import { createStore } from 'zustand/vanilla';
import type { DirectoryCacheItem, FilterType, SortOrder } from '../shared/model';
import type { ViewerPresentation } from './viewerModel';

export type ListMode = 'directory' | 'recursive' | 'favorites' | 'hidden';
export type FavoriteMode = 'off' | 'first' | 'only';
export type GalleryEntry = {
  item: DirectoryCacheItem;
  parent: FileSystemDirectoryHandle | null;
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

export function initialAppState() {
  return {
    screen: 'directory' as 'home' | 'directory',
    directories: [] as FileSystemDirectoryHandle[],
    library: [] as DesktopLibraryItem[],
    listMode: 'directory' as ListMode,
    favoriteMode: 'off' as FavoriteMode,
    thumbnailSizeIndex: 1,
    sortOrder: 'asc' as SortOrder,
    filterType: 'all' as FilterType,
    searchQuery: '',
    isSinglePageView: false,
    isUiHidden: false,
    isUiDockRevealed: false,
    entries: [] as GalleryEntry[],
    displayImages: [] as FileSystemFileHandle[],
    currentImageFiles: [] as FileSystemFileHandle[],
    currentImageIndex: 0,
    pageOffset: 0,
    viewer: { ...closedViewer },
    status: { message: '', type: 'clear' as 'info' | 'error' | 'loading' | 'clear' },
    scanPreview: null as { url: string; name: string; open: () => void } | null,
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
export type AppState = ReturnType<typeof initialAppState>;
