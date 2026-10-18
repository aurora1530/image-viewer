import { samplePdf } from '../helpers/pdf';
import type { ConfigNode } from '../../src/services/storage';
import { expect, test } from '@playwright/test';

test('shows the built version and links to its release from the header and settings', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#open-directory-externally-btn')).toHaveCount(0);
  const badge = page.locator('.version-badge a');
  await expect(badge).toHaveText(/^v\d+\.\d+\.\d+$/);
  await expect(badge).toHaveAttribute(
    'href',
    `https://github.com/aurora1530/image-viewer/releases/tag/${await badge.textContent()}`,
  );
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'バージョンと更新' })).toBeVisible();
  await expect(page.getByRole('link', { name: '最新リリース・ダウンロード' })).toHaveAttribute(
    'href',
    'https://github.com/aurora1530/image-viewer/releases/latest',
  );
});

test('reduced JPEG decoding preserves EXIF orientation, colors and thumbnail resolution', async ({
  page,
}) => {
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const modulePath = '/src/services/thumbnailEncoder.ts';
    const { encodeThumbnail } = (await import(
      /* @vite-ignore */ modulePath
    )) as typeof import('../../src/services/thumbnailEncoder');
    const original = document.createElement('canvas');
    original.width = 3200;
    original.height = 1600;
    const context = original.getContext('2d')!;
    for (const [color, x, y] of [
      ['red', 0, 0],
      ['lime', 1600, 0],
      ['blue', 0, 800],
      ['yellow', 1600, 800],
    ] as const) {
      context.fillStyle = color;
      context.fillRect(x, y, 1600, 800);
    }
    const jpeg = await new Promise<Blob>((resolve) =>
      original.toBlob((value) => resolve(value!), 'image/jpeg', 0.95),
    );
    const pixels = (image: ImageBitmap) => {
      const canvas = new OffscreenCanvas(image.width, image.height);
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      return [
        [0.25, 0.25],
        [0.75, 0.25],
        [0.25, 0.75],
        [0.75, 0.75],
      ].map(([x, y]) =>
        Array.from(
          context.getImageData(Math.floor(image.width * x), Math.floor(image.height * y), 1, 1)
            .data,
        ).slice(0, 3),
      );
    };
    const results = [];
    for (let orientation = 1; orientation <= 8; orientation++) {
      const exif = new Uint8Array([
        0xff,
        0xe1,
        0,
        34,
        69,
        120,
        105,
        102,
        0,
        0,
        73,
        73,
        42,
        0,
        8,
        0,
        0,
        0,
        1,
        0,
        18,
        1,
        3,
        0,
        1,
        0,
        0,
        0,
        orientation,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
      ]);
      const source = new Blob([jpeg.slice(0, 2), exif, jpeg.slice(2)], { type: 'image/jpeg' });
      const expected = await createImageBitmap(source);
      const blob = await encodeThumbnail(source, 'image/jpeg');
      const actual = await createImageBitmap(blob);
      const scale = 1280 / Math.max(expected.width, expected.height);
      results.push({
        orientation,
        expectedSize: [Math.round(expected.width * scale), Math.round(expected.height * scale)],
        actualSize: [actual.width, actual.height],
        expectedColors: pixels(expected),
        actualColors: pixels(actual),
      });
      expected.close();
      actual.close();
    }
    return results;
  });
  for (const result of results) {
    expect(result.actualSize, `orientation ${result.orientation}`).toEqual(result.expectedSize);
    for (let corner = 0; corner < 4; corner++)
      for (let channel = 0; channel < 3; channel++) {
        expect(
          Math.abs(result.actualColors[corner][channel] - result.expectedColors[corner][channel]),
          `orientation ${result.orientation}, corner ${corner}`,
        ).toBeLessThan(15);
      }
  }
});

test('large PNG thumbnails preserve transparency and proportional sizing', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const modulePath = '/src/services/thumbnailEncoder.ts';
    const { encodeThumbnail } = (await import(
      /* @vite-ignore */ modulePath
    )) as typeof import('../../src/services/thumbnailEncoder');
    const canvas = new OffscreenCanvas(3200, 1600);
    const context = canvas.getContext('2d')!;
    context.fillStyle = 'rgba(255,0,0,.5)';
    context.fillRect(0, 0, 1600, 800);
    context.fillStyle = 'blue';
    context.fillRect(0, 800, 1600, 800);
    const source = await canvas.convertToBlob({ type: 'image/png' });
    const encoded = await encodeThumbnail(source, 'image/webp');
    const bitmap = await createImageBitmap(encoded);
    const preview = new OffscreenCanvas(bitmap.width, bitmap.height);
    const pixels = preview.getContext('2d')!;
    pixels.drawImage(bitmap, 0, 0);
    const at = (x: number, y: number) => Array.from(pixels.getImageData(x, y, 1, 1).data);
    const result = {
      width: bitmap.width,
      height: bitmap.height,
      translucent: at(320, 160),
      clear: at(960, 160),
      opaque: at(320, 480),
    };
    bitmap.close();
    return result;
  });
  expect([result.width, result.height]).toEqual([1280, 640]);
  expect(result.translucent[0]).toBeGreaterThan(240);
  expect(result.translucent[3]).toBeGreaterThanOrEqual(126);
  expect(result.translucent[3]).toBeLessThanOrEqual(129);
  expect(result.clear[3]).toBe(0);
  expect(result.opaque[2]).toBeGreaterThan(240);
  expect(result.opaque[3]).toBe(255);
});

