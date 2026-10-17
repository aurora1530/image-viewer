import { createConfig } from './createConfig';
import { createAppStore } from './store';
import { readPreferences, writePreference } from '../platform/preferences';
import type { AppStore, AppState } from './store';
import { createPreferences } from './createPreferences';
import { registerApplicationEvents } from '../platform/applicationEvents';
import type { GalleryNavigation, PlaybackReader, MediaServices } from './ports';
import type { GalleryEntry, ListMode } from './store';
import { normalizeDirPathSegments } from '../shared/utils';
import {
  ensureConfigNode,
  flushRootConfig,
  reloadRootConfig,
  saveDirectorySettings,
  toggleFavoriteEntry,
  toggleHiddenEntry,
} from '../services/storage';
import type { ConfigNode } from '../services/storage';
import {
  clearThumbnailCaches as clearDirectoryThumbnailCaches,
  ensureDirectoryCache,
  invalidateDirectoryCache,
  getDirectoryPreviewUrl,
} from '../services/directoryCache';
import { createDirectoryViews } from './createDirectoryViews';
import { thumbnailCache } from '../services/thumbnailCache';
import {
  chooseNativeDirectory,
  isDesktopApp,
  openNativeDirectory,
  getMediaSource,
} from '../platform/nativeFs';
import { createViewer } from './createViewer';

