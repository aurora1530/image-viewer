import { describe, expect, it, vi } from 'vitest';
import { createOriginalImageCache } from '../../src/services/originalImageCache';

function file(name: string, size = 4) {
  return {
    name,
    kind: 'file',
    getFile: vi.fn(async () => new File(['x'.repeat(size)], name)),
  } as unknown as FileSystemFileHandle;
}

describe('shared original image cache', () => {
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
    let release!: (file: File) => void;
    vi.mocked(handle.getFile).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const old = cache.get(handle);
    cache.clear();
    await cache.get(handle);
    release(new File(['old'], handle.name));
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