test('JPEG thumbnails retain proportional sizing for odd, portrait and small originals', async ({
  page,
}) => {
  const results = await page.evaluate(async () => {
    const modulePath = '/src/services/thumbnailEncoder.ts';
    const { encodeThumbnail } = (await import(
      /* @vite-ignore */ modulePath
    )) as typeof import('../../src/services/thumbnailEncoder');
    const results = [];
    for (const [width, height] of [
      [6001, 4003],
      [2048, 5003],
      [100, 200],
    ]) {
      const canvas = new OffscreenCanvas(width, height);
      canvas.getContext('2d')!.fillRect(0, 0, width, height);
      const source = await canvas.convertToBlob({ type: 'image/jpeg' });
      const result = await encodeThumbnail(source, 'image/jpeg');
      const image = await createImageBitmap(result);
      const scale = Math.min(1, 1280 / Math.max(width, height));
      results.push({
        actual: [image.width, image.height],
        expected: [Math.round(width * scale), Math.round(height * scale)],
      });
      image.close();
      canvas.width = 0;
      canvas.height = 0;
    }
    return results;
  });
  for (const result of results) expect(result.actual).toEqual(result.expected);
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const image = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      ),
      (c) => c.charCodeAt(0),
    );
    class TestFile {
      kind = 'file' as const;
      constructor(
        readonly name: string,
        private content: Uint8Array | string = image,
      ) {}
      async getFile() {
        return new File([this.content as BlobPart], this.name, {
          type: this.name.endsWith('.mp4') ? 'video/mp4' : 'image/png',
        });
      }
      async createWritable() {
        return {
          write: async (value: string) => {
            this.content = value;
            if (this.name === '.image-viewer.json')
              sessionStorage.setItem('image-viewer-test-config', value);
          },
          close: async () => undefined,
        };
      }
    }
    class TestDirectory {
      kind = 'directory' as const;
      entries = new Map<string, TestFile | TestDirectory>();
      constructor(readonly name: string) {}
      file(name: string) {
        this.entries.set(name, new TestFile(name));
      }
      directory(name: string) {
        const dir = new TestDirectory(name);
        this.entries.set(name, dir);
        return dir;
      }
      async *values() {
        yield* this.entries.values();
      }
      async getFileHandle(name: string, options?: { create?: boolean }) {
        let entry = this.entries.get(name);
        if (!entry && options?.create) {
          entry = new TestFile(name, '');
          this.entries.set(name, entry);
        }
        if (!(entry instanceof TestFile)) throw new DOMException('Not found', 'NotFoundError');
        return entry;
      }
      async getDirectoryHandle(name: string) {
        const entry = this.entries.get(name);
        if (!(entry instanceof TestDirectory)) throw new DOMException('Not found', 'NotFoundError');
        return entry;
      }
    }
    const root = new TestDirectory('books');
    root.file('2.png');
    root.file('10.png');
    root.file('cover.gif');
    root.file('clip.mp4');
    root.directory('chapter').file('nested.png');
    (window as unknown as { __imageViewerTestRoot: TestDirectory }).__imageViewerTestRoot = root;
    const savedConfig = sessionStorage.getItem('image-viewer-test-config');
    if (savedConfig)
      root.entries.set('.image-viewer.json', new TestFile('.image-viewer.json', savedConfig));
    Object.defineProperty(window, 'showDirectoryPicker', { value: async () => root });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'ルートフォルダを選択' }).click();
  await expect(page.locator('#current-dir-name')).toHaveText('books');
});

test('back and forward restore folders and viewer pages and discard a branched history', async ({
  page,
}) => {
  await page.locator('.directory-card[data-dir-name="chapter"] .dir-title').click();
  await expect(page.locator('#current-dir-name')).toHaveText('chapter');
  await page.locator('#search-input').fill('nested');
  await expect(page.locator('#item-list .media-card')).toHaveCount(1);
  await page.locator('#item-list .media-card').click();
  await expect(page.locator('#viewer')).toHaveCSS('display', 'flex');
  await page.keyboard.press('Alt+ArrowRight'); // No forward entry must not turn a page.
  await expect(page.locator('#page-counter')).toContainText('1 / 1');
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.locator('#viewer')).toHaveCSS('display', 'none');
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.locator('#current-dir-name')).toHaveText('books');
  await page.keyboard.press('Alt+ArrowRight');
  await expect(page.locator('#current-dir-name')).toHaveText('chapter');
  await expect(page.locator('#search-input')).toHaveValue('nested');
  await page.keyboard.press('Alt+ArrowRight');
  await expect(page.locator('#viewer')).toHaveCSS('display', 'flex');
  await expect(page.locator('#right-page')).toHaveJSProperty('naturalWidth', 1);
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.locator('#viewer')).toHaveCSS('display', 'none');
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.locator('#current-dir-name')).toHaveText('books');
  await page.locator('#item-list img[alt="10.png"]').click();
  await expect(page.locator('#viewer')).toHaveCSS('display', 'flex');
  await page.locator('#toggle-view-btn').click();
  await page.keyboard.press('ArrowLeft');
  const counter = await page.locator('#page-counter').textContent();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(page.locator('#page-counter')).toHaveText(counter!);
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.locator('#viewer')).toHaveCSS('display', 'none');
  await page.keyboard.press('Alt+ArrowRight');
  await expect(page.locator('#viewer')).toHaveCSS('display', 'flex');
  await expect(page.locator('#page-counter')).toHaveText(counter!);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Alt+ArrowRight');
  await expect(page.locator('#current-dir-name')).toHaveText('books');
  await expect(page.locator('#viewer')).toHaveCSS('display', 'none');
});

test('mouse buttons 3 and 4 navigate once per click in the browser', async ({ page }) => {
  await page.locator('.directory-card[data-dir-name="chapter"] .dir-title').click();
  await expect(page.locator('#current-dir-name')).toHaveText('chapter');
  await page.locator('#item-list .media-card').click();
  await expect(page.locator('#viewer')).toHaveCSS('display', 'flex');
  const mouseNavigation = (button: number) =>
    page.evaluate((button) => {
      for (const type of ['mousedown', 'mouseup', 'auxclick']) {
        const event = new MouseEvent(type, { button, bubbles: true, cancelable: true });
        if (document.dispatchEvent(event)) throw new Error(`${type} default was not prevented`);
      }
    }, button);
  await mouseNavigation(3);
  await expect(page.locator('#viewer')).toHaveCSS('display', 'none');
  await expect(page.locator('#current-dir-name')).toHaveText('chapter');
  await mouseNavigation(3);
  await expect(page.locator('#current-dir-name')).toHaveText('books');
  await mouseNavigation(4);
  await expect(page.locator('#current-dir-name')).toHaveText('chapter');
  await expect(page.locator('#viewer')).toHaveCSS('display', 'none');
  await mouseNavigation(4);
  await expect(page.locator('#viewer')).toHaveCSS('display', 'flex');
});

