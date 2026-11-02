import type { DirectoryHandle } from '../shared/fileSystem';
import type { DirectoryCacheEntry } from '../shared/model';

// Runtime resources are deliberately independent of the React tree.
export const state = {
  directoryCache: new WeakMap<DirectoryHandle, DirectoryCacheEntry>(),
};
