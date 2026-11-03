import type { DirectoryHandle, FileHandle } from '../shared/fileSystem';
import { defaultAppConfig, type AppConfig } from '../shared/appConfig';
import { createStore } from 'zustand/vanilla';
import type { DirectoryCacheItem, FilterType, SortOrder } from '../shared/model';
import type { ViewerPresentation } from './viewerModel';

export type ListMode = 'directory' | 'recursive' | 'favorites' | 'hidden';
export type GalleryEntry = {
  item: DirectoryCacheItem;
  parent: DirectoryHandle | null;
  parentPath: string;
  key: string;
};
export type ViewerState = ViewerPresentation;
export const closedViewer: ViewerState = {
  mode: 'closed',
  left: null,
  right: null,
  video: null,
  loading: '',
  counter: '',
  playback: null,
};

export const sizeOptions = [
  { name: '小', minWidth: 120, gap: 8, originalAspect: false },
  { name: '中', minWidth: 170, gap: 10, originalAspect: false },
  { name: '大', minWidth: 230, gap: 14, originalAspect: false },
  { name: '元サイズ 小', minWidth: 280, gap: 14, originalAspect: true },
  { name: '元サイズ 中', minWidth: 390, gap: 16, originalAspect: true },
  { name: '元サイズ 大', minWidth: 520, gap: 16, originalAspect: true },
];
export function normalizeThumbnailSize(value: number) {
  return Number.isInteger(value) ? Math.min(Math.max(value, 0), sizeOptions.length - 1) : 1;
}

export function initialAppState(): AppState {
  return {
    config: { ...defaultAppConfig },
    configReady: false,
    configError: '',
    cacheUsage: { thumbnail: 0, original: 0, disk: 0, path: '', configPath: '' },
    screen: 'directory',
    directories: [],
    library: [],
    listMode: 'directory',
    favoriteFirst: false,
    favoriteOnly: false,
    thumbnailSizeIndex: 1,
    denseGallery: false,
    sortOrder: 'asc',
    filterType: 'all',
    searchQuery: '',
    isSinglePageView: false,
    isUiHidden: false,
    isUiDockRevealed: false,
    entries: [],
    displayImages: [],
    currentImageFiles: [],
    currentImageIndex: 0,
    pageOffset: 0,
    viewer: { ...closedViewer },
    status: { message: '', type: 'clear' },
    scanPreview: null,
  };
}

// Only observable application data lives here. Workers, caches and URL ownership
// belong to their services and outlive individual React components.
export const createAppStore = (initial: Partial<AppState> = {}) =>
  createStore<AppState>(() => ({
    ...initialAppState(),
    ...initial,
    thumbnailSizeIndex: normalizeThumbnailSize(initial.thumbnailSizeIndex ?? 1),
  }));
export type AppStore = ReturnType<typeof createAppStore>;
export type AppState = {
  config: AppConfig;
  configReady: boolean;
  configError: string;
  cacheUsage: {
    thumbnail: number;
    original: number;
    disk: number;
    path: string;
    configPath: string;
  };
  screen: 'home' | 'directory';
  directories: DirectoryHandle[];
  library: DesktopLibraryItem[];
  listMode: ListMode;
  favoriteFirst: boolean;
  favoriteOnly: boolean;
  thumbnailSizeIndex: number;
  denseGallery: boolean;
  sortOrder: SortOrder;
  filterType: FilterType;
  searchQuery: string;
  isSinglePageView: boolean;
  isUiHidden: boolean;
  isUiDockRevealed: boolean;
  entries: GalleryEntry[];
  displayImages: FileHandle[];
  currentImageFiles: FileHandle[];
  currentImageIndex: number;
  pageOffset: number;
  viewer: ViewerState;
  status: { message: string; type: 'info' | 'error' | 'loading' | 'clear' };
  scanPreview: { url: string; name: string; open: () => void } | null;
};
