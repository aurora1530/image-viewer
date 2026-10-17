import { getMediaSource } from '../platform/nativeFs';

// Share compressed originals between thumbnail generation and the full-size viewer.
export function createOriginalImageCache(maxBytes = 512 * 1024 * 1024, maxEntries = Infinity) {
  type Entry = { promise: Promise<Blob>; blob?: Blob };
  let entries = new Map<string | FileSystemFileHandle, Entry>();
  let bytes = 0;

  async function read(handle: FileSystemFileHandle): Promise<Blob> {
    if (!handle.nativePath || !window.desktopApi) return handle.getFile();
    const source = await getMediaSource(handle);
    try {
      const response = await fetch(source.url);
      if (!response.ok) throw new Error('元画像の読み込みに失敗しました。');
      return await response.blob();
    } finally {
      if (source.objectUrl) URL.revokeObjectURL(source.url);
    }
  }

  function get(handle: FileSystemFileHandle): Promise<Blob> {
    const key = handle.nativePath || handle;
    const cached = entries.get(key);
    if (cached) {
      entries.delete(key);
      entries.set(key, cached);
      return cached.promise;
    }
    const cache = entries;
    const entry: Entry = { promise: Promise.resolve(new Blob()) };
    cache.set(key, entry);
    entry.promise = read(handle).then(
      (blob) => {
        if (entries === cache && cache.get(key) === entry) {
          entry.blob = blob;
          bytes += blob.size;
          trim();
        }
        return blob;
      },
      (error) => {
        if (cache.get(key) === entry) cache.delete(key);
        throw error;
      },
    );
    return entry.promise;
  }

  function trim() {
    // Pending reads stay shared until completion.
    for (const [key, entry] of entries) {
      if (bytes <= maxBytes && entries.size <= maxEntries) break;
      if (!entry.blob) continue;
      bytes -= entry.blob.size;
      entries.delete(key);
    }
  }

  return {
    get,
    stats: () => ({ retainedBytes: bytes }),
    setMaxBytes(value: number) {
      maxBytes = value;
      trim();
    },
    clear() {
      entries = new Map();
      bytes = 0;
    },
  };
}

export const originalImageCache = createOriginalImageCache();
export async function getOriginalImageSource(handle: FileSystemFileHandle) {
  const blob = await originalImageCache.get(handle);
  return { url: URL.createObjectURL(blob), objectUrl: true };
}
