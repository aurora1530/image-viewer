import { appStore, normalizeThumbnailSize, setFavoriteMode, showStatus } from './appStore';
import type { FavoriteMode, GalleryEntry, ListMode } from './appStore';
import type { FilterType } from './state';
import { normalizeDirPathSegments } from './utils';
import { ensureConfigNode, flushRootConfig, reloadRootConfig, saveDirectorySettings, toggleFavoriteEntry, toggleHiddenEntry } from './storage';
import type { ConfigNode } from './storage';
import { clearThumbnailCaches as clearDirectoryThumbnailCaches, ensureDirectoryCache, invalidateDirectoryCache } from './directoryCache';
import { createDirectoryViews } from './directoryViews';
import { thumbnailCache } from './thumbnailCache';
import { chooseNativeDirectory, isDesktopApp, openNativeDirectory } from './nativeFs';
import { createNavigationInput } from './navigationInput';
import { createViewer } from './viewer';

const get = appStore.getState;
const set = appStore.setState;
const directoryViews = createDirectoryViews({
  getRoot: () => getRootDirHandle(), getPathSegments: () => getCurrentDirPathSegments(),
  applySettings: applySettingsFromConfig,
  openPreview: (dir, files) => { clearForwardHistory(); void viewerController.openViewer(dir, 0, files); }
});
let searchTimer: ReturnType<typeof setTimeout> | undefined;
const lastVisitedChild = new WeakMap<FileSystemDirectoryHandle, string>();
const forwardHistory: Array<() => Promise<void>> = [];
let navigationQueue = Promise.resolve();
let galleryNavigation: { scrollToDirectory(name: string): HTMLElement | null } | null = null;
let videoElement: HTMLVideoElement | null = null;
export const viewerController = createViewer({
  getThumbnailPreview: handle => thumbnailCache.peek(handle),
  setBackgroundWorkPaused: paused => thumbnailCache.setPaused(paused),
  getCurrentImageFiles: () => get().currentImageFiles,
  setCurrentImageFiles: currentImageFiles => set({ currentImageFiles }),
  getCurrentImageIndex: () => get().currentImageIndex,
  setCurrentImageIndex: currentImageIndex => set({ currentImageIndex }),
  getPageOffset: () => get().pageOffset,
  setPageOffset: pageOffset => set({ pageOffset }),
  getSortOrder: () => get().sortOrder,
  getIsSinglePageView: () => get().isSinglePageView,
  setIsSinglePageView: isSinglePageView => set({ isSinglePageView }),
  render: patch => set({ viewer: { ...get().viewer, ...patch } }),
  getVideoPlayback: () => ({ time: videoElement?.currentTime ?? 0, paused: videoElement?.paused ?? true }),
  showStatus, ensureDirectoryCache
});

