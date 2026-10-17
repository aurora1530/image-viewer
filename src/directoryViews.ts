import { appStore, showStatus } from './appStore';
import type { AppState, GalleryEntry } from './appStore';
import { CONFIG } from './state';
import type { DirectoryCacheItem } from './state';
import { ensureDirectoryCache } from './directoryCache';
import { createRecursiveImageCache } from './recursiveImageCache';
import { getMediaSource } from './nativeFs';
import {
  collectFavoriteFilesFromConfig,
  ensureConfigNode,
  getConfigNode,
  getFavoriteKeyForItem,
  makeFavoriteSet,
  makeHiddenSet,
  readRootConfig,
} from './storage';
import type { ConfigNode } from './storage';
import { compareNumericText, isImageFileName } from './utils';

export function selectGalleryEntries(
  entries: GalleryEntry[],
  settings: Pick<AppState, 'filterType' | 'searchQuery' | 'listMode' | 'favoriteMode'>,
) {
  const query = settings.searchQuery.toLowerCase();
  const filtered = entries.filter(({ item }) => {
    const type = settings.filterType;
    if (
      type === 'gif'
        ? item.type !== 'image' || !item.nameLower.endsWith('.gif')
        : type !== 'all' && item.type !== type
    )
      return false;
    if (query && !item.nameLower.includes(query)) return false;
    if (settings.listMode === 'hidden' ? !item.isHidden : item.isHidden) return false;
    return settings.favoriteMode !== 'only' || !!item.isFavorite;
  });
  if (settings.favoriteMode === 'first')
    filtered.sort((a, b) => Number(!!b.item.isFavorite) - Number(!!a.item.isFavorite));
  return filtered;
}

type ViewDependencies = {
  getRoot: () => FileSystemDirectoryHandle | null;
  getPathSegments: () => string[];
  applySettings: (config: ConfigNode | null) => void;
  openPreview: (dir: FileSystemDirectoryHandle, files: FileSystemFileHandle[]) => void;
};
type RenderOptions = { forceRefresh?: boolean; useConfig?: boolean };

