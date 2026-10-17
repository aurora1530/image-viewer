declare const __APP_VERSION__: string;

interface FileSystemDirectoryHandle {
  values(): AsyncIterable<FileSystemDirectoryHandle | FileSystemFileHandle>;
  nativePath?: string;
}

interface FileSystemFileHandle {
  nativePath?: string;
}

interface Window {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
  desktopApi?: {
    getUpdateState(): Promise<import('./shared/release').UpdateState>;
    checkForUpdates(): Promise<import('./shared/release').UpdateState>;
    installUpdate(): Promise<boolean>;
    onUpdateState(callback: (state: import('./shared/release').UpdateState) => void): () => void;
    onBeforeClose(callback: () => Promise<boolean>): () => void;
    onNavigate(callback: (direction: 'back' | 'forward') => void): () => void;
    readThumbnail(path: string): Promise<{ version: string; bytes: Uint8Array | null }>;
    writeThumbnail(path: string, version: string, bytes: Uint8Array): Promise<boolean>;
    readAppConfig(): Promise<unknown>;
    writeAppConfig(config: import('./shared/appConfig').AppConfig): Promise<void>;
    cacheStats(): Promise<{ bytes: number; path: string; configPath: string }>;
    chooseDirectory(): Promise<string | null>;
    openRoot(path: string): Promise<string>;
    openDirectoryExternally(path: string): Promise<void>;
    getLibrary(): Promise<DesktopLibraryItem[]>;
    toggleFavoriteRoot(path: string): Promise<boolean>;
    removeRecent(path: string): Promise<void>;
    listDirectory(path: string): Promise<Array<{ name: string; kind: 'directory' | 'file' }>>;
    readFile(path: string): Promise<Uint8Array>;
    writeFile(path: string, data: string | Uint8Array): Promise<void>;
    exists(path: string, kind: 'directory' | 'file'): Promise<boolean>;
  };
}

type DesktopLibraryItem = {
  path: string;
  name: string;
  openedAt: number;
  favorite: boolean;
};
