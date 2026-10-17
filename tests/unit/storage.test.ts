import type { ConfigNode } from '../../src/storage';
import { describe, expect, it, vi } from 'vitest';
import {
  collectFavoriteFilesFromConfig,
  ensureConfigNode,
  getConfigNode,
  makeFavoriteSet,
  makeHiddenSet,
  normalizeRootConfig,
  readRootConfig,
  toggleFavoriteEntry,
  toggleHiddenEntry,
  writeRootConfig,
  flushRootConfig,
  reloadRootConfig,
  saveDirectorySettings,
} from '../../src/storage';
import { MemoryDirectory } from '../helpers/memoryFs';

describe('folder configuration', () => {
  it('repairs missing fields, ignores invalid entries and keeps nested settings', () => {
    const config = normalizeRootConfig({
      favorites: ['old.png', 12, { type: 'directory', path: 'child' }],
      hiddenItems: null,
      settings: { sortOrder: 'desc' },
      directories: { child: { favorites: ['new.png'] } },
      version: 'old',
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

  it('looks up normalized settings without mutating or reading unrelated subtrees', () => {
    const root = normalizeRootConfig({
      directories: {
        child: { directories: { nested: { settings: { filterType: 'gif' } } } },
      },
    });
    const child = root.directories.child;
    const nested = child.directories.nested;
    Object.defineProperty(root.directories, 'unrelated', {
      enumerable: true,
      get() {
        throw new Error('unrelated subtree should not be read');
      },
    });
    Object.freeze(root);
    Object.freeze(root.directories);
    Object.freeze(child);
    Object.freeze(child.directories);
    Object.freeze(nested);
    expect(getConfigNode(root, 'child/nested')).toBe(nested);
    expect(getConfigNode(root, 'child/nested')?.settings.filterType).toBe('gif');
    expect(getConfigNode(root, 'missing')).toBeNull();
  });

  it('does not overwrite malformed JSON after a failed read', async () => {
    const root = new MemoryDirectory('root');
    root.file('.image-viewer.json', '{broken');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(readRootConfig(root.asHandle())).rejects.toThrow();
    const onError = vi.fn();
    await expect(toggleFavoriteEntry(root.asHandle(), [], 'new.png', onError)).rejects.toThrow();
    expect(onError).toHaveBeenCalledOnce();
    expect(await (await (await root.getFileHandle('.image-viewer.json')).getFile()).text()).toBe(
      '{broken',
    );
  });

  it('writes and reads nested favorites and hidden entries without losing either', async () => {
    const root = new MemoryDirectory('root');
    const child = root.directory('child');
    child.file('one.png');
    expect(await toggleFavoriteEntry(root.asHandle(), 'child', 'one.png')).toBe(true);
    expect(
      await toggleHiddenEntry(root.asHandle(), 'child', { type: 'file', path: 'one.png' }),
    ).toBe(true);
    const config = await readRootConfig(root.asHandle());
    expect(makeFavoriteSet(getConfigNode(config, 'child'))).toEqual(new Set(['file:one.png']));
    expect(makeHiddenSet(getConfigNode(config, 'child'))).toEqual(new Set(['file:one.png']));
    expect(await toggleFavoriteEntry(root.asHandle(), 'child', 'one.png')).toBe(false);
    expect(
      makeFavoriteSet(getConfigNode(await readRootConfig(root.asHandle()), 'child')).size,
    ).toBe(0);
  });

  it('collects existing favorites across directories and marks hidden files', async () => {
    const root = new MemoryDirectory('root');
    root.file('cover.png');
    const child = root.directory('child');
    child.file('part2.gif');
    const config = normalizeRootConfig({
      favorites: ['cover.png', 'missing.png'],
      directories: { child: { favorites: ['part2.gif'], hiddenItems: ['part2.gif'] } },
    });
    Object.freeze(config);
    Object.freeze(config.directories.child);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const entries = await collectFavoriteFilesFromConfig(root.asHandle(), config);
    expect(entries.map(({ path, isHidden }) => ({ path, isHidden }))).toEqual([
      { path: 'cover.png', isHidden: false },
      { path: 'child/part2.gif', isHidden: true },
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

  it('shares one disk read between concurrent readers and edits', async () => {
    const root = new MemoryDirectory('root');
    const file = root.file('.image-viewer.json', JSON.stringify({ favorites: ['old.png'] }));
    const reads = vi.spyOn(file, 'getFile');
    const [first, second] = await Promise.all([
      readRootConfig(root.asHandle()),
      readRootConfig(root.asHandle()),
    ]);
    expect(first).toBe(second);
    await Promise.all([
      toggleFavoriteEntry(root.asHandle(), 'child', 'one.png'),
      toggleFavoriteEntry(root.asHandle(), 'child', 'two.png'),
      toggleHiddenEntry(root.asHandle(), 'child', 'one.png'),
      saveDirectorySettings(root.asHandle(), 'child', { sortOrder: 'desc' }),
    ]);
    await flushRootConfig(root.asHandle());
    expect(reads).toHaveBeenCalledOnce();
    const saved = JSON.parse(file.textValue) as ConfigNode;
    expect(saved.version).toBe(3);
    expect(saved.favorites).toEqual(['old.png']);
    expect(saved.directories.child).toMatchObject({
      favorites: ['one.png', 'two.png'],
      hiddenItems: ['one.png'],
      settings: { sortOrder: 'desc' },
    });
  });

  it('captures settings before navigation and reloads external edits on request', async () => {
    const root = new MemoryDirectory('root');
    const path = ['first'];
    const settings = { sortOrder: 'desc' };
    const pending = saveDirectorySettings(root.asHandle(), path, settings);
    path[0] = 'second';
    settings.sortOrder = 'asc';
    await pending;
    await flushRootConfig(root.asHandle());
    const file = await root.getFileHandle('.image-viewer.json');
    const saved = JSON.parse(await (await file.getFile()).text()) as ConfigNode;
    expect(saved.directories.first.settings.sortOrder).toBe('desc');
    expect(saved.directories.second).toBeUndefined();
    root.file('.image-viewer.json', JSON.stringify({ favorites: ['external.png'] }));
    expect((await readRootConfig(root.asHandle())).favorites).toEqual([]);
    expect((await reloadRootConfig(root.asHandle())).favorites).toEqual(['external.png']);
  });

  it('keeps independent roots isolated and never creates config just by flushing', async () => {
    const first = new MemoryDirectory('same-name');
    const second = new MemoryDirectory('same-name');
    await readRootConfig(second.asHandle());
    await flushRootConfig(second.asHandle());
    expect(second.entries.size).toBe(0);
    await toggleFavoriteEntry(first.asHandle(), [], 'one.png');
    expect((await readRootConfig(second.asHandle())).favorites).toEqual([]);
  });

  it('preserves newer configs and retries transient read failures', async () => {
    const root = new MemoryDirectory('root');
    const file = root.file('.image-viewer.json', '{"version":4,"favorites":["keep.png"]}');
    await expect(toggleFavoriteEntry(root.asHandle(), [], 'new.png')).rejects.toThrow(
      '新しいバージョン',
    );
    expect((JSON.parse(file.textValue) as ConfigNode).version).toBe(4);
    file.textValue = '{"version":3,"favorites":["keep.png"]}';
    const getFile = vi
      .spyOn(file, 'getFile')
      .mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    await expect(readRootConfig(root.asHandle())).rejects.toThrow('denied');
    expect((await readRootConfig(root.asHandle())).favorites).toEqual(['keep.png']);
    expect(getFile).toHaveBeenCalledTimes(2);
  });

  it('does not open directories containing only settings or hidden entries', async () => {
    const root = new MemoryDirectory('root');
    root.directory('settings-only');
    root.directory('hidden-only');
    const ancestor = root.directory('ancestor');
    ancestor.directory('nested').file('favorite.png');
    const getDirectory = vi.spyOn(root, 'getDirectoryHandle');
    const config = normalizeRootConfig({
      directories: {
        'settings-only': { settings: { sortOrder: 'desc' } },
        'hidden-only': { hiddenItems: ['hidden.png'] },
        ancestor: { directories: { nested: { favorites: ['favorite.png'] } } },
      },
    });
    expect(
      (await collectFavoriteFilesFromConfig(root.asHandle(), config)).map((item) => item.path),
    ).toEqual(['ancestor/nested/favorite.png']);
    expect(getDirectory).toHaveBeenCalledExactlyOnceWith('ancestor');
  });

  it('reports failed toggle saves and retains all edits for retry', async () => {
    const root = new MemoryDirectory('root');
    const file = root.file('.image-viewer.json', '{"favorites":["old.png"]}');
    vi.spyOn(file, 'createWritable').mockRejectedValueOnce(new Error('disk full'));
    const onError = vi.fn();
    await expect(toggleFavoriteEntry(root.asHandle(), [], 'new.png', onError)).rejects.toThrow(
      'disk full',
    );
    expect(onError).toHaveBeenCalledOnce();
    expect((JSON.parse(file.textValue) as ConfigNode).favorites).toEqual(['old.png']);
    await flushRootConfig(root.asHandle());
    expect((JSON.parse(file.textValue) as ConfigNode).favorites).toEqual(['old.png', 'new.png']);
  });

  it('continues to read legacy entries and preserves unrelated config fields on save', async () => {
    const root = new MemoryDirectory('root');
    const file = root.file(
      '.image-viewer.json',
      JSON.stringify({
        version: 3,
        favorites: ['cover.png', { type: 'directory', path: '日本語' }],
        custom: { keep: true },
        directories: { 日本語: { hiddenItems: ['old.png'], settings: { customOption: 42 } } },
      }),
    );
    await toggleFavoriteEntry(root.asHandle(), ['日本語'], { type: 'file', path: 'new.png' });
    expect(JSON.parse(file.textValue) as ConfigNode).toMatchObject({
      version: 3,
      favorites: ['cover.png', { type: 'directory', path: '日本語' }],
      custom: { keep: true },
      directories: {
        日本語: {
          favorites: [{ type: 'file', path: 'new.png' }],
          hiddenItems: ['old.png'],
          settings: { customOption: 42 },
        },
      },
    });
  });
});
