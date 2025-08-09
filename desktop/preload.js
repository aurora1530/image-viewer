const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');

contextBridge.exposeInMainWorld('electronAPI', {
  showDirectoryPicker: () => ipcRenderer.invoke('fs:showDirectoryPicker'),
  readDir: (dirPath) => ipcRenderer.invoke('fs:readDir', dirPath),
  readFileAsDataUrl: (filePath) => ipcRenderer.invoke('fs:readFileAsDataUrl', filePath),
  resolvePath: (base, child) => ipcRenderer.invoke('fs:resolvePath', base, child),
});

// ブラウザ版と同じAPI名に合わせるラッパ
window.showDirectoryPicker = async () => {
  const dir = await window.electronAPI.showDirectoryPicker();
  if (!dir) throw new DOMException('AbortError', 'AbortError');
  // ディレクトリハンドル互換オブジェクトを作る
  return createDirHandle(dir);
};

function createDirHandle(dirPath) {
  return {
    kind: 'directory',
    name: path.basename(dirPath),
    path: dirPath,
    async *values() {
      const entries = await window.electronAPI.readDir(dirPath);
      for (const e of entries) {
        if (e.kind === 'directory') {
          yield createDirHandle(path.join(dirPath, e.name));
        } else {
          yield createFileHandle(path.join(dirPath, e.name));
        }
      }
    }
  };
}

function createFileHandle(filePath) {
  return {
    kind: 'file',
    name: path.basename(filePath),
    path: filePath,
    async getFile() {
      // data URL をBlob化
      const dataUrl = await window.electronAPI.readFileAsDataUrl(filePath);
      if (!dataUrl) throw new Error('Failed to read file');
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      return new File([blob], path.basename(filePath), { type: blob.type, lastModified: Date.now() });
    }
  };
}
