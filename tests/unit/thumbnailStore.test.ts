import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createThumbnailStore } = createRequire(import.meta.url)('../../electron/thumbnail-store.cjs') as {
  createThumbnailStore(options: { cacheDirectory: () => string; requireAllowed: (file: string) => string; maxEntries?: number }): {
    read(file: string): Promise<{ version: string; bytes: Uint8Array | null }>;
    write(file: string, version: string, bytes: Uint8Array): Promise<boolean>;
  };
};
let directory: string;
let source: string;
let cacheDirectory: string;
const bytes = new Uint8Array([1, 2, 3]);
function store(maxEntries?: number) {
  return createThumbnailStore({ cacheDirectory: () => cacheDirectory, maxEntries, requireAllowed: file => {
    if (!path.resolve(file).startsWith(`${directory}${path.sep}`)) throw new Error('forbidden');
    return path.resolve(file);
  } });
}
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'image-viewer-thumbnails-'));
  source = path.join(directory, 'source.jpg');
  cacheDirectory = path.join(directory, 'cache');
  await writeFile(source, 'original');
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe('persistent desktop thumbnails', () => {
  it('reuses thumbnails across store instances and invalidates modified originals', async () => {
    const initial = await store().read(source);
    expect(initial.bytes).toBeNull();
    expect(await store().write(source, initial.version, bytes)).toBe(true);
    expect(new Uint8Array((await store().read(source)).bytes!)).toEqual(bytes);
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
    await expect(store().write(source, current.version, new Uint8Array(8 * 1024 * 1024 + 1))).rejects.toThrow('不正');
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
    await vi.waitFor(async () => expect((await readdir(cacheDirectory)).filter(name => name.endsWith('.webp'))).toHaveLength(2));
    expect(await readFile(path.join(cacheDirectory, 'unrelated.txt'), 'utf8')).toBe('keep');
  });
});
