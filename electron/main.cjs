const { app, BrowserWindow, dialog, ipcMain, net, protocol } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createThumbnailStore } = require('./thumbnail-store.cjs');
const { serveMedia } = require('./media-protocol.cjs');
const { writeConfigFile } = require('./config-file.cjs');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

const allowedRoots = new Set();
let library = { recent: [], favorites: [] };
let directoryCache = {};
let saveTimer = null;

const libraryPath = () => path.join(app.getPath('userData'), 'library.json');
const cachePath = () => path.join(app.getPath('userData'), 'directory-cache.json');
const normalize = (value) => path.resolve(String(value));
const samePath = (a, b) =>
  process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

function isInside(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function requireAllowed(target) {
  const resolved = normalize(target);
  if (![...allowedRoots].some((root) => isInside(root, resolved))) {
    throw new Error('このパスへのアクセスは許可されていません。');
  }
  return resolved;
}

const thumbnails = createThumbnailStore({
  cacheDirectory: () => path.join(app.getPath('userData'), 'thumbnails'),
  requireAllowed,
});

async function loadJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function saveJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(temp, file);
}

function scheduleCacheSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveJson(cachePath(), directoryCache).catch(console.error), 350);
}

async function getLibrary() {
  const existing = [];
  for (const item of library.recent || []) {
    try {
      const stat = await fs.stat(item.path);
      if (stat.isDirectory())
        existing.push({
          ...item,
          favorite: (library.favorites || []).some((p) => samePath(p, item.path)),
        });
    } catch {
      /* unavailable folders remain out of the home screen */
    }
  }
  return existing;
}

async function rememberRoot(rootPath) {
  const resolved = normalize(rootPath);
  allowedRoots.add(resolved);
  const recent = (library.recent || []).filter((item) => !samePath(item.path, resolved));
  recent.unshift({
    path: resolved,
    name: path.basename(resolved) || resolved,
    openedAt: Date.now(),
  });
  library.recent = recent.slice(0, 30);
  await saveJson(libraryPath(), library);
  return resolved;
}

function decodeMediaUrl(url) {
  const encoded = new URL(url).pathname.replace(/^\//, '');
  return Buffer.from(encoded, 'base64url').toString('utf8');
}

function registerIpc() {
  ipcMain.handle('desktop:read-thumbnail', (_event, filePath) => thumbnails.read(filePath));
  ipcMain.handle('desktop:write-thumbnail', (_event, filePath, version, bytes) =>
    thumbnails.write(filePath, version, bytes),
  );
  ipcMain.handle('desktop:choose-directory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'ルートフォルダーを選択',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return rememberRoot(result.filePaths[0]);
  });
  ipcMain.handle('desktop:open-root', async (_event, rootPath) => {
    const resolved = normalize(rootPath);
    const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) throw new Error('フォルダーではありません。');
    return rememberRoot(resolved);
  });
  ipcMain.handle('desktop:get-library', () => getLibrary());
  ipcMain.handle('desktop:toggle-favorite-root', async (_event, rootPath) => {
    const resolved = normalize(rootPath);
    const favorites = library.favorites || [];
    const index = favorites.findIndex((item) => samePath(item, resolved));
    if (index >= 0) favorites.splice(index, 1);
    else favorites.unshift(resolved);
    library.favorites = favorites;
    await saveJson(libraryPath(), library);
    return index < 0;
  });
  ipcMain.handle('desktop:remove-recent', async (_event, rootPath) => {
    const resolved = normalize(rootPath);
    library.recent = (library.recent || []).filter((item) => !samePath(item.path, resolved));
    library.favorites = (library.favorites || []).filter((item) => !samePath(item, resolved));
    await saveJson(libraryPath(), library);
  });
  ipcMain.handle('desktop:list-directory', async (_event, dirPath) => {
    const resolved = requireAllowed(dirPath);
    const stat = await fs.stat(resolved);
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    const cached = directoryCache[key];
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.entries;
    const entries = (await fs.readdir(resolved, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() || entry.isFile())
      .map((entry) => ({ name: entry.name, kind: entry.isDirectory() ? 'directory' : 'file' }));
    directoryCache[key] = { mtimeMs: stat.mtimeMs, entries, cachedAt: Date.now() };
    const keys = Object.keys(directoryCache);
    if (keys.length > 500) {
      keys
        .sort((a, b) => directoryCache[a].cachedAt - directoryCache[b].cachedAt)
        .slice(0, keys.length - 500)
        .forEach((oldKey) => delete directoryCache[oldKey]);
    }
    scheduleCacheSave();
    return entries;
  });
  ipcMain.handle('desktop:read-file', async (_event, filePath) => {
    const resolved = requireAllowed(filePath);
    return fs.readFile(resolved);
  });
  ipcMain.handle('desktop:write-file', async (_event, filePath, data) => {
    const resolved = requireAllowed(filePath);
    if (path.basename(resolved) === '.image-viewer.json') await writeConfigFile(resolved, data);
    else await fs.writeFile(resolved, data);
  });
  ipcMain.handle('desktop:exists', async (_event, targetPath, kind) => {
    try {
      const stat = await fs.stat(requireAllowed(targetPath));
      return kind === 'directory' ? stat.isDirectory() : stat.isFile();
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
      throw error;
    }
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#15151b',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const devUrl =
    process.env.VITE_DEV_SERVER_URL || (app.isPackaged ? null : 'http://127.0.0.1:5173');
  win.on('app-command', (_event, command) => {
    if (command === 'browser-backward' || command === 'browser-forward') {
      win.webContents.send('desktop:navigate', command === 'browser-backward' ? 'back' : 'forward');
    }
  });
  if (devUrl) win.loadURL(devUrl);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  let readyToClose = false;
  let closing = false;
  let hasCloseHandler = false;
  const onCloseHandlerReady = (event) => {
    if (event.sender === win.webContents) hasCloseHandler = true;
  };
  const onReadyToClose = (event, saved) => {
    if (event.sender !== win.webContents || !closing) return;
    closing = false;
    if (saved === true) {
      readyToClose = true;
      win.close();
    }
  };
  ipcMain.on('desktop:ready-to-close', onReadyToClose);
  ipcMain.on('desktop:close-handler-ready', onCloseHandlerReady);
  win.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) hasCloseHandler = false;
  });
  win.on('close', (event) => {
    if (
      readyToClose ||
      !hasCloseHandler ||
      win.webContents.isDestroyed() ||
      win.webContents.isCrashed()
    )
      return;
    event.preventDefault();
    if (!closing) {
      closing = true;
      win.webContents.send('desktop:before-close');
    }
  });
  win.on('closed', () => {
    ipcMain.removeListener('desktop:ready-to-close', onReadyToClose);
    ipcMain.removeListener('desktop:close-handler-ready', onCloseHandlerReady);
  });
}

app.whenReady().then(async () => {
  library = await loadJson(libraryPath(), { recent: [], favorites: [] });
  directoryCache = await loadJson(cachePath(), {});
  registerIpc();
  protocol.handle('local-media', (request) => {
    const filePath = requireAllowed(decodeMediaUrl(request.url));
    // Whole-image reads stay in Chromium's file pipeline instead of copying many
    // small Node stream chunks across processes. Media byte ranges retain the
    // explicit partial-response path needed for seeking.
    if (!request.headers.has('range') && /\.(jpe?g|png|gif|webp|bmp|heic)$/i.test(filePath)) {
      return net.fetch(pathToFileURL(filePath).toString(), { method: request.method });
    }
    return serveMedia(request, filePath);
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
