import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createThumbnailWorkerPool } from '../../src/thumbnailWorkerPool';

class TestWorker {
  static instances: TestWorker[] = [];
  onmessage: ((event: MessageEvent<{ blob?: Blob; error?: string }>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { TestWorker.instances.push(this); }
  reply(data: { blob?: Blob; error?: string }) { this.onmessage?.({ data } as MessageEvent<typeof data>); }
}

beforeEach(() => { TestWorker.instances = []; vi.stubGlobal('Worker', TestWorker); });

describe('thumbnail worker pool', () => {
  it('runs jobs on separate workers up to the limit and reuses idle workers', async () => {
    const pool = createThumbnailWorkerPool(2);
    const input = new Blob(['original']);
    const output = new Blob(['thumbnail']);
    const jobs = [pool.encode(input), pool.encode(input), pool.encode(input)];
    expect(TestWorker.instances).toHaveLength(2);
    const [first, second] = TestWorker.instances;
    expect(first.postMessage).toHaveBeenCalledOnce();
    expect(second.postMessage).toHaveBeenCalledOnce();
    first.reply({ blob: output });
    expect(first.postMessage).toHaveBeenCalledTimes(2);
    second.reply({ blob: output });
    first.reply({ blob: output });
    expect(await Promise.all(jobs)).toEqual([output, output, output]);
  });

  it('rejects failed image jobs without disabling healthy workers', async () => {
    const pool = createThumbnailWorkerPool(1);
    const failed = pool.encode(new Blob());
    const rejection = expect(failed).rejects.toThrow('bad image');
    TestWorker.instances[0].reply({ error: 'bad image' });
    await rejection;
    const next = pool.encode(new Blob());
    const output = new Blob();
    TestWorker.instances[0].reply({ blob: output });
    expect(await next).toBe(output);
    expect(TestWorker.instances).toHaveLength(1);
  });

  it('rejects running and queued jobs when the worker cannot start', async () => {
    const pool = createThumbnailWorkerPool(1);
    const jobs = [pool.encode(new Blob()), pool.encode(new Blob())];
    const results = Promise.allSettled(jobs);
    TestWorker.instances[0].onerror?.();
    expect((await results).every(result => result.status === 'rejected')).toBe(true);
    expect(TestWorker.instances[0].terminate).toHaveBeenCalledOnce();
    await expect(pool.encode(new Blob())).rejects.toThrow('利用できません');
  });

  it('handles worker construction failures without leaving jobs pending', async () => {
    vi.stubGlobal('Worker', class { constructor() { throw new Error('blocked'); } });
    await expect(createThumbnailWorkerPool().encode(new Blob())).rejects.toThrow('起動できません');
  });
});