test('keeps thumbnails visible after scrolling through a large folder and back', async ({
  page,
}) => {
  await page.evaluate(() => {
    const state = window as unknown as {
      __imageViewerTestRoot: {
        file(name: string): void;
        entries: Map<string, { getFile(): Promise<File> }>;
      };
      __firstImageReads: number;
    };
    const root = state.__imageViewerTestRoot;
    const first = root.entries.get('2.png')!;
    const read = first.getFile.bind(first);
    state.__firstImageReads = 0;
    first.getFile = () => {
      state.__firstImageReads++;
      return read();
    };
    for (let index = 0; index < 1200; index++) root.file(`extra-${index}.png`);
  });
  await page.locator('#reload-btn').click();
  await expect(page.locator('#item-list')).toHaveAttribute('data-virtual', 'true');
  await expect.poll(() => page.locator('#item-list .item-card').count()).toBeLessThan(100);
  const images = page.locator('#item-list .media-card img');
  await expect(images.first()).toHaveJSProperty('naturalWidth', 1);
  await page.evaluate(() => {
    (window as unknown as { __unmountedThumb: Element }).__unmountedThumb = document.querySelector(
      '#item-list img[alt="2.png"]',
    )!;
  });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const lastImage = page.locator('#item-list img[alt="extra-1199.png"]');
  await expect(lastImage).toHaveJSProperty('naturalWidth', 1);
  await page.evaluate(() => {
    const thumbnail = (window as unknown as { __unmountedThumb: Element }).__unmountedThumb;
    if (thumbnail.isConnected) throw new Error('The first card should have been unmounted');
    thumbnail.dispatchEvent(new Event('error'));
  });
  await page.evaluate(() => {
    const image = document.querySelector<HTMLImageElement>('#item-list img[alt="extra-1199.png"]')!;
    Object.assign(window, {
      __retainedCard: image.closest('.item-card'),
      __retainedImage: image,
      __retainedSrc: image.src,
      __retainedScroll: window.scrollY,
    });
  });
  await lastImage.click();
  await expect(page.locator('#page-counter')).toContainText('1203 / 1203');
  await page.keyboard.press('Escape');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(
    await page.evaluate(() => {
      const saved = window as unknown as {
        __retainedCard: Element;
        __retainedImage: HTMLImageElement;
        __retainedSrc: string;
        __retainedScroll: number;
      };
      return {
        connected: saved.__retainedCard.isConnected && saved.__retainedImage.isConnected,
        sameUrl: saved.__retainedImage.src === saved.__retainedSrc,
        scrollDelta: Math.abs(window.scrollY - saved.__retainedScroll),
      };
    }),
  ).toEqual({ connected: true, sameUrl: true, scrollDelta: 0 });
  const readsBeforeReturning = await page.evaluate(
    () => (window as unknown as { __firstImageReads: number }).__firstImageReads,
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator('#item-list img[alt="2.png"]')).toHaveJSProperty('naturalWidth', 1);
  expect(
    await page.evaluate(
      () => (window as unknown as { __firstImageReads: number }).__firstImageReads,
    ),
  ).toBe(readsBeforeReturning);
  await expect(lastImage).toHaveCount(0);
  await page.locator('#search-input').fill('extra-1199');
  await expect(page.locator('#item-list .item-card')).toHaveCount(1);
  await expect(page.locator('#item-list')).not.toHaveAttribute('data-virtual', 'true');
});

test('shows a cached thumbnail during full-image decoding and reuses the decoded page on reopen', async ({
  page,
}) => {
  const thumbnail = page.locator('#item-list img[alt="2.png"]');
  await expect(thumbnail).toHaveJSProperty('naturalWidth', 1);
  await page.evaluate(() => {
    const original = HTMLImageElement.prototype.decode;
    let release!: () => void;
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    Object.assign(window, { __releaseDecode: release, __viewerDecodes: 0 });
    HTMLImageElement.prototype.decode = async function () {
      (window as unknown as { __viewerDecodes: number }).__viewerDecodes++;
      await paused;
      return original.call(this);
    };
  });
  await thumbnail.click();
  await expect(page.locator('#viewer .viewer-loading')).toBeVisible();
  await expect(page.locator('#right-page')).toHaveJSProperty('naturalWidth', 1);
  await expect(page.locator('#left-page')).toHaveJSProperty('naturalWidth', 1);
  await page.evaluate(() => (window as unknown as { __releaseDecode(): void }).__releaseDecode());
  await expect(page.locator('#viewer .viewer-loading')).toBeHidden();
  const originalUrl = await page.locator('#right-page').getAttribute('src');
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __viewerDecodes: number }).__viewerDecodes),
    )
    .toBe(3);
  await page.keyboard.press('Escape');
  await thumbnail.click();
  await expect(page.locator('#right-page')).toHaveAttribute('src', originalUrl!);
  expect(
    await page.evaluate(() => (window as unknown as { __viewerDecodes: number }).__viewerDecodes),
  ).toBe(3);
});

test('virtual rows preserve original aspect ratios across resizing and returning to a distant folder', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1360, height: 720 });
  await page.evaluate(async () => {
    const root = (
      window as unknown as {
        __imageViewerTestRoot: {
          entries: Map<string, unknown>;
          file(name: string): void;
          directory(name: string): { file(name: string): void };
        };
      }
    ).__imageViewerTestRoot;
    for (let i = 0; i < 500; i++) root.file(`extra-${i}.png`);
    root.directory('zz-folder').file('child.png');
    for (const [name, width, height] of [
      ['zz-landscape.png', 400, 100],
      ['zz-portrait.png', 100, 400],
    ] as const) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!)));
      root.entries.set(name, {
        kind: 'file',
        name,
        getFile: async () => new File([blob], name, { type: 'image/png' }),
      });
    }
  });
  await page.locator('#reload-btn').click();
  await expect(page.locator('#item-list')).toHaveAttribute('data-virtual', 'true');
  await page.locator('#size-select').selectOption('3');
  await expect
    .poll(() =>
      page
        .locator('#item-list .virtual-gallery-row')
        .first()
        .evaluate((row) => getComputedStyle(row).gridTemplateColumns.split(' ').length),
    )
    .toBe(4);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const portrait = page.locator('#item-list img[alt="zz-portrait.png"]');
  const landscape = page.locator('#item-list img[alt="zz-landscape.png"]');
  await expect(portrait).toHaveJSProperty('naturalHeight', 400);
  await expect(landscape).toHaveJSProperty('naturalWidth', 400);
  const ratio = (locator: typeof portrait) =>
    locator.evaluate((image) => image.clientHeight / image.clientWidth);
  await expect.poll(() => ratio(portrait)).toBeCloseTo(4, 1);
  await expect.poll(() => ratio(landscape)).toBeCloseTo(0.25, 1);
  await page.setViewportSize({ width: 800, height: 720 });
  await expect
    .poll(() =>
      page
        .locator('#item-list .virtual-gallery-row')
        .first()
        .evaluate((row) => getComputedStyle(row).gridTemplateColumns.split(' ').length),
    )
    .toBe(2);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(portrait).toHaveJSProperty('naturalHeight', 400);
  await expect.poll(() => ratio(portrait)).toBeCloseTo(4, 1);
  await page.locator('#item-list .directory-card[data-dir-name="zz-folder"] .dir-title').click();
  await expect(page.locator('#current-dir-name')).toHaveText('zz-folder');
  await page.getByRole('button', { name: '上の階層へ', exact: true }).click();
  const folder = page.locator('#item-list .directory-card[data-dir-name="zz-folder"]');
  await expect(folder).toBeInViewport();
  await expect.poll(() => page.locator('#item-list .item-card').count()).toBeLessThan(100);
});

