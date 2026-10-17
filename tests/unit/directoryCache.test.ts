import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildDirectoryCache,
  ensureDirectoryCache,
  getDirectoryPreview,
  invalidateDirectoryCache,
} from '../../src/services/directoryCache';
import { thumbnailCache } from '../../src/services/thumbnailCache';
import { state } from '../../src/services/directoryResources';
import { MemoryDirectory } from '../helpers/memoryFs';
import { flushRootConfig, readRootConfig } from '../../src/services/storage';

vi.mock('../../src/services/thumbnailCache', async () => {
  const { getMediaSource } = await import('../../src/platform/nativeFs');
  return { thumbnailCache: { get: getMediaSource, clear: vi.fn() } };
});

beforeEach(() => {
  state.directoryCache = new WeakMap();
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

  it('selects the preferred file before requesting its thumbnail on every call', async () => {
    const root = new MemoryDirectory('root');
    root.file('ordinary.jpg');
    const preferred = root.file('icon.png');
    const get = vi.spyOn(thumbnailCache, 'get');
    const first = await getDirectoryPreview(root.asHandle());
    expect(first).toEqual({ url: 'blob:preview', objectUrl: true });
    await getDirectoryPreview(root.asHandle());
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls.map(([handle]) => handle)).toEqual([
      preferred.asHandle(),
      preferred.asHandle(),
    ]);
    invalidateDirectoryCache(root.asHandle());
    // The caller owns each URL; invalidating a listing must not revoke displayed URLs.
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it.each(['__0.jpg', 'ICON.PNG', 'thumbnail.webp'])(
    'selects an added %s despite a cached listing, previous preview and persisted path',
    async (name) => {
      const root = new MemoryDirectory('root');
      const old = root.file('ordinary.jpg');
      const location = { rootHandle: root.asHandle(), path: [] };
      const get = vi.spyOn(thumbnailCache, 'get');
      const listing = await ensureDirectoryCache(root.asHandle());
      await getDirectoryPreview(root.asHandle(), {}, location);
      expect(get.mock.calls.at(-1)?.[0]).toBe(old.asHandle());
      const preferred = root.file(name);
      await getDirectoryPreview(root.asHandle(), {}, location);
      expect(get.mock.calls.at(-1)?.[0]).toBe(preferred.asHandle());
      expect(await ensureDirectoryCache(root.asHandle())).toBe(listing);
      await flushRootConfig(root.asHandle());
      expect((await readRootConfig(root.asHandle())).directoryThumbnail?.path).toEqual([name]);
      root.entries.delete(name);
      await getDirectoryPreview(root.asHandle(), {}, location);
      expect(get.mock.calls.at(-1)?.[0]).toBe(old.asHandle());
      await flushRootConfig(root.asHandle());
    },
  );

  it('prefers __0 over icon and thumbnail regardless of enumeration order or case', async () => {
    const root = new MemoryDirectory('root');
    root.file('thumbnail.jpg');
    root.file('icon.jpg');
    const cover = root.file('__0.PNG');
    const get = vi.spyOn(thumbnailCache, 'get');
    await getDirectoryPreview(root.asHandle());
    expect(get.mock.calls.at(-1)?.[0]).toBe(cover.asHandle());
  });

  it('releases a generated URL if the request is cancelled during generation', async () => {
    const root = new MemoryDirectory('root');
    root.file('cover.jpg');
    let active = true;
    vi.spyOn(thumbnailCache, 'get').mockImplementationOnce(() => {
      active = false;
      return Promise.resolve({ url: 'blob:cancelled', objectUrl: true });
    });
    expect(await getDirectoryPreview(root.asHandle(), { shouldContinue: () => active })).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:cancelled');
  });

  it('returns null when a directory has no image, including below children', async () => {
    const root = new MemoryDirectory('root');
    root.directory('child').file('video.mp4');
    expect(await getDirectoryPreview(root.asHandle())).toBeNull();
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
    await getDirectoryPreview(folder.asHandle(), {}, location);
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
    await getDirectoryPreview(
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
      await getDirectoryPreview(root.asHandle(), {}, { rootHandle: root.asHandle(), path: [] });
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
      await getDirectoryPreview(root.asHandle(), {}, { rootHandle: root.asHandle(), path: [] }),
    ).toEqual({ url: 'blob:preview', objectUrl: true });
    await flushRootConfig(root.asHandle());
    expect(config.textValue).toBe('{invalid');
  });
});
