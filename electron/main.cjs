const { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } = require('electron');
const { existsSync } = require('node:fs');
const { createUpdates } = require('./updates.cjs');
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
let updates;
let requestUpdateClose;

const libraryPath = () => path.join(app.getPath('userData'), 'library.json');
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
  ipcMain.handle('desktop:update-state', () => updates.getState());
  ipcMain.handle('desktop:check-updates', () => updates.check());
  ipcMain.handle('desktop:install-update', () => updates.install());
  const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
  ipcMain.handle('desktop:read-app-config', async () => {
    const config = await loadJson(settingsPath(), {});
    const value = config.thumbnailDiskMiB;
    if (Number.isInteger(value) && value >= 0 && value <= 1048576)
      await thumbnails.configure(value * 1024 * 1024);
    return config;
  });
  ipcMain.handle('desktop:write-app-config', async (_event, config) => {
    const clean = {};
    for (const key of ['thumbnailMemoryMiB', 'originalMemoryMiB', 'thumbnailDiskMiB']) {
      const value = config?.[key];
      if (!Number.isInteger(value) || value < 0 || value > 1048576)
        throw new Error('不正な設定です。');
      clean[key] = value;
    }
    const names = config?.directoryThumbnailNames;
    if (
      !Array.isArray(names) ||
      !names.every(
        (name) =>
          typeof name === 'string' &&
          name.trim().length > 0 &&
          name.trim() !== '.' &&
          name.trim() !== '..' &&
          !/[\\/:*?"<>|]/.test(name) &&
          !Array.from(name).some((character) => character.charCodeAt(0) < 32),
      )
    )
      throw new Error('不正な代表画像名です。');
    clean.directoryThumbnailNames = [...new Set(names.map((name) => name.trim()))];
    await saveJson(settingsPath(), clean);
    await thumbnails.configure(clean.thumbnailDiskMiB * 1024 * 1024);
  });
  ipcMain.handle('desktop:cache-stats', async () => ({
    ...(await thumbnails.stats()),
    path: path.join(app.getPath('userData'), 'thumbnails'),
    configPath: settingsPath(),
  }));
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
  ipcMain.handle('desktop:open-directory-externally', async (_event, dirPath) => {
    if (typeof dirPath !== 'string' || !path.isAbsolute(dirPath))
      throw new Error('不正なフォルダーパスです。');
    const resolved = requireAllowed(dirPath);
    if (!(await fs.stat(resolved)).isDirectory()) throw new Error('フォルダーではありません。');
    const error = await shell.openPath(resolved);
    if (error) throw new Error(error);
  });
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
    return (await fs.readdir(resolved, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() || entry.isFile())
      .map((entry) => ({ name: entry.name, kind: entry.isDirectory() ? 'directory' : 'file' }));
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
    backgroundColor: '#1c1c1e',
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
  // Release links are opened in the system browser; renderer navigation stays local.
  const openRelease = (url) => {
    if (/^https:\/\/github\.com\/aurora1530\/image-viewer\/releases(?:\/|$)/.test(url))
      void shell.openExternal(url);
  };
  win.webContents.setWindowOpenHandler(({ url }) => {
    openRelease(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url === win.webContents.getURL()) return; // Allow reloading the current app page.
    event.preventDefault();
    openRelease(url);
  });
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
  let updateAfterSave = false;
  const closeForUpdate = () => {
    if (!hasCloseHandler || closing || win.isDestroyed()) return false;
    updateAfterSave = true;
    win.close();
    return true;
  };
  requestUpdateClose = closeForUpdate;
  const onCloseHandlerReady = (event) => {
    if (event.sender === win.webContents) hasCloseHandler = true;
  };
  const onReadyToClose = (event, saved) => {
    if (event.sender !== win.webContents || !closing) return;
    closing = false;
    if (saved === true) {
      if (updateAfterSave) readyToClose = updates.finishInstall();
      else {
        readyToClose = true;
        win.close();
      }
    } else if (updateAfterSave) {
      updateAfterSave = false;
      updates.cancelInstall();
    }
  };
  ipcMain.on('desktop:ready-to-close', onReadyToClose);
  ipcMain.on('desktop:close-handler-ready', onCloseHandlerReady);
  win.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) hasCloseHandler = false;
  });
  win.on('close', (event) => {
    // An installer failure must not let a later ordinary close skip saving.
    if (updateAfterSave && updates.getState().status !== 'ready') {
      updateAfterSave = false;
      readyToClose = false;
    }
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
    if (requestUpdateClose === closeForUpdate) requestUpdateClose = undefined;
    ipcMain.removeListener('desktop:ready-to-close', onReadyToClose);
    ipcMain.removeListener('desktop:close-handler-ready', onCloseHandlerReady);
  });
}

app.whenReady().then(async () => {
  const enabled =
    app.isPackaged &&
    process.platform === 'win32' &&
    !process.env.PORTABLE_EXECUTABLE_FILE &&
    existsSync(path.join(process.resourcesPath, 'nsis-installed'));
  updates = createUpdates({
    enabled,
    updater: enabled ? require('electron-updater').autoUpdater : null,
    broadcast: (state) => {
      for (const win of BrowserWindow.getAllWindows())
        win.webContents.send('desktop:update-state', state);
    },
    requestInstall: () => requestUpdateClose?.() ?? false,
  });
  library = await loadJson(libraryPath(), { recent: [], favorites: [] });
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
  updates.start();
  app.once('will-quit', () => updates.stop());
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
