import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useAppActions, useAppState } from '../../src/app/ApplicationProvider';
import { createApplication } from '../../src/app/createApplication';
import { createAppStore } from '../../src/app/store';
import { renderApplication } from '../helpers/render';

function PreferenceControl() {
  const size = useAppState((state) => state.thumbnailSizeIndex);
  const actions = useAppActions();
  return createElement('button', { onClick: () => actions.setThumbnailSize(4) }, String(size));
}

describe('application composition and lifecycle', () => {
  it('keeps commands and subscriptions scoped to their provider', async () => {
    const first = createApplication(createAppStore({ thumbnailSizeIndex: 1 }));
    const second = createApplication(createAppStore({ thumbnailSizeIndex: 2 }));
    const firstView = renderApplication(createElement(PreferenceControl), first);
    const secondView = renderApplication(createElement(PreferenceControl), second);
    firstView.container.querySelector('button')!.click();
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
