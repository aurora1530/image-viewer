import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGallery } from '../../src/gallery';
import { MemoryDirectory } from '../helpers/memoryFs';

const root = new MemoryDirectory('root');
const first = root.file('first.png').asHandle();
const second = root.file('second.png').asHandle();

function harness() {
  const itemList = document.querySelector<HTMLElement>('#item-list')!;
  let displayList = [second, first];
  let renderToken = 1;
  const idleCallbacks: Array<() => void> = [];
  const openViewer = vi.fn();
  const openVideoPlayer = vi.fn();
  const enterDirectory = vi.fn(async () => undefined);
  const toggleFavoriteEntry = vi.fn(async () => true);
  const toggleHiddenEntry = vi.fn(async () => true);
  const scheduleProcessForCurrentDir = vi.fn();
  const showStatus = vi.fn();
  const gallery = createGallery({
    itemList,
    createdUrls: new Set<string>(),
    RIC: callback => { idleCallbacks.push(callback); return idleCallbacks.length; },
    enableDebugLogs: false,
    ensureLazyLoadObserver: vi.fn(),
    getLazyLoadObserver: () => null,
    getCurrentDisplayImageList: () => displayList,
    setCurrentDisplayImageList: list => { displayList = list; },
    openViewer, openVideoPlayer, enterDirectory,
    getDirectoryPreviewUrl: async () => null,
    setFavoriteButtonState: (button, active) => button.setAttribute('aria-pressed', String(active)),
    setHiddenButtonState: (button, hidden) => button.setAttribute('aria-pressed', String(hidden)),
    toggleFavoriteEntry, toggleHiddenEntry,
    getRootDirHandle: () => root.asHandle(),
    normalizeDirPathSegments: path => String(path).split('/').filter(Boolean),
    scheduleProcessForCurrentDir,
    getFavoriteFirst: () => true,
    getFavoriteOnly: () => false,
    getIsFavoriteListMode: () => false,
    getIsHiddenMode: () => false,
    getRenderToken: () => renderToken,
    showStatus
  });
  return {
    gallery, itemList, openViewer, openVideoPlayer, enterDirectory,
    toggleFavoriteEntry, toggleHiddenEntry, scheduleProcessForCurrentDir,
    showStatus, idleCallbacks,
    get displayList() { return displayList; },
    set renderToken(value: number) { renderToken = value; }
  };
}

beforeEach(() => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:thumbnail');
});

describe('gallery cards and batching', () => {
  it('opens an image at its index in the displayed, filtered list', () => {
    const view = harness();
    view.gallery.createItemCard({ type: 'image', handle: first, name: 'first.png' }, root.asHandle(), 0, true);
    view.itemList.querySelector('.media-card')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(view.openViewer).toHaveBeenCalledWith(root.asHandle(), 1, [second, first]);
  });

  it('uses the favorite-first all-images order across directories for navigation', async () => {
    const view = harness();
    const child = root.directory('child');
    const favorite = child.file('favorite.png').asHandle();
    const items = [
      { handle: favorite, name: favorite.name, parentHandle: child.asHandle(), imageIndex: 0, parentPath: 'child', path: 'child/favorite.png', isFavorite: true },
      { handle: first, name: first.name, parentHandle: root.asHandle(), imageIndex: 0, parentPath: '', path: 'first.png', isFavorite: false },
      { handle: second, name: second.name, parentHandle: root.asHandle(), imageIndex: 1, parentPath: '', path: 'second.png', isFavorite: false }
    ];
    await view.gallery.renderRecursiveItemsInBatches(items, true);
    expect(view.displayList).toEqual([favorite, first, second]);
    view.itemList.querySelector('.media-card')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(view.openViewer).toHaveBeenCalledWith(child.asHandle(), 0, [favorite, first, second]);
  });

  it('changes the favorite without opening the viewer, then schedules a fresh list', async () => {
    const view = harness();
    view.gallery.createItemCard({ type: 'image', handle: first, name: 'first.png' }, root.asHandle(), 0, true, null, 'chapter');
    (view.itemList.querySelector('.favorite-btn') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(view.toggleFavoriteEntry).toHaveBeenCalledWith(
      root.asHandle(), ['chapter'], { type: 'file', path: 'first.png' }, expect.any(Function)
    ));
    expect(view.openViewer).not.toHaveBeenCalled();
    expect(view.itemList.querySelector('.favorite-btn')?.getAttribute('aria-pressed')).toBe('true');
    expect(view.scheduleProcessForCurrentDir).toHaveBeenCalledWith(0, true);
  });

  it('removes a newly hidden image from the visible list', async () => {
    const view = harness();
    view.gallery.createItemCard({ type: 'image', handle: first, name: 'first.png' }, root.asHandle(), 0, true, null, 'chapter');
    (view.itemList.querySelector('.hidden-toggle-btn') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(view.itemList.querySelector('.media-card')).toBeNull());
    expect(view.toggleHiddenEntry).toHaveBeenCalledWith(
      root.asHandle(), ['chapter'], { type: 'file', path: 'first.png' }, expect.any(Function)
    );
    expect(view.displayList).toEqual([second]);
    expect(view.openViewer).not.toHaveBeenCalled();
    expect(view.showStatus).toHaveBeenCalledWith('表示できるアイテムがありません。', 'info');
  });

  it('stops a queued batch when a newer render starts', async () => {
    const view = harness();
    const items = Array.from({ length: 150 }, (_, index) => ({
      type: 'image' as const, handle: first, name: `image-${index}.png`
    }));
    const rendering = view.gallery.renderItemsInBatches(items, root.asHandle(), true);
    expect(view.itemList.querySelectorAll('.item-card')).toHaveLength(100);
    expect(view.idleCallbacks).toHaveLength(1);
    view.renderToken = 2;
    view.idleCallbacks.shift()!();
    await rendering;
    expect(view.itemList.querySelectorAll('.item-card')).toHaveLength(100);
  });
});
