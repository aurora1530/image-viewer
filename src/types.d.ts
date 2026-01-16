interface FileSystemDirectoryHandle {
	values(): AsyncIterable<FileSystemDirectoryHandle | FileSystemFileHandle>;
}

interface HTMLDivElement {
	_loadThumb?: () => void;
}

interface Window {
	showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
}
