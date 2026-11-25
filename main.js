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

// ---------------------------------------------------------------------
//  SÉCURITÉ : on n'accepte les demandes (IPC) QUE de notre propre interface
//  (les fichiers de l'app, en file://). Une page web ne peut rien demander.
// ---------------------------------------------------------------------
const isOwnPage = e => (e.senderFrame?.url || '').startsWith('file://');
const _handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, fn) => _handle(channel, (e, ...args) => {
  if (!isOwnPage(e)) throw new Error('Demande refusée');
  return fn(e, ...args);
});
// Les modes test et diagnostic n'existent QUE dans la version de développement
const DEV = !app.isPackaged;

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
ipcMain.handle('vrc:spotlight', safe(() => vrc.spotlight()));
ipcMain.handle('vrc:worldBrief', safe((_e, id) => vrc.world(id)));
ipcMain.handle('vrc:groupBrief', safe((_e, id) => vrc.group(id)));
ipcMain.handle('vrc:myGroups', safe(() => vrc.myGroups()));
ipcMain.handle('vrc:groupInstances', safe(() => vrc.groupInstances()));
ipcMain.handle('vrc:groupDetails', safe((_e, id) => vrc.groupDetails(id)));

// ---------- Statut des serveurs VRChat ----------
// La page officielle status.vrchat.com (service "Statuspage") a une adresse publique en JSON
ipcMain.handle('vrcstatus:get', safe(async () => {
  const res = await fetch('https://status.vrchat.com/api/v2/summary.json', { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`status.vrchat.com ${res.status}`);
  const s = await res.json();
  const groups = new Map((s.components || []).filter(c => c.group).map(c => [c.id, c.name]));
  return {
    indicator: s.status?.indicator || 'none',  // none | minor | major | critical | maintenance
    description: s.status?.description || '',
    updated: s.page?.updated_at || null,
    components: (s.components || []).filter(c => !c.group)
      .map(c => ({ name: c.name, status: c.status, group: groups.get(c.group_id) || '' })),
    incidents: (s.incidents || []).map(i => ({
      name: i.name, status: i.status, impact: i.impact, url: i.shortlink || 'https://status.vrchat.com',
      updated: i.updated_at, text: i.incident_updates?.[0]?.body || '',
    })),
    maintenances: (s.scheduled_maintenances || []).map(m => ({
      name: m.name, status: m.status, start: m.scheduled_for, end: m.scheduled_until, url: m.shortlink || 'https://status.vrchat.com',
    })),
  };
}));

// ---------- Mises à jour ----------
// On demande à GitHub la dernière version publiée (page publique, rien n'est envoyé sur toi)
const REPO = 'TheGoddessQc/VRCLogs';
// "0.10.0" est plus récent que "0.9.2" : on compare nombre par nombre, pas comme du texte
function isNewer(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('app:reload', () => win?.webContents.reload()); // recharge l'interface (changement de langue)
ipcMain.handle('update:check', safe(async () => {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const r = await res.json();
  const latest = String(r.tag_name || '').replace(/^v/, '');
  const exe = (r.assets || []).find(a => /\.exe$/i.test(a.name));
  return {
    current: app.getVersion(), latest, newer: isNewer(latest, app.getVersion()),
    page: r.html_url, download: exe?.browser_download_url || r.html_url, size: exe?.size || 0,
    date: r.published_at, notes: r.body || '',
  };
}));

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
  if (DEV && process.env.VRCLOGS_MOCK) vrc = new (require('./dev/mock-vrchat'))(allEvents);
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
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
      // Sécurité (écrit noir sur blanc, même si ce sont déjà les valeurs par défaut) :
      contextIsolation: true,  // l'interface ne voit que window.api, jamais Node.js
      nodeIntegration: false,  // pas d'accès aux fichiers ou aux programmes depuis l'interface
      sandbox: true,           // l'interface tourne dans un "bac à sable" isolé
      webSecurity: true,
    },
  });
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));

  // La fenêtre ne peut JAMAIS ouvrir ou charger une autre page
  // (les liens passent par openUrl, qui les ouvre dans ton navigateur)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // (sauf recharger la page de l'app elle-même : nécessaire pour changer de langue)
  win.webContents.on('will-navigate', (e, url) => {
    if (url.split('#')[0] !== win.webContents.getURL().split('#')[0]) e.preventDefault();
  });

  // Affiche les erreurs de l'interface dans le terminal (utile pour corriger les bugs)
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) console.log(`[UI] ${message} (${path.basename(source)}:${line})`);
  });

  // Mode diagnostic : VRCLOGS_EVAL="code" → exécute ce code dans l'interface, affiche le résultat, quitte
  if (DEV && process.env.VRCLOGS_EVAL) {
    win.webContents.once('did-finish-load', async () => {
      await new Promise(r => setTimeout(r, 8000));
      try { console.log('[EVAL]', JSON.stringify(await win.webContents.executeJavaScript(process.env.VRCLOGS_EVAL), null, 1)); }
      catch (e) { console.log('[EVAL] erreur', e.message); }
      app.quit();
    });
  }

  // Mode test : VRCLOGS_SHOT=dossier → capture chaque onglet puis quitte
  if (DEV && process.env.VRCLOGS_SHOT) {
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
        ['vgroups', `hideModal(); goTo('vgroups'); new Promise(r => setTimeout(r, 6000))`],
        ['vgroup', `document.querySelector('.vgcard').click(); new Promise(r => setTimeout(r, 5000))`],
        ['circles', `hideModal(); goTo('groups')`],
        ['shop', `goTo('shop'); new Promise(r => setTimeout(r, 15000))`],
        ['shop-store', `document.querySelector('.spotcard:not(.nostore)')?.click(); new Promise(r => setTimeout(r, 3000))`],
        ['shop-visited', `hideModal(); SHOP.tab = 'visited'; renderShop(); new Promise(r => setTimeout(r, 2000))`],
        ['settings-look', `openSettings('look')`],
        ['whatsnew', `showWhatsNew('0.3.0')`],
        ['srv-status', `hideModal(); NEWS.tab = 'status'; goTo('news'); new Promise(r => setTimeout(r, 3000))`],
        ['changelog', `NEWS.tab = 'app'; renderNews()`],
        ['lang-click', `openSettings('look'); setTimeout(() => document.querySelector('[data-lang="ja"]').click(), 300); 'ok'`],
        ['lang-after', `new Promise(r => setTimeout(r, 5000)).then(() => { openSettings('look'); return document.documentElement.lang; })`],
        ['lang-back', `openSettings('look'); setTimeout(() => document.querySelector('[data-lang="fr"]').click(), 300); 'ok'`],
        ['lang-back-after', `new Promise(r => setTimeout(r, 5000)).then(() => document.documentElement.lang)`],
        ['update', `openSettings('update'); checkUpdate(true).then(() => new Promise(r => setTimeout(r, 500)))`],
        ['update-new', `UPDATE.result = { current: '0.3.0', latest: '0.4.0', newer: true, page: 'https://github.com/TheGoddessQc/VRCLogs/releases', download: 'https://github.com/TheGoddessQc/VRCLogs/releases', size: 87677654, date: new Date().toISOString(), notes: '## Test\\n\\n**Nouveautés**\\n- Une fonction\\n- Une autre\\n\\n> Note' }; $('openSettings').classList.add('has-update'); openSettings('update')`],
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
      // VRCLOGS_SHOT_ONLY=live,stats → seulement ces captures
      const only = (process.env.VRCLOGS_SHOT_ONLY || '').split(',').filter(Boolean);
      for (const [name, js] of steps) {
        if (only.length && !only.includes(name)) continue;
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
// Sites connus : on les ouvre directement. Les autres (liens dans une bio, un groupe…)
// demandent confirmation, pour éviter les liens piégés (hameçonnage).
// Textes de la fenêtre de confirmation, dans les 10 langues (la page nous dit laquelle)
let UI_LANG = 'fr';
ipcMain.handle('set-lang', (_e, l) => { if (/^[a-z]{2}$/.test(l)) UI_LANG = l; });
const LINK_TXT = {
  fr: ['Ouvrir', 'Annuler', 'Lien externe', 'Ouvrir ce site dans ton navigateur ?', "Ce lien vient d'un profil ou d'un groupe. Ne tape jamais ton mot de passe VRChat sur un site qui n'est pas vrchat.com."],
  en: ['Open', 'Cancel', 'External link', 'Open this site in your browser?', 'This link comes from a profile or a group. Never type your VRChat password on a site that is not vrchat.com.'],
  es: ['Abrir', 'Cancelar', 'Enlace externo', '¿Abrir este sitio en tu navegador?', 'Este enlace viene de un perfil o grupo. Nunca escribas tu contraseña de VRChat en un sitio que no sea vrchat.com.'],
  pt: ['Abrir', 'Cancelar', 'Link externo', 'Abrir este site no navegador?', 'Este link vem de um perfil ou grupo. Nunca digite sua senha do VRChat em um site que não seja vrchat.com.'],
  de: ['Öffnen', 'Abbrechen', 'Externer Link', 'Diese Seite im Browser öffnen?', 'Dieser Link stammt aus einem Profil oder einer Gruppe. Gib dein VRChat-Passwort nie auf einer Seite ein, die nicht vrchat.com ist.'],
  it: ['Apri', 'Annulla', 'Link esterno', 'Aprire questo sito nel browser?', 'Questo link proviene da un profilo o da un gruppo. Non scrivere mai la password di VRChat su un sito che non sia vrchat.com.'],
  ru: ['Открыть', 'Отмена', 'Внешняя ссылка', 'Открыть этот сайт в браузере?', 'Ссылка из профиля или группы. Никогда не вводи пароль VRChat на сайте, который не vrchat.com.'],
  ja: ['開く', 'キャンセル', '外部リンク', 'このサイトをブラウザで開きますか？', 'このリンクはプロフィールまたはグループからのものです。vrchat.com 以外のサイトでVRChatのパスワードを入力しないでください。'],
  ko: ['열기', '취소', '외부 링크', '이 사이트를 브라우저에서 열까요?', '이 링크는 프로필이나 그룹에서 왔습니다. vrchat.com이 아닌 사이트에 VRChat 비밀번호를 입력하지 마세요.'],
  zh: ['打开', '取消', '外部链接', '在浏览器中打开此网站？', '此链接来自个人资料或群组。切勿在 vrchat.com 以外的网站输入你的 VRChat 密码。'],
};
const TRUSTED = /(^|\.)(vrchat\.com|vrchat\.cloud|steampowered\.com|steamcommunity\.com|youtube\.com|youtu\.be|avtrdb\.com|github\.com)$/i;
ipcMain.handle('open-url', async (_e, url) => {
  url = String(url);
  if (/^vrchat:\/\/launch\?/i.test(url)) return shell.openExternal(url); // "Rejoindre" dans VRChat
  let u;
  try { u = new URL(url); } catch { return; }
  if (!/^https?:$/.test(u.protocol)) return; // jamais de file://, javascript:, etc.
  if (!TRUSTED.test(u.hostname)) {
    const T = LINK_TXT[UI_LANG] || LINK_TXT.fr;
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning', buttons: [T[0], T[1]], defaultId: 1, cancelId: 1,
      title: T[2], message: `${T[3]}\n\n${u.hostname}`, detail: T[4],
    });
    if (response !== 0) return;
  }
  return shell.openExternal(u.href);
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
