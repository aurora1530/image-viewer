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

    const rangeResult = await page.evaluate(async file => {
      const encoded = btoa(file).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const response = await fetch(`local-media://file/${encoded}`, { headers: { Range: 'bytes=8-15' } });
      return {
        status: response.status,
        contentRange: response.headers.get('content-range'),
        bytes: Array.from(new Uint8Array(await response.arrayBuffer()))
      };
    }, path.join(images, 'sample.png'));
    expect(rangeResult.status).toBe(206);
    expect(rangeResult.contentRange).toBe(`bytes 8-15/${png.length}`);
    expect(rangeResult.bytes).toEqual(Array.from(png.subarray(8, 16)));

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

    if (!bundled) {
      const orientation = await page.evaluate(async () => {
        const modulePath = '/src/thumbnailEncoder.ts';
        const { encodeThumbnail } = await import(/* @vite-ignore */ modulePath);
        const canvas = document.createElement('canvas'); canvas.width = 3200; canvas.height = 1600;
        const context = canvas.getContext('2d')!;
        context.fillStyle = 'red'; context.fillRect(0, 0, 1600, 1600);
        context.fillStyle = 'blue'; context.fillRect(1600, 0, 1600, 1600);
        const jpeg = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/jpeg'));
        const exif = new Uint8Array([0xff,0xe1,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0]);
        const result = await encodeThumbnail(new Blob([jpeg.slice(0,2), exif, jpeg.slice(2)], { type: 'image/jpeg' }), 'image/jpeg');
        const image = await createImageBitmap(result);
        const preview = new OffscreenCanvas(image.width, image.height); const pixels = preview.getContext('2d')!;
        pixels.drawImage(image, 0, 0);
        const color = (y: number) => Array.from(pixels.getImageData(image.width / 2, y, 1, 1).data).slice(0,3);
        const resultData = { width: image.width, height: image.height, top: color(image.height / 4), bottom: color(image.height * .75) };
        image.close(); return resultData;
      });
      expect(orientation).toMatchObject({ width: 640, height: 1280 });
      expect(orientation.top[0]).toBeGreaterThan(240);
      expect(orientation.bottom[2]).toBeGreaterThan(240);
    }

    const videoBytes = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 320; canvas.height = 180;
      const context = canvas.getContext('2d')!;
      const stream = canvas.captureStream(10);
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
      const chunks: Blob[] = [];
      recorder.ondataavailable = event => chunks.push(event.data);
      const recording = new Promise<Blob>(resolve => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
      });
      recorder.start();
      const timer = setInterval(() => {
        context.fillStyle = `hsl(${Date.now() % 360}, 100%, 50%)`;
        context.fillRect(0, 0, canvas.width, canvas.height);
      }, 100);
      await new Promise(resolve => setTimeout(resolve, 3000));
      recorder.stop();
      clearInterval(timer);
      const blob = await recording;
      stream.getTracks().forEach(track => track.stop());
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    });
    await writeFile(path.join(images, 'seek.webm'), Buffer.from(videoBytes));
    await page.locator('#reload-btn').click();
    await page.locator('#filter-select').selectOption('video');
    await page.locator('#item-list .media-card').click();
    const video = page.locator('#viewer-video');
    await expect(video).toBeVisible();
    await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
    await expect(video).toHaveJSProperty('paused', false);
    for (const time of [2, 0.5]) {
      await video.evaluate((element, target) => {
        const media = element as HTMLVideoElement;
        media.pause();
        media.currentTime = target;
      }, time);
      await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).seeking)).toBe(false);
      await expect(video).toHaveJSProperty('currentTime', time);
      await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
    }
    await video.evaluate(element => (element as HTMLVideoElement).play());
    await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(0.5);
    await page.keyboard.press('Escape');
    await expect(page.locator('#viewer')).toHaveCSS('display', 'none');
  } finally {
    await app?.close();
    await rm(profile, { recursive: true, force: true });
  }
});
}
