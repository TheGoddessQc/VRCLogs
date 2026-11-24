// Pont sécurisé entre l'interface et le processus principal.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  init: () => ipcRenderer.invoke('init'),
  onEvents: cb => ipcRenderer.on('events', (_e, evs) => cb(evs)),
  onStatus: cb => ipcRenderer.on('status', (_e, s) => cb(s)),
  openUrl: url => ipcRenderer.invoke('open-url', url),
  openLogFolder: () => ipcRenderer.invoke('open-log-folder'),
  openDataFolder: () => ipcRenderer.invoke('open-data-folder'),
  exportCsv: text => ipcRenderer.invoke('export-csv', text),
  // Compte VRChat
  vrc: {
    get: () => ipcRenderer.invoke('vrc:get'),
    login: (username, password) => ipcRenderer.invoke('vrc:login', { username, password }),
    verify2fa: (method, code) => ipcRenderer.invoke('vrc:2fa', { method, code }),
    logout: () => ipcRenderer.invoke('vrc:logout'),
    refresh: () => ipcRenderer.invoke('vrc:refresh'),
    avatars: () => ipcRenderer.invoke('vrc:avatars'),
    onUpdate: cb => ipcRenderer.on('vrc', (_e, s) => cb(s)),
  },
});
