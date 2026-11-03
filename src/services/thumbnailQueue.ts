import type { ThumbnailSize } from '../shared/thumbnail';

export type ThumbnailRequest = {
  signal?: AbortSignal;
  maxEdge?: ThumbnailSize;
  shouldContinue?: () => boolean;
  getPriority?: () => number;
};

type Job = {
  run: () => Promise<void>;
  cancel: () => void;
  reject: (error: unknown) => void;
  request: ThumbnailRequest;
};

// Re-evaluate positions at dispatch time: scroll targets can overtake earlier requests.
export function createThumbnailQueue(concurrency: number, reserveForVisible = false) {
  const waiting: Job[] = [];
  const active = new Set<Job>();
  // Keep room for newly visible cards without stopping useful work already in progress.
  const prefetchLimit = Math.max(1, Math.floor(concurrency * 0.75));
  let scheduled = false;
  let paused = false;

  function pump() {
    scheduled = false;
    for (let i = waiting.length - 1; i >= 0; i--) {
      if (waiting[i].request.shouldContinue?.() === false) waiting.splice(i, 1)[0].cancel();
    }
    let prefetchActive = reserveForVisible
      ? [...active].filter((job) => (job.request.getPriority?.() ?? 0) > 0).length
      : 0;
    while (!paused && active.size < concurrency && waiting.length) {
      let best = 0;
      let priority = waiting[0].request.getPriority?.() ?? 0;
      for (let i = 1; i < waiting.length; i++) {
        const candidate = waiting[i].request.getPriority?.() ?? 0;
        if (candidate < priority) {
          best = i;
          priority = candidate;
        }
      }
      if (reserveForVisible && priority > 0 && prefetchActive >= prefetchLimit) break;
      const job = waiting.splice(best, 1)[0];
      active.add(job);
      if (priority > 0) prefetchActive++;
      void Promise.resolve()
        .then(job.run)
        .catch(job.reject)
        .finally(() => {
          active.delete(job);
          refresh();
        });
    }
  }

  function refresh() {
    // Cards created in a fragment must be attached before checking shouldContinue.
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(pump);
    }
  }

  return {
    enqueue<T>(work: () => Promise<T>, request: ThumbnailRequest = {}): Promise<T | null> {
      return new Promise((resolve, reject) => {
        waiting.push({
          run: async () => {
            resolve(await work());
          },
          cancel: () => resolve(null),
          reject,
          request,
        });
        refresh();
      });
    },
    refresh,
    setPaused(value: boolean) {
      paused = value;
      refresh();
    },
    hasVisibleWaiting: () =>
      waiting.some(
        (job) =>
          job.request.shouldContinue?.() !== false && (job.request.getPriority?.() ?? 0) <= 0,
      ),
    clear(error?: Error) {
      for (const job of waiting.splice(0)) {
        if (error) job.reject(error);
        else job.cancel();
      }
    },
  };
}
