export type SortOrder = 'asc' | 'desc';
export type FilterType = 'all' | 'directory' | 'image' | 'gif' | 'video';

export type DirectoryCacheDirectoryItem = {
  type: 'directory';
  handle: FileSystemDirectoryHandle;
  name: string;
  nameLower: string;
  imageIndex?: number;
  displayIndex?: number;
  isFavorite?: boolean;
};

export type DirectoryCacheImageItem = {
  type: 'image';
  handle: FileSystemFileHandle;
  name: string;
  nameLower: string;
  imageIndex?: number;
  displayIndex?: number;
  isFavorite?: boolean;
};

export type DirectoryCacheVideoItem = {
  type: 'video';
  handle: FileSystemFileHandle;
  name: string;
  nameLower: string;
  imageIndex?: number;
  displayIndex?: number;
  isFavorite?: boolean;
};

export type DirectoryCacheItem =
  | DirectoryCacheDirectoryItem
  | DirectoryCacheImageItem
  | DirectoryCacheVideoItem;

export type DirectoryCacheEntry = {
  items: DirectoryCacheItem[];
  imageCount: number;
  sorted: Partial<Record<SortOrder, DirectoryCacheItem[]>>;
};

export type DirectoryPreviewEntry = {
  url: string;
};

type IdleCallback = (cb: () => void) => number;
type CancelIdleCallback = (handle: number) => void;

const requestIdle: IdleCallback =
  typeof window.requestIdleCallback === 'function'
    ? (cb) => window.requestIdleCallback(() => cb())
    : (cb) => window.setTimeout(cb, 16);

const cancelIdle: CancelIdleCallback =
  typeof window.cancelIdleCallback === 'function'
    ? (handle) => window.cancelIdleCallback(handle)
    : (handle) => window.clearTimeout(handle);

