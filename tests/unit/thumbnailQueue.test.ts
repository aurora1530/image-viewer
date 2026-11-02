import { describe, expect, it } from 'vitest';
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
