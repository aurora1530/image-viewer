import type { DirectoryCacheEntry, DirectoryPreviewEntry } from '../shared/model';

// Runtime resources are deliberately independent of the React tree.
export const state = {
  directoryCache: new WeakMap<FileSystemDirectoryHandle, DirectoryCacheEntry>(),
  directoryPreviewCache: new WeakMap<FileSystemDirectoryHandle, DirectoryPreviewEntry>(),
  previewUrls: new Set<string>(),
};
