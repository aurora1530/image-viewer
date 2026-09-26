interface FileSystemDirectoryHandle {
	values(): AsyncIterable<FileSystemDirectoryHandle | FileSystemFileHandle>;
	nativePath?: string;
}

interface FileSystemFileHandle {
	nativePath?: string;
}

interface HTMLDivElement {
	_loadThumb?: () => void;
}

interface Window {
	showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
	desktopApi?: {
		chooseDirectory(): Promise<string | null>;
		openRoot(path: string): Promise<string>;
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
