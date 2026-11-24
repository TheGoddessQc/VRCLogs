// Processus principal : lit les fichiers de log et les surveille en temps réel.
const { app, BrowserWindow, ipcMain, shell, dialog, protocol } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { LogParser, parseInstance } = require('./parser');
const { VRChat } = require('./vrchat');
const { AvatarSearch, UA } = require('./avatars');
const { Steam } = require('./steam');
const { getNews } = require('./news');

// "vrcimg://" = notre propre adresse pour afficher les images VRChat (avatars, mondes).
// Elles passent par main.js, qui les télécharge proprement et les garde en cache.
protocol.registerSchemesAsPrivileged([
  { scheme: 'vrcimg', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const LOG_DIR = path.join(os.homedir(), 'AppData', 'LocalLow', 'VRChat', 'VRChat');
const LIVE_WINDOW = 10 * 60 * 1000; // log modifié il y a moins de 10 min = VRChat ouvert

let win = null;
let allEvents = [];
let tail = null; // { file, offset, parser }

function listLogFiles() {
  try {
    return fs.readdirSync(LOG_DIR).filter(f => /^output_log_.*\.txt$/.test(f)).sort();
  } catch {
    return [];
  }
}

// Lit les nouvelles lignes complètes d'un fichier à partir de "offset".
function readNew(file, offset, parser) {
  const full = path.join(LOG_DIR, file);
  const size = fs.statSync(full).size;
  if (size <= offset) return { events: [], offset };
  const fd = fs.openSync(full, 'r');
  const buf = Buffer.alloc(size - offset);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);
  const lastNl = buf.lastIndexOf(0x0a);
  if (lastNl < 0) return { events: [], offset };
  const text = buf.subarray(0, lastNl + 1).toString('utf8');
  const events = [];
  for (const line of text.split('\n')) {
    const e = parser.parseLine(line);
    if (e) events.push(e);
  }
  return { events, offset: offset + lastNl + 1 };
}

function endOf(parser) {
  return parser.quit || !parser.lastT ? [] : [{ t: parser.lastT, file: parser.file, type: 'end' }];
}

function isLive() {
  if (!tail) return false;
  try {
    return Date.now() - fs.statSync(path.join(LOG_DIR, tail.file)).mtimeMs < LIVE_WINDOW;
  } catch {
    return false;
  }
}

// ---------- Historique permanent ----------
// VRChat supprime ses vieux logs : on garde notre propre copie de tous les événements.
const DATA_DIR = path.join(app.getPath('appData'), 'VRCLogs');
// L'app s'appelait "vrlogs" avant : on récupère l'ancien historique, les favoris et les notes
const OLD_DIR = path.join(app.getPath('appData'), 'vrlogs');
if (!fs.existsSync(DATA_DIR) && fs.existsSync(OLD_DIR)) {
  try { fs.cpSync(OLD_DIR, DATA_DIR, { recursive: true }); } catch (err) { console.error(err); }
}
app.setPath('userData', DATA_DIR);
const HIST = path.join(DATA_DIR, 'history.jsonl');
const STATE = path.join(DATA_DIR, 'state.json');
let doneFiles = new Set(); // fichiers de log terminés et déjà sauvegardés

// À augmenter quand parser.js apprend à reconnaître de nouvelles lignes :
// les logs encore présents sur le PC seront relus une fois.
const PARSER_VERSION = 2;
function saveState() {
  fs.writeFileSync(STATE, JSON.stringify({ done: [...doneFiles], v: PARSER_VERSION }));
}
function appendHistory(events) {
  if (events.length) fs.appendFileSync(HIST, events.map(e => JSON.stringify(e)).join('\n') + '\n');
}

function initialLoad() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  try {
    const st = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    // Nouvelle version du lecteur → on relit tout ce qui existe encore
    if (st.v === PARSER_VERSION) doneFiles = new Set(st.done);
  } catch {}
  let hist = [];
  try {
    hist = fs.readFileSync(HIST, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch {}

  const files = listLogFiles();
  const toParse = files.filter(f => !doneFiles.has(f));
  const reparse = new Set(toParse);
  allEvents = hist.filter(e => !reparse.has(e.file)); // on relit les fichiers pas encore terminés

  toParse.forEach(file => {
    const parser = new LogParser(file);
    const r = readNew(file, 0, parser);
    allEvents.push(...r.events);
    if (file === files[files.length - 1]) tail = { file, offset: r.offset, parser };
    else { allEvents.push(...endOf(parser)); doneFiles.add(file); }
  });
  allEvents.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0)); // ordre chronologique des fichiers
  fs.writeFileSync(HIST, allEvents.map(e => JSON.stringify(e)).join('\n') + '\n');
  saveState();
}

function poll() {
  const files = listLogFiles();
  if (!files.length) return;
  const newest = files[files.length - 1];
  const fresh = [];
  try {
    if (tail && tail.file !== newest) {
      // VRChat a été relancé : on termine l'ancien fichier et on passe au nouveau
      const r = readNew(tail.file, tail.offset, tail.parser);
      fresh.push(...r.events, ...endOf(tail.parser));
      doneFiles.add(tail.file);
      saveState();
      tail = null;
    }
    if (!tail) tail = { file: newest, offset: 0, parser: new LogParser(newest) };
    const r = readNew(tail.file, tail.offset, tail.parser);
    tail.offset = r.offset;
    fresh.push(...r.events);
  } catch (err) {
    console.error(err);
  }
  if (fresh.length) {
    allEvents.push(...fresh);
    try { appendHistory(fresh); } catch (err) { console.error(err); }
    win?.webContents.send('events', fresh);
  }
  win?.webContents.send('status', { live: isLive() });
}

// =====================================================================
//  Compte VRChat (optionnel) : liste d'amis, favoris, avatars
// =====================================================================
let vrc = null;
const IMG_DIR = path.join(DATA_DIR, 'images');
const social = { user: null, friends: [], favorites: { groups: [], favs: [] }, updated: 0, error: null };
let lastFull = 0;
let refreshing = false;

function sendSocial() { win?.webContents.send('vrc', social); }

// Met à jour la liste d'amis. "full" = aussi les amis hors ligne et les favoris (plus lourd).
async function refreshFriends(full = false) {
  if (!social.user || refreshing) return;
  refreshing = true;
  try {
    const online = await vrc.friends(false);
    const map = new Map(social.friends.map(f => [f.id, f]));
    if (full || !social.friends.length) {
      map.clear();
      for (const f of await vrc.friends(true)) map.set(f.id, f);
      social.favorites = await vrc.favorites();
      lastFull = Date.now();
    } else {
      // ceux qui ne sont plus dans la liste "en ligne" viennent de se déconnecter
      for (const f of map.values()) if (f.online) { f.online = false; f.location = 'offline'; }
    }
    for (const f of online) map.set(f.id, f);

    // Nom et image du monde où se trouve chaque ami (gardés en mémoire)
    let lookups = 0;
    for (const f of map.values()) {
      const m = /^(wrld_[^:]+):/.exec(f.location);
      f.instType = m ? parseInstance(f.location).type : null;
      f.world = null;
      if (!m) continue;
      if (!vrc.worlds.has(m[1]) && lookups++ >= 15) continue; // max 15 nouveaux mondes par mise à jour
      try { f.world = await vrc.world(m[1]); } catch {}
    }
    social.friends = [...map.values()];
    social.updated = Date.now();
    social.error = null;
  } catch (e) {
    social.error = e.message;
    if (e.status === 401) { vrc.clear(); social.user = null; social.friends = []; } // session expirée
  }
  refreshing = false;
  sendSocial();
}

function handleAuth(r) {
  if (r.user) { social.user = r.user; sendSocial(); refreshFriends(true); }
  return r;
}

ipcMain.handle('vrc:get', () => social);
ipcMain.handle('vrc:login', async (_e, { username, password }) => {
  try { return handleAuth(await vrc.login(username, password)); } catch (e) { return { error: e.message }; }
});
ipcMain.handle('vrc:2fa', async (_e, { method, code }) => {
  try { return handleAuth(await vrc.verify2fa(method, code)); } catch (e) { return { error: e.message }; }
});
ipcMain.handle('vrc:logout', async () => {
  await vrc.logout();
  Object.assign(social, { user: null, friends: [], favorites: { groups: [], favs: [] }, updated: 0, error: null });
  sendSocial();
});
ipcMain.handle('vrc:refresh', () => refreshFriends(true));
ipcMain.handle('vrc:user', async (_e, id) => {
  try { return await vrc.profile(id); } catch (e) { return { error: e.message }; }
});
// ---------- Steam, actualités, boutiques ----------
let steam = null;
const safe = fn => async (...a) => { try { return await fn(...a); } catch (e) { return { error: e.message, status: e.status } } };
ipcMain.handle('steam:local', () => steam.local());
ipcMain.handle('steam:hasKey', () => steam.hasKey());
ipcMain.handle('steam:setKey', safe(async (_e, { key, steamId }) => { await steam.setKey(key, steamId); return { ok: true }; }));
ipcMain.handle('steam:clearKey', () => steam.clearKey());
ipcMain.handle('steam:time', safe((_e, steamId) => steam.vrchatTime(steamId)));
ipcMain.handle('steam:friends', safe((_e, { steamId, force }) =>
  steam.friends(steamId, force, (done, total) => win?.webContents.send('steam:progress', { done, total }))));
ipcMain.handle('news:get', safe((_e, force) => getNews(force)));
ipcMain.handle('vrc:store', safe((_e, storeId) => vrc.store(storeId)));

let avatarSearch = null;
ipcMain.handle('avatar:lookup', (_e, { name, author }) => avatarSearch.lookup(name, author));
ipcMain.handle('vrc:avatars', async () => {
  try { return { avatars: await vrc.myAvatars() }; } catch (e) { return { error: e.message }; }
});

// Images VRChat : on n'accepte que les serveurs de VRChat, et on garde une copie en cache
function serveImage(req) {
  return (async () => {
    try {
      const u = new URL(req.url).searchParams.get('u');
      const host = new URL(u).hostname;
      const isVRChat = /(^|\.)vrchat\.(cloud|com)$/.test(host);
      const isOther = host === 'thumb.avtrdb.com' || /(^|\.)steamstatic\.com$/.test(host) || /(^|\.)akamaihd\.net$/.test(host);
      if (!isVRChat && !isOther) return new Response('', { status: 403 });
      const fp = path.join(IMG_DIR, crypto.createHash('sha1').update(u).digest('hex'));
      if (fs.existsSync(fp)) {
        const type = fs.existsSync(fp + '.t') ? fs.readFileSync(fp + '.t', 'utf8') : 'image/png';
        return new Response(fs.readFileSync(fp), { headers: { 'Content-Type': type } });
      }
      // Images VRChat : avec la session. Images avtrDB : SANS (tes cookies restent chez VRChat).
      const res = isVRChat ? await vrc.fetchImage(u) : await fetch(u, { headers: { 'User-Agent': UA } });
      if (!res.ok) return new Response('', { status: res.status });
      const type = res.headers.get('content-type') || 'image/png';
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(fp, buf);
      fs.writeFileSync(fp + '.t', type);
      return new Response(buf, { headers: { 'Content-Type': type } });
    } catch {
      return new Response('', { status: 500 });
    }
  })();
}

function startVRChat() {
  fs.mkdirSync(IMG_DIR, { recursive: true });
  avatarSearch = new AvatarSearch(DATA_DIR);
  steam = new Steam(DATA_DIR);
  // Mode test (développement seulement) : de faux amis pour vérifier l'affichage
  if (process.env.VRCLOGS_MOCK) vrc = new (require('./dev/mock-vrchat'))(allEvents);
  else vrc = new VRChat(DATA_DIR);
  protocol.handle('vrcimg', serveImage);
  // On reprend la session enregistrée en arrière-plan (la fenêtre n'attend pas)
  vrc.restore().then(user => {
    social.user = user;
    sendSocial();
    if (user) refreshFriends(true);
  });
  // Toutes les 60 s : amis en ligne. Toutes les 10 min : liste complète.
  setInterval(() => refreshFriends(Date.now() - lastFull > 10 * 60 * 1000), 60 * 1000);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1300,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f0d17',
    autoHideMenuBar: true,
    title: 'VRCLogs',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
  });
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));

  // Affiche les erreurs de l'interface dans le terminal (utile pour corriger les bugs)
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) console.log(`[UI] ${message} (${path.basename(source)}:${line})`);
  });

  // Mode diagnostic : VRCLOGS_EVAL="code" → exécute ce code dans l'interface, affiche le résultat, quitte
  if (process.env.VRCLOGS_EVAL) {
    win.webContents.once('did-finish-load', async () => {
      await new Promise(r => setTimeout(r, 8000));
      try { console.log('[EVAL]', JSON.stringify(await win.webContents.executeJavaScript(process.env.VRCLOGS_EVAL), null, 1)); }
      catch (e) { console.log('[EVAL] erreur', e.message); }
      app.quit();
    });
  }

  // Mode test : VRCLOGS_SHOT=dossier → capture chaque onglet puis quitte
  if (process.env.VRCLOGS_SHOT) {
    win.webContents.once('did-finish-load', async () => {
      const steps = [
        ...['live', 'day', 'feed', 'worlds', 'people', 'groups', 'videos', 'stats']
          .map(v => [v, `document.querySelector('[data-view="${v}"]').click()`]),
        ['player', `goTo('people'); document.querySelector('.trow[data-player]').click()`],
        ['session', `hideModal(); goTo('worlds'); document.querySelectorAll('.wcard')[1].click()`],
        ['settings-alerts', `hideModal(); openSettings('alerts')`],
        ['friends', `hideModal(); goTo('friends')`],
        ['friend', `document.querySelector('.fcard[data-friend]').click()`],
        ['avatar-zoom', `document.querySelector('[data-zoom]').click()`],
        ['avatars', `hideModal(); goTo('avatars')`],
        ['avatar-history', `hideModal(); openPlayer([...M.players.values()].sort((a, b) => b.avatarHist.length - a.avatarHist.length)[0].key); setTimeout(() => document.querySelector('.avrow')?.scrollIntoView(), 50)`],
        ['avatar-history-done', `new Promise(r => setTimeout(r, 9000))`],
        ['avatar-public', `document.querySelector('.avrow.public')?.click()`],
        ['steam', `hideModal(); goTo('steam'); new Promise(r => setTimeout(r, 3000))`],
        ['news', `goTo('news'); new Promise(r => setTimeout(r, 4000))`],
        ['shop', `goTo('shop'); new Promise(r => setTimeout(r, 4000))`],
        ['settings-look', `openSettings('look')`],
        ['theme-neon', `document.querySelector('[data-theme-pick="neon"]').click()`],
        ['theme-clair', `document.querySelector('[data-theme-pick="clair"]').click(); hideModal(); goTo('live')`],
        ['theme-random', `openSettings('look'); document.getElementById('palRandom').click()`],
        ['theme-back', `SETTINGS.theme = 'goddess'; applySettings(); hideModal()`],
        ['brain', `hideModal(); goTo('brain'); new Promise(r => setTimeout(r, 6000))`],
        ['brain-hover', `(() => { const n = BRAIN.nodes[3]; BRAIN.hover = n; drawBrain(); })()`],
        ['chart-pin', `goTo('live'); const b = document.querySelector('.ichart'); if (b) pinChart(b, +b.dataset.t0 + (b.dataset.t1 - b.dataset.t0) * 0.3)`],
        ['friend-profile', `goTo('friends'); document.querySelector('.fcard[data-friend]').click(); new Promise(r => setTimeout(r, 4000))`],
        ['my-avatar', `hideModal(); goTo('avatars'); new Promise(r => setTimeout(r, 3000)).then(() => document.querySelector('[data-avatar]')?.click())`],
      ];
      for (const [name, js] of steps) {
        try { await win.webContents.executeJavaScript(js); } catch { continue; } // étape impossible (ex : pas connecté)
        await new Promise(r => setTimeout(r, 1200));
        await win.webContents.capturePage();
        fs.writeFileSync(path.join(process.env.VRCLOGS_SHOT, `${name}.png`), (await win.webContents.capturePage()).toPNG());
      }
      app.quit();
    });
  }
}

ipcMain.handle('init', () => ({ events: allEvents, logDir: LOG_DIR, live: isLive() }));
ipcMain.handle('open-data-folder', () => shell.openPath(DATA_DIR));
ipcMain.handle('open-url', (_e, url) => {
  // On n'ouvre que des pages web, ou un lien "rejoindre" de VRChat
  if (/^https?:\/\//i.test(url) || /^vrchat:\/\/launch\?/i.test(url)) shell.openExternal(url);
});
ipcMain.handle('open-log-folder', () => shell.openPath(LOG_DIR));
ipcMain.handle('export-csv', async (_e, text) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: 'vrclogs-export.csv',
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  if (canceled || !filePath) return false;
  fs.writeFileSync(filePath, '﻿' + text, 'utf8'); // BOM pour Excel
  return true;
});

app.whenReady().then(() => {
  initialLoad();
  startVRChat();
  createWindow();
  setInterval(poll, 1000);
});

app.on('window-all-closed', () => app.quit());
