import type { DirectoryCacheEntry, DirectoryCacheImageItem, DirectoryCacheItem } from './state';
type StatusType = 'info' | 'error' | 'loading' | 'clear';
import { getMediaSource } from './nativeFs';
import { compareNumericText } from './utils';
import { createImagePageCache } from './imagePageCache';
import { getOriginalImageSource } from './originalImageCache';

type Source = { url: string; objectUrl: boolean };

type CacheItem = DirectoryCacheItem;
type CacheEntry = DirectoryCacheEntry;

export type ViewerPresentation = {
  mode: 'closed' | 'image' | 'video';
  left: string | null;
  right: string | null;
  video: string | null;
  loading: string;
  counter: string;
  playback: { time: number; paused: boolean } | null;
};

type ViewerDeps = {
  getImageSource?: (handle: FileSystemFileHandle) => Promise<Source>;
  getThumbnailPreview?: (handle: FileSystemFileHandle) => Source | null;
  setBackgroundWorkPaused?: (paused: boolean) => void;
  render: (patch: Partial<ViewerPresentation>) => void;
  getVideoPlayback?: () => { time: number; paused: boolean };
  getCurrentImageFiles: () => FileSystemFileHandle[];
  setCurrentImageFiles: (files: FileSystemFileHandle[]) => void;
  getCurrentImageIndex: () => number;
  setCurrentImageIndex: (index: number) => void;
  getPageOffset: () => number;
  setPageOffset: (offset: number) => void;
  getSortOrder: () => 'asc' | 'desc';
  getIsSinglePageView: () => boolean;
  setIsSinglePageView: (value: boolean) => void;
  showStatus: (message: string, type: StatusType) => void;
  ensureDirectoryCache: (dirHandle: FileSystemDirectoryHandle) => Promise<CacheEntry>;
};

