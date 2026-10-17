import { createElement, StrictMode } from 'react';
import { flushSync } from 'react-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Gallery } from '../../src/features/gallery/Gallery';
import { createAppStore, initialAppState } from '../../src/app/store';
import type { GalleryEntry } from '../../src/app/store';
import { createApplication } from '../../src/app/createApplication';
import { thumbnailCache } from '../../src/services/thumbnailCache';
import { MemoryDirectory } from '../helpers/memoryFs';
import { renderApplication } from '../helpers/render';
import type { ReactNode } from 'react';

let application: ReturnType<typeof createApplication>;
let appStore: ReturnType<typeof createAppStore>;
let actions: ReturnType<typeof createApplication>['actions'];
const render = (node: ReactNode) => renderApplication(node, application);

vi.mock('../../src/services/thumbnailCache', async () => {
  const { getMediaSource } = await import('../../src/platform/nativeFs');
  return {
    thumbnailCache: {
      get: vi.fn(getMediaSource),
      peek: vi.fn(),
      clear: vi.fn(),
      invalidate: vi.fn(),
      setPaused: vi.fn(),
    },
  };
});
const root = new MemoryDirectory('root');
const first = root.file('first.png').asHandle();
const second = root.file('second.png').asHandle();
const entry = (handle = first, parentPath = ''): GalleryEntry => ({
  key: `${parentPath}/${handle.name}`,
  parent: root.asHandle(),
  parentPath,
  item: { type: 'image', handle, name: handle.name, nameLower: handle.name.toLowerCase() },
});
beforeEach(() => {
  appStore = createAppStore();
  application = createApplication(appStore);
  actions = application.actions;
  appStore.setState(
    { ...initialAppState(), directories: [root.asHandle()], displayImages: [second, first] },
    true,
  );
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:thumbnail');
  vi.spyOn(URL, 'revokeObjectURL');
});

