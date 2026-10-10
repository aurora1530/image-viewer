import { getMediaSource } from './nativeFs';

type ImagePage = {
  url: string;
  objectUrl: boolean;
  image: HTMLImageElement;
};

type CacheEntry = {
  disposed: boolean;
  page: ImagePage | null;
  promise: Promise<ImagePage | null>;
};

export function createImagePageCache() {
  const entries = new Map<FileSystemFileHandle, CacheEntry>();

  function dispose(entry: CacheEntry) {
    entry.disposed = true;
    if (!entry.page) return;
    entry.page.image.removeAttribute('src');
    if (entry.page.objectUrl) URL.revokeObjectURL(entry.page.url);
    entry.page = null;
  }

  async function load(handle: FileSystemFileHandle, entry: CacheEntry): Promise<ImagePage | null> {
    try {
      const source = await getMediaSource(handle);
      if (entry.disposed) {
        if (source.objectUrl) URL.revokeObjectURL(source.url);
        return null;
      }
      const image = new Image();
      entry.page = { ...source, image };
      image.decoding = 'async';
      image.src = source.url;
      await image.decode();
      return entry.disposed ? null : entry.page;
    } catch (error) {
      if (entry.disposed) return null;
      dispose(entry);
      if (entries.get(handle) === entry) entries.delete(handle);
      throw error;
    }
  }

  function get(handle: FileSystemFileHandle): Promise<ImagePage | null> {
    const cached = entries.get(handle);
    if (cached) return cached.promise;
    const entry: CacheEntry = { disposed: false, page: null, promise: Promise.resolve(null) };
    entries.set(handle, entry);
    entry.promise = load(handle, entry);
    return entry.promise;
  }

  function retain(handles: FileSystemFileHandle[]) {
    const retained = new Set(handles);
    for (const [handle, entry] of entries) {
      if (retained.has(handle)) continue;
      entries.delete(handle);
      dispose(entry);
    }
  }

  function clear() {
    retain([]);
  }

  return { get, retain, clear };
}
