import { requireValue } from '../../src/shared/validation';
import type { FileHandle } from '../../src/shared/fileSystem';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOriginalImageCache } from '../../src/services/originalImageCache';
import { createDesktopApi } from '../helpers/desktopApi';
import { ReadableStream as NodeReadableStream } from 'node:stream/web';

afterEach(() => {
  vi.unstubAllGlobals();
  delete window.desktopApi;
});

function file(name: string, size = 4) {
  return {
    name,
    kind: 'file' as const,
    createWritable: async () => {
      throw new Error('Read-only file');
    },
    getFile: vi.fn(async () => new File(['x'.repeat(size)], name)),
  } satisfies FileHandle;
}

describe('shared original image cache', () => {
  it('aborts an abandoned native fetch and permits an immediate retry', async () => {
    const cache = createOriginalImageCache();
    window.desktopApi = createDesktopApi();
    const handle = { ...file('cancel.jpg'), nativePath: 'C:\\images\\cancel.jpg' };
    const signals: AbortSignal[] = [];
    const fetchFile = vi.fn<typeof fetch>((_input, init) => {
      const signal = requireValue(init?.signal);
      signals.push(signal);
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
          once: true,
        });
      });
    });
    vi.stubGlobal('fetch', fetchFile);
    const controller = new AbortController();
    const first = cache.get(handle, controller.signal);
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    controller.abort();
    expect(signals[0].aborted).toBe(true);
    fetchFile.mockResolvedValueOnce(new Response('new image'));
    const next = cache.get(handle);
    await rejected;
    expect(await (await next).text()).toBe('new image');
    expect(fetchFile).toHaveBeenCalledTimes(2);
  });

  it('keeps a shared read alive for another size and an uncancelled viewer', async () => {
    const cache = createOriginalImageCache();
    window.desktopApi = createDesktopApi();
    const handle = { ...file('shared.jpg'), nativePath: 'C:\\images\\shared.jpg' };
    let finish: ((response: Response) => void) | undefined;
    let readSignal: AbortSignal | undefined;
    const fetchFile = vi.fn<typeof fetch>((_input, init) => {
      readSignal = requireValue(init?.signal);
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    });
    vi.stubGlobal('fetch', fetchFile);
    const small = new AbortController();
    const large = new AbortController();
    const a = cache.get(handle, small.signal);
    const b = cache.get(handle, large.signal);
    const viewer = cache.get(handle);
    const stopped = Promise.all([
      expect(a).rejects.toMatchObject({ name: 'AbortError' }),
      expect(b).rejects.toMatchObject({ name: 'AbortError' }),
    ]);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    small.abort();
    large.abort();
    await stopped;
    expect(requireValue(readSignal).aborted).toBe(false);
    requireValue(finish)(new Response('shared image'));
    const blob = await viewer;
    expect(await cache.get(handle)).toBe(blob);
    expect(fetchFile).toHaveBeenCalledOnce();
  });

  it('aborts while reading a response body after the last consumer leaves', async () => {
    vi.stubGlobal('ReadableStream', NodeReadableStream);
    const cache = createOriginalImageCache();
    window.desktopApi = createDesktopApi();
    const handle = { ...file('body.png'), nativePath: 'C:\\images\\body.png' };
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (_input, init) => {
        const signal = requireValue(init?.signal);
        signals.push(signal);
        return new Response(
          new ReadableStream<Uint8Array>({
            start(stream) {
              signal.addEventListener(
                'abort',
                () => stream.error(new DOMException('aborted', 'AbortError')),
                { once: true },
              );
            },
          }),
        );
      }),
    );
    const a = new AbortController();
    const b = new AbortController();
    const first = cache.get(handle, a.signal);
    const second = cache.get(handle, b.signal);
    const stopped = Promise.all([
      expect(first).rejects.toMatchObject({ name: 'AbortError' }),
      expect(second).rejects.toMatchObject({ name: 'AbortError' }),
    ]);
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    a.abort();
    expect(signals[0].aborted).toBe(false);
    b.abort();
    expect(signals[0].aborted).toBe(true);
    await stopped;
    expect(cache.stats().retainedBytes).toBe(0);
  });

  it('discards an unabortable browser read without delaying its cancellation or replacing a retry', async () => {
    const cache = createOriginalImageCache();
    const handle = file('browser.jpg');
    let finish: ((file: File) => void) | undefined;
    handle.getFile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const controller = new AbortController();
    const old = cache.get(handle, controller.signal);
    const stopped = expect(old).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await stopped;
    const next = await cache.get(handle);
    requireValue(finish)(new File(['discard'], handle.name));
    await Promise.resolve();
    expect(await cache.get(handle)).toBe(next);
    expect(cache.stats().retainedBytes).toBe(4);
    expect(handle.getFile).toHaveBeenCalledTimes(2);
  });

  it('releases retained blobs immediately when the budget is reduced to zero', async () => {
    const cache = createOriginalImageCache();
    const handle = file('runtime.jpg');
    await cache.get(handle);
    expect(cache.stats().retainedBytes).toBe(4);
    cache.setMaxBytes(0);
    expect(cache.stats().retainedBytes).toBe(0);
    await cache.get(handle);
    expect(handle.getFile).toHaveBeenCalledTimes(2);
    expect(cache.stats().retainedBytes).toBe(0);
  });
  it('shares pending reads between thumbnail and viewer and retains the result', async () => {
    const cache = createOriginalImageCache();
    const handle = file('shared.jpg');
    const [thumbnail, viewer] = await Promise.all([cache.get(handle), cache.get(handle)]);
    expect(viewer).toBe(thumbnail);
    expect(await cache.get(handle)).toBe(viewer);
    expect(handle.getFile).toHaveBeenCalledOnce();
  });

  it('evicts least recently used originals within the byte budget', async () => {
    const cache = createOriginalImageCache(8);
    const a = file('a.jpg'),
      b = file('b.jpg'),
      c = file('c.jpg');
    await cache.get(a);
    await cache.get(b);
    await cache.get(a);
    await cache.get(c);
    await cache.get(a);
    expect(a.getFile).toHaveBeenCalledOnce();
    await cache.get(b);
    expect(b.getFile).toHaveBeenCalledTimes(2);
  });

  it('does not repopulate a cleared cache when an older read completes', async () => {
    const cache = createOriginalImageCache();
    const handle = file('pending.jpg');
    let release: ((file: File) => void) | undefined;
    vi.mocked(handle.getFile).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const old = cache.get(handle);
    cache.clear();
    await cache.get(handle);
    requireValue(release)(new File(['old'], handle.name));
    await old;
    expect(await cache.get(handle)).not.toBe(await old);
    expect(handle.getFile).toHaveBeenCalledTimes(2);
  });

  it('retries a failed read and invalidates originals on explicit clear', async () => {
    const cache = createOriginalImageCache();
    const handle = file('retry.jpg');
    vi.mocked(handle.getFile).mockRejectedValueOnce(new Error('read failed'));
    await expect(cache.get(handle)).rejects.toThrow('read failed');
    await cache.get(handle);
    cache.clear();
    await cache.get(handle);
    expect(handle.getFile).toHaveBeenCalledTimes(3);
  });
});
