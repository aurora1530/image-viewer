import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { Home } from '../../src/features/library/Home';
import { createApplication } from '../../src/app/createApplication';
import { createAppStore } from '../../src/app/store';
import { renderApplication } from '../helpers/render';
import { createDesktopApi } from '../helpers/desktopApi';
import { requireValue } from '../../src/shared/validation';

afterEach(() => {
  delete window.desktopApi;
});

const first = { path: '/first', name: 'first', openedAt: 1, favorite: true, favoriteOrder: 0 };
const second = { path: '/second', name: 'second', openedAt: 2, favorite: true, favoriteOrder: 1 };

function mount() {
  const app = createApplication(createAppStore({ library: [second, first] }));
  vi.spyOn(app, 'start').mockReturnValue(() => {});
  const { container } = renderApplication(createElement(Home), app);
  const names = (section: string) =>
    Array.from(container.querySelectorAll(`${section} .library-name`), (node) => node.textContent);
  const handle = () => requireValue(container.querySelector('.favorite-drag-handle'));
  return { app, container, names, handle };
}

it('keeps favorites in saved order independently of recency and exposes handles only there', () => {
  const { container, names } = mount();
  expect(names('#favorite-roots')).toEqual(['first', 'second']);
  expect(names('#recent-roots')).toEqual(['second', 'first']);
  expect(container.querySelectorAll('#favorite-roots .favorite-drag-handle')).toHaveLength(2);
  expect(container.querySelectorAll('#recent-roots .favorite-drag-handle')).toHaveLength(0);
});

it('moves from the handle with arrow keys, locks while saving and refreshes after success', async () => {
  let finish: () => void = () => {};
  const moveFavoriteRoot = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  window.desktopApi = createDesktopApi({
    moveFavoriteRoot,
    getLibrary: async () => [
      { ...second, favoriteOrder: 0 },
      { ...first, favoriteOrder: 1 },
    ],
  });
  const { app, names, handle } = mount();
  const open = vi.spyOn(app.actions, 'openLibrary');
  flushSync(() =>
    handle().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })),
  );
  expect(moveFavoriteRoot).toHaveBeenCalledExactlyOnceWith('/first', '/second');
  expect(handle().hasAttribute('disabled')).toBe(true);
  expect(names('#favorite-roots')).toEqual(['first', 'second']);
  finish();
  await vi.waitFor(() => expect(names('#favorite-roots')).toEqual(['second', 'first']));
  expect(open).not.toHaveBeenCalled();
});

it('accepts internal handle drags, ignores external drops and does not open folders', async () => {
  const { app, container, handle } = mount();
  const move = vi.spyOn(app.actions, 'moveLibraryFavorite').mockResolvedValue();
  const open = vi.spyOn(app.actions, 'openLibrary');
  const target = requireValue(container.querySelectorAll('.favorite-root-slot')[1]);
  const drop = () => target.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
  flushSync(drop);
  expect(move).not.toHaveBeenCalled();
  const start = new Event('dragstart', { bubbles: true });
  Object.defineProperty(start, 'dataTransfer', { value: { setData: vi.fn() } });
  flushSync(() => handle().dispatchEvent(start));
  flushSync(drop);
  expect(move).toHaveBeenCalledExactlyOnceWith('/first', '/second');
  expect(open).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(handle().hasAttribute('disabled')).toBe(false));
});

it('keeps the displayed order on save failure and reports the error', async () => {
  window.desktopApi = createDesktopApi({
    moveFavoriteRoot: async () => {
      throw new Error('disk');
    },
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const { app, names } = mount();
  await app.actions.moveLibraryFavorite('/first', '/second');
  expect(names('#favorite-roots')).toEqual(['first', 'second']);
  expect(app.store.getState().status.message).toContain('お気に入りの順番を保存できませんでした');
});
