export const THUMBNAIL_CONCURRENCY = Math.min(8, Math.max(1, (navigator.hardwareConcurrency || 4) - 2));

type Job = { blob: Blob; resolve: (blob: Blob) => void; reject: (error: Error) => void };
type Slot = { worker: Worker; job: Job | null };

export function createThumbnailWorkerPool(size = THUMBNAIL_CONCURRENCY) {
  const slots: Slot[] = [];
  const waiting: Job[] = [];
  let failed = false;

  function fail() {
    failed = true;
    const error = new Error('サムネイル用Workerを起動できませんでした。');
    for (const slot of slots) {
      slot.worker.terminate();
      slot.job?.reject(error);
    }
    slots.length = 0;
    for (const job of waiting.splice(0)) job.reject(error);
  }

  function dispatch() {
    while (waiting.length && !failed) {
      let slot = slots.find(candidate => !candidate.job);
      if (!slot) {
        if (slots.length >= size) return;
        try {
          const worker = new Worker(new URL('./thumbnailWorker.ts', import.meta.url), { type: 'module' });
          slot = { worker, job: null };
          const current = slot;
          worker.onmessage = (event: MessageEvent<{ blob?: Blob; error?: string }>) => {
            const job = current.job;
            current.job = null;
            if (event.data.blob) job?.resolve(event.data.blob);
            else job?.reject(new Error(event.data.error || 'サムネイルの生成に失敗しました。'));
            dispatch();
          };
          worker.onerror = fail;
          worker.onmessageerror = fail;
          slots.push(slot);
        } catch { fail(); return; }
      }
      slot.job = waiting.shift()!;
      try { slot.worker.postMessage(slot.job.blob); }
      catch { fail(); }
    }
  }

  function encode(blob: Blob): Promise<Blob> {
    if (failed) return Promise.reject(new Error('サムネイル用Workerが利用できません。'));
    return new Promise((resolve, reject) => {
      waiting.push({ blob, resolve, reject });
      dispatch();
    });
  }

  return { encode };
}

let pool: ReturnType<typeof createThumbnailWorkerPool> | null = null;
export async function encodeThumbnailInWorker(blob: Blob): Promise<Blob | null> {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') return null;
  pool ??= createThumbnailWorkerPool();
  try { return await pool.encode(blob); }
  catch { return null; }
}
