import { describe, expect, it, vi } from 'vitest';
import { createThumbnailQueue } from '../../src/services/thumbnailQueue';

describe('thumbnail queue result ownership', () => {
  it('keeps differently typed results paired with their callers', async () => {
    const queue = createThumbnailQueue(1);
    const number = queue.enqueue(() => Promise.resolve(42));
    const text = queue.enqueue(() => Promise.resolve('thumbnail'));
    const numericResult: number | null = await number;
    const textResult: string | null = await text;
    expect(numericResult).toBe(42);
    expect(textResult).toBe('thumbnail');
  });

  it('cancels queued work without executing it', async () => {
    const queue = createThumbnailQueue(1);
    let executed = false;
    const pending = queue.enqueue(() => {
      executed = true;
      return Promise.resolve(42);
    });
    queue.clear();
    expect(await pending).toBeNull();
    expect(executed).toBe(false);
  });

  it('propagates a failure and continues dispatching later jobs', async () => {
    const queue = createThumbnailQueue(1);
    const error = new Error('encoding failed');
    const failed = queue.enqueue(() => Promise.reject(error));
    const next = queue.enqueue(() => Promise.resolve('next'));
    await expect(failed).rejects.toBe(error);
    expect(await next).toBe('next');
  });
});

describe('thumbnail queue visible capacity', () => {
  function blockedWork() {
    const releases: (() => void)[] = [];
    const run = vi.fn(() => new Promise<void>((resolve) => releases.push(resolve)));
    return { run, release: () => releases.splice(0).forEach((resolve) => resolve()) };
  }

  it('leaves capacity for newly visible work while prefetch is still running', async () => {
    const queue = createThumbnailQueue(4, true);
    const work = blockedWork();
    const pending = Array.from({ length: 4 }, () =>
      queue.enqueue(work.run, { getPriority: () => 100 }),
    );
    await vi.waitFor(() => expect(work.run).toHaveBeenCalledTimes(3));
    expect(await queue.enqueue(() => Promise.resolve('visible'))).toBe('visible');
    expect(work.run).toHaveBeenCalledTimes(3);
    queue.clear();
    work.release();
    await Promise.all(pending);
  });

  it('allows visible requests to use every slot', async () => {
    const queue = createThumbnailQueue(4, true);
    const work = blockedWork();
    const pending = Array.from({ length: 4 }, () => queue.enqueue(work.run));
    await vi.waitFor(() => expect(work.run).toHaveBeenCalledTimes(4));
    work.release();
    await Promise.all(pending);
  });

  it('promotes a waiting request into reserved capacity after scrolling', async () => {
    const queue = createThumbnailQueue(4, true);
    const work = blockedWork();
    const running = Array.from({ length: 3 }, () =>
      queue.enqueue(work.run, { getPriority: () => 100 }),
    );
    await vi.waitFor(() => expect(work.run).toHaveBeenCalledTimes(3));
    let priority = 200;
    const target = queue.enqueue(work.run, { getPriority: () => priority });
    await Promise.resolve();
    expect(work.run).toHaveBeenCalledTimes(3);
    priority = 0;
    queue.refresh();
    await vi.waitFor(() => expect(work.run).toHaveBeenCalledTimes(4));
    work.release();
    await Promise.all([...running, target]);
  });

  it('re-evaluates running requests when counting available prefetch capacity', async () => {
    const queue = createThumbnailQueue(4, true);
    const work = blockedWork();
    let priority = 100;
    const running = Array.from({ length: 3 }, () =>
      queue.enqueue(work.run, { getPriority: () => priority }),
    );
    await vi.waitFor(() => expect(work.run).toHaveBeenCalledTimes(3));
    const waiting = queue.enqueue(work.run, { getPriority: () => 200 });
    await Promise.resolve();
    expect(work.run).toHaveBeenCalledTimes(3);
    priority = 0;
    queue.refresh();
    await vi.waitFor(() => expect(work.run).toHaveBeenCalledTimes(4));
    work.release();
    await Promise.all([...running, waiting]);
  });

  it('keeps prefetch progressing after completion and on a single-slot queue', async () => {
    for (const concurrency of [1, 4]) {
      const queue = createThumbnailQueue(concurrency, true);
      const run = vi.fn(() => Promise.resolve('prefetched'));
      const results = await Promise.all(
        Array.from({ length: 5 }, () => queue.enqueue(run, { getPriority: () => 100 })),
      );
      expect(results).toEqual(Array.from({ length: 5 }, () => 'prefetched'));
    }
  });
});
