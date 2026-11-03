import { requireValue } from '../../src/shared/validation';
import { mkdtemp, mkdir, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import api from '../../electron/thumbnail-store.cjs';
const { createThumbnailStore } = api;
let directory: string;
let source: string;
let cacheDirectory: string;
const bytes = new Uint8Array([1, 2, 3]);
function store(maxEntries?: number, maxBytes?: number) {
  return createThumbnailStore({
    cacheDirectory: () => cacheDirectory,
    maxEntries,
    maxBytes,
    requireAllowed: (file) => {
      if (!path.resolve(file).startsWith(`${directory}${path.sep}`)) throw new Error('forbidden');
      return path.resolve(file);
    },
  });
}
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'image-viewer-thumbnails-'));
  source = path.join(directory, 'source.jpg');
  cacheDirectory = path.join(directory, 'cache');
  await writeFile(source, 'original');
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('persistent desktop thumbnails', () => {
  it('rejects invalid sizes at the main-process storage boundary', async () => {
    const cache = store();
    for (const size of [0, 641, Infinity, '640', null, {}]) {
      await expect(cache.read(source, size)).rejects.toThrow('不正なサムネイルサイズ');
      await expect(cache.write(source, 'version', bytes, size)).rejects.toThrow(
        '不正なサムネイルサイズ',
      );
    }
  });

  it('isolates disk versions by size and rejects a version from another size', async () => {
    const cache = store();
    const small = await cache.read(source, 640);
    const large = await cache.read(source);
    expect(small.version).not.toBe(large.version);
    expect(await cache.write(source, small.version, bytes, 1280)).toBe(false);
    expect(await cache.write(source, small.version, bytes, 640)).toBe(true);
    expect((await cache.read(source, 1280)).bytes).toBeNull();
    expect(Array.from(requireValue((await store().read(source, 640)).bytes))).toEqual([1, 2, 3]);
    expect(await cache.write(source, large.version, new Uint8Array([4]), 1280)).toBe(true);
    expect(Array.from(requireValue((await store().read(source, 1280)).bytes))).toEqual([4]);
  });

  it('reports existing disk data and releases it when disabled at runtime', async () => {
    const cache = store();
    const { version } = await cache.read(source);
    await cache.write(source, version, bytes);
    const reopened = store();
    expect(await reopened.stats()).toEqual({ bytes: 3 });
    await reopened.configure(0);
    expect(await reopened.stats()).toEqual({ bytes: 0 });
    expect((await reopened.read(source)).bytes).toBeNull();
    expect(await reopened.write(source, version, bytes)).toBe(false);
  });
  it('reuses thumbnails across store instances and invalidates modified originals', async () => {
    const initial = await store().read(source);
    expect(initial.bytes).toBeNull();
    expect(await store().write(source, initial.version, bytes)).toBe(true);
    expect(new Uint8Array(requireValue((await store().read(source)).bytes))).toEqual(bytes);
    await writeFile(source, 'updated original');
    await utimes(source, new Date('2025-01-01'), new Date('2025-01-01'));
    const updated = await store().read(source);
    expect(updated.version).not.toBe(initial.version);
    expect(updated.bytes).toBeNull();
    expect(await store().write(source, initial.version, bytes)).toBe(false);
  });

  it('confines source access and prevents caller-provided cache paths', async () => {
    await expect(store().read(path.join(tmpdir(), 'forbidden.jpg'))).rejects.toThrow('forbidden');
    expect(await store().write(source, '../escape', bytes)).toBe(false);
    const current = await store().read(source);
    await expect(
      store().write(source, current.version, new Uint8Array(8 * 1024 * 1024 + 1)),
    ).rejects.toThrow('不正');
    expect(await readFile(source, 'utf8')).toBe('original');
  });

  it('prunes old thumbnails while leaving unrelated files untouched', async () => {
    const cache = store(2);
    await mkdir(cacheDirectory);
    await writeFile(path.join(cacheDirectory, 'unrelated.txt'), 'keep');
    for (let i = 0; i < 32; i++) {
      const file = path.join(directory, `${i}.jpg`);
      await writeFile(file, `${i}`);
      const { version } = await cache.read(file);
      await cache.write(file, version, bytes);
    }
    await vi.waitFor(async () =>
      expect((await readdir(cacheDirectory)).filter((name) => name.endsWith('.webp'))).toHaveLength(
        2,
      ),
    );
    expect(await readFile(path.join(cacheDirectory, 'unrelated.txt'), 'utf8')).toBe('keep');
  });

  it('retains more than 2000 thumbnails and scans existing metadata only once', async () => {
    await mkdir(cacheDirectory);
    const count = 2100;
    for (let offset = 0; offset < count; offset += 32) {
      await Promise.all(
        Array.from({ length: Math.min(32, count - offset) }, (_, index) =>
          writeFile(
            path.join(cacheDirectory, `${(offset + index).toString(16).padStart(64, '0')}.webp`),
            bytes,
          ),
        ),
      );
    }
    const { default: fs } = await import('node:fs/promises');
    const scans = vi.spyOn(fs, 'readdir');
    const metadata = vi.spyOn(fs, 'stat');
    const cache = store();
    const { version } = await cache.read(source);
    for (let i = 0; i < 32; i++) await cache.write(source, version, bytes);
    const thumbnailStats = () =>
      metadata.mock.calls.filter(([file]) => String(file).endsWith('.webp')).length;
    await vi.waitFor(() => expect(thumbnailStats()).toBe(count), { timeout: 10000 });
    for (let i = 0; i < 32; i++) await cache.write(source, version, bytes);
    // A source stat after the second write burst must not trigger another directory scan.
    expect((await cache.read(source)).bytes).toEqual(Buffer.from(bytes));
    expect(scans).toHaveBeenCalledOnce();
    expect(thumbnailStats()).toBe(count);
    expect((await readdir(cacheDirectory)).filter((name) => name.endsWith('.webp'))).toHaveLength(
      count + 1,
    );
  }, 20000);

  it('bounds disk bytes even when the entry count is below its limit', async () => {
    const cache = store(100, 12);
    for (let i = 0; i < 32; i++) {
      const file = path.join(directory, `${i}.jpg`);
      await writeFile(file, `${i}`);
      const { version } = await cache.read(file);
      await cache.write(file, version, bytes);
    }
    await vi.waitFor(async () => {
      const files = (await readdir(cacheDirectory)).filter((name) => name.endsWith('.webp'));
      expect(files).toHaveLength(3);
      const sizes = await Promise.all(
        files.map((file) => readFile(path.join(cacheDirectory, file))),
      );
      expect(sizes.reduce((total, data) => total + data.length, 0)).toBeLessThanOrEqual(12);
    });
  });

  it('keeps recently read thumbnails when evicting older cached files', async () => {
    const old = path.join(directory, 'old.jpg');
    const hot = path.join(directory, 'hot.jpg');
    await writeFile(old, 'old');
    await writeFile(hot, 'hot');
    const initial = store();
    for (const file of [old, hot]) {
      const { version } = await initial.read(file);
      await initial.write(file, version, bytes);
    }
    for (const name of await readdir(cacheDirectory)) {
      await utimes(path.join(cacheDirectory, name), new Date(1000), new Date(1000));
    }
    const cache = store(2);
    expect((await cache.read(hot)).bytes).toEqual(Buffer.from(bytes));
    const { version } = await cache.read(source);
    for (let i = 0; i < 32; i++) await cache.write(source, version, bytes);
    await vi.waitFor(async () =>
      expect((await readdir(cacheDirectory)).filter((name) => name.endsWith('.webp'))).toHaveLength(
        2,
      ),
    );
    expect((await cache.read(old)).bytes).toBeNull();
    expect((await cache.read(hot)).bytes).toEqual(Buffer.from(bytes));
    expect((await cache.read(source)).bytes).toEqual(Buffer.from(bytes));
  });
});

describe('clearing persistent thumbnails', () => {
  it('clears existing and in-flight writes while preserving source and unrelated files', async () => {
    const cache = store();
    const { version } = await cache.read(source);
    const writing = cache.write(source, version, bytes);
    const clearing = cache.clear();
    await Promise.all([writing, clearing]);
    expect(await cache.stats()).toEqual({ bytes: 0 });
    expect((await cache.read(source)).bytes).toBeNull();
    await cache.write(source, version, bytes);
    await writeFile(path.join(cacheDirectory, 'settings.json'), '{}');
    await store().clear();
    expect(await readdir(cacheDirectory)).toEqual(['settings.json']);
    expect(await readFile(source, 'utf8')).toBe('original');
    expect(await cache.write(source, version, bytes)).toBe(true);
    expect((await store().stats()).bytes).toBe(3);
  });
});
