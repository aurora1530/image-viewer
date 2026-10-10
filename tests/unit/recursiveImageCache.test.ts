import { describe, expect, it, vi } from 'vitest';
import { createRecursiveImageCache } from '../../src/recursiveImageCache';
import { MemoryDirectory } from '../helpers/memoryFs';

describe('recursive image cache', () => {
  it('reuses complete collections and keeps view changes out of cached items', async () => {
    const root = new MemoryDirectory('root');
    root.file('2.png');
    root.file('10.png');
    const child = root.directory('child');
    child.file('nested.gif');
    const readRoot = vi.spyOn(root, 'values');
    const readChild = vi.spyOn(child, 'values');
    const cache = createRecursiveImageCache();
    const first = await cache.get(root.asHandle());
    first.reverse();
    first[0].isFavorite = true;
    first[0].isHidden = true;
    first.pop();
    const second = await cache.get(root.asHandle());
    expect(second.map(item => item.path)).toEqual(['2.png', '10.png', 'child/nested.gif']);
    expect(second.every(item => item.isFavorite === undefined && item.isHidden === undefined)).toBe(true);
    expect(readRoot).toHaveBeenCalledOnce();
    expect(readChild).toHaveBeenCalledOnce();
  });

  it('caches empty folders and keeps different folders and base paths separate', async () => {
    const root = new MemoryDirectory('root');
    const other = new MemoryDirectory('other');
    other.file('one.png');
    const readRoot = vi.spyOn(root, 'values');
    const cache = createRecursiveImageCache();
    expect(await cache.get(root.asHandle())).toEqual([]);
    expect(await cache.get(root.asHandle())).toEqual([]);
    expect(readRoot).toHaveBeenCalledOnce();
    expect((await cache.get(other.asHandle(), 'a'))[0].path).toBe('a/one.png');
    expect((await cache.get(other.asHandle(), 'b'))[0].path).toBe('b/one.png');
  });

  it('refreshes additions and deletions in both parent and child collections', async () => {
    const root = new MemoryDirectory('root');
    root.file('old.png');
    const child = root.directory('child');
    child.file('one.png');
    const cache = createRecursiveImageCache();
    await cache.get(root.asHandle());
    await cache.get(child.asHandle(), 'child');
    root.entries.delete('old.png');
    child.file('new.png');
    expect((await cache.get(root.asHandle())).map(item => item.path)).toContain('old.png');
    cache.clear();
    expect((await cache.get(root.asHandle())).map(item => item.path)).toEqual(['child/new.png', 'child/one.png']);
    expect((await cache.get(child.asHandle(), 'child')).map(item => item.path)).toEqual(['child/new.png', 'child/one.png']);
  });

  it('does not cache collections interrupted by a new view', async () => {
    const root = new MemoryDirectory('root');
    root.file('cover.png');
    const child = root.directory('child');
    child.file('nested.png');
    const cache = createRecursiveImageCache();
    let active = true;
    await cache.get(root.asHandle(), '', {
      shouldContinue: () => active,
      onFirstImages: () => { active = false; }
    });
    expect((await cache.get(root.asHandle())).map(item => item.path)).toEqual(['cover.png', 'child/nested.png']);
  });

  it('retries unreadable subfolders instead of caching partial results', async () => {
    const root = new MemoryDirectory('root');
    root.file('cover.png');
    const child = root.directory('child');
    child.file('nested.png');
    const read = vi.spyOn(child, 'values').mockImplementationOnce(async function* () { throw new Error('unreadable'); });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const cache = createRecursiveImageCache();
    expect((await cache.get(root.asHandle())).map(item => item.path)).toEqual(['cover.png']);
    expect((await cache.get(root.asHandle())).map(item => item.path)).toEqual(['cover.png', 'child/nested.png']);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('does not restore a cleared cache when an older scan finishes', async () => {
    const root = new MemoryDirectory('root');
    root.file('old.png');
    const originalValues = root.values.bind(root);
    let release!: () => void;
    const paused = new Promise<void>(resolve => { release = resolve; });
    const read = vi.spyOn(root, 'values').mockImplementationOnce(async function* () {
      yield* originalValues();
      await paused;
    });
    const cache = createRecursiveImageCache();
    const pending = cache.get(root.asHandle());
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    cache.clear();
    root.entries.delete('old.png');
    root.file('new.png');
    release();
    await pending;
    expect((await cache.get(root.asHandle())).map(item => item.path)).toEqual(['new.png']);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
