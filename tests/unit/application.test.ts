import { createDesktopApi } from '../helpers/desktopApi';
import { requireValue } from '../../src/shared/validation';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useAppActions, useAppState } from '../../src/app/ApplicationProvider';
import { createApplication } from '../../src/app/createApplication';
import { createAppStore } from '../../src/app/store';
import { renderApplication } from '../helpers/render';
import { MemoryDirectory } from '../helpers/memoryFs';

function PreferenceControl() {
  const size = useAppState((state) => state.thumbnailSizeIndex);
  const actions = useAppActions();
  return createElement('button', { onClick: () => actions.setThumbnailSize(4) }, String(size));
}

describe('application composition and lifecycle', () => {
  it('ignores a confirmation accepted after a newer view has started', async () => {
    const root = new MemoryDirectory('root');
    const application = createApplication(createAppStore({ directories: [root.asHandle()] }));
    let accept: (value: boolean) => void = () => {};
    window.desktopApi = createDesktopApi({
      confirmListMode: () => new Promise<boolean>((resolve) => (accept = resolve)),
    });
    try {
      const pending = application.actions.changeListMode('recursive');
      await application.actions.changeListMode('hidden');
      accept(true);
      await pending;
      expect(application.store.getState().listMode).toBe('hidden');
    } finally {
      delete window.desktopApi;
    }
  });

  it.each([false, true])(
    'refreshes metadata after a cached search during favorite saving (write fails: %s)',
    async (writeFails) => {
      const root = new MemoryDirectory('root');
      root.file('one.png');
      const config = root.file('.image-viewer.json', '{}');
      vi.stubGlobal('showDirectoryPicker', vi.fn().mockResolvedValue(root.asHandle()));
      vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
      const application = createApplication();
      const stop = application.start();
      let release: (() => void) | undefined;
      try {
        await application.actions.selectRootDirectory();
        const entry = application.store.getState().entries[0];
        vi.spyOn(config, 'createWritable').mockImplementationOnce(async () => ({
          write: async (value: FileSystemWriteChunkType) => {
            if (typeof value !== 'string') throw new Error('Expected text');
            config.textValue = value;
            await new Promise<void>((resolve) => {
              release = resolve;
            });
            if (writeFails) throw new Error('write failed');
          },
          close: async () => undefined,
        }));
        const saving = application.actions.toggleEntry(entry, 'favorite');
        await vi.waitFor(() => expect(release).toBeTypeOf('function'));
        application.actions.setSearch('one');
        await vi.waitFor(() => expect(application.store.getState().searchQuery).toBe('one'));
        // Wait for the debounced cached search, not only the input state update.
        const published = vi.fn();
        const unsubscribe = application.store.subscribe((state, previous) => {
          if (state.entries !== previous.entries) published();
        });
        await vi.waitFor(() => expect(published).toHaveBeenCalled());
        unsubscribe();
        expect(application.store.getState().entries[0].item.isFavorite).toBe(false);
        requireValue(release)();
        if (writeFails) {
          await expect(saving).rejects.toThrow('write failed');
          application.actions.setSearch('one.png');
        } else await saving;
        await vi.waitFor(() =>
          expect(application.store.getState().entries[0]?.item.isFavorite).toBe(true),
        );
        expect(application.store.getState().searchQuery).toBe(writeFails ? 'one.png' : 'one');
      } finally {
        release?.();
        stop();
        vi.unstubAllGlobals();
      }
    },
  );

  it('keeps commands and subscriptions scoped to their provider', async () => {
    const first = createApplication(createAppStore({ thumbnailSizeIndex: 1 }));
    const second = createApplication(createAppStore({ thumbnailSizeIndex: 2 }));
    const firstView = renderApplication(createElement(PreferenceControl), first);
    const secondView = renderApplication(createElement(PreferenceControl), second);
    requireValue(firstView.container.querySelector('button')).click();
    await vi.waitFor(() => expect(firstView.container.textContent).toBe('4'));
    expect(secondView.container.textContent).toBe('2');
    expect(second.store.getState().thumbnailSizeIndex).toBe(2);
  });

  it('registers events once and can restart after cleanup without stale cleanup stopping it', () => {
    const application = createApplication();
    const turn = vi.spyOn(application.actions, 'turnPage').mockImplementation(() => {});
    const press = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    const open = () =>
      application.store.setState((state) => ({ viewer: { ...state.viewer, mode: 'image' } }));
    const stop = application.start();
    try {
      expect(application.start()).toBe(stop);
      open();
      press();
      expect(turn).toHaveBeenCalledTimes(1);
      stop();
      open();
      press();
      expect(turn).toHaveBeenCalledTimes(1);
      const stopRestarted = application.start();
      try {
        stop();
        open();
        press();
        expect(turn).toHaveBeenCalledTimes(2);
      } finally {
        stopRestarted();
      }
    } finally {
      stop();
    }
  });

  it('loads persisted display preferences at composition while stores have pure defaults', () => {
    localStorage.setItem('thumbnailSizeIndex', '999');
    localStorage.setItem('isSinglePageView', '1');
    localStorage.setItem('isUiHidden', '1');
    expect(createAppStore().getState().thumbnailSizeIndex).toBe(1);
    expect(createApplication().store.getState()).toMatchObject({
      thumbnailSizeIndex: 5,
      isSinglePageView: true,
      isUiHidden: true,
    });
  });
});
