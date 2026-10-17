import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createThumbnailWorkerPool } from '../../src/services/thumbnailWorkerPool';

class TestWorker {
  static instances: TestWorker[] = [];
  onmessage: ((event: MessageEvent<{ blob?: Blob; error?: string }>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    TestWorker.instances.push(this);
  }
  reply(data: { blob?: Blob; error?: string }) {
    this.onmessage?.({ data } as MessageEvent<typeof data>);
  }
}

beforeEach(() => {
  TestWorker.instances = [];
  vi.stubGlobal('Worker', TestWorker);
});

describe('thumbnail worker pool', () => {
  it('pauses queued encoding while preserving completed work and resumes on close', async () => {
    const pool = createThumbnailWorkerPool(1);
    const first = pool.encode(new Blob());
    await vi.waitFor(() => expect(TestWorker.instances).toHaveLength(1));
    pool.setPaused(true);
    const second = pool.encode(new Blob());
    TestWorker.instances[0].reply({ blob: new Blob(['first']) });
    await first;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(TestWorker.instances[0].postMessage).toHaveBeenCalledOnce();
    pool.setPaused(false);
    await vi.waitFor(() => expect(TestWorker.instances[0].postMessage).toHaveBeenCalledTimes(2));
    const output = new Blob(['second']);
    TestWorker.instances[0].reply({ blob: output });
    expect(await second).toBe(output);
  });
  it('runs jobs on separate workers up to the limit and reuses idle workers', async () => {
    const pool = createThumbnailWorkerPool(2);
    const input = new Blob(['original']);
    const output = new Blob(['thumbnail']);
    const jobs = [pool.encode(input), pool.encode(input), pool.encode(input)];
    await vi.waitFor(() => expect(TestWorker.instances).toHaveLength(2));
    const [first, second] = TestWorker.instances;
    expect(first.postMessage).toHaveBeenCalledOnce();
    expect(second.postMessage).toHaveBeenCalledOnce();
    first.reply({ blob: output });
    await vi.waitFor(() => expect(first.postMessage).toHaveBeenCalledTimes(2));
    second.reply({ blob: output });
    first.reply({ blob: output });
    expect(await Promise.all(jobs)).toEqual([output, output, output]);
  });

  it('rejects failed image jobs without disabling healthy workers', async () => {
    const pool = createThumbnailWorkerPool(1);
    const failed = pool.encode(new Blob());
    const rejection = expect(failed).rejects.toThrow('bad image');
    await vi.waitFor(() => expect(TestWorker.instances).toHaveLength(1));
    TestWorker.instances[0].reply({ error: 'bad image' });
    await rejection;
    const next = pool.encode(new Blob());
    const output = new Blob();
    await vi.waitFor(() => expect(TestWorker.instances[0].postMessage).toHaveBeenCalledTimes(2));
    TestWorker.instances[0].reply({ blob: output });
    expect(await next).toBe(output);
    expect(TestWorker.instances).toHaveLength(1);
  });

  it('rejects running and queued jobs when the worker cannot start', async () => {
    const pool = createThumbnailWorkerPool(1);
    const jobs = [pool.encode(new Blob()), pool.encode(new Blob())];
    const results = Promise.allSettled(jobs);
    await vi.waitFor(() => expect(TestWorker.instances).toHaveLength(1));
    TestWorker.instances[0].onerror?.();
    expect((await results).every((result) => result.status === 'rejected')).toBe(true);
    expect(TestWorker.instances[0].terminate).toHaveBeenCalledOnce();
    await expect(pool.encode(new Blob())).rejects.toThrow('利用できません');
  });

  it('handles worker construction failures without leaving jobs pending', async () => {
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new Error('blocked');
        }
      },
    );
    await expect(createThumbnailWorkerPool().encode(new Blob())).rejects.toThrow('起動できません');
  });

  it('reprioritizes queued images and discards unneeded work before a running worker finishes', async () => {
    const pool = createThumbnailWorkerPool(1);
    const first = pool.encode(new Blob(['first']));
    await vi.waitFor(() => expect(TestWorker.instances).toHaveLength(1));
    let needed = true;
    const abandoned = pool.encode(new Blob(['abandoned']), { shouldContinue: () => needed });
    const backgroundBlob = new Blob(['background']);
    const targetBlob = new Blob(['target'], { type: 'image/jpeg' });
    let priority = 100;
    const background = pool.encode(backgroundBlob, { getPriority: () => 10 });
    const target = pool.encode(targetBlob, { getPriority: () => priority });
    needed = false;
    priority = 0;
    pool.refresh();
    expect(await abandoned).toBeNull();
    const worker = TestWorker.instances[0];
    const output = new Blob();
    worker.reply({ blob: output });
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2));
    expect(worker.postMessage).toHaveBeenLastCalledWith({ blob: targetBlob, format: 'image/jpeg' });
    worker.reply({ blob: output });
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(3));
    expect(worker.postMessage).toHaveBeenLastCalledWith({
      blob: backgroundBlob,
      format: 'image/webp',
    });
    worker.reply({ blob: output });
    await Promise.all([first, target, background]);
  });

  it('reclaims an abandoned running worker for a visible scroll target', async () => {
    const pool = createThumbnailWorkerPool(1);
    let connected = true;
    const abandoned = pool.encode(new Blob(['old viewport']), { shouldContinue: () => connected });
    await vi.waitFor(() => expect(TestWorker.instances).toHaveLength(1));
    const oldWorker = TestWorker.instances[0];
    connected = false;
    const target = pool.encode(new Blob(['new viewport']), { getPriority: () => 0 });
    expect(await abandoned).toBeNull();
    expect(oldWorker.terminate).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(TestWorker.instances).toHaveLength(2));
    const thumbnail = new Blob();
    TestWorker.instances[1].reply({ blob: thumbnail });
    expect(await target).toBe(thumbnail);
  });
});
