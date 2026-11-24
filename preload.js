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
});
