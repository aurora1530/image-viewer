import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildDirectoryCache,
  ensureDirectoryCache,
  getDirectoryPreviewUrl,
  invalidateDirectoryCache,
} from '../../src/directoryCache';
import { state } from '../../src/state';
import { MemoryDirectory } from '../helpers/memoryFs';

vi.mock('../../src/thumbnailCache', async () => {
  const { getMediaSource } = await import('../../src/nativeFs');
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

describe('directory cache and previews', () => {
  it('classifies supported media and excludes unrelated files', async () => {
    const root = new MemoryDirectory('root');
    root.directory('child');
    for (const name of ['cover.HEIC', 'clip.MP4', 'notes.txt']) root.file(name);
    const cache = await buildDirectoryCache(root.asHandle());
    expect(cache.items.map((item) => [item.type, item.name])).toEqual([
      ['directory', 'child'],
      ['image', 'cover.HEIC'],
      ['video', 'clip.MP4'],
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
});
