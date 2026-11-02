/** The filesystem operations used by the application, implemented by browser and native adapters. */
export interface FileHandle {
  readonly kind: 'file';
  readonly name: string;
  readonly nativePath?: string;
  getFile(): Promise<Blob>;
  createWritable(): Promise<{
    write(data: FileSystemWriteChunkType): Promise<void>;
    close(): Promise<void>;
    abort?(): Promise<void>;
  }>;
}
export interface DirectoryHandle {
  readonly kind: 'directory';
  readonly name: string;
  readonly nativePath?: string;
  values(): AsyncIterable<DirectoryHandle | FileHandle>;
  getFileHandle(name: string, options?: FileSystemGetFileOptions): Promise<FileHandle>;
  getDirectoryHandle(name: string): Promise<DirectoryHandle>;
}

export type EntryHandle = FileHandle | DirectoryHandle;
