// =====================================================================
//  steam.js — tes heures sur VRChat et tes amis Steam qui y jouent
//
//  Deux sources :
//   1. TON PC : Steam écrit tes heures de jeu dans ses fichiers
//      (userdata\…\config\localconfig.vdf). Pas besoin de connexion.
//   2. L'API WEB DE STEAM, avec TA clé API (gratuite, créée par toi sur
//      steamcommunity.com/dev/apikey). Elle sert pour tes amis Steam.
//      La clé est gardée chiffrée par Windows et envoyée uniquement à Steam.
// =====================================================================
const { safeStorage } = require('electron');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const VRCHAT_APP = '438100';             // le numéro de VRChat sur Steam
const STEAM64_BASE = 76561197960265728n;  // pour convertir un "accountId" en SteamID64
const API = 'https://api.steampowered.com';
const GAP = 250;                          // pause entre deux requêtes Steam
const KEEP = 12 * 3600 * 1000;            // on garde les heures des amis 12 h

// ---------- Lire les fichiers ".vdf" de Steam ----------
// Format : "clé" "valeur"  ou  "clé" { … }
function parseVDF(text) {
  const re = /"((?:[^"\\]|\\.)*)"|([{}])/g;
  const root = {};
  const stack = [root];
  let key = null, m;
  while ((m = re.exec(text))) {
    if (m[2] === '{') { const o = {}; stack[stack.length - 1][key] = o; stack.push(o); key = null; }
    else if (m[2] === '}') { stack.pop(); key = null; }
    else {
      const s = m[1].replace(/\\(.)/g, '$1');
      if (key === null) key = s;
      else { stack[stack.length - 1][key] = s; key = null; }
    }
  }
  return root;
}
// Cherche une clé sans tenir compte des majuscules ("apps" ou "Apps")
function get(obj, ...keys) {
  for (const k of keys) {
    if (!obj) return undefined;
    const real = Object.keys(obj).find(x => x.toLowerCase() === k.toLowerCase());
    obj = real === undefined ? undefined : obj[real];
  }
  return obj;
}

function steamPath() {
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { encoding: 'utf8' });
    const m = out.match(/SteamPath\s+REG_SZ\s+(.+)/);
    if (m) return m[1].trim().replace(/\//g, '\\');
  } catch {}
  return 'C:\\Program Files (x86)\\Steam';
}