test('keeps the complete recursive order when virtual cards are hidden or favorited', async ({
  page,
}) => {
  // Configure through the control: persisted storage is read only during startup.
  await page.locator('#toggle-view-btn').dispatchEvent('click');
  await page.evaluate(() => {
    const root = (
      window as unknown as {
        __imageViewerTestRoot: { directory(name: string): { file(name: string): void } };
      }
    ).__imageViewerTestRoot;
    const child = root.directory('bulk');
    for (let i = 0; i < 500; i++) child.file(`zz-item-${i}.png`);
  });
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#recursive-btn').click();
  await expect(page.locator('#item-list')).toHaveAttribute('data-virtual', 'true');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const last = page.locator('#item-list .media-card', {
    has: page.locator('img[alt="zz-item-499.png"]'),
  });
  await expect(last.locator('img')).toHaveJSProperty('naturalWidth', 1);
  await last.click();
  await expect(page.locator('#page-counter')).toHaveText('502 / 504');
  await page.keyboard.press('Escape');
  await last.locator('.hidden-toggle-btn').click();
  await expect(last).toHaveCount(0);
  const previous = page.locator('#item-list .media-card', {
    has: page.locator('img[alt="zz-item-498.png"]'),
  });
  await expect(previous.locator('img')).toHaveJSProperty('naturalWidth', 1);
  await previous.click();
  await expect(page.locator('#page-counter')).toHaveText('501 / 503');
  await page.keyboard.press('Escape');
  await previous.locator('.favorite-btn').click();
  await expect(previous.locator('.favorite-btn')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#favorite-only-btn').click();
  await expect(page.locator('#item-list .media-card')).toHaveCount(1);
  await expect(previous.locator('img')).toHaveJSProperty('naturalWidth', 1);
});

test('keeps wheel scrolling uninterrupted when offscreen thumbnails finish loading', async ({
  page,
}) => {
  await expect(page.locator('#item-list img[alt="2.png"]')).toHaveJSProperty('naturalWidth', 1);
  await page.evaluate(async () => {
    const modulePath = '/src/features/gallery/virtualGallery.ts';
    const { createVirtualGallery } = (await import(
      modulePath
    )) as typeof import('../../src/features/gallery/virtualGallery');
    const container = document.querySelector<HTMLElement>('#item-list')!;
    container.replaceChildren();
    const grown = new Set<number>();
    const view = createVirtualGallery(
      container,
      3000,
      (index: number, row: HTMLElement) => {
        const card = document.createElement('div');
        card.className = 'item-card';
        card.style.height = `${grown.has(index) ? 360 : 180}px`;
        card.textContent = String(index);
        row.append(card);
        return card;
      },
      () => {},
      () => true,
      () => 180,
    );
    const state = window as unknown as {
      __finishVirtualThumbnails: () => void;
      __virtualScrollCalls: number;
    };
    state.__virtualScrollCalls = 0;
    state.__finishVirtualThumbnails = () => {
      const nativeScrollTo = window.scrollTo.bind(window);
      window.scrollTo = ((...args: [number, number]) => {
        state.__virtualScrollCalls++;
        nativeScrollTo(...args);
      }) as typeof window.scrollTo;
      for (const card of container.querySelectorAll<HTMLElement>('[data-item-index]')) {
        if (card.getBoundingClientRect().bottom < 0) {
          grown.add(Number(card.dataset.itemIndex));
          card.style.height = '360px';
        }
      }
    };
    window.addEventListener('beforeunload', () => view.dispose(), { once: true });
    window.scrollTo(0, 6000);
  });
  await page.mouse.move(600, 400);
  await page.mouse.wheel(0, 400);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(6000);
  const lowerPosition = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, -240);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(lowerPosition);
  const anchor = await page.locator('#item-list [data-item-index]').evaluateAll((cards) => {
    const card = cards.find((card) => card.getBoundingClientRect().bottom > 0)! as HTMLElement;
    return { index: card.dataset.itemIndex!, top: card.getBoundingClientRect().top };
  });
  await page.evaluate(async () => {
    (window as unknown as { __finishVirtualThumbnails: () => void }).__finishVirtualThumbnails();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const anchoredCard = page.locator(`#item-list [data-item-index="${anchor.index}"]`);
  await expect
    .poll(() =>
      anchoredCard.evaluate(
        (card, top) => Math.abs(card.getBoundingClientRect().top - top),
        anchor.top,
      ),
    )
    .toBeLessThan(2);
  expect(
    await page.evaluate(
      () => (window as unknown as { __virtualScrollCalls: number }).__virtualScrollCalls,
    ),
  ).toBe(0);
  const position = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, -300);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(position - 200);
});

test('shows an image while the recursive list is still scanning', async ({ page }) => {
  await page.evaluate(() => {
    const root = (
      window as unknown as {
        __imageViewerTestRoot: { entries: Map<string, { values(): AsyncIterable<unknown> }> };
      }
    ).__imageViewerTestRoot;
    const child = root.entries.get('chapter')!;
    const originalValues = child.values.bind(child);
    child.values = async function* () {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      yield* originalValues();
    };
  });
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#recursive-btn').click();
  await expect(page.locator('.scan-preview')).toBeVisible();
  await page.locator('.scan-preview').click();
  await expect(page.locator('#viewer')).toHaveCSS('display', 'flex');
  await expect(page.locator('#item-list .media-card')).toHaveCount(4);
  await expect(page.locator('.scan-preview')).toHaveCount(0);
});

test('filters, searches and opens the displayed image', async ({ page }) => {
  await expect(page.locator('#item-list .item-card')).toHaveCount(5);
  const layoutBefore = await page.evaluate(() => {
    const ids = [
      'search-input',
      'filter-select',
      'favorite-only-btn',
      'toggle-sort-btn',
      'favorite-first-btn',
      'size-select',
      'ui-visibility-btn',
    ];
    const rects = ids.map((id) => {
      const rect = document.getElementById(id)!.getBoundingClientRect();
      return { id, top: Math.round(rect.top), height: Math.round(rect.height) };
    });
    const selectStyle = getComputedStyle(document.getElementById('filter-select')!);
    return { rects, color: selectStyle.color, bg: selectStyle.backgroundColor };
  });
  for (const item of layoutBefore.rects) {
    expect(item.height, `${item.id} height`).toBe(layoutBefore.rects[0].height);
    expect(item.top, `${item.id} single-row top`).toBe(layoutBefore.rects[0].top);
  }
  await page.locator('#filter-select').selectOption('image');
  const styleAfter = await page.evaluate(() => {
    const selectStyle = getComputedStyle(document.getElementById('filter-select')!);
    const optionStyle = getComputedStyle(
      document.querySelector('#filter-select option[value="image"]')!,
    );
    return {
      color: selectStyle.color,
      bg: selectStyle.backgroundColor,
      optionColor: optionStyle.color,
      optionBg: optionStyle.backgroundColor,
    };
  });
  expect(styleAfter.color).toBe(layoutBefore.color);
  expect(styleAfter.bg).toBe(layoutBefore.bg);
  expect(styleAfter.optionColor).toBe(layoutBefore.color);
  expect(styleAfter.optionBg).toBe(layoutBefore.bg);
  await expect(page.locator('#item-list .media-card')).toHaveCount(3);
  await page.locator('#search-input').fill('10');
  await expect(page.locator('#item-list .media-card')).toHaveCount(1);
  await page.locator('#item-list .media-card').click();
  await expect(page.locator('#viewer')).toHaveCSS('display', 'flex');
  await expect(page.locator('#page-counter')).toContainText('/ 1');
  await page.keyboard.press('Escape');
  await expect(page.locator('#viewer')).toHaveCSS('display', 'none');
});

test('opens child images in recursive mode and returns to the normal list', async ({ page }) => {
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '全画像一覧' }).click();
  await expect(page.locator('#item-list .media-card')).toHaveCount(4);
  await expect(page.locator('#item-list img[alt="nested.png"]')).toHaveCount(1);
  await page.getByRole('button', { name: '通常', exact: true }).click();
  await expect(page.locator('#item-list .item-card')).toHaveCount(5);
});

