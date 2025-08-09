const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  // mainWindow.webContents.openDevTools(); // 必要ならコメント解除
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// --- IPC ハンドラ ---

ipcMain.handle('fs:showDirectoryPicker', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

function readDirEntries(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  return entries.map(e => ({
    name: e.name,
    kind: e.isDirectory() ? 'directory' : 'file'
  }));
}

ipcMain.handle('fs:readDir', async (_e, dirPath) => {
  try {
    return readDirEntries(dirPath);
  } catch (e) {
    console.error(e);
    throw e;
  }
});

ipcMain.handle('fs:getFileMeta', async (_e, filePath) => {
  try {
    const stat = fs.statSync(filePath);
    return { size: stat.size, mtime: stat.mtimeMs };
  } catch (e) { console.error(e); return null; }
});

ipcMain.handle('fs:readFileAsDataUrl', async (_e, filePath) => {
  try {
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mime = ({
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.heic': 'image/heic',
      '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.ogg': 'video/ogg'
    })[ext] || 'application/octet-stream';
    return `data:${mime};base64,${data.toString('base64')}`;
  } catch (e) { console.error(e); return null; }
});

ipcMain.handle('fs:resolvePath', (_e, base, child) => path.join(base, child));

ipcMain.handle('shell:showItem', (_e, filePath) => {
  shell.showItemInFolder(filePath);
});
