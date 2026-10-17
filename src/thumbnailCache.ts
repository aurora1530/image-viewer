import {
  encodeThumbnailInWorker,
  refreshThumbnailWorkers,
  setThumbnailWorkersPaused,
  waitForThumbnailResume,
  THUMBNAIL_CONCURRENCY,
} from './thumbnailWorkerPool';

import { createThumbnailQueue } from './thumbnailQueue';
import type { ThumbnailRequest } from './thumbnailQueue';
import { getOriginalImageSource, originalImageCache } from './originalImageCache';

const MAX_EDGE = 1280;
const MAX_ENTRIES = 10000;
const MAX_BYTES = 512 * 1024 * 1024;
type Source = { url: string; objectUrl: boolean };
type Entry = {
  promise: Promise<Blob | null>;
  consumers: Map<() => boolean, () => number>;
  blob?: Blob | null;
  invalid?: boolean;
};

// IHDR and tRNS tell us whether JPEG can preserve all thumbnail opacity.
// acTL appears before IDAT for APNG; compressed image data need not be inspected.
export async function inspectPng(blob: Blob): Promise<{ animated: boolean; opaque: boolean }> {
  const prefix = new Uint8Array(await blob.slice(0, 65536).arrayBuffer());
  let offset = 8;
  let colorType: number | undefined;
  let transparent = false;
  while (offset + 8 <= blob.size) {
    const header =
      offset + 8 <= prefix.length
        ? prefix.subarray(offset, offset + 8)
        : new Uint8Array(await blob.slice(offset, offset + 8).arrayBuffer());
    const kind = String.fromCharCode(...header.slice(4, 8));
    const length = new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(0);
    if (kind === 'acTL') return { animated: true, opaque: false };
    if (kind === 'IHDR' && length >= 10 && offset + 17 < prefix.length)
      colorType = prefix[offset + 17];
    if (kind === 'tRNS') transparent = true;
    if (kind === 'IDAT' || kind === 'IEND') break;
    offset += length + 12;
  }
  return {
    animated: false,
    opaque: !transparent && (colorType === 0 || colorType === 2 || colorType === 3),
  };
}

export async function isAnimatedPng(blob: Blob): Promise<boolean> {
  return (await inspectPng(blob)).animated;
}

async function generate(
  handle: FileSystemFileHandle,
  request: ThumbnailRequest,
): Promise<Blob | null> {
  let source: Source | null = null;
  const image = new Image();
  let canvas: HTMLCanvasElement | null = null;
  try {
    const blob = await originalImageCache.get(handle);
    await waitForThumbnailResume();
    if (request.shouldContinue?.() === false) return null;
    const png = handle.name.toLowerCase().endsWith('.png') ? await inspectPng(blob) : null;
    if (png?.animated) return null;
    const format = /\.jpe?g$/i.test(handle.name) || png?.opaque ? 'image/jpeg' : 'image/webp';
    const workerResult = await encodeThumbnailInWorker(blob, request, format);
    if (workerResult) return workerResult;
    if (request.shouldContinue?.() === false) return null;
    source = { url: URL.createObjectURL(blob), objectUrl: true };
    image.decoding = 'async';
    image.src = source.url;
    await image.decode();
    const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('サムネイルを生成できませんでした。');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas!.toBlob(
        (result) =>
          result ? resolve(result) : reject(new Error('サムネイルの圧縮に失敗しました。')),
        format,
        0.85,
      ),
    );
  } finally {
    image.removeAttribute('src');
    if (source?.objectUrl) URL.revokeObjectURL(source.url);
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}

