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
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

describe('React display preferences', () => {
  it('clamps invalid thumbnail sizes and updates both the control and gallery', () => {
    render(createElement(App));
    flushSync(() => actions.setThumbnailSize(999));
    expect(element<HTMLSelectElement>('size-select').value).toBe('5');
    expect(element('item-list').style.getPropertyValue('--thumbnail-min-width')).toBe('520px');
    expect(element('item-list').classList.contains('original-aspect')).toBe(true);
    flushSync(() => actions.setThumbnailSize(Number.NaN));
    expect(element<HTMLSelectElement>('size-select').value).toBe('1');
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

  it('updates folder controls and disables favorite sorting in the favorite list', () => {
    render(createElement(App));
    expect(element('list-toolbar').classList.contains('hidden')).toBe(true);
    const root = new MemoryDirectory('root');
    flushSync(() =>
      appStore.setState({
        directories: [root.asHandle(), root.directory('chapter').asHandle()],
        listMode: 'favorites',
        favoriteMode: 'only',
        sortOrder: 'desc',
      }),
    );
    expect(element('list-toolbar').classList.contains('hidden')).toBe(false);
    expect(element('up-dir-btn').classList.contains('hidden')).toBe(false);
    expect(element('current-dir-name').textContent).toBe('chapter');
    expect(element('favorite-list-btn').textContent).toBe('戻る');
    expect(element<HTMLSelectElement>('favorite-mode-select').disabled).toBe(true);
    expect(element<HTMLSelectElement>('favorite-mode-select').value).toBe('only');
    expect(element('toggle-sort-btn').textContent).toContain('降順');
  });
});
