// =====================================================================
//  vrchat.js — connexion au compte VRChat (API web de VRChat)
//
//  Comment marche la connexion :
//   1. On envoie pseudo + mot de passe à VRChat (jamais enregistrés).
//   2. VRChat répond avec un "cookie" de session (auth) : c'est une sorte
//      de badge qui prouve qu'on est connecté.
//   3. Si la double authentification (2FA) est activée, VRChat demande
//      un code, puis donne un 2e cookie (twoFactorAuth).
//   4. On garde ces cookies CHIFFRÉS par Windows (safeStorage) pour ne pas
//      redemander le mot de passe à chaque lancement.
//
//  Règles respectées : une seule requête à la fois, avec une pause entre
//  chaque, et un "User-Agent" qui dit clairement qui on est.
// =====================================================================
const { safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const { version } = require('./package.json');

const API = 'https://api.vrchat.cloud/api/1';
const UA = `VRCLogs/${version} (https://github.com/TheGoddessQc/VRCLogs)`;
const GAP = 500; // millisecondes minimum entre deux requêtes

// Le rang de confiance VRChat est caché dans les "tags" du joueur
function trustRank(tags = []) {
  if (tags.includes('system_trust_veteran')) return 'Trusted User';
  if (tags.includes('system_trust_trusted')) return 'Known User';
  if (tags.includes('system_trust_known')) return 'User';
  if (tags.includes('system_trust_basic')) return 'New User';
  return 'Visitor';
}

// On garde seulement les infos utiles d'un ami
function summarizeUser(u, online) {
  return {
    id: u.id,
    name: u.displayName,
    status: u.status,                       // "join me", "active", "ask me", "busy", "offline"
    statusDescription: u.statusDescription || '',
    location: u.location || 'offline',      // "wrld_…:instance", "private", "traveling", "offline"
    platform: u.last_platform || '',
    avatarThumb: u.currentAvatarThumbnailImageUrl || '',
    avatarImage: u.currentAvatarImageUrl || '',
    icon: u.userIcon || u.profilePicOverrideThumbnail || u.profilePicOverride || '',
    bio: u.bio || '',
    lastLogin: u.last_login || null,
    rank: trustRank(u.tags),
    online,
  };
}

class VRChat {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'session.bin');
    this.cookies = {};
    this.user = null;
    this.worlds = new Map();
    this.queue = Promise.resolve();
    this.last = 0;
    this.load();
  }

  // ---------- Session chiffrée ----------
  load() {
    try {
      if (!safeStorage.isEncryptionAvailable()) return;
      this.cookies = JSON.parse(safeStorage.decryptString(fs.readFileSync(this.file)));
    } catch { this.cookies = {}; }
  }
  save() {
    if (!safeStorage.isEncryptionAvailable()) return; // pas de chiffrement = on ne garde rien sur le disque
    fs.writeFileSync(this.file, safeStorage.encryptString(JSON.stringify(this.cookies)));
  }
  clear() {
    this.cookies = {};
    this.user = null;
    try { fs.unlinkSync(this.file); } catch {}
  }
  cookieHeader() {
    return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  }

  // ---------- Requête vers VRChat (une à la fois, avec une pause) ----------
  request(method, p, { body, headers = {} } = {}) {
    const run = async () => {
      const wait = this.last + GAP - Date.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      this.last = Date.now();
      const h = { 'User-Agent': UA, ...headers };
      if (this.cookieHeader()) h.Cookie = this.cookieHeader();
      if (body) h['Content-Type'] = 'application/json';
      const res = await fetch(API + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
      // VRChat nous donne (ou retire) nos cookies de session
      for (const c of res.headers.getSetCookie?.() || []) {
        const m = c.match(/^(auth|twoFactorAuth)=([^;]*)/);
        if (m) { if (m[2]) this.cookies[m[1]] = m[2]; else delete this.cookies[m[1]]; }
      }
      let data = null;
      try { data = await res.json(); } catch {}
      if (!res.ok) {
        const msg = String(data?.error?.message || `Erreur ${res.status}`).replace(/^"|"$/g, '');
        const err = new Error(msg);
        err.status = res.status;
        throw err;
      }
      return data;
    };
    const pr = this.queue.then(run, run);
    this.queue = pr.catch(() => {});
    return pr;
  }

  // ---------- Connexion ----------
  async login(username, password) {
    this.cookies = {};
    const basic = Buffer.from(`${encodeURIComponent(username)}:${encodeURIComponent(password)}`).toString('base64');
    const data = await this.request('GET', '/auth/user', { headers: { Authorization: `Basic ${basic}` } });
    return this.afterAuth(data);
  }
  afterAuth(data) {
    if (data?.requiresTwoFactorAuth) {
      this.save();
      return { need2fa: data.requiresTwoFactorAuth }; // ex : ["totp", "otp"] ou ["emailOtp"]
    }
    this.user = data;
    this.save();
    return { user: summarizeUser(data, true) };
  }
  async verify2fa(method, code) {
    const ep = { totp: 'totp', emailOtp: 'emailotp', otp: 'otp' }[method] || 'totp';
    const r = await this.request('POST', `/auth/twofactorauth/${ep}/verify`, { body: { code: String(code).trim() } });
    if (r && r.verified === false) throw new Error('Code incorrect');
    return this.afterAuth(await this.request('GET', '/auth/user'));
  }
  // Au lancement : la session enregistrée est-elle encore valide ?
  async restore() {
    if (!this.cookies.auth) return null;
    try {
      const d = await this.request('GET', '/auth/user');
      if (d?.requiresTwoFactorAuth) return null;
      this.user = d;
      return summarizeUser(d, true);
    } catch (e) {
      if (e.status === 401) this.clear();
      return null;
    }
  }
  async logout() {
    try { await this.request('PUT', '/logout'); } catch {}
    this.clear();
  }

  // ---------- Données ----------
  async friends(offline) {
    const out = [];
    for (let off = 0; off < 5000; off += 100) {
      const page = await this.request('GET', `/auth/user/friends?offline=${offline}&n=100&offset=${off}`);
      out.push(...page);
      if (page.length < 100) break;
    }
    return out.map(u => summarizeUser(u, !offline));
  }
  async favorites() {
    const groups = await this.request('GET', '/favorite/groups?type=friend&n=50');
    const favs = [];
    for (let off = 0; off < 1000; off += 100) {
      const p = await this.request('GET', `/favorites?type=friend&n=100&offset=${off}`);
      favs.push(...p);
      if (p.length < 100) break;
    }
    return {
      groups: groups.map(g => ({ name: g.name, displayName: g.displayName })),
      favs: favs.map(f => ({ userId: f.favoriteId, tags: f.tags || [] })),
    };
  }
  async world(id) {
    if (this.worlds.has(id)) return this.worlds.get(id);
    const w = await this.request('GET', `/worlds/${encodeURIComponent(id)}`);
    const s = { id, name: w.name, thumb: w.thumbnailImageUrl, author: w.authorName };
    this.worlds.set(id, s);
    return s;
  }
  async myAvatars() {
    const out = [];
    for (let off = 0; off < 1000; off += 100) {
      const p = await this.request('GET', `/avatars?user=me&releaseStatus=all&sort=updated&order=descending&n=100&offset=${off}`);
      out.push(...p);
      if (p.length < 100) break;
    }
    return out.map(a => ({
      id: a.id, name: a.name, description: a.description || '',
      image: a.imageUrl, thumb: a.thumbnailImageUrl, status: a.releaseStatus, updated: a.updated_at,
      platforms: [...new Set((a.unityPackages || []).map(u => u.platform))],
    }));
  }

  // ---------- Images (avatars, mondes) ----------
  // On demande l'image à VRChat avec nos cookies, puis on suit la redirection
  // vers le serveur de fichiers SANS les cookies (pour ne pas les partager).
  async fetchImage(url) {
    const h = { 'User-Agent': UA };
    if (this.cookieHeader()) h.Cookie = this.cookieHeader();
    let res = await fetch(url, { headers: h, redirect: 'manual' });
    for (let i = 0; i < 3 && res.status >= 300 && res.status < 400; i++) {
      res = await fetch(new URL(res.headers.get('location'), url), { headers: { 'User-Agent': UA }, redirect: 'manual' });
    }
    return res;
  }
}

module.exports = { VRChat };
