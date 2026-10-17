export type SortOrder = 'asc' | 'desc';
export type FilterType = 'all' | 'directory' | 'image' | 'gif' | 'video' | 'pdf';

export type DirectoryCacheDirectoryItem = {
  type: 'directory';
  handle: FileSystemDirectoryHandle;
  name: string;
  nameLower: string;
  imageIndex?: number;
  displayIndex?: number;
  isFavorite?: boolean;
  isHidden?: boolean;
};

export type DirectoryCacheImageItem = {
  type: 'image';
  handle: FileSystemFileHandle;
  name: string;
  nameLower: string;
  imageIndex?: number;
  displayIndex?: number;
  isFavorite?: boolean;
  isHidden?: boolean;
};

export type DirectoryCacheVideoItem = {
  type: 'video';
  handle: FileSystemFileHandle;
  name: string;
  nameLower: string;
  imageIndex?: number;
  displayIndex?: number;
  isFavorite?: boolean;
  isHidden?: boolean;
};

export type DirectoryCachePdfItem = Omit<DirectoryCacheImageItem, 'type'> & { type: 'pdf' };

export type DirectoryCacheItem =
  | DirectoryCacheDirectoryItem
  | DirectoryCacheImageItem
  | DirectoryCacheVideoItem
  | DirectoryCachePdfItem;

export type DirectoryCacheEntry = {
  items: DirectoryCacheItem[];
  imageCount: number;
  sorted: Partial<Record<SortOrder, DirectoryCacheItem[]>>;
};

export type DirectoryPreviewEntry = {
  url: string;
};

export const CONFIG = {
  IMAGE_EXTENSIONS: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic'],
  VIDEO_EXTENSIONS: ['.mp4', '.webm', '.mov', '.ogg'],
  CONFIG_FILENAME: '.image-viewer.json',
  ENABLE_DEBUG_LOGS: true,
};
