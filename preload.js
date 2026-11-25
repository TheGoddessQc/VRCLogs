// Pont sécurisé entre l'interface et le processus principal.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  init: () => ipcRenderer.invoke('init'),
  onEvents: cb => ipcRenderer.on('events', (_e, evs) => cb(evs)),
  onStatus: cb => ipcRenderer.on('status', (_e, s) => cb(s)),
  openUrl: url => ipcRenderer.invoke('open-url', url),
  setLang: lang => ipcRenderer.invoke('set-lang', lang),
  version: () => ipcRenderer.invoke('app:version'),
  reload: () => ipcRenderer.invoke('app:reload'),
  vrcStatus: () => ipcRenderer.invoke('vrcstatus:get'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  openLogFolder: () => ipcRenderer.invoke('open-log-folder'),
  openDataFolder: () => ipcRenderer.invoke('open-data-folder'),
  exportCsv: text => ipcRenderer.invoke('export-csv', text),
  // Steam (heures de jeu, amis) et actualités
  steam: {
    local: () => ipcRenderer.invoke('steam:local'),
    hasKey: () => ipcRenderer.invoke('steam:hasKey'),
    setKey: (key, steamId) => ipcRenderer.invoke('steam:setKey', { key, steamId }),
    clearKey: () => ipcRenderer.invoke('steam:clearKey'),
    pasteKey: steamId => ipcRenderer.invoke('steam:pasteKey', steamId),
    localFriends: steamId => ipcRenderer.invoke('steam:localFriends', steamId),
    time: steamId => ipcRenderer.invoke('steam:time', steamId),
    friends: (steamId, force) => ipcRenderer.invoke('steam:friends', { steamId, force }),
    onProgress: cb => ipcRenderer.on('steam:progress', (_e, p) => cb(p)),
  },
  // Discord : statut sur ton profil + alertes dans ton serveur
  discord: {
    setClient: id => ipcRenderer.invoke('discord:setClient', id),
    state: () => ipcRenderer.invoke('discord:state'),
    activity: a => ipcRenderer.invoke('discord:activity', a),
    onState: cb => ipcRenderer.on('discord:state', (_e, s) => cb(s)),
    hasWebhook: () => ipcRenderer.invoke('discord:hasWebhook'),
    setWebhook: url => ipcRenderer.invoke('discord:setWebhook', url),
    clearWebhook: () => ipcRenderer.invoke('discord:clearWebhook'),
    post: msg => ipcRenderer.invoke('discord:post', msg),
  },
  // Chatbox VRChat (texte au-dessus de ta tête, par OSC)
  chatbox: {
    send: (text, sound) => ipcRenderer.invoke('chatbox:send', { text, sound }),
    typing: on => ipcRenderer.invoke('chatbox:typing', on),
    clear: () => ipcRenderer.invoke('chatbox:clear'),
    state: () => ipcRenderer.invoke('chatbox:state'),
  },
  news: force => ipcRenderer.invoke('news:get', force),
  store: storeId => ipcRenderer.invoke('vrc:store', storeId),
  spotlight: () => ipcRenderer.invoke('vrc:spotlight'),
  worldBrief: id => ipcRenderer.invoke('vrc:worldBrief', id),
  groupBrief: id => ipcRenderer.invoke('vrc:groupBrief', id),
  myGroups: () => ipcRenderer.invoke('vrc:myGroups'),
  groupInstances: () => ipcRenderer.invoke('vrc:groupInstances'),
  groupDetails: id => ipcRenderer.invoke('vrc:groupDetails', id),
  // Avatars publics (base avtrDB)
  avatarLookup: (name, author) => ipcRenderer.invoke('avatar:lookup', { name, author }),
  // Compte VRChat
  vrc: {
    get: () => ipcRenderer.invoke('vrc:get'),
    login: (username, password) => ipcRenderer.invoke('vrc:login', { username, password }),
    verify2fa: (method, code) => ipcRenderer.invoke('vrc:2fa', { method, code }),
    logout: () => ipcRenderer.invoke('vrc:logout'),
    refresh: () => ipcRenderer.invoke('vrc:refresh'),
    user: id => ipcRenderer.invoke('vrc:user', id),
    avatars: () => ipcRenderer.invoke('vrc:avatars'),
    onUpdate: cb => ipcRenderer.on('vrc', (_e, s) => cb(s)),
  },
});
