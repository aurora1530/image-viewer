import type { FileHandle } from '../shared/fileSystem';
import { getMediaSource } from '../platform/nativeFs';
import { abortError, waitWithSignal } from '../shared/abort';

// Share compressed originals between thumbnail generation and the full-size viewer.
export function createOriginalImageCache(maxBytes = 512 * 1024 * 1024, maxEntries = Infinity) {
  type Entry = {
    promise: Promise<Blob>;
    controller: AbortController;
    consumers: Set<symbol>;
    blob?: Blob;
  };
  let entries = new Map<string | FileHandle, Entry>();
  let bytes = 0;

  async function read(handle: FileHandle, signal: AbortSignal): Promise<Blob> {
    if (!handle.nativePath || !window.desktopApi) return handle.getFile();
    const source = await getMediaSource(handle);
    try {
      if (signal.aborted) throw abortError();
      const response = await fetch(source.url, { signal });
      if (!response.ok) throw new Error('元画像の読み込みに失敗しました。');
      return await response.blob();
    } finally {
      if (source.objectUrl) URL.revokeObjectURL(source.url);
    }
  }

  function get(handle: FileHandle, signal?: AbortSignal): Promise<Blob> {
    if (signal?.aborted) return Promise.reject(abortError());
    const key = handle.nativePath || handle;
    let entry = entries.get(key);
    if (entry) {
      entries.delete(key);
      entries.set(key, entry);
    } else {
      const cache = entries;
      entry = {
        promise: Promise.resolve(new Blob()),
        controller: new AbortController(),
        consumers: new Set(),
      };
      const current = entry;
      cache.set(key, current);
      current.promise = read(handle, current.controller.signal).then(
        (blob) => {
          if (current.controller.signal.aborted) throw abortError();
          if (entries === cache && cache.get(key) === current) {
            current.blob = blob;
            bytes += blob.size;
            trim();
          }
          return blob;
        },
        (error) => {
          if (cache.get(key) === current) cache.delete(key);
          throw error;
        },
      );
    }
    const current = entry;
    const consumer = Symbol();
    current.consumers.add(consumer);
    const release = () => {
      current.consumers.delete(consumer);
      if (!current.blob && current.consumers.size === 0) {
        if (entries.get(key) === current) entries.delete(key);
        current.controller.abort();
      }
    };
    signal?.addEventListener('abort', release, { once: true });
    return waitWithSignal(current.promise, signal).finally(() => {
      signal?.removeEventListener('abort', release);
      release();
    });
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
export async function getOriginalImageSource(handle: FileHandle, signal?: AbortSignal) {
  const blob = await originalImageCache.get(handle, signal);
  return { url: URL.createObjectURL(blob), objectUrl: true };
}
