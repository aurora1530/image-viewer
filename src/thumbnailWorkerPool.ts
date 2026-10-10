import { createThumbnailQueue } from './thumbnailQueue';
import type { ThumbnailRequest } from './thumbnailQueue';

export const THUMBNAIL_CONCURRENCY = Math.min(32, Math.max(1, (navigator.hardwareConcurrency || 4) - 2));

type Job = { resolve: (blob: Blob | null) => void; reject: (error: Error) => void; request: ThumbnailRequest };
type Slot = { worker: Worker; job: Job | null };

export function createThumbnailWorkerPool(size = THUMBNAIL_CONCURRENCY) {
  const slots: Slot[] = [];
  const queue = createThumbnailQueue(size);
  let failed = false;

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

  function encode(blob: Blob, request: ThumbnailRequest = {}, format = blob.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp'): Promise<Blob | null> {
    if (failed) return Promise.reject(new Error('サムネイル用Workerが利用できません。'));
    const result = queue.enqueue(() => new Promise<Blob | null>((resolve, reject) => {
      if (failed) { reject(new Error('サムネイル用Workerが利用できません。')); return; }
      let slot = slots.find(candidate => !candidate.job);
      if (!slot) {
        try {
          const worker = new Worker(new URL('./thumbnailWorker.ts', import.meta.url), { type: 'module' });
          slot = { worker, job: null };
          const current = slot;
          worker.onmessage = (event: MessageEvent<{ blob?: Blob; error?: string }>) => {
            const job = current.job;
            current.job = null;
            if (event.data.blob) job?.resolve(event.data.blob);
            else job?.reject(new Error(event.data.error || 'サムネイルの生成に失敗しました。'));
          };
          worker.onerror = fail;
          worker.onmessageerror = fail;
          slots.push(slot);
        } catch { fail(); reject(new Error('サムネイル用Workerを起動できませんでした。')); return; }
      }
      slot.job = { resolve, reject, request };
      try { slot.worker.postMessage({ blob, format }); }
      catch { fail(); }
    }), request);
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

  return { encode, refresh, setPaused: queue.setPaused };
}

let pool: ReturnType<typeof createThumbnailWorkerPool> | null = null;
let paused = false;
const resumeWaiters = new Set<() => void>();
export function setThumbnailWorkersPaused(value: boolean) {
  paused = value;
  pool?.setPaused(value);
  if (!value) {
    for (const resume of resumeWaiters) resume();
    resumeWaiters.clear();
  }
}
export async function waitForThumbnailResume() {
  while (paused) await new Promise<void>(resolve => resumeWaiters.add(resolve));
}
export function refreshThumbnailWorkers() { pool?.refresh(); }
export async function encodeThumbnailInWorker(blob: Blob, request: ThumbnailRequest = {}, format?: string): Promise<Blob | null> {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') return null;
  if (!pool) { pool = createThumbnailWorkerPool(); pool.setPaused(paused); }
  try { return await pool.encode(blob, request, format); }
  catch { return null; }
}