test('navigates across the favorite boundary in the all-images list', async ({ page }) => {
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '全画像一覧' }).click();
  const nested = page.locator('#item-list .media-card', {
    has: page.locator('img[alt="nested.png"]'),
  });
  await nested.locator('.favorite-btn').click();
  await page.locator('#favorite-first-btn').click();
  await expect
    .poll(() =>
      page
        .locator('#item-list .media-card img')
        .evaluateAll((images) => images.map((image) => image.getAttribute('alt'))),
    )
    .toEqual(['nested.png', '2.png', '10.png', 'cover.gif']);

  await page.locator('#item-list .media-card').first().click();
  await page.locator('#toggle-view-btn').click();
  await expect(page.locator('#page-counter')).toHaveText('1 / 4');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#page-counter')).toHaveText('2 / 4');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#page-counter')).toHaveText('1 / 4');
});

test('reuses recursive scans for view controls and rescans changed files on reload', async ({
  page,
}) => {
  // 初期表示のフォルダープレビューが終わってから再帰走査の回数を測る。
  await expect(page.locator('#item-list .directory-card img')).toHaveJSProperty('naturalWidth', 1);
  await page.evaluate(() => {
    type Directory = {
      values(): AsyncIterable<unknown>;
      entries: Map<string, unknown>;
      file(name: string): void;
    };
    const root = (window as unknown as { __imageViewerTestRoot: Directory }).__imageViewerTestRoot;
    const state = window as unknown as { __recursiveReads: number };
    state.__recursiveReads = 0;
    for (const directory of [root, root.entries.get('chapter') as Directory]) {
      const original = directory.values.bind(directory);
      directory.values = async function* () {
        state.__recursiveReads++;
        yield* original();
      };
    }
  });
  const reads = () =>
    page.evaluate(() => (window as unknown as { __recursiveReads: number }).__recursiveReads);
  const names = () =>
    page
      .locator('#item-list .media-card img')
      .evaluateAll((images) => images.map((image) => image.getAttribute('alt')));
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#recursive-btn').click();
  await expect.poll(names).toEqual(['2.png', '10.png', 'nested.png', 'cover.gif']);
  expect(await reads()).toBe(2);
  await page.locator('#search-input').fill('nested');
  await expect.poll(names).toEqual(['nested.png']);
  await page.locator('#search-input').fill('');
  await expect.poll(names).toHaveLength(4);
  await page.locator('#toggle-sort-btn').click();
  await expect.poll(names).toEqual(['cover.gif', 'nested.png', '10.png', '2.png']);
  await page.locator('#filter-select').selectOption('gif');
  await expect.poll(names).toEqual(['cover.gif']);
  await page.locator('#filter-select').selectOption('image');
  await expect.poll(names).toHaveLength(4);
  const nested = page.locator('#item-list .media-card', {
    has: page.locator('img[alt="nested.png"]'),
  });
  await nested.locator('.favorite-btn').click();
  await expect(nested.locator('.favorite-btn')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#favorite-only-btn').click();
  await expect.poll(names).toEqual(['nested.png']);
  await page.locator('#favorite-only-btn').click();
  await expect.poll(names).toHaveLength(4);
  await nested.locator('.hidden-toggle-btn').click();
  await expect.poll(names).toHaveLength(3);
  await page.locator('#toggle-sort-btn').click();
  await expect.poll(names).toEqual(['2.png', '10.png', 'cover.gif']);
  expect(await reads()).toBe(2);

  await page.evaluate(() => {
    type Directory = { entries: Map<string, unknown>; file(name: string): void };
    const root = (window as unknown as { __imageViewerTestRoot: Directory }).__imageViewerTestRoot;
    root.entries.delete('2.png');
    (root.entries.get('chapter') as Directory).file('new.png');
  });
  await page.locator('#reload-btn').click();
  await expect.poll(names).toEqual(['10.png', 'new.png', 'cover.gif']);
  expect(await reads()).toBe(4);
});

test('favorites can be shown alone and survive another directory render', async ({ page }) => {
  const cover = page.locator('#item-list .media-card', {
    has: page.locator('img[alt="cover.gif"]'),
  });
  await cover.locator('.favorite-btn').click();
  await page.locator('#favorite-only-btn').click();
  await expect(page.locator('#item-list .item-card')).toHaveCount(1);
  await expect(page.locator('#item-list img[alt="cover.gif"]')).toHaveCount(1);
  await page.locator('#favorite-only-btn').click();
  await expect(page.locator('#item-list .item-card')).toHaveCount(5);
  await expect(
    page
      .locator('#item-list .media-card', { has: page.locator('img[alt="cover.gif"]') })
      .locator('.favorite-btn'),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('sorts numeric filenames and moves through images right to left', async ({ page }) => {
  await page.locator('#filter-select').selectOption('image');
  const visibleNames = () =>
    page
      .locator('#item-list .media-card img')
      .evaluateAll((images) => images.map((image) => image.getAttribute('alt')));
  await expect.poll(visibleNames).toEqual(['2.png', '10.png', 'cover.gif']);
  await page.locator('#toggle-sort-btn').click();
  await expect.poll(visibleNames).toEqual(['cover.gif', '10.png', '2.png']);
  await page.locator('#item-list .media-card').first().click();
  await page.locator('#toggle-view-btn').click();
  await expect(page.locator('#page-counter')).toHaveText('1 / 3');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#page-counter')).toHaveText('2 / 3');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#page-counter')).toHaveText('1 / 3');
});

test('hides an item in a child directory and finds it in the hidden view', async ({ page }) => {
  await page.locator('#item-list .directory-card .thumbnail-container').click();
  await expect(page.locator('#current-dir-name')).toHaveText('chapter');
  await expect(page.locator('#item-list img[alt="nested.png"]')).toHaveCount(1);
  await page.locator('#item-list .hidden-toggle-btn').click();
  await expect(page.locator('#item-list .media-card')).toHaveCount(0);
  await page.locator('#hidden-mode-btn').click();
  await expect(page.locator('#item-list img[alt="nested.png"]')).toHaveCount(1);
  await page.locator('#hidden-mode-btn').click();
  await expect(page.locator('#item-list .media-card')).toHaveCount(0);
});

test('restores saved sorting and filtering when the folder is opened again', async ({ page }) => {
  await page.locator('#filter-select').selectOption('gif');
  await page.locator('#toggle-sort-btn').click();
  await expect(page.locator('#item-list img[alt="cover.gif"]')).toHaveCount(1);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (JSON.parse(sessionStorage.getItem('image-viewer-test-config') || '{}') as ConfigNode)
            .settings,
      ),
    )
    .toMatchObject({
      filterType: 'gif',
      sortOrder: 'desc',
    });
  await page.reload();
  await page.getByRole('button', { name: 'ルートフォルダを選択' }).click();
  await expect(page.locator('#filter-select')).toHaveValue('gif');
  await expect(page.locator('#toggle-sort-btn')).toContainText('降順');
  await expect(page.locator('#item-list img[alt="cover.gif"]')).toHaveCount(1);
});

test('keeps config reads out of search and sorting and reloads only on explicit refresh', async ({
  page,
}) => {
  await page
    .locator('#item-list .media-card', { has: page.locator('img[alt="cover.gif"]') })
    .locator('.favorite-btn')
    .click();
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('image-viewer-test-config')))
    .not.toBeNull();
  await page.evaluate(() => {
    type TestFile = { getFile(): Promise<File> };
    const state = window as unknown as {
      __imageViewerTestRoot: { entries: Map<string, TestFile> };
      __configReads: number;
    };
    state.__configReads = 0;
    const file = state.__imageViewerTestRoot.entries.get('.image-viewer.json')!;
    const original = file.getFile.bind(file);
    file.getFile = async () => {
      state.__configReads++;
      return original();
    };
  });
  await page.locator('#search-input').fill('cover');
  await expect(page.locator('#item-list .media-card')).toHaveCount(1);
  await page.locator('#toggle-sort-btn').click();
  await expect(page.locator('#toggle-sort-btn')).toContainText('降順');
  const reads = () =>
    page.evaluate(() => (window as unknown as { __configReads: number }).__configReads);
  expect(await reads()).toBe(0);
  await page.locator('#reload-btn').click();
  await expect.poll(reads).toBe(1);
});

