import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createImagePageCache } from '../../src/services/imagePageCache';
import { getMediaSource } from '../../src/platform/nativeFs';
import { MemoryDirectory } from '../helpers/memoryFs';

vi.mock('../../src/platform/nativeFs', () => ({ getMediaSource: vi.fn() }));

const directory = new MemoryDirectory('root');
const first = directory.file('one.png').asHandle();
const second = directory.file('two.png').asHandle();
const decode = vi.fn<() => Promise<void>>();

beforeEach(() => {
  decode.mockReset().mockResolvedValue(undefined);
  vi.mocked(getMediaSource)
    .mockReset()
    .mockImplementation(async (handle) => ({ url: `blob:${handle.name}`, objectUrl: true }));
  vi.stubGlobal(
    'Image',
    class {
      src = '';
      decoding = '';
      decode = decode;
      removeAttribute() {
        this.src = '';
      }
    },
  );
  vi.stubGlobal('URL', Object.assign(URL, { revokeObjectURL: vi.fn() }));
});

describe('decoded image page cache', () => {
  it('shares pending requests and retains decoded images for reuse', async () => {
    const cache = createImagePageCache();
    const a = cache.get(first);
    const b = cache.get(first);
    expect(a).toBe(b);
    const page = await a;
    expect(page?.image.src).toBe('blob:one.png');
    expect(await cache.get(first)).toBe(page);
    expect(getMediaSource).toHaveBeenCalledOnce();
    expect(decode).toHaveBeenCalledOnce();
    cache.clear();
    expect(page?.image.src).toBe('');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:one.png');
  });

  it('releases evicted images and reloads them if requested again', async () => {
    const cache = createImagePageCache();
    await cache.get(first);
    await cache.get(second);
    cache.retain([second]);
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:one.png');
    await cache.get(second);
    await cache.get(first);
    expect(getMediaSource).toHaveBeenCalledTimes(3);
    cache.clear();
    cache.clear();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3);
  });

  it('releases a source that arrives after its pending entry was cleared', async () => {
    let release!: (source: { url: string; objectUrl: boolean }) => void;
    vi.mocked(getMediaSource).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const cache = createImagePageCache();
    const pending = cache.get(first);
    cache.clear();
    release({ url: 'blob:late', objectUrl: true });
    expect(await pending).toBeNull();
    expect(decode).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:late');
    expect((await cache.get(first))?.url).toBe('blob:one.png');
  });

  it('releases a pending decode without publishing its result', async () => {
    let release!: () => void;
    decode.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const cache = createImagePageCache();
    const pending = cache.get(first);
    await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce());
    cache.clear();
    release();
    expect(await pending).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:one.png');
  });

  it('retries failed decodes and file reads', async () => {
    decode.mockRejectedValueOnce(new Error('corrupt image'));
    const cache = createImagePageCache();
    await expect(cache.get(first)).rejects.toThrow('corrupt image');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:one.png');
    expect((await cache.get(first))?.url).toBe('blob:one.png');
    vi.mocked(getMediaSource).mockRejectedValueOnce(new Error('unavailable file'));
    await expect(cache.get(second)).rejects.toThrow('unavailable file');
    expect((await cache.get(second))?.url).toBe('blob:two.png');
  });

  it('decodes desktop stream URLs without revoking them on eviction', async () => {
    vi.mocked(getMediaSource).mockResolvedValue({
      url: 'local-media://file/image',
      objectUrl: false,
    });
    const cache = createImagePageCache();
    const page = await cache.get(first);
    cache.clear();
    expect(page?.image.src).toBe('');
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });
});
