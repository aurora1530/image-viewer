import { requireValue } from '../../src/shared/validation';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/app/App';
import { createAppStore, initialAppState } from '../../src/app/store';
import { createApplication } from '../../src/app/createApplication';
import { MemoryDirectory } from '../helpers/memoryFs';
import { renderApplication } from '../helpers/render';
import type { ReactNode } from 'react';

let application: ReturnType<typeof createApplication>;
let appStore: ReturnType<typeof createAppStore>;
let actions: ReturnType<typeof createApplication>['actions'];
const render = (node: ReactNode) => renderApplication(node, application);

beforeEach(() => {
  appStore = createAppStore();
  application = createApplication(appStore);
  actions = application.actions;
  appStore.setState(initialAppState(), true);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
});
const element = (id: string) => requireValue(document.getElementById(id));
const button = (id: string) => {
  const node = element(id);
  if (!(node instanceof HTMLButtonElement)) throw new Error('Expected button');
  return node;
};
const select = (id: string) => {
  const node = element(id);
  if (!(node instanceof HTMLSelectElement)) throw new Error('Expected select');
  return node;
};

describe('React display preferences', () => {
  it('toggles dense layout only for original aspect sizes and remembers the preference', () => {
    render(createElement(App));
    expect(document.getElementById('dense-gallery-btn')).toBeNull();
    flushSync(() => actions.setThumbnailSize(3));
    flushSync(() => button('dense-gallery-btn').click());
    expect(element('dense-gallery-btn').getAttribute('aria-pressed')).toBe('true');
    expect(element('item-list').classList.contains('dense-gallery')).toBe(true);
    expect(localStorage.getItem('denseGallery')).toBe('1');
    flushSync(() => actions.setThumbnailSize(1));
    expect(document.getElementById('dense-gallery-btn')).toBeNull();
    expect(element('item-list').classList.contains('dense-gallery')).toBe(false);
    flushSync(() => actions.setThumbnailSize(4));
    expect(element('item-list').classList.contains('dense-gallery')).toBe(true);
    flushSync(() => button('dense-gallery-btn').click());
    expect(element('item-list').classList.contains('dense-gallery')).toBe(false);
  });

  it('clamps invalid thumbnail sizes and updates both the control and gallery', () => {
    render(createElement(App));
    flushSync(() => actions.setThumbnailSize(999));
    expect(select('size-select').value).toBe('5');
    expect(element('item-list').style.getPropertyValue('--thumbnail-min-width')).toBe('520px');
    expect(element('item-list').classList.contains('original-aspect')).toBe(true);
    flushSync(() => actions.setThumbnailSize(Number.NaN));
    expect(select('size-select').value).toBe('1');
    expect(element('item-list').classList.contains('original-aspect')).toBe(false);
  });

  it('reflects hidden UI and single-page view from shared state', () => {
    render(createElement(App));
    flushSync(() =>
      appStore.setState({ isUiHidden: true, isUiDockRevealed: true, isSinglePageView: true }),
    );
    expect(document.body.classList.contains('ui-hidden-mode')).toBe(true);
    expect(document.body.classList.contains('ui-dock-revealed')).toBe(true);
    expect(element('ui-visibility-btn').getAttribute('aria-pressed')).toBe('true');
    expect(element('toggle-view-btn').textContent).toBe('見開きに戻す');
    expect(element('adjust-spread-btn').style.display).toBe('none');
  });

  it('updates folder controls and disables favorite filter/sort in the favorite list', () => {
    render(createElement(App));
    expect(element('list-toolbar').classList.contains('hidden')).toBe(true);
    const root = new MemoryDirectory('root');
    flushSync(() =>
      appStore.setState({
        directories: [root.asHandle(), root.directory('chapter').asHandle()],
        listMode: 'favorites',
        favoriteOnly: true,
        favoriteFirst: true,
        sortOrder: 'desc',
      }),
    );
    expect(element('list-toolbar').classList.contains('hidden')).toBe(false);
    expect(element('up-dir-btn').classList.contains('hidden')).toBe(false);
    expect(element('current-dir-name').textContent).toBe('chapter');
    expect(element('favorite-list-btn').getAttribute('aria-pressed')).toBe('true');
    expect(element('directory-mode-btn').getAttribute('aria-pressed')).toBe('false');
    expect(button('favorite-only-btn').disabled).toBe(true);
    expect(element('favorite-only-btn').getAttribute('aria-pressed')).toBe('true');
    expect(button('favorite-first-btn').disabled).toBe(true);
    expect(element('favorite-first-btn').getAttribute('aria-pressed')).toBe('true');
    expect(element('toggle-sort-btn').textContent).toContain('降順');
  });
});