test('saves settings to the original folder when navigating before the save delay', async ({
  page,
}) => {
  await page.locator('.directory-card[data-dir-name="chapter"] .dir-title').click();
  await expect(page.locator('#current-dir-name')).toHaveText('chapter');
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('#toggle-sort-btn')!.click();
    document.querySelector<HTMLButtonElement>('#up-dir-btn')!.click();
  });
  await expect(page.locator('#current-dir-name')).toHaveText('books');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const config = JSON.parse(
          sessionStorage.getItem('image-viewer-test-config') || '{}',
        ) as ConfigNode;
        return {
          child: config.directories?.chapter?.settings.sortOrder,
          root: config.settings?.sortOrder,
        };
      }),
    )
    .toEqual({ child: 'desc', root: undefined });
});

test('preloads decoded neighboring pages and reuses their sources when navigating back', async ({
  page,
}) => {
  // Configure through the control: persisted storage is read only during startup.
  await page.locator('#toggle-view-btn').dispatchEvent('click');
  await page.locator('#filter-select').selectOption('image');
  await expect
    .poll(() =>
      page
        .locator('#item-list .media-card img')
        .evaluateAll(
          (images) =>
            images.length === 3 &&
            images.every((image) => (image as HTMLImageElement).naturalWidth === 1),
        ),
    )
    .toBe(true);
  await page.evaluate(() => {
    type TestFile = { getFile(): Promise<File> };
    const state = window as unknown as {
      __imageViewerTestRoot: { entries: Map<string, TestFile> };
      __pageReads: Record<string, number>;
      __pageDecodes: number;
    };
    state.__pageReads = {};
    state.__pageDecodes = 0;
    const decode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = async function () {
      state.__pageDecodes++;
      return decode.call(this);
    };
    for (const name of ['2.png', '10.png', 'cover.gif']) {
      const file = state.__imageViewerTestRoot.entries.get(name)!;
      const original = file.getFile.bind(file);
      file.getFile = async () => {
        state.__pageReads[name] = (state.__pageReads[name] || 0) + 1;
        return original();
      };
    }
  });
  await page.locator('#item-list .media-card').first().click();
  await expect(page.locator('#page-counter')).toHaveText('1 / 3');
  await expect(page.locator('#right-page')).toHaveJSProperty('naturalWidth', 1);
  const firstUrl = await page.locator('#right-page').getAttribute('src');
  const reads = () =>
    page.evaluate(() => (window as unknown as { __pageReads: Record<string, number> }).__pageReads);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __pageDecodes: number }).__pageDecodes))
    .toBe(3);
  expect(await reads()).toEqual({});
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#page-counter')).toHaveText('2 / 3');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#page-counter')).toHaveText('1 / 3');
  await expect(page.locator('#right-page')).toHaveAttribute('src', firstUrl!);
  expect(await reads()).toEqual({});
});

test('keeps the latest page when an older page decode finishes after rapid navigation', async ({
  page,
}) => {
  // Configure through the control: persisted storage is read only during startup.
  await page.locator('#toggle-view-btn').dispatchEvent('click');
  await page.locator('#filter-select').selectOption('image');
  await expect
    .poll(() =>
      page
        .locator('#item-list .media-card img')
        .evaluateAll(
          (images) =>
            images.length === 3 &&
            images.every((image) => (image as HTMLImageElement).naturalWidth === 1),
        ),
    )
    .toBe(true);
  await page.evaluate(() => {
    const state = window as unknown as {
      __imageViewerTestRoot: { entries: Map<string, { getFile(): Promise<File> }> };
      __releaseSlowPage: () => void;
      __slowPageFinished: boolean;
    };
    const decode = HTMLImageElement.prototype.decode;
    let calls = 0;
    const paused = new Promise<void>((resolve) => {
      state.__releaseSlowPage = resolve;
    });
    HTMLImageElement.prototype.decode = async function () {
      const slow = ++calls === 2;
      if (slow) await paused;
      await decode.call(this);
      if (slow) state.__slowPageFinished = true;
    };
  });
  await page.locator('#item-list .media-card').first().click();
  await expect(page.locator('#page-counter')).toHaveText('1 / 3');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#page-counter')).toHaveText('3 / 3');
  const latestUrl = await page.locator('#right-page').getAttribute('src');
  await page.evaluate(() =>
    (window as unknown as { __releaseSlowPage: () => void }).__releaseSlowPage(),
  );
  await expect
    .poll(() =>
      page.evaluate(async () => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return (window as unknown as { __slowPageFinished: boolean }).__slowPageFinished;
      }),
    )
    .toBe(true);
  await expect(page.locator('#right-page')).toHaveAttribute('src', latestUrl!);
  await expect(page.locator('#page-counter')).toHaveText('3 / 3');
});

