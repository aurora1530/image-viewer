import { createThumbnailQueue } from './thumbnailQueue';
import type { ThumbnailRequest } from './thumbnailQueue';
import type { ThumbnailSize } from '../shared/thumbnail';

// Bound full-resolution decode memory and read contention during rapid scrolling.
// More workers increased first-visible latency in the 24 MP cold-thumbnail benchmark.
export const THUMBNAIL_CONCURRENCY = Math.min(
  8,
  Math.max(1, (navigator.hardwareConcurrency || 4) - 2),
);
// WebP encoding dominates GIF generation. In the 12-GIF benchmark, six workers
// cleared the queue almost as fast as eight and finished the first GIF sooner.
export const ANIMATED_GIF_CONCURRENCY = Math.min(6, THUMBNAIL_CONCURRENCY);

type Job = {
  resolve: (blob: Blob | null) => void;
  reject: (error: Error) => void;
  request: ThumbnailRequest;
};
type Slot = { worker: Worker; job: Job | null };

export function createThumbnailWorkerPool(size = THUMBNAIL_CONCURRENCY, pauseRunning = false) {
  const slots: Slot[] = [];
  const queue = createThumbnailQueue(size, true);
  let failed = false;
  let paused = false;

  function fail() {
    failed = true;
    const error = new Error('サムネイル用Workerを起動できませんでした。');
    for (const slot of slots) {
      slot.worker.terminate();
      slot.job?.reject(error);
    }
    slots.length = 0;
    queue.clear(error);
  }

  function encode(
    blob: Blob,
    request: ThumbnailRequest = {},
    format = blob.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp',
    maxEdge: ThumbnailSize = 1280,
  ): Promise<Blob | null> {
    if (failed) return Promise.reject(new Error('サムネイル用Workerが利用できません。'));
    const result = queue.enqueue(
      () =>
        new Promise<Blob | null>((resolve, reject) => {
          if (failed) {
            reject(new Error('サムネイル用Workerが利用できません。'));
            return;
          }
          let slot = slots.find((candidate) => !candidate.job);
          if (!slot) {
            try {
              const worker = new Worker(new URL('./thumbnailWorker.ts', import.meta.url), {
                type: 'module',
              });
              slot = { worker, job: null };
              const current = slot;
              worker.onmessage = (event: MessageEvent<{ blob?: Blob | null; error?: string }>) => {
                const job = current.job;
                current.job = null;
                if (event.data.error) job?.reject(new Error(event.data.error));
                else job?.resolve(event.data.blob ?? null);
              };
              worker.onerror = fail;
              worker.onmessageerror = fail;
              slots.push(slot);
            } catch {
              fail();
              reject(new Error('サムネイル用Workerを起動できませんでした。'));
              return;
            }
          }
          slot.job = { resolve, reject, request };
          try {
            slot.worker.postMessage({ blob, format, maxEdge });
          } catch {
            fail();
          }
        }),
      request,
    );
    refresh();
    return result;
  }

  function refresh() {
    // Reclaim abandoned running jobs only when a visible image needs their worker.
    // Otherwise allow useful background results to complete and enter the cache.
    if (queue.hasVisibleWaiting()) {
      for (let i = slots.length - 1; i >= 0; i--) {
        const slot = slots[i];
        if (slot.job?.request.shouldContinue?.() === false) {
          const job = slot.job;
          slot.job = null;
          slot.worker.terminate();
          slots.splice(i, 1);
          job.resolve(null);
        }
      }
    }
    queue.refresh();
  }

  function setPaused(value: boolean) {
    if (paused === value) return;
    paused = value;
    queue.setPaused(value);
    if (pauseRunning) {
      for (const slot of slots) slot.worker.postMessage({ paused: value });
    }
  }

  return { encode, refresh, setPaused };
}

let pool: ReturnType<typeof createThumbnailWorkerPool> | null = null;
let animationPool: ReturnType<typeof createThumbnailWorkerPool> | null = null;
let paused = false;
const resumeWaiters = new Set<() => void>();
export function setThumbnailWorkersPaused(value: boolean) {
  paused = value;
  pool?.setPaused(value);
  animationPool?.setPaused(value);
  if (!value) {
    for (const resume of resumeWaiters) resume();
    resumeWaiters.clear();
  }
}
export async function waitForThumbnailResume() {
  while (paused) await new Promise<void>((resolve) => resumeWaiters.add(resolve));
}
export function refreshThumbnailWorkers() {
  pool?.refresh();
  animationPool?.refresh();
}
export async function encodeThumbnailInWorker(
  blob: Blob,
  request: ThumbnailRequest = {},
  format?: string,
  maxEdge: ThumbnailSize = 1280,
): Promise<Blob | null> {
  const animated = format === 'gif-animation';
  if (
    typeof Worker === 'undefined' ||
    typeof OffscreenCanvas === 'undefined' ||
    (animated ? typeof ImageDecoder === 'undefined' : typeof createImageBitmap === 'undefined')
  )
    return null;
  const workers = animated
    ? (animationPool ??= createThumbnailWorkerPool(ANIMATED_GIF_CONCURRENCY, true))
    : (pool ??= createThumbnailWorkerPool());
  workers.setPaused(paused);
  try {
    return await workers.encode(blob, request, format, maxEdge);
  } catch {
    return null;
  }
}
