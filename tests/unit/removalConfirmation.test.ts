import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDesktopApi } from '../helpers/desktopApi';
import { createApplication } from '../../src/app/createApplication';
import { MemoryDirectory } from '../helpers/memoryFs';
import { requireValue } from '../../src/shared/validation';
import { confirmRemoval } from '../../src/platform/removalConfirmation';

afterEach(() => {
  delete window.desktopApi;
});

describe('removal confirmation', () => {
  it('uses browser confirmation for favorites and history', async () => {
    const confirm = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    expect(await confirmRemoval('favorite', 'photo.png')).toBe(false);
    expect(confirm).toHaveBeenLastCalledWith('「photo.png」をお気に入りから外しますか？');
    expect(await confirmRemoval('history', 'photos')).toBe(true);
    expect(confirm).toHaveBeenLastCalledWith('「photos」を履歴から削除しますか？');
  });

  it('keeps a favorite entry unchanged when its removal is canceled', async () => {
    const root = new MemoryDirectory('root');
    root.file('one.png');
    const config = root.file('.image-viewer.json', '{}');
    vi.stubGlobal('showDirectoryPicker', vi.fn().mockResolvedValue(root.asHandle()));
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    const app = createApplication();
    const stop = app.start();
    try {
      await app.actions.selectRootDirectory();
      await app.actions.toggleEntry(requireValue(app.store.getState().entries[0]), 'favorite');
      const before = config.textValue;
      const entry = requireValue(app.store.getState().entries[0]);
      expect(entry.item.isFavorite).toBe(true);
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      await app.actions.toggleEntry(entry, 'favorite');
      expect(config.textValue).toBe(before);
      expect(app.store.getState().entries[0].item.isFavorite).toBe(true);
      confirm.mockReturnValue(true);
      await app.actions.toggleEntry(entry, 'favorite');
      expect(app.store.getState().entries[0].item.isFavorite).toBe(false);
    } finally {
      stop();
      vi.unstubAllGlobals();
    }
  });

  it('leaves library intact on cancel and mutates it only after acceptance', async () => {
    const confirmRemoval = vi.fn().mockResolvedValue(false);
    const toggleFavoriteRoot = vi.fn().mockResolvedValue(false);
    const removeRecent = vi.fn().mockResolvedValue(undefined);
    window.desktopApi = createDesktopApi({
      confirmRemoval,
      toggleFavoriteRoot,
      removeRecent,
      getLibrary: async () => [],
    });
    const app = createApplication();
    const item = { name: 'photos', path: '/photos', favorite: true, openedAt: 0 };
    await app.actions.toggleLibraryFavorite(item);
    await app.actions.removeLibrary(item);
    expect(toggleFavoriteRoot).not.toHaveBeenCalled();
    expect(removeRecent).not.toHaveBeenCalled();
    confirmRemoval.mockResolvedValue(true);
    await app.actions.toggleLibraryFavorite(item);
    await app.actions.removeLibrary(item);
    expect(toggleFavoriteRoot).toHaveBeenCalledExactlyOnceWith('/photos');
    expect(removeRecent).toHaveBeenCalledExactlyOnceWith('/photos');
    confirmRemoval.mockClear();
    await app.actions.toggleLibraryFavorite({ ...item, favorite: false });
    expect(confirmRemoval).not.toHaveBeenCalled();
  });
});
