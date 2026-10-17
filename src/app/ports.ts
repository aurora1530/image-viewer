// UI capabilities are callbacks, so application services never retain DOM nodes.
export type GalleryNavigation = { revealDirectory(name: string): boolean };
export type PlaybackReader = () => { time: number; paused: boolean };

export type MediaSource = { url: string; objectUrl: boolean };
export type MediaServices = {
  getThumbnail: (
    handle: FileSystemFileHandle,
    shouldContinue: () => boolean,
    getPriority: () => number,
  ) => Promise<MediaSource | null>;
  invalidateThumbnail: (handle: FileSystemFileHandle) => void;
  getDirectoryPreview: (
    handle: FileSystemDirectoryHandle,
    options: { shouldContinue: () => boolean; getPriority: () => number },
  ) => Promise<MediaSource | null>;
  getMediaSource: (handle: FileSystemFileHandle) => Promise<MediaSource>;
};
