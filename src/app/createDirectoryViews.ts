import type { DirectoryHandle, FileHandle } from '../shared/fileSystem';
import type { AppStore } from './store';
import type { AppState, GalleryEntry, ListMode } from './store';
import type { DirectoryCacheItem, SortOrder } from '../shared/model';
import { ensureDirectoryCache } from '../services/directoryCache';
import { createRecursiveMediaCache } from '../services/recursiveMediaCache';
import { getMediaSource } from '../platform/nativeFs';
import {
  collectFavoriteFilesFromConfig,
  ensureConfigNode,
  getConfigNode,
  getFavoriteKeyForItem,
  makeFavoriteSet,
  makeHiddenSet,
  readRootConfig,
} from '../services/storage';
import type { ConfigNode } from '../services/storage';
import { compareNumericText, getMediaType } from '../shared/utils';

export function selectGalleryEntries(
  entries: GalleryEntry[],
  settings: Pick<
    AppState,
    'filterType' | 'searchQuery' | 'listMode' | 'favoriteOnly' | 'favoriteFirst'
  >,
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
    return !settings.favoriteOnly || !!item.isFavorite;
  });
  if (settings.favoriteFirst)
    filtered.sort((a, b) => Number(!!b.item.isFavorite) - Number(!!a.item.isFavorite));
  return filtered;
}

type ViewDependencies = {
  store: AppStore;
  getRoot: () => DirectoryHandle | null;
  getPathSegments: () => string[];
  applySettings: (config: ConfigNode | null) => void;
  openPreview: (dir: DirectoryHandle, files: FileHandle[]) => void;
};
type RenderOptions = { forceRefresh?: boolean; useConfig?: boolean };
type PreparedView = {
  directory: DirectoryHandle;
  root: DirectoryHandle | null;
  path: string;
  mode: ListMode;
  entries: GalleryEntry[];
  sorted: Partial<Record<SortOrder, GalleryEntry[]>>;
};

// One pipeline applies search, filtering and ordering to all three data sources.
export function createDirectoryViews(deps: ViewDependencies) {
  const scans = createRecursiveMediaCache();
  let generation = 0;
  let prepared: PreparedView | null = null;
  const get = deps.store.getState;
  const set = deps.store.setState;
  const showStatus = (message: string, type: AppState['status']['type']) =>
    set({ status: { message, type }, scanPreview: null });
  const entry = (
    item: DirectoryCacheItem,
    parent: DirectoryHandle | null,
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

  function compareEntries(a: GalleryEntry, b: GalleryEntry, mode: ListMode) {
    return mode === 'recursive' || mode === 'favorites'
      ? compareNumericText(pathOf(a).toLowerCase(), pathOf(b).toLowerCase())
      : compareNumericText(a.item.nameLower, b.item.nameLower);
  }

  function publish(source: PreparedView) {
    const settings = get();
    const order = settings.sortOrder;
    const sorted = (source.sorted[order] ??= [...source.entries].sort(
      (a, b) => (order === 'asc' ? 1 : -1) * compareEntries(a, b, source.mode),
    ));
    let entries = selectGalleryEntries(sorted, settings);
    const displayImages: FileHandle[] = [];
    entries = entries.map((value) => {
      if (value.item.type !== 'image') return value;
      const displayIndex = displayImages.length;
      displayImages.push(value.item.handle);
      return { ...value, item: { ...value.item, displayIndex } };
    });
    const empty =
      source.mode === 'favorites'
        ? 'お気に入りに登録された表示可能なファイルがありません。'
        : '表示できるアイテムがありません。';
    set({
      entries,
      displayImages,
      scanPreview: null,
      status: entries.length ? { message: '', type: 'clear' } : { message: empty, type: 'info' },
    });
  }

  async function render(
    dir: DirectoryHandle,
    { forceRefresh = false, useConfig = true }: RenderOptions = {},
  ) {
    const token = ++generation;
    const mode = get().listMode;
    const root = deps.getRoot();
    const segments = deps.getPathSegments();
    const path = segments.join('/');
    const current = () => token === generation;
    // Refilter only the active source. Navigation and explicit refresh still load
    // settings/data normally, while searches publish once without emptying cards.
    if (
      !forceRefresh &&
      !useConfig &&
      prepared?.directory === dir &&
      prepared.root === root &&
      prepared.path === path &&
      prepared.mode === mode
    ) {
      publish(prepared);
      return;
    }
    prepared = null;
    let reusable = true;
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
        handle: FileHandle;
        name: string;
        parentHandle: DirectoryHandle;
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
          scans.get(dir, path, {
            shouldContinue: current,
            onFirstImages: preview,
            onReadError: () => {
              reusable = false;
            },
          }),
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
            type: image.type,
            handle: image.handle,
            name: image.name,
            nameLower: image.name.toLowerCase(),
          });
          return entry(item, image.parentHandle, image.parentPath);
        });
      } else if (mode === 'favorites') {
        const config = await readRootConfig(root);
        if (!current()) return;
        const files = await collectFavoriteFilesFromConfig(root, config, current);
        if (!current()) return;
        entries = files.flatMap((file) => {
          const nameLower = file.name.toLowerCase();
          const type = getMediaType(file.name);
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
        entries = sorted.map((item) => entry(annotate(item), dir, path));
      }
      if (mode === 'recursive' || mode === 'favorites') {
        const direction = get().sortOrder === 'asc' ? 1 : -1;
        entries.sort((a, b) => direction * compareEntries(a, b, mode));
      }
      const source: PreparedView = {
        directory: dir,
        root,
        path,
        mode,
        entries,
        sorted: { [get().sortOrder]: entries },
      };
      if (reusable) prepared = source;
      publish(source);
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
    invalidateEntries: () => {
      prepared = null;
    },
    cancel: () => {
      prepared = null;
      return ++generation;
    },
    clearScanCache: () => {
      prepared = null;
      scans.clear();
    },
  };
}
