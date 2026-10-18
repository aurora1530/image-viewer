const separator = navigator.userAgent.includes('Windows') ? '\\' : '/';

function joinPath(parent: string, name: string) {
  return parent.endsWith(separator) ? `${parent}${name}` : `${parent}${separator}${name}`;
}

function baseName(filePath: string) {
  const parts = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.at(-1) || filePath;
}

function mimeType(name: string) {
  const ext = name.toLowerCase().split('.').pop();
  const types: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    heic: 'image/heic',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    ogg: 'video/ogg',
    json: 'application/json',
    pdf: 'application/pdf',
  };
  return ext ? types[ext] || 'application/octet-stream' : 'application/octet-stream';
}

class NativeFileHandle {
  readonly kind = 'file' as const;
  readonly name: string;
  readonly nativePath: string;

  constructor(filePath: string) {
    this.nativePath = filePath;
    this.name = baseName(filePath);
  }

  async getFile() {
    const bytes = await window.desktopApi!.readFile(this.nativePath);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return new File([copy.buffer], this.name, { type: mimeType(this.name) });
  }

  createWritable() {
    let value: string | Uint8Array = '';
    return Promise.resolve({
      write: async (data: FileSystemWriteChunkType) => {
        if (typeof data === 'string') value = data;
        else if (data instanceof Blob) value = new Uint8Array(await data.arrayBuffer());
        else if (data instanceof ArrayBuffer) value = new Uint8Array(data);
        else if (ArrayBuffer.isView(data))
          value = new Uint8Array(
            data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
          );
        else throw new Error('未対応の書き込み形式です。');
      },
      close: async () => window.desktopApi!.writeFile(this.nativePath, value),
      abort: () => Promise.resolve(),
      seek: () => Promise.resolve(),
      truncate: () => Promise.resolve(),
      locked: false,
      getWriter: () => {
        throw new Error('getWriter is not supported');
      },
    });
  }
}

class NativeDirectoryHandle {
  readonly kind = 'directory' as const;
  readonly name: string;
  readonly nativePath: string;

  constructor(dirPath: string) {
    this.nativePath = dirPath;
    this.name = baseName(dirPath);
  }

  async *values() {
    for (const entry of await window.desktopApi!.listDirectory(this.nativePath)) {
      const childPath = joinPath(this.nativePath, entry.name);
      yield entry.kind === 'directory'
        ? asDirectoryHandle(new NativeDirectoryHandle(childPath))
        : asFileHandle(new NativeFileHandle(childPath));
    }
  }

  async getFileHandle(name: string, options?: FileSystemGetFileOptions) {
    const filePath = joinPath(this.nativePath, name);
    if (!options?.create && !(await window.desktopApi!.exists(filePath, 'file'))) {
      throw new DOMException('File not found', 'NotFoundError');
    }
    return asFileHandle(new NativeFileHandle(filePath));
  }

  async getDirectoryHandle(name: string) {
    const dirPath = joinPath(this.nativePath, name);
    if (!(await window.desktopApi!.exists(dirPath, 'directory'))) {
      throw new DOMException('Directory not found', 'NotFoundError');
    }
    return asDirectoryHandle(new NativeDirectoryHandle(dirPath));
  }
}

function asFileHandle(handle: NativeFileHandle) {
  return handle as unknown as FileSystemFileHandle;
}

function asDirectoryHandle(handle: NativeDirectoryHandle) {
  return handle as unknown as FileSystemDirectoryHandle;
}

export function isDesktopApp() {
  return Boolean(window.desktopApi);
}

export async function chooseNativeDirectory() {
  const selected = await window.desktopApi?.chooseDirectory();
  return selected ? asDirectoryHandle(new NativeDirectoryHandle(selected)) : null;
}

export async function openNativeDirectory(dirPath: string) {
  const selected = await window.desktopApi!.openRoot(dirPath);
  return asDirectoryHandle(new NativeDirectoryHandle(selected));
}

export async function openDirectoryExternally(handle: FileSystemDirectoryHandle) {
  if (!window.desktopApi || !handle.nativePath) return;
  await window.desktopApi.openDirectoryExternally(handle.nativePath);
}

export async function listDirectoryEntries(
  dirHandle: FileSystemDirectoryHandle,
): Promise<Array<FileSystemDirectoryHandle | FileSystemFileHandle>> {
  if (dirHandle.nativePath && window.desktopApi) {
    return (await window.desktopApi.listDirectory(dirHandle.nativePath)).map((entry) => {
      const childPath = joinPath(dirHandle.nativePath!, entry.name);
      return entry.kind === 'directory'
        ? asDirectoryHandle(new NativeDirectoryHandle(childPath))
        : asFileHandle(new NativeFileHandle(childPath));
    });
  }
  const entries: Array<FileSystemDirectoryHandle | FileSystemFileHandle> = [];
  for await (const entry of dirHandle.values()) entries.push(entry);
  return entries;
}

export async function* iterateDirectoryEntries(
  dirHandle: FileSystemDirectoryHandle,
  shouldContinue: () => boolean = () => true,
): AsyncGenerator<FileSystemDirectoryHandle | FileSystemFileHandle> {
  if (!shouldContinue()) return;
  if (dirHandle.nativePath && window.desktopApi) {
    for (const entry of await listDirectoryEntries(dirHandle)) {
      if (!shouldContinue()) return;
      yield entry;
    }
    return;
  }
  for await (const entry of dirHandle.values()) {
    if (!shouldContinue()) return;
    yield entry;
  }
}

export async function getMediaSource(
  handle: FileSystemFileHandle,
): Promise<{ url: string; objectUrl: boolean }> {
  if (handle.nativePath && window.desktopApi) {
    const bytes = new TextEncoder().encode(handle.nativePath);
    const encoded = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    return { url: `local-media://file/${encoded}`, objectUrl: false };
  }
  const file = await handle.getFile();
  return { url: URL.createObjectURL(file), objectUrl: true };
}
