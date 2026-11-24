// Processus principal : lit les fichiers de log et les surveille en temps réel.
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { LogParser } = require('./parser');

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

function saveState() {
  fs.writeFileSync(STATE, JSON.stringify({ done: [...doneFiles] }));
}
function appendHistory(events) {
  if (events.length) fs.appendFileSync(HIST, events.map(e => JSON.stringify(e)).join('\n') + '\n');
}

function initialLoad() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  try { doneFiles = new Set(JSON.parse(fs.readFileSync(STATE, 'utf8')).done); } catch {}
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

  // Mode test : VRCLOGS_SHOT=dossier → capture chaque onglet puis quitte
  if (process.env.VRCLOGS_SHOT) {
    win.webContents.once('did-finish-load', async () => {
      const steps = [
        ...['live', 'day', 'feed', 'worlds', 'people', 'groups', 'videos', 'stats']
          .map(v => [v, `document.querySelector('[data-view="${v}"]').click()`]),
        ['player', `goTo('people'); document.querySelector('.trow[data-player]').click()`],
        ['session', `hideModal(); goTo('worlds'); document.querySelectorAll('.wcard')[1].click()`],
        ['settings-alerts', `hideModal(); openSettings('alerts')`],
      ];
      for (const [name, js] of steps) {
        await win.webContents.executeJavaScript(js);
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
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
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
  createWindow();
  setInterval(poll, 1000);
});

app.on('window-all-closed', () => app.quit());
