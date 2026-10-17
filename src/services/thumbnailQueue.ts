export type ThumbnailRequest = {
  shouldContinue?: () => boolean;
  getPriority?: () => number;
};

type Job = {
  work: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  request: ThumbnailRequest;
};

// Re-evaluate positions at dispatch time: scroll targets can overtake earlier requests.
export function createThumbnailQueue(concurrency: number) {
  const waiting: Job[] = [];
  let active = 0;
  let scheduled = false;
  let paused = false;

  function pump() {
    scheduled = false;
    for (let i = waiting.length - 1; i >= 0; i--) {
      if (waiting[i].request.shouldContinue?.() === false) waiting.splice(i, 1)[0].resolve(null);
    }
    while (!paused && active < concurrency && waiting.length) {
      let best = 0;
      let priority = waiting[0].request.getPriority?.() ?? 0;
      for (let i = 1; i < waiting.length; i++) {
        const candidate = waiting[i].request.getPriority?.() ?? 0;
        if (candidate < priority) {
          best = i;
          priority = candidate;
        }
      }
      const job = waiting.splice(best, 1)[0];
      active++;
      void Promise.resolve()
        .then(job.work)
        .then(job.resolve, job.reject)
        .finally(() => {
          active--;
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
        waiting.push({ work, resolve: (value) => resolve(value as T | null), reject, request });
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
        else job.resolve(null);
      }
    },
  };
}
