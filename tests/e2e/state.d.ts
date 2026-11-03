import type { DirectoryHandle, FileHandle } from '../../src/shared/fileSystem';
export interface TestDirectory extends DirectoryHandle {
  getDirectoryHandle(name: string): Promise<TestDirectory>;
  entries: Map<string, TestDirectory | FileHandle>;
  file(name: string): void;
  directory(name: string): TestDirectory;
}
declare global {
  var openedDirectories: string[];
  var nativeReadProbe: { started: boolean; cancelled: boolean };
  interface Window {
    __parseTestConfig: typeof import('../../src/services/storage').ensureConfigNode;
    __imageViewerTestRoot: TestDirectory;
    __previewScans: { active: number; peak: number; yielded: number; started: number };
    __firstImageReads: number;
    __unmountedThumb: Element;
    __retainedCard: Element;
    __retainedImage: HTMLImageElement;
    __retainedSrc: string;
    __retainedScroll: number;
    __viewerDecodes: number;
    __releaseDecode(): void;
    __finishVirtualThumbnails: () => void;
    __virtualScrollCalls: number;
    __retainedSearchImage: Element;
    __recursiveReads: number;
    __favoriteReleases: (() => void)[];
    __favoriteReads: number;
    __favoriteCompleted: number;
    __configReads: number;
    __pageReads: Record<string, number>;
    __pageDecodes: number;
    __releaseSlowPage: () => void;
    __slowPageFinished: boolean;
    __largeFile: File;
    __largeReads: number;
    __emptyGalleryFrames: number;
    __thumbnailWorkerReplies: number;
    __originalReads: Record<string, number>;
    __releaseAbandonedReads: () => void;
    __abandonedReadCount: number;
    __abortNativeRead: () => void;
    __nativeReadResult: Promise<string>;
  }
}