export function createApplication(store: AppStore = createAppStore(readPreferences())) {
  const config = createConfig(store);
  const get = store.getState;
  const set = store.setState;
  const showStatus = (message: string, type: AppState['status']['type']) =>
    set({ status: { message, type }, scanPreview: null });
  const directoryViews = createDirectoryViews({
    store,
    getRoot: () => getRootDirHandle(),
    getPathSegments: () => getCurrentDirPathSegments(),
    applySettings: applySettingsFromConfig,
    openPreview: (dir, files) => {
      clearForwardHistory();
      void viewerController.openViewer(dir, 0, files);
    },
  });
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  const lastVisitedChild = new WeakMap<FileSystemDirectoryHandle, string>();
  const forwardHistory: Array<() => Promise<void>> = [];
  let navigationQueue = Promise.resolve();
  let galleryNavigation: GalleryNavigation | null = null;
  let readPlayback: PlaybackReader | null = null;
  const viewerController = createViewer({
    getThumbnailPreview: (handle) => thumbnailCache.peek(handle),
    setBackgroundWorkPaused: (paused) => thumbnailCache.setPaused(paused),
    getCurrentImageFiles: () => get().currentImageFiles,
    setCurrentImageFiles: (currentImageFiles) => set({ currentImageFiles }),
    getCurrentImageIndex: () => get().currentImageIndex,
    setCurrentImageIndex: (currentImageIndex) => set({ currentImageIndex }),
    getPageOffset: () => get().pageOffset,
    setPageOffset: (pageOffset) => set({ pageOffset }),
    getSortOrder: () => get().sortOrder,
    getIsSinglePageView: () => get().isSinglePageView,
    setIsSinglePageView: (isSinglePageView) => set({ isSinglePageView }),
    render: (patch) => set({ viewer: { ...get().viewer, ...patch } }),
    getVideoPlayback: () => readPlayback?.() ?? { time: 0, paused: true },
    showStatus,
    ensureDirectoryCache,
  });

  const getRootDirHandle = () => get().directories[0] ?? null;
  const getCurrentDirPathSegments = () =>
    get()
      .directories.slice(1)
      .map((handle) => handle.name);
  const getDisplayPath = () =>
    get().directories.at(-1)?.nativePath ??
    get()
      .directories.map((handle) => handle.name)
      .join('/');
  const clearForwardHistory = () => {
    forwardHistory.length = 0;
  };
  const rememberVisitedChild = (parent: FileSystemDirectoryHandle | undefined, name: string) => {
    if (parent) lastVisitedChild.set(parent, name);
  };
  function clearThumbnailCaches() {
    clearDirectoryThumbnailCaches();
    viewerController.clearCache();
  }
  function applySettingsFromConfig(config: ConfigNode | null) {
    preferences.applySettings(config);
  }
  const preferences = createPreferences({
    store,
    persist: writePreference,
    saveSettings: scheduleSaveCurrentDirectoryConfig,
    refreshList: scheduleProcessForCurrentDir,
    refreshPages: () => viewerController.displayPages(),
    navigatePages: (direction) => viewerController.navigatePages(direction),
  });
  function scheduleSaveCurrentDirectoryConfig() {
    const root = getRootDirHandle();
    if (root)
      void saveDirectorySettings(
        root,
        getCurrentDirPathSegments(),
        preferences.getSettingsSnapshot(),
        (message) => showStatus(message, 'error'),
      );
  }
  async function renderActiveDirectoryView(
    dir: FileSystemDirectoryHandle,
    options: { forceRefresh?: boolean; useConfig?: boolean } = {},
  ) {
    await directoryViews.render(dir, options);
  }
  async function enterDirectory(dir: FileSystemDirectoryHandle) {
    clearForwardHistory();
    rememberVisitedChild(get().directories.at(-1), dir.name);
    set({ directories: [...get().directories, dir], searchQuery: '' });
    await renderActiveDirectoryView(dir);
    await scrollToVisitedChild(dir);
  }
  function scheduleProcessForCurrentDir(debounceMs = 150, preserveScrollPosition = false) {
    clearTimeout(searchTimer);
    const scroll = preserveScrollPosition ? { x: window.scrollX, y: window.scrollY } : null;
    const update = async () => {
      const current = get().directories.at(-1);
      if (!current) return;
      await renderActiveDirectoryView(current, { useConfig: false });
      if (scroll) requestAnimationFrame(() => window.scrollTo(scroll.x, scroll.y));
    };
    searchTimer = setTimeout(() => {
      void update().catch(console.error);
    }, debounceMs);
  }
  async function scrollToVisitedChild(handle: FileSystemDirectoryHandle | null) {
    const name = handle ? lastVisitedChild.get(handle) : null;
    if (!name) return;
    const token = directoryViews.generation;
    for (let attempt = 0; attempt < 20 && token === directoryViews.generation; attempt++) {
      const revealed = galleryNavigation?.revealDirectory(name);
      if (revealed) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        if (token === directoryViews.generation) galleryNavigation?.revealDirectory(name);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  async function openRootDirectory(dir: FileSystemDirectoryHandle) {
    await flushRootConfig(getRootDirHandle());
    await reloadRootConfig(dir);
    clearForwardHistory();
    viewerController.closeViewer();
    clearThumbnailCaches();
    directoryViews.clearScanCache();
    set({ directories: [dir], screen: 'directory', searchQuery: '' });
    await renderActiveDirectoryView(dir);
    await scrollToVisitedChild(dir);
  }
  async function showHome(preserveForwardHistory = false) {
    if (!isDesktopApp()) return;
    await flushRootConfig(getRootDirHandle());
    if (!preserveForwardHistory) clearForwardHistory();
    const token = directoryViews.cancel();
    clearTimeout(searchTimer);
    viewerController.closeViewer();
    clearThumbnailCaches();
    directoryViews.clearScanCache();
    set({
      screen: 'home',
      directories: [],
      entries: [],
      displayImages: [],
      listMode: 'directory',
      scanPreview: null,
    });
    const library = await window.desktopApi!.getLibrary();
    if (token === directoryViews.generation) set({ library });
  }
  async function selectRootDirectory() {
    try {
      if (!isDesktopApp() && !window.showDirectoryPicker) {
        showStatus(
          'お使いのブラウザはこの機能に対応していません。Google ChromeやMicrosoft Edgeの最新版をお試しください。',
          'error',
        );
        return;
      }
      const dir = isDesktopApp()
        ? await chooseNativeDirectory()
        : await window.showDirectoryPicker?.();
      if (dir) await openRootDirectory(dir);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      console.error(error);
      showStatus('フォルダーを開けませんでした。', 'error');
    }
  }
  function captureNavigationState() {
    const directories = get().directories.slice();
    const restoreViewer = viewerController.captureView();
    const { listMode, searchQuery } = get();
    const settings = preferences.getSettingsSnapshot();
    const scroll = { x: window.scrollX, y: window.scrollY };
    return async () => {
      if (
        directories.length !== get().directories.length ||
        directories.some((handle, i) => handle !== get().directories[i])
      ) {
        await flushRootConfig(getRootDirHandle());
        clearThumbnailCaches();
        set({ directories: directories.slice(), listMode, searchQuery, screen: 'directory' });
        applySettingsFromConfig({ ...ensureConfigNode({}), settings });
        await renderActiveDirectoryView(directories[directories.length - 1], { useConfig: false });
      }
      window.scrollTo(scroll.x, scroll.y);
      if (restoreViewer) await restoreViewer();
    };
  }
  async function goUpDirectory() {
    const dirs = get().directories;
    if (dirs.length < 2) return;
    const parent = dirs[dirs.length - 2];
    rememberVisitedChild(parent, dirs[dirs.length - 1].name);
    set({ directories: dirs.slice(0, -1), searchQuery: '' });
    await renderActiveDirectoryView(parent);
    await scrollToVisitedChild(parent);
  }
  function navigate(direction: 'back' | 'forward') {
    navigationQueue = navigationQueue.then(async () => {
      try {
        if (direction === 'forward') {
          const restore = forwardHistory.at(-1);
          if (restore) {
            await restore();
            forwardHistory.pop();
          }
        } else if (get().viewer.mode !== 'closed') {
          forwardHistory.push(captureNavigationState());
          viewerController.closeViewer();
        } else if (get().directories.length > 1) {
          forwardHistory.push(captureNavigationState());
          await goUpDirectory();
        } else if (get().directories.length === 1 && isDesktopApp()) {
          forwardHistory.push(captureNavigationState());
          await showHome(true);
        }
      } catch (error) {
        console.error(error);
        showStatus('前の状態を復元できませんでした。', 'error');
      }
    });
    return navigationQueue;
  }
  async function changeListMode(mode: ListMode) {
    const current = get().directories.at(-1);
    if (!current) return;
    const next = mode === 'directory' ? 'directory' : get().listMode === mode ? 'directory' : mode;
    if (next === get().listMode) return;
    if (
      next === 'recursive' &&
      !confirm('このフォルダ配下のすべての画像を読み込みます。続行しますか？')
    )
      return;
    if (
      next === 'favorites' &&
      !confirm(
        'ルート設定の .image-viewer.json からお気に入りファイルをすべて読み込みます。続行しますか？',
      )
    )
      return;
    set({ listMode: next });
    await renderActiveDirectoryView(current);
    if (next === 'directory') await scrollToVisitedChild(current);
  }
  async function copyPath(image = false) {
    if (!get().directories.length) return;
    const path = image
      ? `${getDisplayPath()}/${viewerController.getCurrentFile()?.name ?? ''}`
      : getDisplayPath();
    try {
      await navigator.clipboard.writeText(path);
      showStatus(
        image
          ? 'フルパスをクリップボードにコピーしました。'
          : 'パスをクリップボードにコピーしました。',
        'info',
      );
      const status = get().status;
      setTimeout(() => {
        if (get().status === status) showStatus('', 'clear');
      }, 2000);
    } catch (error) {
      console.error(error);
      showStatus('パスのコピーに失敗しました。', 'error');
    }
  }

  const setGalleryNavigation = (navigation: typeof galleryNavigation) => {
    galleryNavigation = navigation;
  };

  const actions = {
    ...config.actions,
    selectRootDirectory,
    showHome: () => showHome(),
    navigate,
    changeListMode,
    copyPath,
    attachPlaybackReader: (reader: PlaybackReader | null) => {
      readPlayback = reader;
    },
    async openLibrary(item: DesktopLibraryItem) {
      try {
        await openRootDirectory(await openNativeDirectory(item.path));
      } catch (error) {
        console.error(error);
        showStatus('フォルダーを開けませんでした。', 'error');
        await showHome();
      }
    },
    async toggleLibraryFavorite(item: DesktopLibraryItem) {
      await window.desktopApi!.toggleFavoriteRoot(item.path);
      await showHome();
    },
    async removeLibrary(item: DesktopLibraryItem) {
      await window.desktopApi!.removeRecent(item.path);
      await showHome();
    },
    ...preferences.actions,
    closeViewer: viewerController.closeViewer,
    async reload() {
      const current = get().directories.at(-1);
      if (!current) return;
      try {
        await reloadRootConfig(getRootDirHandle());
      } catch (error) {
        console.error(error);
        showStatus('設定ファイルを再読み込みできませんでした。', 'error');
        return;
      }
      invalidateDirectoryCache(current);
      clearThumbnailCaches();
      directoryViews.clearScanCache();
      await renderActiveDirectoryView(current, { forceRefresh: true, useConfig: false });
      await scrollToVisitedChild(current);
    },
    openEntry(entry: GalleryEntry) {
      clearForwardHistory();
      if (entry.item.type === 'directory') return enterDirectory(entry.item.handle);
      if (entry.item.type === 'video') return viewerController.openVideoPlayer(entry.item.handle);
      if (entry.item.type === 'pdf') return viewerController.openPdf(entry.item.handle);
      if (!entry.parent) return;
      const list = get().displayImages;
      const index = list.indexOf(entry.item.handle);
      return viewerController.openViewer(
        entry.parent,
        index >= 0 ? index : (entry.item.displayIndex ?? 0),
        list.length ? list : null,
      );
    },
    readDirectory(dir: FileSystemDirectoryHandle) {
      clearForwardHistory();
      return viewerController.openViewer(dir, 0);
    },
    async toggleEntry(entry: GalleryEntry, kind: 'favorite' | 'hidden') {
      const token = directoryViews.generation;
      const root = getRootDirHandle();
      const next = await (kind === 'favorite' ? toggleFavoriteEntry : toggleHiddenEntry)(
        root,
        normalizeDirPathSegments(entry.parentPath),
        { type: entry.item.type === 'directory' ? 'directory' : 'file', path: entry.item.name },
        (message) => showStatus(message, 'error'),
      );
      if (token !== directoryViews.generation || root !== getRootDirHandle()) return;
      if (kind === 'hidden') {
        set({
          entries: get().entries.filter((e) => e.key !== entry.key),
          displayImages: get().displayImages.filter((handle) => handle !== entry.item.handle),
        });
        if (!get().entries.length) showStatus('表示できるアイテムがありません。', 'info');
        else showStatus('', 'clear');
      } else {
        set({
          entries: get().entries.map((e) =>
            e.key === entry.key ? { ...e, item: { ...e.item, isFavorite: next } } : e,
          ),
        });
        if (get().favoriteFirst || get().favoriteOnly || get().listMode === 'favorites')
          scheduleProcessForCurrentDir(0, true);
      }
    },
  };

  let stop: (() => void) | undefined;
  function start() {
    if (stop) return stop;
    void config.load();
    const detach = registerApplicationEvents({
      getViewerMode: () => get().viewer.mode,
      navigate,
      closeViewer: () => viewerController.closeViewer(),
      turnPage: (direction) => actions.turnPage(direction),
      flush: () => flushRootConfig(getRootDirHandle()),
      saveFailed: () =>
        showStatus(
          '設定を保存できませんでした。保存先を確認してから再度終了してください。',
          'error',
        ),
      refreshThumbnails: () => thumbnailCache.refresh(),
    });
    if (isDesktopApp()) void showHome().catch(console.error);
    let disposed = false;
    stop = () => {
      if (disposed) return;
      disposed = true;
      detach();
      clearTimeout(searchTimer);
      directoryViews.cancel();
      viewerController.closeViewer();
      clearThumbnailCaches();
      directoryViews.clearScanCache();
      stop = undefined;
    };
    return stop;
  }
  return {
    store,
    actions,
    start,
    setGalleryNavigation,
    capabilities: { desktop: isDesktopApp() },
    media: {
      getThumbnail: (
        handle: FileSystemFileHandle,
        shouldContinue: () => boolean,
        getPriority: () => number,
      ) => thumbnailCache.get(handle, shouldContinue, getPriority),
      invalidateThumbnail: (handle: FileSystemFileHandle) => thumbnailCache.invalidate(handle),
      getDirectoryPreview: getDirectoryPreviewUrl,
      getMediaSource,
    } satisfies MediaServices,
  };
}
export type Application = ReturnType<typeof createApplication>;