export function createViewer(deps: ViewerDeps) {
  const {
    getCurrentImageFiles,
    setCurrentImageFiles,
    getCurrentImageIndex,
    setCurrentImageIndex,
    getPageOffset,
    setPageOffset,
    getSortOrder,
    getIsSinglePageView,
    setIsSinglePageView,
    showStatus,
    ensureDirectoryCache,
  } = deps;

  const imageCache = createImagePageCache(deps.getImageSource ?? getOriginalImageSource);
  const previews = new Map<'left' | 'right', Source>();
  let loadingMessage = '';
  const render = deps.render;

  function clearPreview(element: 'left' | 'right') {
    const source = previews.get(element);
    if (source?.objectUrl) URL.revokeObjectURL(source.url);
    previews.delete(element);
  }
  let viewerSession = 0;
  let displayToken = 0;
  let mediaMode: 'closed' | 'image' | 'video' = 'closed';
  let videoSource: { url: string; objectUrl: boolean } | null = null;
  let currentVideo: FileSystemFileHandle | null = null;
  let currentImageDirectory: FileSystemDirectoryHandle | null = null;

  function captureView(): (() => Promise<void>) | null {
    if (mediaMode === 'video' && currentVideo) {
      const handle = currentVideo;
      const playback = deps.getVideoPlayback?.() ?? { time: 0, paused: true };
      return async () => {
        await openVideoPlayer(handle);
        render({ playback });
      };
    }
    if (mediaMode !== 'image' || !currentImageDirectory) return null;
    const directory = currentImageDirectory;
    const files = getCurrentImageFiles().slice();
    const index = getCurrentImageIndex();
    const offset = getPageOffset();
    const single = getIsSinglePageView();
    return async () => {
      // The captured list avoids rescanning and preserves recursive/favorite lists.
      await openViewer(directory, index, files);
      setPageOffset(offset);
      setIsSinglePageView(single);
      await displayPages();
    };
  }

  function resetMedia() {
    viewerSession++;
    displayToken++;
    mediaMode = 'closed';
    currentVideo = null;
    clearPreview('left');
    clearPreview('right');
    render({
      mode: 'closed',
      left: null,
      right: null,
      video: null,
      loading: '',
      counter: '',
      playback: null,
    });
    imageCache.discardPending();
    setCurrentImageFiles([]);

    if (videoSource?.objectUrl) URL.revokeObjectURL(videoSource.url);
    videoSource = null;
    return viewerSession;
  }

  function isImageItem(item: CacheItem): item is DirectoryCacheImageItem {
    return item.type === 'image';
  }

  async function openViewer(
    dirHandle: FileSystemDirectoryHandle,
    startIndex: number,
    overrideImageList: FileSystemFileHandle[] | null = null,
  ) {
    const session = resetMedia();
    currentImageDirectory = dirHandle;
    mediaMode = 'image';
    deps.setBackgroundWorkPaused?.(true);
    try {
      showStatus('画像を読み込んでいます...', 'loading');
      if (Array.isArray(overrideImageList) && overrideImageList.length > 0) {
        setCurrentImageFiles(overrideImageList.slice());
      } else {
        const cacheEntry = await ensureDirectoryCache(dirHandle);
        if (session !== viewerSession) return;
        const sortKey = getSortOrder();
        if (!cacheEntry.sorted[sortKey]) {
          const sorted = [...cacheEntry.items].sort((a, b) => {
            const nameA = a.nameLower || a.name.toLowerCase();
            const nameB = b.nameLower || b.name.toLowerCase();
            return sortKey === 'asc'
              ? compareNumericText(nameA, nameB)
              : compareNumericText(nameB, nameA);
          });
          cacheEntry.sorted[sortKey] = sorted;
        }
        const sortedItems = cacheEntry.sorted[sortKey] ?? [];
        setCurrentImageFiles(sortedItems.filter(isImageItem).map((i) => i.handle));
      }
      if (getCurrentImageFiles().length === 0) {
        closeViewer();
        showStatus('このフォルダには表示できる画像がありません。', 'info');
        return;
      }
      setCurrentImageIndex(startIndex);
      setPageOffset(0);
      setIsSinglePageView(localStorage.getItem('isSinglePageView') === '1');
      render({ mode: 'image' });
      await displayPages();
      if (session === viewerSession) showStatus('', 'clear');
    } catch (err) {
      if (session !== viewerSession) return;
      console.error('ビューワー起動エラー:', err);
      showStatus('画像の読み込みに失敗しました。', 'error');
      closeViewer();
    }
  }

  async function openVideoPlayer(videoHandle: FileSystemFileHandle) {
    const session = resetMedia();
    mediaMode = 'video';
    currentVideo = videoHandle;
    imageCache.clear();
    deps.setBackgroundWorkPaused?.(true);
    try {
      render({ mode: 'video' });
      const source = await getMediaSource(videoHandle);
      if (session !== viewerSession) {
        if (source.objectUrl) URL.revokeObjectURL(source.url);
        return;
      }
      const url = source.url;
      videoSource = source;
      render({ video: url });
    } catch (err) {
      if (session !== viewerSession) return;
      console.error('動画再生エラー:', err);
      showStatus('動画の再生に失敗しました。', 'error');
      closeViewer();
    }
  }

  function closeViewer() {
    resetMedia();

    deps.setBackgroundWorkPaused?.(false);
    if (document.fullscreenElement) void document.exitFullscreen();
  }

  async function displayPages() {
    if (mediaMode !== 'image') return;
    const session = viewerSession;
    const token = ++displayToken;
    const files = getCurrentImageFiles();
    const total = files.length;
    if (!total) return;
    const single = getIsSinglePageView();
    const index = getCurrentImageIndex();
    let baseIndex = index;
    if (baseIndex % 2 !== 0 && baseIndex > 0) baseIndex--;
    const rightIndex = single ? index : baseIndex - getPageOffset();
    const leftIndex = single ? -1 : baseIndex + 1 - getPageOffset();
    const visible = [rightIndex, leftIndex].filter((i) => i >= 0 && i < total);
    const neighbors: FileSystemFileHandle[] = [];
    if (visible.length) {
      // 表示中の最大2枚と、前後各2枚を保持する。端では先頭・末尾につなぐ。
      const first = Math.min(...visible);
      const last = Math.max(...visible);
      for (const i of [last + 1, last + 2, first - 1, first - 2]) {
        const handle = files[(i + total) % total];
        if (!visible.some((v) => files[v] === handle) && !neighbors.includes(handle))
          neighbors.push(handle);
      }
    }
    imageCache.retain([...visible.map((i) => files[i]), ...neighbors]);
    const load = async (i: number) => {
      if (i < 0 || i >= total) return null;
      try {
        return await imageCache.get(files[i]);
      } catch (err) {
        if (session === viewerSession && token === displayToken)
          console.error(`画像表示エラー (index: ${i}):`, err);
        return null;
      }
    };
    const current = () => session === viewerSession && token === displayToken;
    let pending = visible.length;
    loadingMessage = pending ? '元画像を読み込んでいます…' : '';
    render({ loading: loadingMessage });
    const show = (element: 'left' | 'right', source: Source | null) =>
      render({ [element]: source?.url ?? null });
    // A slow second page must not block the ready page or its cached preview.
    await Promise.all(
      (
        [
          ['right', rightIndex],
          ['left', leftIndex],
        ] as const
      ).map(async ([element, i]) => {
        clearPreview(element);
        if (i < 0 || i >= total) {
          show(element, null);
          return;
        }
        const ready = imageCache.peek(files[i]);
        const preview = ready ? null : (deps.getThumbnailPreview?.(files[i]) ?? null);
        if (preview) previews.set(element, preview);
        show(element, ready ?? preview);
        const page = await load(i);
        if (!current()) return;
        if (page) {
          show(element, page);
          clearPreview(element);
        } else loadingMessage = '元画像の読み込みに失敗しました。';
        pending--;
        if (pending === 0 && loadingMessage === '元画像を読み込んでいます…') loadingMessage = '';
        render({ loading: loadingMessage });
      }),
    );
    if (!current()) return;
    const pageNumber = (i: number) => (i >= 0 && i < total ? i + 1 : '-');
    render({
      counter: single
        ? `${index + 1} / ${total}`
        : `${pageNumber(leftIndex)} - ${pageNumber(rightIndex)} / ${total}`,
    });
    void preloadNeighbors(neighbors, session, token);
  }

  async function preloadNeighbors(handles: FileSystemFileHandle[], session: number, token: number) {
    // 表示対象のデコード完了後に1枚ずつ読み、現在ページの処理を優先する。
    for (const handle of handles) {
      if (session !== viewerSession || token !== displayToken) return;
      try {
        await imageCache.get(handle);
      } catch {
        /* 表示時に再試行する */
      }
    }
  }

  function navigatePages(direction: number) {
    const total = getCurrentImageFiles().length;
    if (total <= 1) return;

    let newIndex = getCurrentImageIndex() + direction;

    if (newIndex >= total) {
      newIndex = 0;
    } else if (newIndex < 0) {
      if (getIsSinglePageView()) {
        newIndex = total - 1;
      } else {
        const lastSpreadIndex = total % 2 === 0 ? total - 2 : total - 1;
        newIndex = lastSpreadIndex < 0 ? 0 : lastSpreadIndex;
      }
    }

    if (newIndex !== getCurrentImageIndex()) {
      setCurrentImageIndex(newIndex);
      void displayPages();
    }
  }

  return {
    captureView,
    clearCache: () => imageCache.clear(),
    openViewer,
    openVideoPlayer,
    closeViewer,
    displayPages,
    navigatePages,
  };
}
