import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createViewer } from '../../src/viewer';
import type { DirectoryCacheEntry } from '../../src/state';
import { MemoryDirectory } from '../helpers/memoryFs';

const root = new MemoryDirectory('root');
const handles = ['1.png', '2.png', '3.png', '4.png', '5.png'].map(name => root.file(name).asHandle());

function harness(single = false, files = handles) {
  const viewer = document.querySelector<HTMLElement>('#viewer')!;
  const pages = document.querySelector<HTMLElement>('#viewer-pages')!;
  const videoContainer = document.querySelector<HTMLElement>('#viewer-video-container')!;
  const toolbar = document.querySelector<HTMLElement>('#viewer-toolbar')!;
  const listToolbar = document.querySelector<HTMLElement>('#list-toolbar')!;
  const left = document.querySelector<HTMLImageElement>('#left-page')!;
  const right = document.querySelector<HTMLImageElement>('#right-page')!;
  const video = document.querySelector<HTMLVideoElement>('#viewer-video')!;
  const counter = document.querySelector<HTMLElement>('#page-counter')!;
  let currentFiles: FileSystemFileHandle[] = [];
  let index = 0;
  let offset = 0;
  let singleView = single;
  const urls = new Set<string>();
  localStorage.setItem('isSinglePageView', single ? '1' : '0');
  const controller = createViewer({
    viewer, viewerPages: pages, viewerVideoContainer: videoContainer,
    viewerToolbar: toolbar, listToolbar, leftPageImg: left, rightPageImg: right,
    viewerVideo: video, pageCounter: counter, createdUrls: urls,
    getCurrentImageFiles: () => currentFiles,
    setCurrentImageFiles: value => { currentFiles = value; },
    getCurrentImageIndex: () => index,
    setCurrentImageIndex: value => { index = value; },
    getPageOffset: () => offset,
    setPageOffset: value => { offset = value; },
    getSortOrder: () => 'asc',
    getIsSinglePageView: () => singleView,
    setIsSinglePageView: value => { singleView = value; },
    updateViewModeUI: vi.fn(), showStatus: vi.fn(),
    ensureDirectoryCache: async () => ({
      items: files.map(handle => ({ type: 'image' as const, handle, name: handle.name, nameLower: handle.name.toLowerCase() })),
      imageCount: files.length, sorted: {}
    } satisfies DirectoryCacheEntry)
  });
  return { controller, viewer, pages, left, right, counter, urls, video, get index() { return index; }, get files() { return currentFiles; } };
}

beforeEach(() => {
  let sequence = 0;
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: vi.fn(() => `blob:image-${++sequence}`),
    revokeObjectURL: vi.fn()
  }));
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async () => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
});

describe('image viewer behavior', () => {
  it('opens a spread right to left and shows the requested page', async () => {
    const view = harness();
    await view.controller.openViewer(root.asHandle(), 1);
    expect(view.viewer.style.display).toBe('flex');
    expect(view.counter.textContent).toBe('2 - 1 / 5');
    expect(view.right.dataset.url).toMatch(/^blob:image-/);
    expect(view.left.dataset.url).toMatch(/^blob:image-/);
  });

  it('shows one image and wraps from the first to the last', async () => {
    const view = harness(true);
    await view.controller.openViewer(root.asHandle(), 0);
    expect(view.counter.textContent).toBe('1 / 5');
    expect(view.left.style.visibility).toBe('hidden');
    view.controller.navigatePages(-1);
    await vi.waitFor(() => expect(view.counter.textContent).toBe('5 / 5'));
    expect(view.index).toBe(4);
    view.controller.navigatePages(1);
    await vi.waitFor(() => expect(view.counter.textContent).toBe('1 / 5'));
  });

  it('wraps spreads to the last odd page and back', async () => {
    const view = harness();
    await view.controller.openViewer(root.asHandle(), 0);
    view.controller.navigatePages(-2);
    await vi.waitFor(() => expect(view.counter.textContent).toBe('- - 5 / 5'));
    expect(view.index).toBe(4);
    view.controller.navigatePages(2);
    await vi.waitFor(() => expect(view.counter.textContent).toBe('2 - 1 / 5'));
  });

  it('cleans up blob URLs and stops video on close', async () => {
    const view = harness(true);
    await view.controller.openViewer(root.asHandle(), 0);
    const imageUrl = view.right.dataset.url!;
    await view.controller.openVideoPlayer(root.file('clip.mp4').asHandle());
    expect(view.video.src).toContain('blob:image-');
    view.controller.closeViewer();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(imageUrl);
    expect(view.urls.size).toBe(0);
    expect(view.files).toEqual([]);
    expect(view.viewer.style.display).toBe('none');
  });

  it('leaves the viewer closed when there are no displayable images', async () => {
    const view = harness(false, []);
    await view.controller.openViewer(root.asHandle(), 0);
    expect(view.viewer.style.display).not.toBe('flex');
  });
});
