import { describe, expect, it, vi } from 'vitest';
import {
  collectFavoriteFilesFromConfig, ensureConfigNode, getConfigNode,
  makeFavoriteSet, makeHiddenSet, normalizeRootConfig, readRootConfig,
  toggleFavoriteEntry, toggleHiddenEntry, writeRootConfig
} from '../../src/storage';
import { MemoryDirectory } from '../helpers/memoryFs';

describe('folder configuration', () => {
  it('repairs missing fields, ignores invalid entries and keeps nested settings', () => {
    const config = normalizeRootConfig({
      favorites: ['old.png', 12, { type: 'directory', path: 'child' }],
      hiddenItems: null,
      settings: { sortOrder: 'desc' },
      directories: { child: { favorites: ['new.png'] } },
      version: 'old'
    });
    expect(config.version).toBe(3);
    expect(makeFavoriteSet(config)).toEqual(new Set(['file:old.png', 'directory:child']));
    expect(makeHiddenSet(config).size).toBe(0);
    expect(getConfigNode(config, 'child')?.favorites).toEqual(['new.png']);
    expect(config.settings.sortOrder).toBe('desc');
  });

  it('only creates missing nested nodes on request', () => {
    const root = ensureConfigNode({});
    expect(getConfigNode(root, 'a/b')).toBeNull();
    const child = getConfigNode(root, 'a/b', { create: true });
    expect(child).not.toBeNull();
    child!.settings.filterType = 'gif';
    expect(getConfigNode(root, ['a', 'b'])?.settings.filterType).toBe('gif');
  });

  it('reads malformed JSON as a usable empty version 3 config', async () => {
    const root = new MemoryDirectory('root');
    root.file('.image-viewer.json', '{broken');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await readRootConfig(root.asHandle())).toMatchObject({
      version: 3, favorites: [], hiddenItems: [], settings: {}, directories: {}
    });
  });

  it('writes and reads nested favorites and hidden entries without losing either', async () => {
    const root = new MemoryDirectory('root');
    const child = root.directory('child');
    child.file('one.png');
    expect(await toggleFavoriteEntry(root.asHandle(), 'child', 'one.png')).toBe(true);
    expect(await toggleHiddenEntry(root.asHandle(), 'child', { type: 'file', path: 'one.png' })).toBe(true);
    const config = await readRootConfig(root.asHandle());
    expect(makeFavoriteSet(getConfigNode(config, 'child'))).toEqual(new Set(['file:one.png']));
    expect(makeHiddenSet(getConfigNode(config, 'child'))).toEqual(new Set(['file:one.png']));
    expect(await toggleFavoriteEntry(root.asHandle(), 'child', 'one.png')).toBe(false);
    expect(makeFavoriteSet(getConfigNode(await readRootConfig(root.asHandle()), 'child')).size).toBe(0);
  });

  it('collects existing favorites across directories and marks hidden files', async () => {
    const root = new MemoryDirectory('root');
    root.file('cover.png');
    const child = root.directory('child');
    child.file('part2.gif');
    const config = normalizeRootConfig({
      favorites: ['cover.png', 'missing.png'],
      directories: { child: { favorites: ['part2.gif'], hiddenItems: ['part2.gif'] } }
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const entries = await collectFavoriteFilesFromConfig(root.asHandle(), config);
    expect(entries.map(({ path, isHidden }) => ({ path, isHidden }))).toEqual([
      { path: 'cover.png', isHidden: false }, { path: 'child/part2.gif', isHidden: true }
    ]);
  });

  it('reports write failures to the caller', async () => {
    const root = new MemoryDirectory('root');
    const error = new Error('disk full');
    vi.spyOn(root, 'getFileHandle').mockRejectedValue(error);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onError = vi.fn();
    await writeRootConfig(root.asHandle(), ensureConfigNode({}), onError);
    expect(onError).toHaveBeenCalledWith('コンフィグの保存に失敗しました。', error);
  });
});