function getRequiredElement<T extends HTMLElement>(id: string, guard: (el: HTMLElement) => el is T): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Element not found: ${id}`);
  }
  if (!guard(el)) {
    throw new Error(`Element type mismatch for: ${id}`);
  }
  return el;
}

const isDiv = (el: HTMLElement): el is HTMLDivElement => el instanceof HTMLDivElement;
const isButton = (el: HTMLElement): el is HTMLButtonElement => el instanceof HTMLButtonElement;
const isImage = (el: HTMLElement): el is HTMLImageElement => el instanceof HTMLImageElement;
const isInput = (el: HTMLElement): el is HTMLInputElement => el instanceof HTMLInputElement;
const isSelect = (el: HTMLElement): el is HTMLSelectElement => el instanceof HTMLSelectElement;
const isVideo = (el: HTMLElement): el is HTMLVideoElement => el instanceof HTMLVideoElement;
const isSpan = (el: HTMLElement): el is HTMLSpanElement => el instanceof HTMLSpanElement;

export const DOM = {
  selectDirBtn: getRequiredElement('select-dir-btn', isButton),
  itemList: getRequiredElement('item-list', isDiv),
  statusArea: getRequiredElement('status-area', isDiv),
  viewer: getRequiredElement('viewer', isDiv),
  leftPageImg: getRequiredElement('left-page', isImage),
  rightPageImg: getRequiredElement('right-page', isImage),
  closeViewerBtn: getRequiredElement('close-viewer-btn', isButton),
  adjustSpreadBtn: getRequiredElement('adjust-spread-btn', isButton),
  prevBtn: getRequiredElement('prev-btn', isButton),
  nextBtn: getRequiredElement('next-btn', isButton),
  fullscreenBtn: getRequiredElement('fullscreen-btn', isButton),
  copyImagePathBtn: getRequiredElement('copy-image-path-btn', isButton),
  pageCounter: getRequiredElement('page-counter', isSpan),
  toggleViewBtn: getRequiredElement('toggle-view-btn', isButton),
  viewerToolbar: getRequiredElement('viewer-toolbar', isDiv),
  upDirBtn: getRequiredElement('up-dir-btn', isButton),
  currentDirName: getRequiredElement('current-dir-name', isSpan),
  copyPathBtn: getRequiredElement('copy-path-btn', isButton),
  sizeSelect: getRequiredElement('size-select', isSelect),
  filterSelect: getRequiredElement('filter-select', isSelect),
  searchInput: getRequiredElement('search-input', isInput),
  listToolbar: getRequiredElement('list-toolbar', isDiv),
  toggleSortBtn: getRequiredElement('toggle-sort-btn', isButton),
  reloadBtn: getRequiredElement('reload-btn', isButton),
  recursiveBtn: getRequiredElement('recursive-btn', isButton),
  viewerPages: getRequiredElement('viewer-pages', isDiv),
  viewerVideoContainer: getRequiredElement('viewer-video-container', isDiv),
  viewerVideo: getRequiredElement('viewer-video', isVideo),
  favoriteFirstBtn: getRequiredElement('favorite-first-btn', isButton),
  favoriteOnlyBtn: getRequiredElement('favorite-only-btn', isButton)
};

export const CONFIG = {
  IMAGE_EXTENSIONS: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic'],
  VIDEO_EXTENSIONS: ['.mp4', '.webm', '.mov', '.ogg'],
  CONFIG_FILENAME: '.image-viewer.json',
  LAZY_LOAD_THRESHOLD: 500,
  ENABLE_DEBUG_LOGS: true
};

type State = {
  directoryHistory: FileSystemDirectoryHandle[];
  currentImageFiles: FileSystemFileHandle[];
  currentImageIndex: number;
  pageOffset: number;
  renderToken: number;
  isSinglePageView: boolean;
  toolbarHideTimer: ReturnType<typeof setTimeout> | null;
  lazyLoadObserver: IntersectionObserver | null;
  createdUrls: Set<string>;
  thumbnailSizeIndex: number;
  sortOrder: SortOrder;
  filterType: FilterType;
  searchQuery: string;
  isRecursiveMode: boolean;
  favoriteFirst: boolean;
  favoriteOnly: boolean;
  currentDisplayImageList: FileSystemFileHandle[];
  configWriteTimer: ReturnType<typeof setTimeout> | null;
  lastVisitedChild: WeakMap<FileSystemDirectoryHandle, string>;
  directoryCache: WeakMap<FileSystemDirectoryHandle, DirectoryCacheEntry>;
  directoryPreviewCache: WeakMap<FileSystemDirectoryHandle, DirectoryPreviewEntry>;
  previewUrls: Set<string>;
  currentDirHandle: FileSystemDirectoryHandle | null;
  searchDebounceTimer: ReturnType<typeof setTimeout> | null;
  RIC: IdleCallback;
  CIC: CancelIdleCallback;
};

export const state: State = {
  directoryHistory: [],
  currentImageFiles: [],
  currentImageIndex: 0,
  pageOffset: 0,
  renderToken: 0,
  isSinglePageView: localStorage.getItem('isSinglePageView') === '1',
  toolbarHideTimer: null,
  lazyLoadObserver: null,
  createdUrls: new Set<string>(),
  thumbnailSizeIndex: parseInt(localStorage.getItem('thumbnailSizeIndex') || '1', 10),
  sortOrder: 'asc',
  filterType: 'all',
  searchQuery: '',
  isRecursiveMode: false,
  favoriteFirst: false,
  favoriteOnly: false,
  currentDisplayImageList: [],
  configWriteTimer: null,
  lastVisitedChild: new WeakMap<FileSystemDirectoryHandle, string>(),
  directoryCache: new WeakMap<FileSystemDirectoryHandle, DirectoryCacheEntry>(),
  directoryPreviewCache: new WeakMap<FileSystemDirectoryHandle, DirectoryPreviewEntry>(),
  previewUrls: new Set<string>(),
  currentDirHandle: null,
  searchDebounceTimer: null,
  RIC: requestIdle,
  CIC: cancelIdle
};
