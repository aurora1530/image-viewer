const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApi', {
  chooseDirectory: () => ipcRenderer.invoke('desktop:choose-directory'),
  openRoot: path => ipcRenderer.invoke('desktop:open-root', path),
  getLibrary: () => ipcRenderer.invoke('desktop:get-library'),
  toggleFavoriteRoot: path => ipcRenderer.invoke('desktop:toggle-favorite-root', path),
  removeRecent: path => ipcRenderer.invoke('desktop:remove-recent', path),
  listDirectory: path => ipcRenderer.invoke('desktop:list-directory', path),
  readFile: path => ipcRenderer.invoke('desktop:read-file', path),
  writeFile: (path, data) => ipcRenderer.invoke('desktop:write-file', path, data),
  exists: (path, kind) => ipcRenderer.invoke('desktop:exists', path, kind)
});
