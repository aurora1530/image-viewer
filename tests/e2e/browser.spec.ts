import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const image = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), c => c.charCodeAt(0));
    class TestFile {
      kind = 'file' as const;
      constructor(readonly name: string, private content: Uint8Array | string = image) {}
      async getFile() { return new File([this.content as BlobPart], this.name, { type: this.name.endsWith('.mp4') ? 'video/mp4' : 'image/png' }); }
      async createWritable() {
        return {
          write: async (value: string) => {
            this.content = value;
            if (this.name === '.image-viewer.json') sessionStorage.setItem('image-viewer-test-config', value);
          },
          close: async () => undefined
        };
      }
    }
    class TestDirectory {
      kind = 'directory' as const;
      entries = new Map<string, TestFile | TestDirectory>();
      constructor(readonly name: string) {}
      file(name: string) { this.entries.set(name, new TestFile(name)); }
      directory(name: string) {
        const dir = new TestDirectory(name);
        this.entries.set(name, dir);
        return dir;
      }
      async *values() { yield* this.entries.values(); }
      async getFileHandle(name: string, options?: { create?: boolean }) {
        let entry = this.entries.get(name);
        if (!entry && options?.create) { entry = new TestFile(name, ''); this.entries.set(name, entry); }
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
    if (savedConfig) root.entries.set('.image-viewer.json', new TestFile('.image-viewer.json', savedConfig));
    Object.defineProperty(window, 'showDirectoryPicker', { value: async () => root });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'ルートフォルダを選択' }).click();
  await expect(page.locator('#current-dir-name')).toHaveText('books');
});

test('keeps thumbnails visible after scrolling through a large folder and back', async ({ page }) => {
  await page.evaluate(() => {
    const root = (window as unknown as { __imageViewerTestRoot: { file(name: string): void } }).__imageViewerTestRoot;
    for (let index = 0; index < 1200; index++) root.file(`extra-${index}.png`);
  });
  await page.locator('#reload-btn').click();
  await expect(page.locator('#item-list .item-card')).toHaveCount(1205);
  const images = page.locator('#item-list .media-card img');
  await expect(images.first()).toHaveJSProperty('naturalWidth', 1);
  await page.locator('#item-list .media-card').last().scrollIntoViewIfNeeded();
  await expect(images.last()).toHaveJSProperty('naturalWidth', 1);
  await page.locator('#item-list .media-card').first().scrollIntoViewIfNeeded();
  await expect(images.first()).toHaveJSProperty('naturalWidth', 1);
});

test('shows an image while the recursive list is still scanning', async ({ page }) => {
  await page.evaluate(() => {
    const root = (window as unknown as { __imageViewerTestRoot: { entries: Map<string, { values(): AsyncIterable<unknown> }> } }).__imageViewerTestRoot;
    const child = root.entries.get('chapter')!;
    const originalValues = child.values.bind(child);
    child.values = async function* () {
      await new Promise(resolve => setTimeout(resolve, 3000));
      yield* originalValues();
    };
  });
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#recursive-btn').click();
  await expect(page.locator('.scan-preview')).toBeVisible();
  await page.locator('.scan-preview').click();
  await expect(page.locator('#viewer')).toHaveCSS('display', 'flex');
  await expect(page.locator('#item-list .media-card')).toHaveCount(4);
  await expect(page.locator('.scan-preview')).toHaveCount(0);
});

test('filters, searches and opens the displayed image', async ({ page }) => {
  await expect(page.locator('#item-list .item-card')).toHaveCount(5);
  await page.locator('#filter-select').selectOption('image');
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
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '全画像一覧' }).click();
  await expect(page.locator('#item-list .media-card')).toHaveCount(4);
  await expect(page.locator('#item-list img[alt="nested.png"]')).toHaveCount(1);
  await page.getByRole('button', { name: '戻る' }).click();
  await expect(page.locator('#item-list .item-card')).toHaveCount(5);
});

test('navigates across the favorite boundary in the all-images list', async ({ page }) => {
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '全画像一覧' }).click();
  const nested = page.locator('#item-list .media-card', { has: page.locator('img[alt="nested.png"]') });
  await nested.locator('.favorite-btn').click();
  await page.locator('#favorite-mode-select').selectOption('first');
  await expect.poll(() => page.locator('#item-list .media-card img').evaluateAll(images =>
    images.map(image => image.getAttribute('alt'))
  )).toEqual(['nested.png', '2.png', '10.png', 'cover.gif']);

  await page.locator('#item-list .media-card').first().click();
  await page.locator('#toggle-view-btn').click();
  await expect(page.locator('#page-counter')).toHaveText('1 / 4');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#page-counter')).toHaveText('2 / 4');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#page-counter')).toHaveText('1 / 4');
});

test('reuses recursive scans for view controls and rescans changed files on reload', async ({ page }) => {
  // 初期表示のフォルダープレビューが終わってから再帰走査の回数を測る。
  await expect(page.locator('#item-list .directory-card img')).toHaveJSProperty('naturalWidth', 1);
  await page.evaluate(() => {
    type Directory = { values(): AsyncIterable<unknown>; entries: Map<string, unknown>; file(name: string): void };
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
  const reads = () => page.evaluate(() => (window as unknown as { __recursiveReads: number }).__recursiveReads);
  const names = () => page.locator('#item-list .media-card img').evaluateAll(images => images.map(image => image.getAttribute('alt')));
  page.once('dialog', dialog => dialog.accept());
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
  const nested = page.locator('#item-list .media-card', { has: page.locator('img[alt="nested.png"]') });
  await nested.locator('.favorite-btn').click();
  await expect(nested.locator('.favorite-btn')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#favorite-mode-select').selectOption('only');
  await expect.poll(names).toEqual(['nested.png']);
  await page.locator('#favorite-mode-select').selectOption('off');
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
  const cover = page.locator('#item-list .media-card', { has: page.locator('img[alt="cover.gif"]') });
  await cover.locator('.favorite-btn').click();
  await page.locator('#favorite-mode-select').selectOption('only');
  await expect(page.locator('#item-list .item-card')).toHaveCount(1);
  await expect(page.locator('#item-list img[alt="cover.gif"]')).toHaveCount(1);
  await page.locator('#favorite-mode-select').selectOption('off');
  await expect(page.locator('#item-list .item-card')).toHaveCount(5);
  await expect(page.locator('#item-list .media-card', { has: page.locator('img[alt="cover.gif"]') }).locator('.favorite-btn')).toHaveAttribute('aria-pressed', 'true');
});

test('sorts numeric filenames and moves through images right to left', async ({ page }) => {
  await page.locator('#filter-select').selectOption('image');
  const visibleNames = () => page.locator('#item-list .media-card img').evaluateAll(images => images.map(image => image.getAttribute('alt')));
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
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('image-viewer-test-config') || '{}').settings)).toMatchObject({
    filterType: 'gif', sortOrder: 'desc'
  });
  await page.reload();
  await page.getByRole('button', { name: 'ルートフォルダを選択' }).click();
  await expect(page.locator('#filter-select')).toHaveValue('gif');
  await expect(page.locator('#toggle-sort-btn')).toContainText('降順');
  await expect(page.locator('#item-list img[alt="cover.gif"]')).toHaveCount(1);
});

test('opens video in the player and closes it with Escape', async ({ page }) => {
  await page.locator('#filter-select').selectOption('video');
  await expect(page.locator('#item-list .media-card')).toHaveCount(1);
  await page.locator('#item-list .media-card').click();
  await expect(page.locator('#viewer-video-container')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#viewer')).toHaveCSS('display', 'none');
});
