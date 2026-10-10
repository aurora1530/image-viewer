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
  const ensureDirectoryCache = vi.fn(async () => ({
    items: files.map(handle => ({ type: 'image' as const, handle, name: handle.name, nameLower: handle.name.toLowerCase() })),
    imageCount: files.length, sorted: {}
  } satisfies DirectoryCacheEntry));
  localStorage.setItem('isSinglePageView', single ? '1' : '0');
  const controller = createViewer({
    viewer, viewerPages: pages, viewerVideoContainer: videoContainer,
    viewerToolbar: toolbar, listToolbar, leftPageImg: left, rightPageImg: right,
    viewerVideo: video, pageCounter: counter,
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
    ensureDirectoryCache
  });
  return { controller, viewer, pages, left, right, counter, video, ensureDirectoryCache,
    setSingle: (value: boolean) => { singleView = value; },
    get index() { return index; }, get files() { return currentFiles; } };
}

beforeEach(() => {
  vi.stubGlobal('Image', class {
    src = '';
    decoding = '';
    async decode() {}
    removeAttribute() { this.src = ''; }
  });
  let sequence = 0;
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: vi.fn(() => `blob:image-${++sequence}`),
    revokeObjectURL: vi.fn()
  }));
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async () => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
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
    await vi.waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledTimes(vi.mocked(URL.createObjectURL).mock.calls.length));
    expect(view.files).toEqual([]);
    expect(view.viewer.style.display).toBe('none');
  });

  it('leaves the viewer closed when there are no displayable images', async () => {
    const view = harness(false, []);
    await view.controller.openViewer(root.asHandle(), 0);
    expect(view.viewer.style.display).not.toBe('flex');
  });

  it('preloads neighboring images and reuses their files and URLs when moving back', async () => {
    const reads = handles.map(handle => vi.spyOn(handle, 'getFile'));
    const view = harness(true);
    await view.controller.openViewer(root.asHandle(), 0);
    const firstUrl = view.right.dataset.url;
    await vi.waitFor(() => expect(reads.every(read => read.mock.calls.length === 1)).toBe(true));
    view.controller.navigatePages(1);
    await vi.waitFor(() => expect(view.counter.textContent).toBe('2 / 5'));
    view.controller.navigatePages(-1);
    await vi.waitFor(() => expect(view.counter.textContent).toBe('1 / 5'));
    expect(view.right.dataset.url).toBe(firstUrl);
    expect(reads.every(read => read.mock.calls.length === 1)).toBe(true);
    view.controller.closeViewer();
  });

  it('does not let a slower old page overwrite a newer page after rapid navigation', async () => {
    let release!: (file: File) => void;
    vi.spyOn(handles[1], 'getFile').mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const view = harness(true);
    await view.controller.openViewer(root.asHandle(), 0);
    view.controller.navigatePages(1);
    view.controller.navigatePages(1);
    await vi.waitFor(() => expect(view.counter.textContent).toBe('3 / 5'));
    const latestUrl = view.right.dataset.url;
    release(new File([''], '2.png'));
    await vi.waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(5));
    expect(view.right.dataset.url).toBe(latestUrl);
    expect(view.counter.textContent).toBe('3 / 5');
    view.controller.closeViewer();
  });

  it('releases an in-flight preload after closing without restoring the image', async () => {
    let release!: (file: File) => void;
    vi.spyOn(handles[1], 'getFile').mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const view = harness(true);
    await view.controller.openViewer(root.asHandle(), 0);
    view.controller.closeViewer();
    release(new File([''], '2.png'));
    await vi.waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2));
    expect(view.right.hasAttribute('src')).toBe(false);
    expect(view.viewer.style.display).toBe('none');
    expect(view.counter.textContent).toBe('');
  });

  it('keeps at most six image sources when navigating a large collection', async () => {
    const directory = new MemoryDirectory('large');
    const files = Array.from({ length: 20 }, (_, i) => directory.file(`${i}.png`).asHandle());
    const view = harness(false, files);
    await view.controller.openViewer(directory.asHandle(), 0);
    for (let index = 2; index <= 12; index += 2) {
      view.controller.navigatePages(2);
      await vi.waitFor(() => expect(view.counter.textContent).toBe(`${index + 2} - ${index + 1} / 20`));
      expect(vi.mocked(URL.createObjectURL).mock.calls.length - vi.mocked(URL.revokeObjectURL).mock.calls.length).toBeLessThanOrEqual(6);
    }
    view.controller.closeViewer();
    await vi.waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledTimes(vi.mocked(URL.createObjectURL).mock.calls.length));
  });

  it('discards a video source that finishes loading after the viewer is closed', async () => {
    const videoFile = root.file('late.mp4');
    let release!: (file: File) => void;
    vi.spyOn(videoFile, 'getFile').mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const view = harness();
    const pending = view.controller.openVideoPlayer(videoFile.asHandle());
    view.controller.closeViewer();
    release(new File([''], 'late.mp4'));
    await pending;
    expect(view.video.hasAttribute('src')).toBe(false);
    expect(view.viewer.style.display).toBe('none');
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
    expect(view.video.play).not.toHaveBeenCalled();
  });

  it('does not restore an older directory after another image list is opened', async () => {
    const view = harness(true);
    let release!: () => void;
    const paused = new Promise<void>(resolve => { release = resolve; });
    const original = view.ensureDirectoryCache.getMockImplementation()!;
    view.ensureDirectoryCache.mockImplementationOnce(async () => { await paused; return original(); });
    const oldOpen = view.controller.openViewer(root.asHandle(), 0);
    await view.controller.openViewer(root.asHandle(), 0, [handles[4]]);
    const latestUrl = view.right.dataset.url;
    release();
    await oldOpen;
    expect(view.files).toEqual([handles[4]]);
    expect(view.counter.textContent).toBe('1 / 1');
    expect(view.right.dataset.url).toBe(latestUrl);
    view.controller.closeViewer();
  });

  it('keeps the latest view mode when a spread finishes loading after switching to single view', async () => {
    let release!: (file: File) => void;
    vi.spyOn(handles[2], 'getFile').mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const view = harness();
    await view.controller.openViewer(root.asHandle(), 0);
    view.controller.navigatePages(2);
    view.setSingle(true);
    const latestDisplay = view.controller.displayPages();
    release(new File([''], '3.png'));
    await latestDisplay;
    expect(view.counter.textContent).toBe('3 / 5');
    expect(view.pages.classList.contains('single-view')).toBe(true);
    expect(view.left.style.visibility).toBe('hidden');
    view.controller.closeViewer();
  });
});
