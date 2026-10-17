import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppStore } from '../../src/app/store';
import { createDirectoryViews } from '../../src/app/createDirectoryViews';
import { MemoryDirectory } from '../helpers/memoryFs';

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
      root.entries.get('Photo10.GIF')!.asHandle(),
    ]);
  });

  it('does not publish an older folder after a newer folder has finished loading', async () => {
    const old = new MemoryDirectory('old');
    old.file('old.png');
    const latest = new MemoryDirectory('latest');
    latest.file('latest.png');
    let release!: () => void;
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
    release();
    await pending;
    expect(appStore.getState().entries).toBe(published);
    expect(published.map((entry) => entry.item.name)).toEqual(['latest.png']);
    expect(appStore.getState().status.type).toBe('clear');
  });

  it('releases a canceled scan preview without clearing the newer folder', async () => {
    const root = new MemoryDirectory('scan');
    root.file('cover.png');
    const child = root.directory('slow');
    let release!: () => void;
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
    appStore.getState().scanPreview!.open();
    expect(openPreview).toHaveBeenCalledWith(root.asHandle(), [
      root.entries.get('cover.png')!.asHandle(),
    ]);
    const latest = new MemoryDirectory('latest');
    latest.file('latest.png');
    activate(latest);
    appStore.setState({ listMode: 'directory' });
    await views.render(latest.asHandle());
    release();
    await pending;
    expect(revoke).toHaveBeenCalledWith('blob:scan-preview');
    expect(appStore.getState().scanPreview).toBeNull();
    expect(appStore.getState().entries.map((entry) => entry.item.name)).toEqual(['latest.png']);
  });
});
