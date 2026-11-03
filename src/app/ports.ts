import type { DirectoryHandle, FileHandle } from '../shared/fileSystem';
import type { ThumbnailSize } from '../shared/thumbnail';
// UI capabilities are callbacks, so application services never retain DOM nodes.
export type GalleryNavigation = { revealDirectory(name: string): boolean };
export type PlaybackReader = () => { time: number; paused: boolean };

export type MediaSource = { url: string; objectUrl: boolean };
export type MediaServices = {
  getThumbnail: (
    handle: FileHandle,
    shouldContinue: () => boolean,
    getPriority: () => number,
    maxEdge?: ThumbnailSize,
  ) => Promise<MediaSource | null>;
  invalidateThumbnail: (handle: FileHandle) => void;
  getDirectoryPreview: (
    handle: DirectoryHandle,
    options: { shouldContinue: () => boolean; getPriority: () => number; maxEdge?: ThumbnailSize },
  ) => Promise<MediaSource | null>;
  getMediaSource: (handle: FileHandle) => Promise<MediaSource>;
};