const isFilterType = (value: string): value is FilterType => ['all', 'directory', 'image', 'gif', 'video'].includes(value);
const getRootDirHandle = () => get().directories[0] ?? null;
const getCurrentDirPathSegments = () => get().directories.slice(1).map(handle => handle.name);
const getDisplayPath = () => get().directories.at(-1)?.nativePath ?? get().directories.map(handle => handle.name).join('/');
const clearForwardHistory = () => { forwardHistory.length = 0; };
const rememberVisitedChild = (parent: FileSystemDirectoryHandle | undefined, name: string) => {
  if (parent) lastVisitedChild.set(parent, name);
};
function clearThumbnailCaches() {
  clearDirectoryThumbnailCaches();
  viewerController.clearCache();
}
function getCurrentSettingsSnapshot() {
  const s = get();
  return {
    thumbnailSizeIndex: s.thumbnailSizeIndex, sortOrder: s.sortOrder, filterType: s.filterType,
    favoriteFirst: s.favoriteMode === 'first', favoriteOnly: s.favoriteMode === 'only'
  };
}
function applySettingsFromConfig(config: ConfigNode | null) {
  const settings = config?.settings;
  if (!settings) return;
  const next = { ...getCurrentSettingsSnapshot() };
  if (typeof settings.thumbnailSizeIndex === 'number' || typeof settings.thumbnailSizeIndex === 'string') {
    next.thumbnailSizeIndex = normalizeThumbnailSize(Number(settings.thumbnailSizeIndex));
  }
  if (settings.sortOrder === 'asc' || settings.sortOrder === 'desc') next.sortOrder = settings.sortOrder;
  if (typeof settings.filterType === 'string' && isFilterType(settings.filterType)) next.filterType = settings.filterType;
  if (typeof settings.favoriteFirst === 'boolean') next.favoriteFirst = settings.favoriteFirst;
  if (typeof settings.favoriteOnly === 'boolean') next.favoriteOnly = settings.favoriteOnly;
  set({
    thumbnailSizeIndex: next.thumbnailSizeIndex, sortOrder: next.sortOrder, filterType: next.filterType,
    favoriteMode: next.favoriteOnly ? 'only' : next.favoriteFirst ? 'first' : 'off'
  });
}
function scheduleSaveCurrentDirectoryConfig() {
  const root = getRootDirHandle();
  if (root) void saveDirectorySettings(root, getCurrentDirPathSegments(), getCurrentSettingsSnapshot(), message => showStatus(message, 'error'));
}
async function renderActiveDirectoryView(dir: FileSystemDirectoryHandle, options: { forceRefresh?: boolean; useConfig?: boolean } = {}) {
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
  searchTimer = setTimeout(async () => {
    const current = get().directories.at(-1);
    if (!current) return;
    await renderActiveDirectoryView(current, { useConfig: false });
    if (scroll) requestAnimationFrame(() => window.scrollTo(scroll.x, scroll.y));
  }, debounceMs);
}
async function scrollToVisitedChild(handle: FileSystemDirectoryHandle | null) {
  const name = handle ? lastVisitedChild.get(handle) : null;
  if (!name) return;
  const token = directoryViews.generation;
  for (let attempt = 0; attempt < 20 && token === directoryViews.generation; attempt++) {
    const target = galleryNavigation?.scrollToDirectory(name);
    if (target) {
      target.scrollIntoView({ block: 'center' });
      await new Promise(resolve => setTimeout(resolve, 300));
      if (token === directoryViews.generation) galleryNavigation?.scrollToDirectory(name)?.scrollIntoView({ block: 'center' });
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
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
  set({ screen: 'home', directories: [], entries: [], displayImages: [], listMode: 'directory', scanPreview: null });
  const library = await window.desktopApi!.getLibrary();
  if (token === directoryViews.generation) set({ library });
}
async function selectRootDirectory() {
  try {
    if (!isDesktopApp() && !window.showDirectoryPicker) {
      showStatus('お使いのブラウザはこの機能に対応していません。Google ChromeやMicrosoft Edgeの最新版をお試しください。', 'error');
      return;
    }
    const dir = isDesktopApp() ? await chooseNativeDirectory() : await window.showDirectoryPicker?.();
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
  const settings = getCurrentSettingsSnapshot();
  const scroll = { x: window.scrollX, y: window.scrollY };
  return async () => {
    if (directories.length !== get().directories.length || directories.some((handle, i) => handle !== get().directories[i])) {
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
        if (restore) { await restore(); forwardHistory.pop(); }
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
    } catch (error) { console.error(error); showStatus('前の状態を復元できませんでした。', 'error'); }
  });
  return navigationQueue;
}
async function changeListMode(mode: ListMode) {
  const current = get().directories.at(-1);
  if (!current) return;
  const next = get().listMode === mode ? 'directory' : mode;
  if (next === 'recursive' && !confirm('このフォルダ配下のすべての画像を読み込みます。続行しますか？')) return;
  if (next === 'favorites' && !confirm('ルート設定の .image-viewer.json からお気に入りファイルをすべて読み込みます。続行しますか？')) return;
  set({ listMode: next });
  await renderActiveDirectoryView(current);
  if (next === 'directory') await scrollToVisitedChild(current);
}
async function copyPath(image = false) {
  if (!get().directories.length) return;
  const path = image ? `${getDisplayPath()}/${get().currentImageFiles[get().currentImageIndex]?.name ?? ''}` : getDisplayPath();
  try {
    await navigator.clipboard.writeText(path);
    showStatus(image ? 'フルパスをクリップボードにコピーしました。' : 'パスをクリップボードにコピーしました。', 'info');
    const status = get().status;
    setTimeout(() => { if (get().status === status) showStatus('', 'clear'); }, 2000);
  } catch (error) { console.error(error); showStatus('パスのコピーに失敗しました。', 'error'); }
}

export const actions = {
  selectRootDirectory, showHome: () => showHome(), navigate, changeListMode, copyPath,
  setGalleryNavigation: (navigation: typeof galleryNavigation) => { galleryNavigation = navigation; },
  attachVideo: (video: HTMLVideoElement | null) => { videoElement = video; },
  async openLibrary(item: DesktopLibraryItem) {
    try { await openRootDirectory(await openNativeDirectory(item.path)); }
    catch (error) { console.error(error); showStatus('フォルダーを開けませんでした。', 'error'); await showHome(); }
  },
  async toggleLibraryFavorite(item: DesktopLibraryItem) { await window.desktopApi!.toggleFavoriteRoot(item.path); await showHome(); },
  async removeLibrary(item: DesktopLibraryItem) { await window.desktopApi!.removeRecent(item.path); await showHome(); },
  setThumbnailSize(value: number) {
    const thumbnailSizeIndex = normalizeThumbnailSize(value);
    set({ thumbnailSizeIndex });
    localStorage.setItem('thumbnailSizeIndex', String(thumbnailSizeIndex));
    scheduleSaveCurrentDirectoryConfig();
  },
  setFilter(value: string) { set({ filterType: isFilterType(value) ? value : 'all' }); scheduleSaveCurrentDirectoryConfig(); scheduleProcessForCurrentDir(0); },
  setSearch(searchQuery: string) { set({ searchQuery }); scheduleProcessForCurrentDir(180); },
  toggleSort() { set({ sortOrder: get().sortOrder === 'asc' ? 'desc' : 'asc' }); scheduleSaveCurrentDirectoryConfig(); scheduleProcessForCurrentDir(0); },
  setFavoriteMode(mode: FavoriteMode) { setFavoriteMode(mode); scheduleSaveCurrentDirectoryConfig(); scheduleProcessForCurrentDir(0); },
  toggleUi() {
    const isUiHidden = !get().isUiHidden;
    set({ isUiHidden, isUiDockRevealed: false });
    localStorage.setItem('isUiHidden', isUiHidden ? '1' : '0');
  },
  revealDock(isUiDockRevealed: boolean) {
    if (get().isUiHidden && get().isUiDockRevealed !== isUiDockRevealed) set({ isUiDockRevealed });
  },
  toggleSinglePage() {
    const isSinglePageView = !get().isSinglePageView;
    set({ isSinglePageView }); localStorage.setItem('isSinglePageView', isSinglePageView ? '1' : '0');
    void viewerController.displayPages();
  },
  adjustSpread() { set({ pageOffset: 1 - get().pageOffset }); void viewerController.displayPages(); },
  turnPage(direction: number) { viewerController.navigatePages(direction * (get().isSinglePageView ? 1 : 2)); },
  closeViewer: viewerController.closeViewer,
  async reload() {
    const current = get().directories.at(-1);
    if (!current) return;
    try { await reloadRootConfig(getRootDirHandle()); }
    catch (error) { console.error(error); showStatus('設定ファイルを再読み込みできませんでした。', 'error'); return; }
    invalidateDirectoryCache(current); clearThumbnailCaches(); directoryViews.clearScanCache();
    await renderActiveDirectoryView(current, { forceRefresh: true, useConfig: false });
    await scrollToVisitedChild(current);
  },
  openEntry(entry: GalleryEntry) {
    clearForwardHistory();
    if (entry.item.type === 'directory') return enterDirectory(entry.item.handle);
    if (entry.item.type === 'video') return viewerController.openVideoPlayer(entry.item.handle);
    if (!entry.parent) return;
    const list = get().displayImages;
    const index = list.indexOf(entry.item.handle);
    return viewerController.openViewer(entry.parent, index >= 0 ? index : entry.item.displayIndex ?? 0, list.length ? list : null);
  },
  readDirectory(dir: FileSystemDirectoryHandle) { clearForwardHistory(); return viewerController.openViewer(dir, 0); },
  async toggleEntry(entry: GalleryEntry, kind: 'favorite' | 'hidden') {
    const token = directoryViews.generation;
    const root = getRootDirHandle();
    const next = await (kind === 'favorite' ? toggleFavoriteEntry : toggleHiddenEntry)(root, normalizeDirPathSegments(entry.parentPath),
      { type: entry.item.type === 'directory' ? 'directory' : 'file', path: entry.item.name }, message => showStatus(message, 'error'));
    if (token !== directoryViews.generation || root !== getRootDirHandle()) return;
    if (kind === 'hidden') {
      set({ entries: get().entries.filter(e => e.key !== entry.key), displayImages: get().displayImages.filter(handle => handle !== entry.item.handle) });
      if (!get().entries.length) showStatus('表示できるアイテムがありません。', 'info');
      else showStatus('', 'clear');
    } else {
      set({ entries: get().entries.map(e => e.key === entry.key ? { ...e, item: { ...e.item, isFavorite: next } } : e) });
      if (get().favoriteMode !== 'off' || get().listMode === 'favorites') scheduleProcessForCurrentDir(0, true);
    }
  }
};

export function startApplication() {
  const controller = new AbortController();
  const options = { signal: controller.signal };
  const flush = () => flushRootConfig(getRootDirHandle());
  const unsubscribeClose = window.desktopApi?.onBeforeClose(async () => {
    try { await flush(); return true; }
    catch (error) { console.error(error); showStatus('設定を保存できませんでした。保存先を確認してから再度終了してください。', 'error'); return false; }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush().catch(console.error);
  }, options);
  window.addEventListener('pagehide', () => { void flush().catch(console.error); }, options);
  document.addEventListener('keydown', event => {
    if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault(); void navigate(event.key === 'ArrowLeft' ? 'back' : 'forward'); return;
    }
    if (get().viewer.mode === 'closed') return;
    if (event.key === 'Escape') { event.preventDefault(); viewerController.closeViewer(); return; }
    if (get().viewer.mode === 'video') return;
    if (event.key === 'ArrowLeft') actions.turnPage(1);
    if (event.key === 'ArrowRight') actions.turnPage(-1);
  }, options);
  const input = createNavigationInput(direction => { void navigate(direction); });
  const unsubscribeNavigation = window.desktopApi?.onNavigate(direction => input(direction, 'command'));
  for (const type of ['mousedown', 'mouseup', 'auxclick'] as const) {
    document.addEventListener(type, event => {
      if (event.button !== 3 && event.button !== 4) return;
      event.preventDefault();
      if (type === 'mouseup') input(event.button === 3 ? 'back' : 'forward', 'mouse');
    }, { ...options, capture: true });
  }
  window.addEventListener('scroll', () => thumbnailCache.refresh(), { ...options, passive: true });
  if (isDesktopApp()) void showHome().catch(console.error);
  return () => {
    controller.abort(); unsubscribeClose?.(); unsubscribeNavigation?.(); clearTimeout(searchTimer);
    directoryViews.cancel(); viewerController.closeViewer(); clearThumbnailCaches(); directoryViews.clearScanCache();
  };
}
