import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildDirectoryCache,
  ensureDirectoryCache,
  getDirectoryPreviewUrl,
  invalidateDirectoryCache,
} from '../../src/services/directoryCache';
import { state } from '../../src/services/directoryResources';
import { MemoryDirectory } from '../helpers/memoryFs';
import { flushRootConfig, readRootConfig } from '../../src/services/storage';

vi.mock('../../src/services/thumbnailCache', async () => {
  const { getMediaSource } = await import('../../src/platform/nativeFs');
  return { thumbnailCache: { get: getMediaSource, clear: vi.fn() } };
});

beforeEach(() => {
  state.directoryCache = new WeakMap();
  state.directoryPreviewCache = new WeakMap();
  state.previewUrls.clear();
  vi.stubGlobal(
    'URL',
    Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:preview'),
      revokeObjectURL: vi.fn(),
    }),
  );
});

afterEach(() => vi.restoreAllMocks());

describe('directory cache and previews', () => {
  it('classifies supported media and excludes unrelated files', async () => {
    const root = new MemoryDirectory('root');
    root.directory('child');
    for (const name of ['cover.HEIC', 'clip.MP4', 'book.PDF', 'notes.txt']) root.file(name);
    const cache = await buildDirectoryCache(root.asHandle());
    expect(cache.items.map((item) => [item.type, item.name])).toEqual([
      ['directory', 'child'],
      ['image', 'cover.HEIC'],
      ['video', 'clip.MP4'],
      ['pdf', 'book.PDF'],
    ]);
    expect(cache.imageCount).toBe(1);
  });

  it('reuses a cache until forced to refresh', async () => {
    const root = new MemoryDirectory('root');
    root.file('one.png');
    const first = await ensureDirectoryCache(root.asHandle());
    root.file('two.png');
    expect((await ensureDirectoryCache(root.asHandle())).imageCount).toBe(1);
    const refreshed = await ensureDirectoryCache(root.asHandle(), { forceRefresh: true });
    expect(refreshed).not.toBe(first);
    expect(refreshed.imageCount).toBe(2);
  });

  it('prefers a named thumbnail and releases its URL on invalidation', async () => {
    const root = new MemoryDirectory('root');
    root.file('ordinary.jpg');
    root.file('icon.png');
    const first = await getDirectoryPreviewUrl(root.asHandle());
    expect(first).toBe('blob:preview');
    expect(await getDirectoryPreviewUrl(root.asHandle())).toBe(first);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    invalidateDirectoryCache(root.asHandle());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
    expect(state.previewUrls.has('blob:preview')).toBe(false);
  });

  it('returns null when a directory has no image, including below children', async () => {
    const root = new MemoryDirectory('root');
    root.directory('child').file('video.mp4');
    expect(await getDirectoryPreviewUrl(root.asHandle())).toBeNull();
  });

  it('persists a relative descendant path and reuses it without scanning descendants or extending expiry', async () => {
    const root = new MemoryDirectory('root');
    const folder = root.directory('album');
    const child = folder.directory('pages');
    const image = child.file('cover.jpg');
    const getFile = vi.spyOn(image, 'getFile');
    const location = { rootHandle: root.asHandle(), path: ['album'] };
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    await getDirectoryPreviewUrl(folder.asHandle(), {}, location);
    await flushRootConfig(root.asHandle());
    const text = await (await (await root.getFileHandle('.image-viewer.json')).getFile()).text();
    const saved = JSON.parse(text) as {
      directories: { album: { directoryThumbnail: { path: string[]; expiresAt: number } } };
    };
    expect(saved.directories.album.directoryThumbnail).toEqual({
      path: ['pages', 'cover.jpg'],
      expiresAt: now + 7 * 24 * 60 * 60 * 1000,
    });
    // Open through new handles, as after an application restart.
    const reopened = new MemoryDirectory('root');
    reopened.file('.image-viewer.json', JSON.stringify(saved));
    const reopenedFolder = reopened.directory('album');
    const reopenedChild = reopenedFolder.directory('pages');
    reopenedChild.entries.set(image.name, image);
    const scan = vi.spyOn(reopenedChild, 'values');
    vi.mocked(Date.now).mockReturnValue(now + 1000);
    await getDirectoryPreviewUrl(
      reopenedFolder.asHandle(),
      {},
      { rootHandle: reopened.asHandle(), path: ['album'] },
    );
    expect(scan).not.toHaveBeenCalled();
    expect(getFile).toHaveBeenCalledTimes(2);
    expect(
      (await readRootConfig(reopened.asHandle())).directories.album.directoryThumbnail!.expiresAt,
    ).toBe(now + 7 * 24 * 60 * 60 * 1000);
  });

  it.each([
    ['preferred', ['old.jpg'], 1000, 'ICON.PNG'],
    ['valid', ['old.jpg'], 1000, 'old.jpg'],
    ['expired', ['old.jpg'], 0, 'new.jpg'],
    ['missing', ['removed.jpg'], 1000, 'new.jpg'],
    ['unsafe', ['..', 'old.jpg'], 1000, 'new.jpg'],
  ])(
    'handles %s path caches before the normal fallback',
    async (scenario, path, lifetime, expected) => {
      const root = new MemoryDirectory('root');
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);
      root.file(
        '.image-viewer.json',
        JSON.stringify({
          favorites: ['keep.jpg'],
          directoryThumbnail: { path, expiresAt: now + lifetime },
        }),
      );
      const newest = root.file('new.jpg');
      const old = root.file('old.jpg');
      const preferred = scenario === 'preferred' ? root.file('ICON.PNG') : null;
      const files = [newest, old, ...(preferred ? [preferred] : [])];
      const reads = files.map((file) => vi.spyOn(file, 'getFile'));
      await getDirectoryPreviewUrl(root.asHandle(), {}, { rootHandle: root.asHandle(), path: [] });
      expect(
        files.filter((_, index) => reads[index].mock.calls.length > 0).map((file) => file.name),
      ).toEqual([expected]);
      await flushRootConfig(root.asHandle());
      expect((await readRootConfig(root.asHandle())).favorites).toEqual(['keep.jpg']);
    },
  );

  it('still displays a preview when the config cannot be read', async () => {
    const root = new MemoryDirectory('root');
    const config = root.file('.image-viewer.json', '{invalid');
    root.file('cover.jpg');
    expect(
      await getDirectoryPreviewUrl(root.asHandle(), {}, { rootHandle: root.asHandle(), path: [] }),
    ).toBe('blob:preview');
    await flushRootConfig(root.asHandle());
    expect(config.textValue).toBe('{invalid');
  });
});