describe('React gallery', () => {
  it('lets the directory card own and release the selected file thumbnail URL', async () => {
    const folder = new MemoryDirectory('album');
    folder.file('__0.png');
    vi.mocked(thumbnailCache.get).mockResolvedValueOnce({
      url: 'blob:directory-cover',
      objectUrl: true,
    });
    appStore.setState({
      entries: [
        {
          key: '/album',
          parent: root.asHandle(),
          parentPath: '',
          item: { type: 'directory', handle: folder.asHandle(), name: 'album', nameLower: 'album' },
        },
      ],
    });
    render(createElement(Gallery));
    await vi.waitFor(() =>
      expect(document.querySelector('img')?.getAttribute('src')).toBe('blob:directory-cover'),
    );
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:directory-cover');
    flushSync(() => appStore.setState({ entries: [] }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:directory-cover');
  });

  it('clears the previous source and ready flag immediately when a handle changes under the same key', async () => {
    const initial = entry();
    vi.mocked(thumbnailCache.get).mockResolvedValueOnce({ url: 'blob:first', objectUrl: true });
    let complete!: (source: { url: string; objectUrl: boolean }) => void;
    vi.mocked(thumbnailCache.get).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    appStore.setState({ entries: [initial] });
    render(createElement(Gallery));
    const image = await vi.waitFor(() => {
      const image = document.querySelector('img');
      expect(image?.getAttribute('src')).toBe('blob:first');
      return image!;
    });
    flushSync(() => image.dispatchEvent(new Event('load')));
    expect(document.querySelector('.item-card')?.getAttribute('data-thumb-ready')).toBe('true');
    flushSync(() => appStore.setState({ entries: [{ ...entry(second), key: initial.key }] }));
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('.item-card')?.hasAttribute('data-thumb-ready')).toBe(false);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:first');
    complete({ url: 'blob:second', objectUrl: true });
    await vi.waitFor(() =>
      expect(document.querySelector('img')?.getAttribute('src')).toBe('blob:second'),
    );
  });

  it('discards a late result from a replaced handle while retaining the newer thumbnail', async () => {
    let completeOld!: (source: { url: string; objectUrl: boolean }) => void;
    vi.mocked(thumbnailCache.get).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completeOld = resolve;
        }),
    );
    vi.mocked(thumbnailCache.get).mockResolvedValueOnce({ url: 'blob:new', objectUrl: true });
    const initial = entry();
    appStore.setState({ entries: [initial] });
    render(createElement(Gallery));
    flushSync(() => appStore.setState({ entries: [{ ...entry(second), key: initial.key }] }));
    await vi.waitFor(() =>
      expect(document.querySelector('img')?.getAttribute('src')).toBe('blob:new'),
    );
    completeOld({ url: 'blob:old', objectUrl: true });
    await vi.waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:old'));
    expect(document.querySelector('img')?.getAttribute('src')).toBe('blob:new');
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:new');
  });

  it('passes the clicked entry to the application without changing the displayed order', () => {
    const open = vi.spyOn(actions, 'openEntry').mockImplementation(() => undefined);
    const item = entry();
    appStore.setState({ entries: [item] });
    render(createElement(Gallery));
    (document.querySelector('.media-card') as HTMLElement).click();
    expect(open).toHaveBeenCalledWith(item);
    expect(appStore.getState().displayImages).toEqual([second, first]);
  });

  it('toggles favorites without opening the viewer and reflects the resulting shared state', async () => {
    const open = vi.spyOn(actions, 'openEntry').mockImplementation(() => undefined);
    const toggle = vi.spyOn(actions, 'toggleEntry').mockImplementation(async (item) => {
      appStore.setState({ entries: [{ ...item, item: { ...item.item, isFavorite: true } }] });
    });
    const item = entry(first, 'chapter');
    appStore.setState({ entries: [item] });
    render(createElement(Gallery));
    (document.querySelector('.favorite-btn') as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(document.querySelector('.favorite-btn')?.getAttribute('aria-pressed')).toBe('true'),
    );
    expect(toggle).toHaveBeenCalledWith(item, 'favorite');
    expect(open).not.toHaveBeenCalled();
  });

  it('removes hidden entries through shared state without opening the viewer', async () => {
    vi.spyOn(actions, 'toggleEntry').mockImplementation(async () => {
      appStore.setState({ entries: [], displayImages: [second] });
    });
    appStore.setState({ entries: [entry(first, 'chapter')] });
    render(createElement(Gallery));
    (document.querySelector('.hidden-toggle-btn') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector('.media-card')).toBeNull());
    expect(appStore.getState().displayImages).toEqual([second]);
  });

  it('releases a source that completes after its card has unmounted, including StrictMode setup', async () => {
    const releases: Array<(source: { url: string; objectUrl: boolean }) => void> = [];
    vi.mocked(thumbnailCache.get).mockImplementation(
      () =>
        new Promise((resolve) => {
          releases.push(resolve);
        }),
    );
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    appStore.setState({ entries: [entry()] });
    render(createElement(StrictMode, null, createElement(Gallery)));
    flushSync(() => appStore.setState({ entries: [] }));
    releases.forEach((release, i) => release({ url: `blob:late-${i}`, objectUrl: true }));
    await vi.waitFor(() => expect(revoke).toHaveBeenCalledTimes(releases.length));
    releases.forEach((_, i) => expect(revoke).toHaveBeenCalledWith(`blob:late-${i}`));
    expect(document.querySelector('img')).toBeNull();
  });

  it('retries a failed thumbnail and releases its replaced URL', async () => {
    vi.mocked(thumbnailCache.get).mockResolvedValue({ url: 'blob:retry', objectUrl: true });
    appStore.setState({ entries: [entry()] });
    render(createElement(Gallery));
    const firstImage = await vi.waitFor(() => {
      const image = document.querySelector('img');
      expect(image).not.toBeNull();
      return image!;
    });
    firstImage.dispatchEvent(new Event('error'));
    await vi.waitFor(() => {
      const image = document.querySelector('img');
      expect(image).not.toBeNull();
      expect(image).not.toBe(firstImage);
    });
    expect(thumbnailCache.invalidate).toHaveBeenCalledWith(first);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:retry');
  });

  it('retains mounted virtual cards and their thumbnails when favorite metadata changes', async () => {
    vi.mocked(thumbnailCache.get).mockResolvedValue({ url: 'blob:retained', objectUrl: true });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1024);
    const entries = Array.from({ length: 300 }, (_, index) => ({ ...entry(), key: String(index) }));
    appStore.setState({ entries });
    render(createElement(Gallery));
    const image = await vi.waitFor(() => {
      const image = document.querySelector('img');
      expect(image).not.toBeNull();
      return image!;
    });
    const card = image.closest('.item-card');
    flushSync(() =>
      appStore.setState({
        entries: entries.map((value, index) =>
          index === 0 ? { ...value, item: { ...value.item, isFavorite: true } } : value,
        ),
      }),
    );
    expect(document.querySelector('.item-card')).toBe(card);
    expect(document.querySelector('img')).toBe(image);
    expect(card?.querySelector('.favorite-btn')?.getAttribute('aria-pressed')).toBe('true');
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:retained');
  });
});
