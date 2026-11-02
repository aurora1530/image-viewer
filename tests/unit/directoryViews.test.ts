import { requireValue } from '../../src/shared/validation';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppStore } from '../../src/app/store';
import { createDirectoryViews } from '../../src/app/createDirectoryViews';
import { MemoryDirectory } from '../helpers/memoryFs';
import * as utils from '../../src/shared/utils';
import { toggleFavoriteEntry, toggleHiddenEntry } from '../../src/services/storage';

let appStore: ReturnType<typeof createAppStore>;

beforeEach(() => {
  appStore = createAppStore();
});

function harness(root: MemoryDirectory) {
  let active = root;
  const openPreview = vi.fn();
  const views = createDirectoryViews({
    store: appStore,
    getRoot: () => active.asHandle(),
    getPathSegments: () => [],
    applySettings: vi.fn(),
    openPreview,
  });
  return {
    views,
    openPreview,
    activate(next: MemoryDirectory) {
      active = next;
    },
  };
}

describe('gallery data and state coordination', () => {
  it.each(['directory', 'recursive', 'favorites'] as const)(
    'refilters %s entries without reacquiring, resorting or publishing an empty list',
    async (listMode) => {
      const root = new MemoryDirectory('root');
      root.file('Photo10.GIF');
      root.file('Photo2.PNG');
      root.file('Photo1.PNG');
      root.file(
        '.image-viewer.json',
        JSON.stringify({ favorites: ['Photo1.PNG', 'Photo2.PNG', 'Photo10.GIF'] }),
      );
      const read = vi.spyOn(root, 'values');
      const getFile = vi.spyOn(root, 'getFileHandle');
      const compare = vi.spyOn(utils, 'compareNumericText');
      const { views } = harness(root);
      appStore.setState({ listMode });
      await views.render(root.asHandle());
      read.mockClear();
      getFile.mockClear();
      compare.mockClear();

      const published: number[] = [];
      const unsubscribe = appStore.subscribe((state) => published.push(state.entries.length));
      appStore.setState({ searchQuery: 'PHOTO10', filterType: 'gif' });
      published.length = 0;
      await views.render(root.asHandle(), { useConfig: false });
      unsubscribe();
      expect(published).toEqual([1]);
      expect(appStore.getState().entries.map(({ item }) => [item.name, item.displayIndex])).toEqual(
        [['Photo10.GIF', 0]],
      );
      expect(appStore.getState().displayImages).toEqual([
        requireValue(root.entries.get('Photo10.GIF')).asHandle(),
      ]);
      expect(compare).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
      expect(getFile).not.toHaveBeenCalled();

      appStore.setState({ searchQuery: '', filterType: 'all', sortOrder: 'desc' });
      await views.render(root.asHandle(), { useConfig: false });
      expect(appStore.getState().entries.map(({ item }) => item.name)).toEqual([
        'Photo10.GIF',
        'Photo2.PNG',
        'Photo1.PNG',
      ]);
      expect(compare).toHaveBeenCalled();
      compare.mockClear();
      appStore.setState({ sortOrder: 'asc' });
      await views.render(root.asHandle(), { useConfig: false });
      expect(compare).not.toHaveBeenCalled();
      expect(appStore.getState().entries.map(({ item }) => item.displayIndex)).toEqual([0, 1, 2]);

      appStore.setState({ searchQuery: 'missing' });
      await views.render(root.asHandle(), { useConfig: false });
      expect(appStore.getState().status.type).toBe('info');
      appStore.setState({ searchQuery: '' });
      await views.render(root.asHandle(), { useConfig: false });
      expect(appStore.getState().entries).toHaveLength(3);
    },
  );

  it.each(['directory', 'recursive', 'favorites'] as const)(
    'updates favorite and hidden metadata before reusing %s entries',
    async (listMode) => {
      const root = new MemoryDirectory('root');
      root.file('one.png');
      root.file('two.png');
      root.file('.image-viewer.json', JSON.stringify({ favorites: ['one.png', 'two.png'] }));
      const handle = root.asHandle();
      const { views } = harness(root);
      appStore.setState({ listMode });
      await views.render(handle);
      await toggleFavoriteEntry(handle, [], 'one.png');
      views.invalidateEntries();
      appStore.setState({ favoriteOnly: true });
      await views.render(handle, { useConfig: false });
      expect(appStore.getState().entries.map(({ item }) => item.name)).toEqual(['two.png']);

      await toggleHiddenEntry(handle, [], 'two.png');
      views.invalidateEntries();
      await views.render(handle, { useConfig: false });
      expect(appStore.getState().entries).toEqual([]);
      await views.render(handle, { useConfig: false });
      expect(appStore.getState().entries).toEqual([]);
      await toggleHiddenEntry(handle, [], 'two.png');
      views.invalidateEntries();
      await views.render(handle, { useConfig: false });
      expect(appStore.getState().entries.map(({ item }) => item.name)).toEqual(['two.png']);
    },
  );

  it('retries a failed recursive source instead of retaining a partial prepared view', async () => {
    const root = new MemoryDirectory('root');
    root.file('cover.png');
    const child = root.directory('child');
    child.file('nested.png');
    vi.spyOn(child, 'values').mockImplementationOnce(async function* () {
      throw new Error('unreadable');
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { views } = harness(root);
    appStore.setState({ listMode: 'recursive' });
    await views.render(root.asHandle());
    expect(appStore.getState().entries).toHaveLength(1);
    await views.render(root.asHandle(), { useConfig: false });
    expect(appStore.getState().entries.map(({ item }) => item.name)).toEqual([
      'nested.png',
      'cover.png',
    ]);
  });

  it.each(['directory', 'recursive'] as const)(
    'refreshes prepared %s data when files are replaced and the listing is reloaded',
    async (listMode) => {
      const root = new MemoryDirectory('root');
      const old = root.file('one.png');
      const { views } = harness(root);
      appStore.setState({ listMode });
      await views.render(root.asHandle());
      const replacement = root.file('one.png');
      root.file('two.png');
      await views.render(root.asHandle(), { useConfig: false });
      expect(appStore.getState().displayImages).toEqual([old.asHandle()]);
      views.clearScanCache();
      await views.render(root.asHandle(), { useConfig: false, forceRefresh: true });
      expect(appStore.getState().displayImages).toEqual([
        replacement.asHandle(),
        requireValue(root.entries.get('two.png')).asHandle(),
      ]);
    },
  );

  it('applies the same case-insensitive search and media filter in each list mode', async () => {
    const root = new MemoryDirectory('root');
    root.file('Photo2.PNG');
    root.file('Photo10.GIF');
    root.file('clip.mp4');
    const child = root.directory('child');
    child.file('Preview.GIF');
    root.file(
      '.image-viewer.json',
      JSON.stringify({
        favorites: ['Photo10.GIF'],
        directories: { child: { favorites: ['Preview.GIF'] } },
      }),
    );
    const { views } = harness(root);
    appStore.setState({ filterType: 'gif', searchQuery: 'PHOTO' });
    await views.render(root.asHandle());
    expect(appStore.getState().entries.map((entry) => entry.item.name)).toEqual(['Photo10.GIF']);
    appStore.setState({ listMode: 'recursive', searchQuery: 'PREVIEW' });
    await views.render(root.asHandle());
    expect(appStore.getState().entries.map((entry) => entry.item.name)).toEqual(['Preview.GIF']);
    appStore.setState({ listMode: 'favorites', searchQuery: 'PHOTO' });
    await views.render(root.asHandle());
    expect(appStore.getState().entries.map((entry) => entry.item.name)).toEqual(['Photo10.GIF']);
    expect(appStore.getState().displayImages).toEqual([
      requireValue(root.entries.get('Photo10.GIF')).asHandle(),
    ]);
  });

  it('does not publish an older folder after a newer folder has finished loading', async () => {
    const old = new MemoryDirectory('old');
    old.file('old.png');
    const latest = new MemoryDirectory('latest');
    latest.file('latest.png');
    let release: (() => void) | undefined;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = old.values.bind(old);
    vi.spyOn(old, 'values').mockImplementation(async function* () {
      await wait;
      yield* original();
    });
    const { views, activate } = harness(old);
    const pending = views.render(old.asHandle());
    activate(latest);
    await views.render(latest.asHandle());
    const published = appStore.getState().entries;
    requireValue(release)();
    await pending;
    expect(appStore.getState().entries).toBe(published);
    expect(published.map((entry) => entry.item.name)).toEqual(['latest.png']);
    expect(appStore.getState().status.type).toBe('clear');
  });

  it('cancels favorite reads after navigation without retaining or publishing partial results', async () => {
    const root = new MemoryDirectory('root');
    const names = Array.from({ length: 20 }, (_, index) => `${index}.png`);
    names.forEach((name) => root.file(name));
    root.file('.image-viewer.json', JSON.stringify({ favorites: names }));
    const getFile = root.getFileHandle.bind(root);
    const releases: (() => void)[] = [];
    const read = vi.spyOn(root, 'getFileHandle').mockImplementation(async (...args) => {
      if (args[0].endsWith('.png')) await new Promise<void>((resolve) => releases.push(resolve));
      return getFile(...args);
    });
    const { views, activate } = harness(root);
    appStore.setState({ listMode: 'favorites' });
    const pending = views.render(root.asHandle());
    await vi.waitFor(() => expect(releases).toHaveLength(6));
    const latest = new MemoryDirectory('latest');
    latest.file('latest.png');
    activate(latest);
    appStore.setState({ listMode: 'directory' });
    await views.render(latest.asHandle());
    const published = appStore.getState().entries;
    releases.forEach((release) => requireValue(release)());
    await pending;
    expect(releases).toHaveLength(6);
    expect(appStore.getState().entries).toBe(published);
    read.mockRestore();

    activate(root);
    appStore.setState({ listMode: 'favorites' });
    await views.render(root.asHandle(), { useConfig: false });
    expect(appStore.getState().entries).toHaveLength(20);
  });

  it('releases a canceled scan preview without clearing the newer folder', async () => {
    const root = new MemoryDirectory('scan');
    root.file('cover.png');
    const child = root.directory('slow');
    let release: (() => void) | undefined;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(child, 'values').mockImplementation(async function* () {
      await wait;
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:scan-preview');
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const { views, activate, openPreview } = harness(root);
    appStore.setState({ listMode: 'recursive' });
    const pending = views.render(root.asHandle());
    await vi.waitFor(() => expect(appStore.getState().scanPreview?.url).toBe('blob:scan-preview'));
    requireValue(appStore.getState().scanPreview).open();
    expect(openPreview).toHaveBeenCalledWith(root.asHandle(), [
      requireValue(root.entries.get('cover.png')).asHandle(),
    ]);
    const latest = new MemoryDirectory('latest');
    latest.file('latest.png');
    activate(latest);
    appStore.setState({ listMode: 'directory' });
    await views.render(latest.asHandle());
    requireValue(release)();
    await pending;
    expect(revoke).toHaveBeenCalledWith('blob:scan-preview');
    expect(appStore.getState().scanPreview).toBeNull();
    expect(appStore.getState().entries.map((entry) => entry.item.name)).toEqual(['latest.png']);
  });
});

it('filters favorite PDFs without adding documents to the image spread list', async () => {
  const root = new MemoryDirectory('root');
  root.file('cover.png');
  root.directory('child').file('book.PDF');
  root.file(
    '.image-viewer.json',
    JSON.stringify({ directories: { child: { favorites: ['book.PDF'] } } }),
  );
  const { views } = harness(root);
  appStore.setState({ listMode: 'favorites', filterType: 'pdf' });
  await views.render(root.asHandle());
  expect(
    appStore.getState().entries.map(({ item, parentPath }) => [item.type, item.name, parentPath]),
  ).toEqual([['pdf', 'book.PDF', 'child']]);
  expect(appStore.getState().displayImages).toEqual([]);
});
