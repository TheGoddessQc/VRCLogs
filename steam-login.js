// =====================================================================
//  steam-login.js — « Se connecter avec Steam »
//
//  Comme le bouton « Sign in through Steam » des sites web :
//   1. On ouvre la VRAIE page de connexion de Steam dans une fenêtre.
//      Tu te connectes chez Steam (mot de passe, ou QR code avec l'app
//      Steam mobile). VRCLogs ne voit JAMAIS ton mot de passe.
//   2. Steam t'amène sur la page de ta clé API (steamcommunity.com/dev/apikey).
//      Si tu n'as pas encore de clé, tu cliques « Register » (VRCLogs a déjà
//      écrit "localhost" pour toi) et tu confirmes dans l'app Steam mobile.
//   3. VRCLogs lit la clé affichée sur la page, l'enregistre (chiffrée),
//      ferme la fenêtre et OUBLIE la connexion Steam (rien n'est gardé).
// =====================================================================
const { BrowserWindow, session } = require('electron');

const START = 'https://steamcommunity.com/login/home/?goto=dev%2Fapikey';
const KEY_PAGE = 'https://steamcommunity.com/dev/apikey';
// La fenêtre ne peut aller QUE sur les sites de Steam
const STEAM_HOSTS = /(^|\.)(steamcommunity\.com|steampowered\.com|steamstatic\.com|steamusercontent\.com|steamcontent\.com|akamaihd\.net)$/i;
const isSteam = url => { try { const u = new URL(url); return u.protocol === 'https:' && STEAM_HOSTS.test(u.hostname); } catch { return false; } };

// Ce qu'on lit sur la page (exécuté DANS la page Steam)
const READ_PAGE = `(() => {
  const box = document.querySelector('#bodyContents_ex') || document.body;
  const text = box ? box.innerText : '';
  const key = (/Key\\s*:\\s*([0-9A-F]{32})/i.exec(text) || [])[1] || null;
  const domain = document.querySelector('#domain');
  if (domain && !domain.value) domain.value = 'localhost'; // on remplit seulement le nom (les conditions, c'est toi qui les acceptes)
  return { id: (typeof g_steamID === 'string' && /^\\d{17}$/.test(g_steamID)) ? g_steamID : null,
    path: location.pathname, key, form: !!domain, text: text.slice(0, 600) };
})()`;

let open = null; // une seule fenêtre à la fois

function steamLogin(parent) {
  if (open) { open.focus(); return Promise.resolve({ cancelled: true, busy: true }); }
  const ses = session.fromPartition('vrclogs-steam-login'); // sans "persist:" : tout est en mémoire seulement
  ses.setUserAgent(ses.getUserAgent().replace(/\s(Electron|vrclogs)\/\S+/gi, '')); // un navigateur "normal" pour Steam
  const w = new BrowserWindow({
    parent, width: 980, height: 780, title: 'Steam', autoHideMenuBar: true, backgroundColor: '#171a21',
    webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  open = w;
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const guard = (e, url) => { if (!isSteam(url)) e.preventDefault(); };
  w.webContents.on('will-navigate', guard);
  w.webContents.on('will-redirect', guard);

  return new Promise(resolve => {
    let done = false, wentToKeyPage = false;
    const finish = async result => {
      if (done) return;
      done = true;
      clearInterval(timer);
      clearTimeout(limit);
      open = null;
      // On oublie la connexion Steam : cookies, cache, tout
      try { await ses.clearStorageData(); await ses.clearCache(); } catch {}
      if (!w.isDestroyed()) w.close();
      resolve(result);
    };
    const check = async () => {
      if (done || w.isDestroyed() || w.webContents.isLoading()) return;
      let p;
      try { p = await w.webContents.executeJavaScript(READ_PAGE); } catch { return; }
      if (p.key) return finish({ key: p.key, steamId: p.id });
      // Connecté, mais pas encore sur la page de la clé : on y va
      if (p.id && !/^\/dev\/apikey/.test(p.path) && !wentToKeyPage) { wentToKeyPage = true; w.loadURL(KEY_PAGE); return; }
      // Compte "limité" (jamais dépensé 5 $) : Steam refuse de donner une clé
      if (/\/dev\/apikey/.test(p.path) && !p.form && /limited|restricted|5\.00|validated/i.test(p.text)) {
        return finish({ error: 'Steam refuse de créer une clé pour ce compte (il faut avoir dépensé au moins 5 $ sur Steam).', steamId: p.id });
      }
    };
    const timer = setInterval(check, 1000);
    const limit = setTimeout(() => finish({ error: 'Temps écoulé (10 minutes).' }), 10 * 60 * 1000);
    w.webContents.on('did-finish-load', check);
    w.on('closed', () => finish({ cancelled: true }));
    w.loadURL(START);
  });
}

module.exports = { steamLogin };
