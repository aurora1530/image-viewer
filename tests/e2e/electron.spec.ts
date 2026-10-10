import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

for (const bundled of [false, true]) {
test(`persists the library, generates thumbnails in workers and confines file access (${bundled ? 'bundled' : 'dev'})`, async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'image-viewer-test-'));
  const images = path.join(profile, 'images');
  const sibling = path.join(profile, 'images-other');
  await mkdir(images);
  await mkdir(sibling);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  await writeFile(path.join(images, 'sample.png'), png);
  await writeFile(path.join(sibling, 'private.png'), png);
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    const env = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined)) as Record<string, string>;
    env.VITE_DEV_SERVER_URL = bundled
      ? pathToFileURL(path.join(process.cwd(), 'dist', 'index.html')).href
      : 'http://127.0.0.1:5173';
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({
      executablePath: path.join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron.exe'),
      args: [path.join(process.cwd(), 'electron', 'main.cjs'), `--user-data-dir=${profile}`],
      env
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.addInitScript(() => {
      const state = window as unknown as { __thumbnailWorkerReplies: number };
      state.__thumbnailWorkerReplies = 0;
      const NativeFetch = window.fetch;
      const reads = window as unknown as { __originalReads: Record<string, number> };
      reads.__originalReads = {};
      window.fetch = (...args: Parameters<typeof fetch>) => {
        const url = String(args[0]);
        if (url.startsWith('local-media:')) {
          const encoded = url.split('/').pop()!.replace(/-/g, '+').replace(/_/g, '/');
          const file = new TextDecoder().decode(Uint8Array.from(atob(encoded), char => char.charCodeAt(0)));
          reads.__originalReads[file] = (reads.__originalReads[file] || 0) + 1;
        }
        return NativeFetch(...args);
      };
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          this.addEventListener('message', event => { if (event.data?.blob) state.__thumbnailWorkerReplies++; });
        }
      };
    });
    await page.reload();
    await expect(page.locator('#home-view')).toBeVisible();
    await page.evaluate(root => window.desktopApi!.openRoot(root), images);
    await page.reload();
    await expect(page.locator('#recent-roots .library-card')).toHaveCount(1);
    await page.locator('#recent-roots .library-card').click();
    await expect(page.locator('#item-list .media-card')).toHaveCount(1);
    await expect(page.locator('#item-list img')).toHaveJSProperty('naturalWidth', 1);
    await expect(page.locator('#item-list img')).toHaveAttribute('src', /^blob:/);
    expect(await page.evaluate(() => (window as unknown as { __thumbnailWorkerReplies: number }).__thumbnailWorkerReplies)).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(async file => {
      const stored = await window.desktopApi!.readThumbnail(file);
      return stored.bytes?.byteLength || 0;
    }, path.join(images, 'sample.png'))).toBeGreaterThan(0);
    await page.locator('#item-list .media-card').click();
    await expect(page.locator('#viewer')).toHaveCSS('display', 'flex');
    await page.keyboard.press('Alt+ArrowLeft');
    await expect(page.locator('#viewer')).toHaveCSS('display', 'none');

    const result = await page.evaluate(async ({ allowed, forbidden, escaped }) => {
      const api = window.desktopApi!;
      const allowedResult = await api.readFile(allowed);
      let forbiddenError = '';
      try { await api.readFile(forbidden); } catch (error) { forbiddenError = String(error); }
      let escapedError = '';
      try { await api.readFile(escaped); } catch (error) { escapedError = String(error); }
      let thumbnailError = '';
      try { await api.readThumbnail(forbidden); } catch (error) { thumbnailError = String(error); }
      return { allowedLength: allowedResult.byteLength, forbiddenError, escapedError, thumbnailError };
    }, {
      allowed: path.join(images, 'sample.png'),
      forbidden: path.join(sibling, 'private.png'),
      escaped: path.join(images, '..', 'images-other', 'private.png')
    });
    expect(result.allowedLength).toBeGreaterThan(0);
    expect(result.forbiddenError).toContain('許可されていません');
    expect(result.escapedError).toContain('許可されていません');
    expect(result.thumbnailError).toContain('許可されていません');

    const jpeg = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 3000; canvas.height = 1500;
      const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/jpeg'));
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    });
    const jpegPath = path.join(images, 'large.jpg');
    await writeFile(jpegPath, Buffer.from(jpeg));
    await page.locator('#reload-btn').click();
    await expect(page.locator('#item-list img[alt="large.jpg"]')).toHaveJSProperty('naturalWidth', 1280);
    await expect.poll(() => page.evaluate(async file => {
      const stored = await window.desktopApi!.readThumbnail(file);
      return stored.bytes ? Array.from(stored.bytes.slice(0, 2)) : [];
    }, jpegPath)).toEqual([0xff, 0xd8]);
    const jpegReads = () => page.evaluate(file => (window as unknown as { __originalReads: Record<string, number> }).__originalReads[file], jpegPath);
    expect(await jpegReads()).toBe(1);
    const thumbnailUrl = await page.locator('#item-list img[alt="large.jpg"]').getAttribute('src');
    await page.locator('#item-list img[alt="large.jpg"]').click();
    await expect(page.locator('#right-page')).toHaveJSProperty('naturalWidth', 3000);
    await expect(page.locator('#viewer .viewer-loading')).toBeHidden();
    const fullUrl = await page.locator('#right-page').getAttribute('src');
    expect(await jpegReads()).toBe(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('#item-list img[alt="large.jpg"]')).toHaveAttribute('src', thumbnailUrl!);
    await page.locator('#item-list img[alt="large.jpg"]').click();
    await expect(page.locator('#right-page')).toHaveAttribute('src', fullUrl!);
    expect(await jpegReads()).toBe(1);
    await page.keyboard.press('Escape');
    await page.reload();
    await page.locator('#recent-roots .library-card').click();
    await expect(page.locator('#item-list img[alt="large.jpg"]')).toHaveJSProperty('naturalWidth', 1280);
    await expect(page.locator('#item-list img[alt="sample.png"]')).toHaveJSProperty('naturalWidth', 1);
    expect(await page.evaluate(() => (window as unknown as { __thumbnailWorkerReplies: number }).__thumbnailWorkerReplies)).toBe(0);
  } finally {
    await app?.close();
    await rm(profile, { recursive: true, force: true });
  }
});
}
