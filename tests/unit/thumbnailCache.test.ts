import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createThumbnailCache, isAnimatedPng } from '../../src/thumbnailCache';
import { MemoryDirectory } from '../helpers/memoryFs';
import * as workerPool from '../../src/thumbnailWorkerPool';

const decode = vi.fn<() => Promise<void>>();
const draw = vi.fn();
const dimensions: number[][] = [];
const root = new MemoryDirectory('root');

beforeEach(() => {
  dimensions.length = 0;
  decode.mockReset().mockResolvedValue(undefined);
  draw.mockReset();
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('Image', class {
    src = '';
    decoding = '';
    naturalWidth = 4000;
    naturalHeight = 2000;
    decode = decode;
    removeAttribute() { this.src = ''; }
  });
  let sequence = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:thumbnail-${++sequence}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: draw } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function(this: HTMLCanvasElement, callback) {
    dimensions.push([this.width, this.height]);
    callback(new Blob(['thumbnail'], { type: 'image/webp' }));
  });
});

afterEach(() => { delete window.desktopApi; });

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
    expect(read).toHaveBeenCalledTimes(2);
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
    decode.mockImplementation(() => new Promise(resolve => releases.push(resolve)));
    const cache = createThumbnailCache({ concurrency: 2 });
    const third = root.file('third.jpg');
    const thirdRead = vi.spyOn(third, 'getFile');
    let connected = true;
    const jobs = [cache.get(root.file('one.jpg').asHandle()), cache.get(root.file('two.jpg').asHandle()), cache.get(third.asHandle(), () => connected)];
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    expect(thirdRead).not.toHaveBeenCalled();
    connected = false;
    releases.forEach(release => release());
    expect((await Promise.all(jobs))[2]).toBeNull();
    expect(thirdRead).not.toHaveBeenCalled();
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
    vi.stubGlobal('Image', class {
      src = '';
      naturalWidth = 100;
      naturalHeight = 200;
      decode = decode;
      removeAttribute() {}
    });
    await createThumbnailCache().get(root.file('small.jpg').asHandle());
    expect(dimensions).toEqual([[100, 200]]);
  });

  it('uses persisted desktop thumbnails without fetching the original image', async () => {
    const readThumbnail = vi.fn(async () => ({ version: 'v1', bytes: new Uint8Array([1, 2]) }));
    window.desktopApi = { readThumbnail } as unknown as Window['desktopApi'];
    const file = Object.assign(root.file('desktop.jpg').asHandle(), { nativePath: 'C:\\images\\desktop.jpg' });
    const read = vi.spyOn(file, 'getFile');
    const cache = createThumbnailCache();
    expect((await cache.get(file))?.objectUrl).toBe(true);
    await cache.get(file);
    expect(readThumbnail).toHaveBeenCalledOnce();
    expect(read).not.toHaveBeenCalled();
    expect(draw).not.toHaveBeenCalled();
  });

  it('regenerates corrupt persisted thumbnails and writes their replacement', async () => {
    decode.mockRejectedValueOnce(new Error('corrupt thumbnail'));
    const writeThumbnail = vi.fn(async () => true);
    window.desktopApi = {
      readThumbnail: async () => ({ version: 'v1', bytes: new Uint8Array([1]) }),
      writeThumbnail
    } as unknown as Window['desktopApi'];
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['original']) })));
    const file = Object.assign(root.file('desktop.jpg').asHandle(), { nativePath: 'C:\\images\\desktop.jpg' });
    await createThumbnailCache().get(file);
    expect(draw).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(writeThumbnail).toHaveBeenCalledWith(file.nativePath, 'v1', expect.any(Uint8Array)));
  });

  it('uses worker results without decoding or drawing on the main thread', async () => {
    vi.spyOn(workerPool, 'encodeThumbnailInWorker').mockResolvedValue(new Blob(['worker thumbnail']));
    expect((await createThumbnailCache().get(root.file('worker.jpg').asHandle()))?.objectUrl).toBe(true);
    expect(decode).not.toHaveBeenCalled();
    expect(draw).not.toHaveBeenCalled();
  });

  it('returns generated thumbnails without waiting for disk persistence', async () => {
    let release!: () => void;
    const paused = new Promise<void>(resolve => { release = resolve; });
    const writeThumbnail = vi.fn(async () => { await paused; return true; });
    window.desktopApi = {
      readThumbnail: async () => ({ version: 'v1', bytes: null }), writeThumbnail
    } as unknown as Window['desktopApi'];
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['original']) })));
    const file = Object.assign(root.file('saving.jpg').asHandle(), { nativePath: 'C:\\images\\saving.jpg' });
    expect((await createThumbnailCache().get(file))?.objectUrl).toBe(true);
    await vi.waitFor(() => expect(writeThumbnail).toHaveBeenCalledOnce());
    release();
  });

  it('recognizes animated PNG headers before image data', async () => {
    const chunk = (kind: string) => new Uint8Array([0, 0, 0, 0, ...Array.from(kind, char => char.charCodeAt(0)), 0, 0, 0, 0]);
    const signature = new Uint8Array(8);
    expect(await isAnimatedPng(new Blob([signature, chunk('IHDR'), chunk('acTL'), chunk('IDAT')]))).toBe(true);
    expect(await isAnimatedPng(new Blob([signature, chunk('IHDR'), chunk('IDAT')]))).toBe(false);
  });
});
