import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('persists the library, opens media and confines file access to selected roots', async () => {
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
    env.VITE_DEV_SERVER_URL = 'http://127.0.0.1:5173';
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({
      executablePath: path.join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron.exe'),
      args: [path.join(process.cwd(), 'electron', 'main.cjs'), `--user-data-dir=${profile}`],
      env
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#home-view')).toBeVisible();
    await page.evaluate(root => window.desktopApi!.openRoot(root), images);
    await page.reload();
    await expect(page.locator('#recent-roots .library-card')).toHaveCount(1);
    await page.locator('#recent-roots .library-card').click();
    await expect(page.locator('#item-list .media-card')).toHaveCount(1);
    await expect(page.locator('#item-list img')).toHaveJSProperty('naturalWidth', 1);
    await expect(page.locator('#item-list img')).toHaveAttribute('src', /^local-media:\/\//);
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
      return { allowedLength: allowedResult.byteLength, forbiddenError, escapedError };
    }, {
      allowed: path.join(images, 'sample.png'),
      forbidden: path.join(sibling, 'private.png'),
      escaped: path.join(images, '..', 'images-other', 'private.png')
    });
    expect(result.allowedLength).toBeGreaterThan(0);
    expect(result.forbiddenError).toContain('許可されていません');
    expect(result.escapedError).toContain('許可されていません');
  } finally {
    await app?.close();
    await rm(profile, { recursive: true, force: true });
  }
});
