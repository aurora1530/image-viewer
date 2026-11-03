import { requireValue } from '../shared/validation';
import type { FileHandle } from '../shared/fileSystem';
import { renderPdfThumbnail } from './pdfDocument';
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
import { thumbnailSizes } from '../shared/thumbnail';
import type { ThumbnailSize } from '../shared/thumbnail';
import { waitWithSignal } from '../shared/abort';

type Source = { url: string; objectUrl: boolean };
type Entry = {
  promise: Promise<Blob | null>;
  consumers: Map<symbol, { needed: () => boolean; priority: () => number }>;
  controller: AbortController;
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
  handle: FileHandle,
  request: ThumbnailRequest,
  maxEdge: ThumbnailSize,
): Promise<Blob | null> {
  if (/\.pdf$/i.test(handle.name))
    return renderPdfThumbnail(
      handle,
      () => request.shouldContinue?.() !== false,
      maxEdge,
      request.signal,
    );
  let source: Source | null = null;
  const image = new Image();
  let canvas: HTMLCanvasElement | null = null;
  try {
    const blob = await originalImageCache.get(handle, request.signal);
    await waitForThumbnailResume();
    if (request.shouldContinue?.() === false) return null;
    const png = handle.name.toLowerCase().endsWith('.png') ? await inspectPng(blob) : null;
    if (png?.animated) return null;
    const format = /\.jpe?g$/i.test(handle.name) || png?.opaque ? 'image/jpeg' : 'image/webp';
    const workerResult = await encodeThumbnailInWorker(blob, request, format, maxEdge);
    if (workerResult) return workerResult;
    if (request.shouldContinue?.() === false) return null;
    source = { url: URL.createObjectURL(blob), objectUrl: true };
    image.decoding = 'async';
    image.src = source.url;
    await image.decode();
    const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
    canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('サムネイルを生成できませんでした。');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const output = canvas;
    return await new Promise<Blob>((resolve, reject) =>
      output.toBlob(
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
  let entries = new Map<string | symbol, Entry>();
  const pending = new Map<Entry, string | symbol>();
  const needed = (entry: Entry) =>
    !entry.invalid && [...entry.consumers.values()].some((consumer) => consumer.needed());
  const handleKeys = new WeakMap<FileHandle, Map<ThumbnailSize, symbol>>();
  function keyFor(handle: FileHandle, maxEdge: ThumbnailSize) {
    if (handle.nativePath) return `${maxEdge}:${handle.nativePath}`;
    let sizes = handleKeys.get(handle);
    if (!sizes) {
      sizes = new Map();
      handleKeys.set(handle, sizes);
    }
    let key = sizes.get(maxEdge);
    if (!key) {
      key = Symbol();
      sizes.set(maxEdge, key);
    }
    return key;
  }
  let retainedBytes = 0;
  let maxBytes = 512 * 1024 * 1024;
  const skipStored = new Set<string | symbol>();
  // Disk hits must not wait for unrelated image encoding to finish.
  const reads = createThumbnailQueue(Math.max(4, concurrency));
  const generation = createThumbnailQueue(concurrency);
  const counters = { memoryHits: 0, diskHits: 0, generated: 0, sharedRequests: 0 };

  function trim() {
    while (retainedBytes > maxBytes) {
      const key = requireValue(entries.keys().next().value);
      retainedBytes -= entries.get(key)?.blob?.size || 0;
      entries.delete(key);
    }
  }

  function refresh() {
    for (const [entry, key] of pending) {
      if (!needed(entry)) {
        if (entries.get(key) === entry) entries.delete(key);
        entry.controller.abort();
      }
    }
    reads.refresh();
    generation.refresh();
    refreshThumbnailWorkers();
  }

  async function get(
    handle: FileHandle,
    shouldContinue: () => boolean = () => true,
    getPriority: () => number = () => 0,
    maxEdge: ThumbnailSize = 1280,
    signal?: AbortSignal,
  ): Promise<Source | null> {
    if (signal?.aborted || !shouldContinue()) return null;
    if (/\.(gif|webp)$/i.test(handle.name))
      return getOriginalImageSource(handle, signal).catch((error: unknown) => {
        if (signal?.aborted) return null;
        throw error;
      });
    const key = keyFor(handle, maxEdge);
    const consumer = Symbol();
    const usage = { needed: () => !signal?.aborted && shouldContinue(), priority: getPriority };
    let entry = entries.get(key);
    if (!entry) {
      const cache = entries;
      const consumers = new Map([[consumer, usage]]);
      entry = { consumers, controller: new AbortController(), promise: Promise.resolve(null) };
      cache.set(key, entry);
      const current = entry;
      pending.set(current, key);
      const request: ThumbnailRequest = {
        signal: current.controller.signal,
        shouldContinue: () =>
          !current.controller.signal.aborted && cache === entries && needed(current),
        getPriority: () => {
          let priority = Infinity;
          for (const consumer of consumers.values())
            if (consumer.needed()) priority = Math.min(priority, consumer.priority());
          return priority;
        },
      };
      entry.promise = (async () => {
        let stored: Awaited<ReturnType<NonNullable<Window['desktopApi']>['readThumbnail']>> | null =
          null;
        const nativePath = handle.nativePath;
        const desktopApi = window.desktopApi;
        if (nativePath && desktopApi) {
          try {
            stored = await reads.enqueue(
              () => desktopApi.readThumbnail(nativePath, maxEdge),
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
        const blob = await generation.enqueue(() => generate(handle, request, maxEdge), request);
        if (blob) {
          counters.generated++;
          if (stored && handle.nativePath && window.desktopApi) {
            const filePath = handle.nativePath;
            const api = window.desktopApi;
            const version = stored.version;
            void blob
              .arrayBuffer()
              .then((buffer) =>
                api.writeThumbnail(filePath, version, new Uint8Array(buffer), maxEdge),
              )
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
          pending.delete(current);
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
      entry.consumers.set(consumer, usage);
      entries.delete(key);
      entries.set(key, entry);
    }
    const current = entry;
    const release = () => {
      current.consumers.delete(consumer);
      refresh();
    };
    signal?.addEventListener('abort', release, { once: true });
    refresh();
    try {
      const blob = await waitWithSignal(current.promise, signal);
      if (!shouldContinue() || signal?.aborted || current.controller.signal.aborted) return null;
      return blob
        ? { url: URL.createObjectURL(blob), objectUrl: true }
        : /\.pdf$/i.test(handle.name)
          ? null
          : await getOriginalImageSource(handle, signal);
    } catch (error) {
      if (signal?.aborted) return null;
      throw error;
    } finally {
      signal?.removeEventListener('abort', release);
      release();
    }
  }

  function invalidate(handle: FileHandle) {
    for (const maxEdge of thumbnailSizes) {
      const key = keyFor(handle, maxEdge);
      const entry = entries.get(key);
      if (entry) entry.invalid = true;
      retainedBytes -= entry?.blob?.size || 0;
      entries.delete(key);
      skipStored.add(key);
    }
    refresh();
  }

  function clear() {
    for (const entry of pending.keys()) entry.controller.abort();
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
    peek(handle: FileHandle): Source | null {
      const blob =
        entries.get(keyFor(handle, 1280))?.blob ?? entries.get(keyFor(handle, 640))?.blob;
      return blob ? { url: URL.createObjectURL(blob), objectUrl: true } : null;
    },
    setMaxBytes(value: number) {
      maxBytes = value;
      trim();
    },
    stats: () => ({ ...counters, entries: entries.size, retainedBytes }),
  };
}

export const thumbnailCache = createThumbnailCache();