test('reuses reduced thumbnails, keeps full viewer resolution and refreshes replaced originals', async ({
  page,
}) => {
  // Configure through the control: persisted storage is read only during startup.
  await page.locator('#toggle-view-btn').dispatchEvent('click');
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 3000;
    canvas.height = 1500;
    canvas.getContext('2d')!.fillRect(0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((result) => resolve(result!), 'image/jpeg'),
    );
    const state = window as unknown as {
      __imageViewerTestRoot: { entries: Map<string, unknown> };
      __largeFile: File;
      __largeReads: number;
    };
    state.__largeFile = new File([blob], 'large.jpg', { type: 'image/jpeg' });
    state.__largeReads = 0;
    state.__imageViewerTestRoot.entries.set('large.jpg', {
      kind: 'file',
      name: 'large.jpg',
      getFile: async () => {
        state.__largeReads++;
        return state.__largeFile;
      },
    });
  });
  await page.locator('#reload-btn').click();
  const thumbnail = page.locator('#item-list img[alt="large.jpg"]');
  await expect(thumbnail).toHaveJSProperty('naturalWidth', 1280);
  await expect(thumbnail).toHaveJSProperty('naturalHeight', 640);
  const reads = () =>
    page.evaluate(() => (window as unknown as { __largeReads: number }).__largeReads);
  expect(await reads()).toBe(1);
  await page.locator('#toggle-sort-btn').click();
  await expect(thumbnail).toHaveJSProperty('naturalWidth', 1280);
  expect(await reads()).toBe(1);
  await page.locator('#size-select').selectOption('5');
  await expect(page.locator('#item-list')).toHaveClass(/original-aspect/);
  await expect(thumbnail).toHaveJSProperty('naturalHeight', 640);
  await thumbnail.click();
  await expect(page.locator('#right-page')).toHaveJSProperty('naturalWidth', 3000);
  await expect(page.locator('#right-page')).toHaveJSProperty('naturalHeight', 1500);
  await page.keyboard.press('Escape');
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4000;
    canvas.height = 1000;
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((result) => resolve(result!), 'image/jpeg'),
    );
    (window as unknown as { __largeFile: File }).__largeFile = new File([blob], 'large.jpg', {
      type: 'image/jpeg',
    });
  });
  await page.locator('#reload-btn').click();
  await expect(thumbnail).toHaveJSProperty('naturalWidth', 1280);
  await expect(thumbnail).toHaveJSProperty('naturalHeight', 320);
});

for (const single of [false, true]) {
  for (const [width, height] of [
    [120, 300],
    [300, 120],
  ]) {
    test(`closes from image margins while preserving image and toolbar clicks (${single ? 'single' : 'spread'}, ${width}x${height})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.evaluate(
        async ({ width, height }) => {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const blob = await new Promise<Blob>((resolve) =>
            canvas.toBlob((blob) => resolve(blob!)),
          );
          const root = (
            window as unknown as {
              __imageViewerTestRoot: { entries: Map<string, unknown> };
            }
          ).__imageViewerTestRoot;
          root.entries.delete('cover.gif');
          for (const name of ['2.png', '10.png'])
            root.entries.set(name, {
              kind: 'file',
              name,
              getFile: async () => new File([blob], name, { type: 'image/png' }),
            });
        },
        { width, height },
      );
      await page.locator('#reload-btn').click();
      await page.locator('.media-card[title="2.png"]').click();
      if ((await page.locator('#toggle-view-btn').textContent())?.includes('単一') === single)
        await page.locator('#toggle-view-btn').click();
      const image = page.locator('#right-page');
      await expect(image).toHaveJSProperty('naturalWidth', width);
      await image.click();
      await page.locator('#page-counter').click();
      await page.locator('#prev-btn').click();
      await expect(page.locator('#viewer')).toBeVisible();
      await expect(image).toHaveJSProperty('naturalWidth', width);
      const margin = await image.evaluate((element: HTMLImageElement) => {
        const box = element.getBoundingClientRect();
        const scale = Math.min(
          box.width / element.naturalWidth,
          box.height / element.naturalHeight,
        );
        if (box.width - element.naturalWidth * scale > 2)
          return { x: box.x + 1, y: box.y + box.height / 2 };
        if (box.height - element.naturalHeight * scale > 2)
          return { x: box.x + box.width / 2, y: box.y + 1 };
        return { x: box.x - 5, y: box.y + box.height / 2 };
      });
      await page.mouse.click(margin.x, margin.y);
      await expect(page.locator('#viewer')).toBeHidden();
    });
  }
}

test('closes from the viewer background and an empty spread page', async ({ page }) => {
  await page.locator('.directory-card[data-dir-name="chapter"] .dir-title').click();
  const card = page.locator('#item-list .media-card');
  await card.click();
  await page.locator('#viewer').click({ position: { x: 1, y: 1 } });
  await expect(page.locator('#viewer')).toBeHidden();
  await card.click();
  if ((await page.locator('#toggle-view-btn').textContent())?.includes('見開き'))
    await page.locator('#toggle-view-btn').click();
  await page.locator('#fullscreen-btn').click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await expect(page.locator('#left-page')).toBeHidden();
  await page.locator('#viewer-pages .page-container').first().click();
  await expect(page.locator('#viewer')).toBeHidden();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
});

test('opens video in the player and closes it with Escape or a background click', async ({
  page,
}) => {
  await page.locator('#filter-select').selectOption('video');
  await expect(page.locator('#item-list .media-card')).toHaveCount(1);
  await page.locator('#item-list .media-card').click();
  await expect(page.locator('#viewer-video-container')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#viewer')).toHaveCSS('display', 'none');
  await page.locator('#item-list .media-card').click();
  await page.locator('#viewer-video').click();
  await expect(page.locator('#viewer')).toBeVisible();
  await page.locator('#viewer-video-container').click({ position: { x: 32, y: 32 } });
  await expect(page.locator('#viewer')).toBeHidden();
});

for (const originalAspect of [false, true]) {
  for (const hiddenUi of [false, true]) {
    test(`recursive scrolling keeps row order when reversing direction (${originalAspect ? 'original aspect' : 'fixed aspect'}, UI ${hiddenUi ? 'hidden' : 'visible'})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.evaluate(async () => {
        const root = (
          window as unknown as {
            __imageViewerTestRoot: { directory(name: string): { entries: Map<string, unknown> } };
          }
        ).__imageViewerTestRoot;
        const bulk = root.directory('bulk');
        const images: Blob[] = [];
        for (const [width, height] of [
          [400, 100],
          [100, 400],
          [240, 180],
        ]) {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          images.push(
            await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!))),
          );
        }
        for (let index = 0; index < 1800; index++) {
          const name = `image-${index}.png`;
          bulk.entries.set(name, {
            kind: 'file',
            name,
            getFile: async () => {
              await new Promise((resolve) => setTimeout(resolve, (index % 3) * 10));
              return new File([images[index % images.length]], name, { type: 'image/png' });
            },
          });
        }
      });
      await page.locator('#size-select').selectOption(originalAspect ? '3' : '1');
      page.once('dialog', (dialog) => dialog.accept());
      await page.locator('#recursive-btn').click();
      await expect(page.locator('#item-list')).toHaveAttribute('data-virtual', 'true');
      if (hiddenUi) await page.locator('#ui-visibility-btn').click();
      await page.evaluate(() => {
        const state = window as unknown as { __emptyGalleryFrames: number };
        state.__emptyGalleryFrames = 0;
        window.addEventListener('scroll', () =>
          requestAnimationFrame(() => {
            if (
              Array.from(document.querySelectorAll('#item-list .gallery-slot')).some(
                (slot) => !slot.firstElementChild,
              )
            )
              state.__emptyGalleryFrames++;
          }),
        );
      });
      await page.evaluate(() => window.scrollTo(0, 20000));
      await page.mouse.move(600, 400);
      for (const delta of [800, 800, ...Array<number>(12).fill(originalAspect ? -600 : -240)]) {
        const before = await page.evaluate(() => window.scrollY);
        await page.mouse.wheel(0, delta);
        await expect.poll(() => page.evaluate(() => window.scrollY)).not.toBe(before);
        await page.evaluate(
          () =>
            new Promise<void>((resolve) => {
              requestAnimationFrame(() =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
              );
            }),
        );
        const snapshot = await page.evaluate(() => ({
          y: window.scrollY,
          order: Array.from(
            document.querySelectorAll<HTMLElement>('#item-list [data-item-index]'),
            (element) => Number(element.dataset.itemIndex),
          ),
        }));
        expect(snapshot.y).toBeGreaterThan(10000);
        expect(snapshot.order).toEqual([...snapshot.order].sort((a, b) => a - b));
      }
      await expect(page.locator('#status-area')).not.toContainText('読み込んでいます');
      expect(
        await page.evaluate(
          () => (window as unknown as { __emptyGalleryFrames: number }).__emptyGalleryFrames,
        ),
      ).toBe(0);
    });
  }
}

