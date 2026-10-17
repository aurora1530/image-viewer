const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApi', {
  onBeforeClose: (callback) => {
    const listener = async () => {
      let saved = false;
      try {
        saved = await callback();
      } catch (error) {
        console.error(error);
      }
      ipcRenderer.send('desktop:ready-to-close', saved);
    };
    ipcRenderer.on('desktop:before-close', listener);
    ipcRenderer.send('desktop:close-handler-ready');
    return () => ipcRenderer.removeListener('desktop:before-close', listener);
  },
  onNavigate: (callback) => {
    const listener = (_event, direction) => callback(direction);
    ipcRenderer.on('desktop:navigate', listener);
    return () => ipcRenderer.removeListener('desktop:navigate', listener);
  },
  readThumbnail: (path) => ipcRenderer.invoke('desktop:read-thumbnail', path),
  writeThumbnail: (path, version, bytes) =>
    ipcRenderer.invoke('desktop:write-thumbnail', path, version, bytes),
  readAppConfig: () => ipcRenderer.invoke('desktop:read-app-config'),
  writeAppConfig: (config) => ipcRenderer.invoke('desktop:write-app-config', config),
  cacheStats: () => ipcRenderer.invoke('desktop:cache-stats'),
  chooseDirectory: () => ipcRenderer.invoke('desktop:choose-directory'),
  openRoot: (path) => ipcRenderer.invoke('desktop:open-root', path),
  getLibrary: () => ipcRenderer.invoke('desktop:get-library'),
  toggleFavoriteRoot: (path) => ipcRenderer.invoke('desktop:toggle-favorite-root', path),
  removeRecent: (path) => ipcRenderer.invoke('desktop:remove-recent', path),
  listDirectory: (path) => ipcRenderer.invoke('desktop:list-directory', path),
  readFile: (path) => ipcRenderer.invoke('desktop:read-file', path),
  writeFile: (path, data) => ipcRenderer.invoke('desktop:write-file', path, data),
  exists: (path, kind) => ipcRenderer.invoke('desktop:exists', path, kind),
});
