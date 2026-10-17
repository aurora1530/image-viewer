import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = process.cwd();
const executable = process.env.IMAGE_VIEWER_EXECUTABLE
  ? path.resolve(process.env.IMAGE_VIEWER_EXECUTABLE)
  : path.join(root, 'release', 'win-unpacked', 'ローカル画像ビューワー.exe');
const profile = await mkdtemp(path.join(tmpdir(), 'image-viewer-smoke-'));
const libraryFolder = path.join(profile, 'sample-images');
const port = 9333;
let child;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForTarget() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) =>
        response.json(),
      );
      const page = targets.find((target) => target.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* the app is still starting */
    }
    await delay(200);
  }
  throw new Error('Electron のデバッグ対象が起動しませんでした。');
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  return {
    async evaluate(expression) {
      const requestId = ++id;
      const result = await new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
        socket.send(
          JSON.stringify({
            id: requestId,
            method: 'Runtime.evaluate',
            params: { expression, awaitPromise: true, returnByValue: true },
          }),
        );
      });
      if (result.exceptionDetails) {
        throw new Error(
          result.exceptionDetails.exception?.description || result.exceptionDetails.text,
        );
      }
      return result.result.value;
    },
    close: () => socket.close(),
  };
}

try {
  await mkdir(libraryFolder);
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  await writeFile(path.join(libraryFolder, 'sample.png'), png);
  await mkdir(path.join(libraryFolder, 'child'));
  await writeFile(path.join(libraryFolder, 'child', 'sample-child.png'), png);
  child = spawn(executable, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`], {
    stdio: 'ignore',
  });
  const cdp = await connectCdp(await waitForTarget());
  for (let attempt = 0; attempt < 40; attempt++) {
    if (
      await cdp.evaluate(
        `Boolean(window.desktopApi && document.querySelector('#home-view') && !document.querySelector('#home-view').classList.contains('hidden'))`,
      )
    )
      break;
    await delay(100);
  }
  const initial = await cdp.evaluate(
    `({ api: Boolean(window.desktopApi), ready: document.readyState, desktop: !document.querySelector('#desktop-badge').classList.contains('hidden'), home: !document.querySelector('#home-view').classList.contains('hidden'), badgeClass: document.querySelector('#desktop-badge').className, homeClass: document.querySelector('#home-view').className })`,
  );
  if (!initial.desktop || !initial.home) {
    const moduleError = await cdp.evaluate(
      `import(document.querySelector('script[type="module"]').src + '?smoke=1').then(() => 'none').catch(error => error.stack || String(error))`,
    );
    throw new Error(
      `デスクトップのホーム画面が表示されていません: ${JSON.stringify(initial)}\n${moduleError}`,
    );
  }
  await cdp.evaluate(`window.desktopApi.openRoot(${JSON.stringify(libraryFolder)})`);
  await cdp.evaluate('location.reload()');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await cdp.evaluate(`document.querySelectorAll('#recent-roots .library-card').length === 1`))
      break;
    await delay(100);
  }
  const historyCount = await cdp.evaluate(
    `document.querySelectorAll('#recent-roots .library-card').length`,
  );
  if (historyCount !== 1) throw new Error('フォルダー履歴がホーム画面に保存されていません。');
  await cdp.evaluate(`document.querySelector('#recent-roots .library-card').click()`);
  // Thumbnail generation is asynchronous and may return a generated blob URL.
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      await cdp.evaluate(
        `Boolean(document.querySelector('#item-list .media-card img')?.naturalWidth)`,
      )
    )
      break;
    await delay(100);
  }
  const opened = await cdp.evaluate(
    `({ homeHidden: document.querySelector('#home-view').classList.contains('hidden'), cards: document.querySelectorAll('#item-list .media-card').length, source: document.querySelector('#item-list .media-card img')?.src || '', loaded: document.querySelector('#item-list .media-card img')?.naturalWidth || 0 })`,
  );
  if (
    !opened.homeHidden ||
    opened.cards !== 1 ||
    !/^(local-media:\/\/|blob:)/.test(opened.source) ||
    opened.loaded < 1
  ) {
    throw new Error(`履歴からの画像表示に失敗しました: ${JSON.stringify(opened)}`);
  }
  const mediumWidth = await cdp.evaluate(
    `document.querySelector('#item-list .media-card').getBoundingClientRect().width`,
  );
  await cdp.evaluate(
    `(() => { const select = document.querySelector('#size-select'); select.value = '5'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`,
  );
  await delay(200);
  const sizing = await cdp.evaluate(
    `({ card: document.querySelector('#item-list .media-card').getBoundingClientRect().width, container: document.querySelector('#item-list').getBoundingClientRect().width })`,
  );
  if (
    mediumWidth >= sizing.container * 0.35 ||
    sizing.card <= mediumWidth * 1.5 ||
    sizing.card >= sizing.container * 0.75
  ) {
    throw new Error(
      `サムネイルのサイズ切替が正しくありません: ${JSON.stringify({ mediumWidth, ...sizing })}`,
    );
  }
  await cdp.evaluate(`document.querySelector('#item-list .media-card').click()`);
  await delay(200);
  const viewerOpened = await cdp.evaluate(
    `document.querySelector('#viewer').style.display === 'flex'`,
  );
  if (!viewerOpened) throw new Error('画像ビューワーを開けませんでした。');
  await cdp.evaluate(
    `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true }))`,
  );
  await delay(100);
  const viewerClosed = await cdp.evaluate(
    `document.querySelector('#viewer').style.display === 'none' && document.querySelector('#home-view').classList.contains('hidden')`,
  );
  if (!viewerClosed) throw new Error('Alt+Left で画像ビューワーを閉じられませんでした。');
  await cdp.evaluate(
    `document.querySelector('#item-list .directory-card .thumbnail-container').click()`,
  );
  await delay(500);
  const childName = await cdp.evaluate(`document.querySelector('#current-dir-name').textContent`);
  if (childName !== 'child') throw new Error(`子フォルダーへ移動できませんでした: ${childName}`);
  await cdp.evaluate(
    `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true }))`,
  );
  await delay(500);
  const parentName = await cdp.evaluate(`document.querySelector('#current-dir-name').textContent`);
  if (parentName !== 'sample-images')
    throw new Error(`Alt+Left で親フォルダーへ戻れませんでした: ${parentName}`);
  await cdp.evaluate(
    `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true }))`,
  );
  await delay(300);
  const returnedHome = await cdp.evaluate(
    `!document.querySelector('#home-view').classList.contains('hidden')`,
  );
  if (!returnedHome) throw new Error('ルートで Alt+Left を押してホームへ戻れませんでした。');
  cdp.close();
  console.log('Desktop smoke test passed: home, history, media, sizing, Alt+Left navigation.');
} finally {
  if (child && !child.killed) {
    if (process.platform === 'win32') {
      try {
        execFileSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
      } catch {
        /* already stopped */
      }
    } else {
      child.kill();
    }
  }
  await delay(300);
  await rm(profile, { recursive: true, force: true });
}
