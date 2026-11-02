import type { DirectoryHandle, FileHandle } from '../../src/shared/fileSystem';
type Entry = MemoryDirectory | MemoryFile;

export class MemoryFile {
  readonly kind = 'file' as const;
  textValue: string;
  constructor(
    readonly name: string,
    text = '',
  ) {
    this.textValue = text;
  }
  async getFile() {
    return new File([this.textValue], this.name);
  }
  async createWritable() {
    return {
      write: async (value: FileSystemWriteChunkType) => {
        if (typeof value !== 'string') throw new Error('Only text writes are supported');
        this.textValue = value;
      },
      close: async () => undefined,
    };
  }
  asHandle() {
    return this;
  }
}

export class MemoryDirectory {
  readonly kind = 'directory' as const;
  readonly entries = new Map<string, Entry>();
  constructor(
    readonly name: string,
    private readonly options: { caseSensitive?: boolean } = {},
  ) {}
  file(name: string, text = '') {
    const file = new MemoryFile(name, text);
    this.entries.set(name, file);
    return file;
  }
  child(name: string): MemoryDirectory {
    const entry = this.entries.get(name);
    if (!(entry instanceof MemoryDirectory)) throw new Error('Expected directory');
    return entry;
  }
  directory(name: string) {
    const dir = new MemoryDirectory(name, this.options);
    this.entries.set(name, dir);
    return dir;
  }
  async *values(): AsyncGenerator<FileHandle | DirectoryHandle> {
    for (const entry of this.entries.values()) yield entry.asHandle();
  }
  async getFileHandle(name: string, options?: { create?: boolean }) {
    let entry = this.entries.get(name);
    if (!entry && this.options.caseSensitive === false)
      entry = [...this.entries].find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
    if (!entry && options?.create) entry = this.file(name);
    if (!(entry instanceof MemoryFile)) throw new DOMException('Not found', 'NotFoundError');
    return entry.asHandle();
  }
  async getDirectoryHandle(name: string) {
    const entry = this.entries.get(name);
    if (!(entry instanceof MemoryDirectory)) throw new DOMException('Not found', 'NotFoundError');
    return entry.asHandle();
  }
  asHandle() {
    return this;
  }
}