export function createThumbnailCache({
  concurrency = THUMBNAIL_CONCURRENCY * 2,
}: { concurrency?: number } = {}) {
  let entries = new Map<string | FileSystemFileHandle, Entry>();
  let retainedBytes = 0;
  const skipStored = new Set<string | FileSystemFileHandle>();
  // Disk hits must not wait for unrelated image encoding to finish.
  const reads = createThumbnailQueue(Math.max(4, concurrency));
  const generation = createThumbnailQueue(concurrency);
  const counters = { memoryHits: 0, diskHits: 0, generated: 0, sharedRequests: 0 };

  function trim() {
    while (entries.size > MAX_ENTRIES || retainedBytes > MAX_BYTES) {
      const key = entries.keys().next().value!;
      retainedBytes -= entries.get(key)?.blob?.size || 0;
      entries.delete(key);
    }
  }

  function refresh() {
    reads.refresh();
    generation.refresh();
    refreshThumbnailWorkers();
  }

  async function get(
    handle: FileSystemFileHandle,
    shouldContinue: () => boolean = () => true,
    getPriority: () => number = () => 0,
  ): Promise<Source | null> {
    if (/\.(gif|webp)$/i.test(handle.name))
      return shouldContinue() ? getOriginalImageSource(handle) : null;
    const key = handle.nativePath || handle;
    let entry = entries.get(key);
    if (!entry) {
      const cache = entries;
      const consumers = new Map([[shouldContinue, getPriority]]);
      entry = { consumers, promise: Promise.resolve(null) };
      cache.set(key, entry);
      const current = entry;
      const request: ThumbnailRequest = {
        shouldContinue: () =>
          !current.invalid &&
          cache === entries &&
          [...consumers.keys()].some((consumer) => consumer()),
        getPriority: () => {
          let priority = Infinity;
          for (const [needed, getPriority] of consumers)
            if (needed()) priority = Math.min(priority, getPriority());
          return priority;
        },
      };
      entry.promise = (async () => {
        let stored: Awaited<ReturnType<NonNullable<Window['desktopApi']>['readThumbnail']>> | null =
          null;
        if (handle.nativePath && window.desktopApi) {
          try {
            stored = await reads.enqueue(
              () => window.desktopApi!.readThumbnail(handle.nativePath!),
              request,
            );
          } catch {
            /* 保存領域が使えない場合も表示する */
          }
          if (stored?.bytes && !skipStored.has(key)) {
            const bytes = new Uint8Array(stored.bytes);
            counters.diskHits++;
            // Let the displayed img decode once. Its error handler invalidates only this file.
            return new Blob([bytes.buffer], {
              type: bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg' : 'image/webp',
            });
          }
        }
        const blob = await generation.enqueue(() => generate(handle, request), request);
        if (blob) {
          counters.generated++;
          if (stored && handle.nativePath && window.desktopApi) {
            const filePath = handle.nativePath;
            const api = window.desktopApi;
            const version = stored.version;
            void blob
              .arrayBuffer()
              .then((buffer) => api.writeThumbnail(filePath, version, new Uint8Array(buffer)))
              .then((saved) => {
                if (saved && cache === entries) skipStored.delete(key);
              })
              .catch(() => {
                /* ディスク保存に失敗した場合もメモリに保持する */
              });
          }
        }
        return blob;
      })()
        .catch(() => null)
        .then((blob) => {
          current.blob = blob;
          consumers.clear();
          if (!blob && cache.get(key) === current) cache.delete(key);
          if (blob && cache === entries && cache.get(key) === current) {
            retainedBytes += blob.size;
            trim();
          }
          return blob;
        });
      trim();
    } else {
      if (entry.blob) counters.memoryHits++;
      else counters.sharedRequests++;
      entry.consumers.set(shouldContinue, getPriority);
      entries.delete(key);
      entries.set(key, entry);
    }
    refresh();
    const blob = await entry.promise;
    entry.consumers.delete(shouldContinue);
    if (!shouldContinue()) return null;
    return blob
      ? { url: URL.createObjectURL(blob), objectUrl: true }
      : getOriginalImageSource(handle);
  }

  function invalidate(handle: FileSystemFileHandle) {
    const key = handle.nativePath || handle;
    const entry = entries.get(key);
    if (entry) entry.invalid = true;
    retainedBytes -= entry?.blob?.size || 0;
    entries.delete(key);
    skipStored.add(key);
    refresh();
  }

  function clear() {
    entries = new Map();
    retainedBytes = 0;
    skipStored.clear();
    reads.clear();
    generation.clear();
    refresh();
  }
  return {
    get,
    clear,
    invalidate,
    refresh,
    setPaused(value: boolean) {
      reads.setPaused(value);
      generation.setPaused(value);
      setThumbnailWorkersPaused(value);
    },
    peek(handle: FileSystemFileHandle): Source | null {
      const blob = entries.get(handle.nativePath || handle)?.blob;
      return blob ? { url: URL.createObjectURL(blob), objectUrl: true } : null;
    },
    stats: () => ({ ...counters, entries: entries.size, retainedBytes }),
  };
}

export const thumbnailCache = createThumbnailCache();