class Steam {
  constructor(dataDir) {
    this.keyFile = path.join(dataDir, 'steam-key.bin');
    this.cacheFile = path.join(dataDir, 'steam-cache.json');
    try { this.cache = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8')); } catch { this.cache = { owned: {} }; }
    this.queue = Promise.resolve();
    this.last = 0;
  }

  // ---------- 1. Données locales (sans connexion) ----------
  local() {
    const root = steamPath();
    let users = {};
    try { users = get(parseVDF(fs.readFileSync(path.join(root, 'config', 'loginusers.vdf'), 'utf8')), 'users') || {}; } catch {}
    // Tous les comptes : ceux connus de Steam + tous les dossiers "userdata" (un par compte déjà utilisé)
    const ids = new Set(Object.keys(users));
    try {
      for (const d of fs.readdirSync(path.join(root, 'userdata'))) {
        if (/^\d+$/.test(d) && d !== '0') ids.add((BigInt(d) + STEAM64_BASE).toString());
      }
    } catch {}
    const accounts = [];
    for (const id64 of ids) {
      const u = users[id64] || {};
      const accountId = (BigInt(id64) - STEAM64_BASE).toString();
      let app = null, persona = null;
      try {
        const cfg = parseVDF(fs.readFileSync(path.join(root, 'userdata', accountId, 'config', 'localconfig.vdf'), 'utf8'));
        app = get(cfg, 'UserLocalConfigStore', 'Software', 'Valve', 'Steam', 'apps', VRCHAT_APP);
        persona = get(cfg, 'UserLocalConfigStore', 'friends', 'PersonaName');
      } catch {}
      if (!users[id64] && !app) continue; // dossier sans VRChat et compte inconnu : on ignore
      accounts.push({
        steamId: id64,
        // "remembered" = compte enregistré dans Steam sur ce PC (sinon : vieux dossier d'un compte déjà utilisé ici)
        remembered: !!users[id64],
        name: u.PersonaName || persona || u.AccountName || `Compte ${accountId}`,
        mostRecent: get(u, 'MostRecent') === '1',
        minutes: app ? Number(app.Playtime || 0) : null,          // minutes au total
        minutes2wks: app ? Number(app.Playtime2wks || 0) : null,  // minutes ces 2 dernières semaines
        lastPlayed: app?.LastPlayed ? Number(app.LastPlayed) * 1000 : null,
      });
    }
    accounts.sort((a, b) => b.mostRecent - a.mostRecent || (b.minutes || 0) - (a.minutes || 0));
    return { found: accounts.length > 0, accounts };
  }

  // ---------- 2. Clé API (chiffrée) ----------
  getKey() {
    try { return safeStorage.decryptString(fs.readFileSync(this.keyFile)); } catch { return null; }
  }
  hasKey() { return !!this.getKey(); }
  async setKey(key, steamId) {
    key = String(key).trim();
    if (!/^[0-9A-F]{32}$/i.test(key)) throw new Error('Une clé API Steam fait 32 caractères (chiffres et lettres A à F).');
    await this.api('ISteamUser/GetPlayerSummaries/v2', { steamids: steamId }, key); // on vérifie qu'elle marche
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Chiffrement Windows indisponible : clé non enregistrée.');
    fs.writeFileSync(this.keyFile, safeStorage.encryptString(key));
  }
  clearKey() {
    try { fs.unlinkSync(this.keyFile); } catch {}
    this.cache = { owned: {} };
    this.saveCache();
  }
  saveCache() { try { fs.writeFileSync(this.cacheFile, JSON.stringify(this.cache)); } catch {} }

  // Une requête à l'API Steam (une à la fois, avec une pause)
  api(method, params, key = this.getKey()) {
    const run = async () => {
      const wait = this.last + GAP - Date.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      this.last = Date.now();
      const q = new URLSearchParams({ key, format: 'json', ...params });
      const res = await fetch(`${API}/${method}/?${q}`);
      if (res.status === 401 || res.status === 403) {
        const e = new Error(res.status === 403 ? 'Clé API refusée par Steam' : 'Profil ou liste d\'amis privé(e)');
        e.status = res.status;
        throw e;
      }
      if (!res.ok) throw new Error(`Steam a répondu ${res.status}`);
      return res.json();
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  // Heures exactes de VRChat pour un compte (null si profil privé / pas le jeu)
  async vrchatTime(steamId) {
    const r = await this.api('IPlayerService/GetOwnedGames/v1', {
      steamid: steamId, include_played_free_games: 1, include_appinfo: 0, 'appids_filter[0]': VRCHAT_APP,
    });
    const g = r.response?.games?.[0];
    if (!g) return { owns: r.response && 'game_count' in r.response ? false : null };
    return { owns: true, minutes: g.playtime_forever, minutes2wks: g.playtime_2weeks || 0, lastPlayed: g.rtime_last_played ? g.rtime_last_played * 1000 : null };
  }

  // Tes amis Steam + qui a VRChat (progress(done, total) pour la barre d'avancement)
  async friends(steamId, force, progress = () => {}) {
    const fl = await this.api('ISteamUser/GetFriendList/v1', { steamid: steamId, relationship: 'friend' });
    const list = fl.friendslist?.friends || [];
    const summaries = [];
    for (let i = 0; i < list.length; i += 100) {
      const ids = list.slice(i, i + 100).map(f => f.steamid).join(',');
      const r = await this.api('ISteamUser/GetPlayerSummaries/v2', { steamids: ids });
      summaries.push(...(r.response?.players || []));
    }
    const out = [];
    let done = 0;
    for (const p of summaries) {
      const pub = p.communityvisibilitystate === 3;
      let t = this.cache.owned[p.steamid];
      if (pub && (force || !t || Date.now() - t.at > KEEP)) {
        try { t = { at: Date.now(), ...(await this.vrchatTime(p.steamid)) }; } catch { t = { at: Date.now(), owns: null }; }
        this.cache.owned[p.steamid] = t;
      }
      progress(++done, summaries.length);
      const inVRChat = p.gameid === VRCHAT_APP;
      if (!inVRChat && !t?.owns) continue; // on garde seulement ceux qui jouent à VRChat
      out.push({
        steamId: p.steamid, name: p.personaname, avatar: p.avatarfull || p.avatarmedium, url: p.profileurl,
        state: p.personastate, inVRChat, playing: p.gameextrainfo || null, lastOnline: p.lastlogoff ? p.lastlogoff * 1000 : null,
        since: (list.find(f => f.steamid === p.steamid)?.friend_since || 0) * 1000,
        minutes: t?.minutes ?? null, minutes2wks: t?.minutes2wks ?? null, lastPlayed: t?.lastPlayed ?? null,
      });
    }
    this.saveCache();
    return { total: summaries.length, friends: out };
  }
}

module.exports = { Steam, VRCHAT_APP };