test('central settings validate, persist and restore cache budgets', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '設定', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '設定' });
  await expect(dialog).toBeVisible();
  const budget = dialog.getByRole('spinbutton', { name: 'サムネイルのメモリの最大容量（MiB）' });
  await budget.fill('24');
  await dialog.getByRole('button', { name: '容量設定を保存' }).click();
  await expect(dialog.getByRole('status', { name: '容量設定の保存状況' })).toHaveText(
    '保存しました。',
  );
  await page.reload();
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await expect(budget).toHaveValue('24');
  await expect(dialog).not.toContainText('サムネイルのディスク');
  await budget.fill('-1');
  await dialog.getByRole('button', { name: '容量設定を保存' }).click();
  expect(await budget.evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(false);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('PDF thumbnails and single/spread navigation stay within the selected document', async ({
  page,
}) => {
  await page.evaluate((content) => {
    const { __imageViewerTestRoot: root } = window as unknown as {
      __imageViewerTestRoot: { entries: Map<string, unknown> };
    };
    for (const name of ['book.PDF', 'other.pdf'])
      root.entries.set(name, {
        kind: 'file',
        name,
        getFile: async () => new File([content], name, { type: 'application/pdf' }),
      });
    root.entries.set('broken.pdf', {
      kind: 'file',
      name: 'broken.pdf',
      getFile: async () => new File(['invalid pdf'], 'broken.pdf'),
    });
  }, samplePdf());
  await page.locator('#reload-btn').click();
  await page.locator('#filter-select').selectOption('pdf');
  await expect(page.locator('.media-card')).toHaveCount(3);
  const card = page.locator('.media-card').filter({ has: page.locator('img[alt="book.PDF"]') });
  await expect(card).toHaveAttribute('data-thumb-ready', 'true');
  await card.click();
  await expect(page.locator('#page-counter')).toHaveText('2 - 1 / 3');
  const color = (selector: string) =>
    page.locator(selector).evaluate((image: HTMLImageElement) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, image.naturalWidth / 2, image.naturalHeight / 2, 1, 1, 0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
    });
  await expect.poll(() => color('#right-page')).toEqual([255, 0, 0]);
  await expect.poll(() => color('#left-page')).toEqual([0, 255, 0]);
  const whiteTextPixels = await page.locator('#right-page').evaluate((image: HTMLImageElement) => {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 300;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0, 200, 300);
    const pixels = context.getImageData(20, 260, 70, 25).data;
    let white = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > 220 && pixels[i + 1] > 220 && pixels[i + 2] > 220) white++;
    }
    return white;
  });
  expect(whiteTextPixels).toBeGreaterThan(20);
  await page.locator('#toggle-view-btn').click();
  await expect(page.locator('#page-counter')).toHaveText('1 / 3');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#page-counter')).toHaveText('2 / 3');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#page-counter')).toHaveText('3 / 3');
  await expect.poll(() => color('#right-page')).toEqual([0, 0, 255]);
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#page-counter')).toHaveText('1 / 3');
  await page.locator('#toggle-view-btn').click();
  await page.locator('#adjust-spread-btn').click();
  await expect(page.locator('#page-counter')).toHaveText('1 - - / 3');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#page-counter')).toHaveText('3 - 2 / 3');
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.locator('#viewer')).toBeHidden();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(page.locator('#page-counter')).toHaveText('3 - 2 / 3');
  await page.locator('#right-page').click();
  await expect(page.locator('#viewer')).toBeVisible();
  await page.locator('#viewer').click({ position: { x: 1, y: 1 } });
  await expect(page.locator('#viewer')).toBeHidden();
  await page.locator('.media-card[title="broken.pdf"]').click();
  await expect(page.locator('#viewer')).toBeHidden();
  await expect(page.locator('#status-area')).toContainText('PDFを開けませんでした');
});