// One pipeline applies search, filtering and ordering to all three data sources.
export function createDirectoryViews(deps: ViewDependencies) {
  const scans = createRecursiveImageCache();
  let generation = 0;
  const get = appStore.getState;
  const set = appStore.setState;
  const entry = (
    item: DirectoryCacheItem,
    parent: FileSystemDirectoryHandle | null,
    parentPath: string,
  ): GalleryEntry => ({
    item,
    parent,
    parentPath,
    key: `${parentPath}/${item.type}/${item.name}`,
  });
  const pathOf = (value: GalleryEntry) =>
    value.parentPath ? `${value.parentPath}/${value.item.name}` : value.item.name;
  function annotator(config: ConfigNode) {
    const favorites = makeFavoriteSet(config);
    const hidden = makeHiddenSet(config);
    return (item: DirectoryCacheItem): DirectoryCacheItem => {
      const key = getFavoriteKeyForItem(item);
      return {
        ...item,
        isFavorite: key ? favorites.has(key) : false,
        isHidden: key ? hidden.has(key) : false,
      };
    };
  }

  async function render(
    dir: FileSystemDirectoryHandle,
    { forceRefresh = false, useConfig = true }: RenderOptions = {},
  ) {
    const token = ++generation;
    const mode = get().listMode;
    const root = deps.getRoot();
    const segments = deps.getPathSegments();
    const current = () => token === generation;
    let previewActive = true;
    let previewStarted = false;
    let previewUrl: string | null = null;
    set({ entries: [], displayImages: [] });
    showStatus(
      mode === 'favorites' ? 'お気に入りを読み込んでいます...' : 'フォルダを読み込んでいます...',
      'loading',
    );

    const preview = (
      images: {
        handle: FileSystemFileHandle;
        name: string;
        parentHandle: FileSystemDirectoryHandle;
      }[],
    ) => {
      if (previewStarted || !current() || !images.length) return;
      previewStarted = true;
      const image = images[0];
      void getMediaSource(image.handle)
        .then((source) => {
          if (!previewActive || !current()) {
            if (source.objectUrl) URL.revokeObjectURL(source.url);
            return;
          }
          if (source.objectUrl) previewUrl = source.url;
          set({
            scanPreview: {
              url: source.url,
              name: image.name,
              open: () => deps.openPreview(image.parentHandle, [image.handle]),
            },
          });
        })
        .catch((error) => console.error('先頭画像のプレビューに失敗:', error));
    };

    try {
      let entries: GalleryEntry[];
      if (mode === 'recursive') {
        const [images, config] = await Promise.all([
          scans.get(dir, segments.join('/'), { shouldContinue: current, onFirstImages: preview }),
          readRootConfig(root),
        ]);
        if (!current()) return;
        const nodes = new Map<string, ReturnType<typeof annotator>>();
        entries = images.map((image) => {
          let annotate = nodes.get(image.parentPath);
          if (!annotate) {
            annotate = annotator(
              getConfigNode(config, image.parentPath, { create: false }) || ensureConfigNode({}),
            );
            nodes.set(image.parentPath, annotate);
          }
          const item = annotate({
            type: 'image',
            handle: image.handle,
            name: image.name,
            nameLower: image.name.toLowerCase(),
          });
          return entry(item, image.parentHandle, image.parentPath);
        });
      } else if (mode === 'favorites') {
        const config = await readRootConfig(root);
        const files = await collectFavoriteFilesFromConfig(root, config);
        if (!current()) return;
        entries = files.flatMap((file) => {
          const nameLower = file.name.toLowerCase();
          const type = isImageFileName(file.name, CONFIG.IMAGE_EXTENSIONS)
            ? 'image'
            : CONFIG.VIDEO_EXTENSIONS.some((extension) => nameLower.endsWith(extension))
              ? 'video'
              : null;
          return type
            ? [
                entry(
                  {
                    type,
                    handle: file.handle,
                    name: file.name,
                    nameLower,
                    isFavorite: true,
                    isHidden: file.isHidden,
                  },
                  file.parentHandle,
                  file.parentPath,
                ),
              ]
            : [];
        });
      } else {
        const [cache, config] = await Promise.all([
          ensureDirectoryCache(dir, { forceRefresh }),
          readRootConfig(root),
        ]);
        if (!current()) return;
        const node = getConfigNode(config, segments, { create: false }) || ensureConfigNode({});
        if (useConfig) deps.applySettings(node);
        const order = get().sortOrder;
        const sorted = (cache.sorted[order] ??= [...cache.items].sort(
          (a, b) => (order === 'asc' ? 1 : -1) * compareNumericText(a.nameLower, b.nameLower),
        ));
        const annotate = annotator(node);
        entries = sorted.map((item) => entry(annotate(item), dir, segments.join('/')));
      }
      if (mode === 'recursive' || mode === 'favorites') {
        const direction = get().sortOrder === 'asc' ? 1 : -1;
        entries.sort(
          (a, b) =>
            direction * compareNumericText(pathOf(a).toLowerCase(), pathOf(b).toLowerCase()),
        );
      }
      entries = selectGalleryEntries(entries, get());
      const displayImages: FileSystemFileHandle[] = [];
      entries = entries.map((value) => {
        if (value.item.type !== 'image') return value;
        const displayIndex = displayImages.length;
        displayImages.push(value.item.handle);
        return { ...value, item: { ...value.item, displayIndex } };
      });
      const empty =
        mode === 'recursive'
          ? '表示できる画像がありません。'
          : mode === 'favorites'
            ? 'お気に入りに登録された表示可能なファイルがありません。'
            : '表示できるアイテムがありません。';
      set({
        entries,
        displayImages,
        scanPreview: null,
        status: entries.length ? { message: '', type: 'clear' } : { message: empty, type: 'info' },
      });
    } catch (error) {
      if (!current()) return;
      console.error('一覧の読み込みに失敗:', error);
      showStatus(
        mode === 'favorites'
          ? 'お気に入り一覧の読み込み中にエラーが発生しました。'
          : 'フォルダの読み込み中にエラーが発生しました。',
        'error',
      );
    } finally {
      previewActive = false;
      if (current()) set({ scanPreview: null });
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    }
  }
  return {
    render,
    get generation() {
      return generation;
    },
    cancel: () => ++generation,
    clearScanCache: () => scans.clear(),
  };
}
