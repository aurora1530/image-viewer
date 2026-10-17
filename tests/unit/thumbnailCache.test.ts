import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createThumbnailCache, inspectPng, isAnimatedPng } from '../../src/services/thumbnailCache';
import { MemoryDirectory } from '../helpers/memoryFs';
import * as workerPool from '../../src/services/thumbnailWorkerPool';
import { originalImageCache } from '../../src/services/originalImageCache';

const decode = vi.fn<() => Promise<void>>();
const draw = vi.fn();
const dimensions: number[][] = [];
const root = new MemoryDirectory('root');

beforeEach(() => {
  originalImageCache.clear();
  dimensions.length = 0;
  decode.mockReset().mockResolvedValue(undefined);
  draw.mockReset();
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal(
    'Image',
    class {
      src = '';
      decoding = '';
      naturalWidth = 4000;
      naturalHeight = 2000;
      decode = decode;
      removeAttribute() {
        this.src = '';
      }
    },
  );
  let sequence = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:thumbnail-${++sequence}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: draw,
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement,
    callback,
  ) {
    dimensions.push([this.width, this.height]);
    callback(new Blob(['thumbnail'], { type: 'image/webp' }));
  });
});

afterEach(() => {
  delete window.desktopApi;
});

describe('thumbnail generation and reuse', () => {
  it('resizes proportionally and reuses the compressed blob across displays', async () => {
    const file = root.file('large.jpg');
    const read = vi.spyOn(file, 'getFile');
    const cache = createThumbnailCache();
    const a = await cache.get(file.asHandle());
    const b = await cache.get(file.asHandle());
    expect(a?.url).not.toBe(b?.url);
    expect(a?.objectUrl).toBe(true);
    expect(dimensions).toEqual([[1280, 640]]);
    expect(read).toHaveBeenCalledOnce();
    expect(decode).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:thumbnail-1');
    cache.clear();
    await cache.get(file.asHandle());
    expect(read).toHaveBeenCalledOnce();
    expect(decode).toHaveBeenCalledTimes(2);
  });

  it('shares generation requests while giving each card its own URL', async () => {
    const file = root.file('shared.jpg');
    const read = vi.spyOn(file, 'getFile');
    const cache = createThumbnailCache();
    const [a, b] = await Promise.all([cache.get(file.asHandle()), cache.get(file.asHandle())]);
    expect(a?.url).not.toBe(b?.url);
    expect(read).toHaveBeenCalledOnce();
    expect(draw).toHaveBeenCalledOnce();
  });

  it('limits concurrent decoding to two and skips cards removed while waiting', async () => {
    const releases: Array<() => void> = [];
    decode.mockImplementation(() => new Promise((resolve) => releases.push(resolve)));
    const cache = createThumbnailCache({ concurrency: 2 });
    const third = root.file('third.jpg');
    const thirdRead = vi.spyOn(third, 'getFile');
    let connected = true;
    const jobs = [
      cache.get(root.file('one.jpg').asHandle()),
      cache.get(root.file('two.jpg').asHandle()),
      cache.get(third.asHandle(), () => connected),
    ];
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    expect(thirdRead).not.toHaveBeenCalled();
    connected = false;
    releases.forEach((release) => release());
    expect((await Promise.all(jobs))[2]).toBeNull();
    expect(thirdRead).not.toHaveBeenCalled();
  });

  it('lets a new viewport request overtake earlier prefetches while serving memory hits immediately', async () => {
    const cache = createThumbnailCache({ concurrency: 1 });
    const warm = root.file('warm.jpg');
    await cache.get(warm.asHandle());
    const releases: Array<() => void> = [];
    decode.mockImplementation(() => new Promise((resolve) => releases.push(resolve)));
    const active = cache.get(root.file('active.jpg').asHandle());
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    const earlier = root.file('earlier.jpg');
    const target = root.file('target.jpg');
    const earlierRead = vi.spyOn(earlier, 'getFile');
    const targetRead = vi.spyOn(target, 'getFile');
    let priority = 100;
    const background = cache.get(
      earlier.asHandle(),
      () => true,
      () => 10,
    );
    const visible = cache.get(
      target.asHandle(),
      () => true,
      () => priority,
    );
    priority = 0;
    cache.refresh();
    expect((await cache.get(warm.asHandle()))?.objectUrl).toBe(true);
    expect(cache.stats().memoryHits).toBe(1);
    releases[0]();
    await vi.waitFor(() => expect(targetRead).toHaveBeenCalledOnce());
    expect(earlierRead).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases[1]();
    await vi.waitFor(() => expect(releases).toHaveLength(3));
    releases[2]();
    await Promise.all([active, background, visible]);
  });

  it('serves disk hits even while all generation slots are occupied', async () => {
    let release!: (blob: Blob) => void;
    vi.spyOn(workerPool, 'encodeThumbnailInWorker').mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    window.desktopApi = {
      readThumbnail: async (path: string) => ({
        version: 'v1',
        bytes: path.includes('cached') ? new Uint8Array([0xff, 0xd8]) : null,
      }),
      writeThumbnail: async () => true,
    } as unknown as Window['desktopApi'];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, blob: async () => new Blob(['original']) })),
    );
    const file = (name: string) =>
      Object.assign(root.file(name).asHandle(), { nativePath: `C:\\images\\${name}` });
    const cache = createThumbnailCache({ concurrency: 1 });
    const generating = cache.get(file('generating.jpg'));
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect((await cache.get(file('cached.jpg')))?.objectUrl).toBe(true);
    expect(cache.stats().diskHits).toBe(1);
    expect(decode).not.toHaveBeenCalled();
    release(new Blob(['thumbnail']));
    await generating;
  });

  it('invalidates a single failed thumbnail without discarding other cached images', async () => {
    const cache = createThumbnailCache();
    const healthy = root.file('healthy.jpg');
    const broken = root.file('broken.jpg');
    const healthyRead = vi.spyOn(healthy, 'getFile');
    const brokenRead = vi.spyOn(broken, 'getFile');
    await cache.get(healthy.asHandle());
    await cache.get(broken.asHandle());
    cache.invalidate(broken.asHandle());
    await cache.get(healthy.asHandle());
    await cache.get(broken.asHandle());
    expect(healthyRead).toHaveBeenCalledOnce();
    expect(brokenRead).toHaveBeenCalledOnce();
  });

  it('keeps GIF and WebP animation and falls back when decoding fails', async () => {
    const cache = createThumbnailCache();
    await cache.get(root.file('animated.GIF').asHandle());
    await cache.get(root.file('animated.webp').asHandle());
    expect(decode).not.toHaveBeenCalled();
    decode.mockRejectedValueOnce(new Error('unsupported image'));
    expect((await cache.get(root.file('fallback.heic').asHandle()))?.objectUrl).toBe(true);
    expect(draw).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  });

  it('does not enlarge small images', async () => {
    vi.stubGlobal(
      'Image',
      class {
        src = '';
        naturalWidth = 100;
        naturalHeight = 200;
        decode = decode;
        removeAttribute() {}
      },
    );
    await createThumbnailCache().get(root.file('small.jpg').asHandle());
    expect(dimensions).toEqual([[100, 200]]);
  });

  it('uses persisted desktop thumbnails without fetching the original image', async () => {
    const readThumbnail = vi.fn(async () => ({ version: 'v1', bytes: new Uint8Array([1, 2]) }));
    window.desktopApi = { readThumbnail } as unknown as Window['desktopApi'];
    const file = Object.assign(root.file('desktop.jpg').asHandle(), {
      nativePath: 'C:\\images\\desktop.jpg',
    });
    const read = vi.spyOn(file, 'getFile');
    const cache = createThumbnailCache();
    expect((await cache.get(file))?.objectUrl).toBe(true);
    await cache.get(file);
    expect(readThumbnail).toHaveBeenCalledOnce();
    expect(read).not.toHaveBeenCalled();
    expect(draw).not.toHaveBeenCalled();
  });

  it('regenerates corrupt persisted thumbnails and writes their replacement', async () => {
    const writeThumbnail = vi.fn(async () => true);
    window.desktopApi = {
      readThumbnail: async () => ({ version: 'v1', bytes: new Uint8Array([1]) }),
      writeThumbnail,
    } as unknown as Window['desktopApi'];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, blob: async () => new Blob(['original']) })),
    );
    const file = Object.assign(root.file('desktop.jpg').asHandle(), {
      nativePath: 'C:\\images\\desktop.jpg',
    });
    const cache = createThumbnailCache();
    await cache.get(file);
    expect(decode).not.toHaveBeenCalled();
    cache.invalidate(file); // The displayed image reported a decode error.
    await cache.get(file);
    expect(draw).toHaveBeenCalledOnce();
    await vi.waitFor(() =>
      expect(writeThumbnail).toHaveBeenCalledWith(file.nativePath, 'v1', expect.any(Uint8Array)),
    );
  });

  it('uses worker results without decoding or drawing on the main thread', async () => {
    vi.spyOn(workerPool, 'encodeThumbnailInWorker').mockResolvedValue(
      new Blob(['worker thumbnail']),
    );
    expect((await createThumbnailCache().get(root.file('worker.jpg').asHandle()))?.objectUrl).toBe(
      true,
    );
    expect(decode).not.toHaveBeenCalled();
    expect(draw).not.toHaveBeenCalled();
  });

  it('returns generated thumbnails without waiting for disk persistence', async () => {
    let release!: () => void;
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writeThumbnail = vi.fn(async () => {
      await paused;
      return true;
    });
    window.desktopApi = {
      readThumbnail: async () => ({ version: 'v1', bytes: null }),
      writeThumbnail,
    } as unknown as Window['desktopApi'];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, blob: async () => new Blob(['original']) })),
    );
    const file = Object.assign(root.file('saving.jpg').asHandle(), {
      nativePath: 'C:\\images\\saving.jpg',
    });
    expect((await createThumbnailCache().get(file))?.objectUrl).toBe(true);
    await vi.waitFor(() => expect(writeThumbnail).toHaveBeenCalledOnce());
    release();
  });

  it('recognizes animated PNG headers before image data', async () => {
    const chunk = (kind: string) =>
      new Uint8Array([0, 0, 0, 0, ...Array.from(kind, (char) => char.charCodeAt(0)), 0, 0, 0, 0]);
    const signature = new Uint8Array(8);
    expect(
      await isAnimatedPng(new Blob([signature, chunk('IHDR'), chunk('acTL'), chunk('IDAT')])),
    ).toBe(true);
    expect(await isAnimatedPng(new Blob([signature, chunk('IHDR'), chunk('IDAT')]))).toBe(false);
  });

  it('uses JPEG only for opaque PNGs and preserves explicit or palette transparency', async () => {
    const chunk = (kind: string, data: Uint8Array = new Uint8Array()) => {
      const bytes = new Uint8Array(data.length + 12);
      new DataView(bytes.buffer).setUint32(0, data.length);
      bytes.set(
        Array.from(kind, (char) => char.charCodeAt(0)),
        4,
      );
      bytes.set(data, 8);
      return bytes;
    };
    const png = (colorType: number, transparent = false) => {
      const ihdr = new Uint8Array(13);
      ihdr[9] = colorType;
      return new Blob([
        new Uint8Array(8),
        chunk('IHDR', ihdr),
        ...(transparent ? [chunk('tRNS')] : []),
        chunk('IDAT'),
      ]);
    };
    expect(await inspectPng(png(2))).toEqual({ animated: false, opaque: true });
    expect(await inspectPng(png(6))).toEqual({ animated: false, opaque: false });
    expect(await inspectPng(png(3, true))).toEqual({ animated: false, opaque: false });
    expect(await inspectPng(png(0, true))).toEqual({ animated: false, opaque: false });
    const worker = vi
      .spyOn(workerPool, 'encodeThumbnailInWorker')
      .mockResolvedValue(new Blob(['thumbnail']));
    await createThumbnailCache().get({
      name: 'opaque.png',
      getFile: async () => png(2),
    } as FileSystemFileHandle);
    expect(worker).toHaveBeenLastCalledWith(expect.any(Blob), expect.any(Object), 'image/jpeg');
    await createThumbnailCache().get({
      name: 'alpha.png',
      getFile: async () => png(6),
    } as FileSystemFileHandle);
    expect(worker).toHaveBeenLastCalledWith(expect.any(Blob), expect.any(Object), 'image/webp');
  });
});
