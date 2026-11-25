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

// Les images VRChat ont la forme …/image/file_xxx/1/256 : le dernier nombre est la largeur.
// On peut demander une version plus grande en changeant ce nombre.
const bigger = url => (url || '').replace(/\/image\/(file_[^/]+)\/(\d+)\/\d+$/, '/image/$1/$2/1024');

// On garde seulement les infos utiles d'un ami
// (VRChat a changé ses champs avec le temps : on essaie les nouveaux puis les anciens)
function summarizeUser(u, online) {
  const thumb = u.currentAvatarThumbnailImageUrl || u.currentAvatarImageUrl || '';
  return {
    id: u.id,
    name: u.displayName,
    status: u.status,                       // "join me", "active", "ask me", "busy", "offline"
    statusDescription: u.statusDescription || '',
    location: u.location || 'offline',      // "wrld_…:instance", "private", "traveling", "offline"
    platform: u.last_platform || '',
    avatarThumb: thumb,
    avatarImage: bigger(u.currentAvatarImageUrl || thumb),
    icon: u.userIcon || u.iconUrl || u.profilePicOverrideThumbnail || u.profilePicOverride || '',
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
  // Profil complet d'un joueur, comme sur VRChat.
  // VRChat sépare les infos en deux endroits :
  //   /users/{id}   → compte (inscription, dernière activité, ta note privée…)
  //   /profile/{id} → vitrine (bio, liens, badges, langues, groupes, mondes…)
  async profile(id) {
    const uid = encodeURIComponent(id);
    const u = await this.request('GET', `/users/${uid}`);
    let p = {};
    try { p = await this.request('GET', `/profile/${uid}?withGroupsAndWorlds=true`); } catch {}
    const tags = [...(u.tags || []), ...(p.trustTags || [])];
    const langs = (p.languages?.length ? p.languages : tags.filter(t => t.startsWith('language_')))
      .map(l => (typeof l === 'string' ? l : l.key || l.value || '').replace('language_', ''));
    return {
      ...summarizeUser(u, u.state === 'online' || (u.location && u.location !== 'offline')),
      bio: p.bio || u.bio || '',
      bioLinks: p.bioLinks || u.bioLinks || [],
      badges: (p.badges || []).map(b => ({ name: b.badgeName, desc: b.badgeDescription, image: b.badgeImageUrl })),
      banner: p.bannerUrl || u.bannerUrl || '',
      icon: p.iconUrl || u.iconUrl || u.userIcon || '',
      pronouns: p.pronouns || u.pronouns || '',
      languages: [...new Set(langs.filter(Boolean))],
      rank: trustRank(tags),
      vrcPlus: !!p.hasVrcPlus || tags.includes('system_supporter'),
      ageVerified: !!(p.ageVerified ?? u.ageVerified),
      dateJoined: u.date_joined || null,
      lastActivity: u.last_activity || null,
      note: u.note || '',
      isFriend: !!u.isFriend,
      allowAvatarCopying: !!u.allowAvatarCopying,
      representedGroup: p.representedGroup ? { id: p.representedGroup.id, name: p.representedGroup.name, icon: p.representedGroup.iconUrl } : null,
      groups: (p.groups?.list || []).map(g => ({ id: g.id || g.groupId, name: g.name, icon: g.iconUrl })),
      groupCount: p.groups?.count || 0,
      worlds: (p.publicWorlds || []).map(w => ({ id: w.id, name: w.name, thumb: w.thumbnailImageUrl || w.imageUrl })),
      worldCount: p.totalPublicWorldsCount || 0,
    };
  }
  // La VITRINE OFFICIELLE de la Marketplace ("Spotlight") : les mondes et groupes
  // que VRChat met en avant. Trouvé en observant ce que le site vrchat.com demande.
  async spotlight() {
    const r = await this.request('GET', '/infoPush?include=user-all&require=marketplace-page%2Ccontent-compatibility-pc');
    const d = (r || [])[0]?.data || {};
    const cat = type => (d.categories || []).find(c => c.type === type)?.ids || [];
    return { worlds: cat('worlds'), groups: cat('groups'), updated: r?.[0]?.updatedAt || null };
  }
  // ---------- Groupes VRChat ----------
  // Tous les groupes dont tu fais partie
  async myGroups() {
    const list = await this.request('GET', `/users/${encodeURIComponent(this.user.id)}/groups`);
    return list.map(g => ({
      id: g.groupId || g.id, name: g.name, code: g.shortCode ? `${g.shortCode}.${g.discriminator}` : '',
      icon: g.iconUrl, banner: g.bannerUrl, members: g.memberCount || 0, privacy: g.privacy,
      representing: !!g.isRepresenting, mutual: !!g.mutualGroup, owner: g.ownerId === this.user.id,
      lastPost: g.lastPostCreatedAt || null, unread: !!(g.lastPostCreatedAt && (!g.lastPostReadAt || g.lastPostReadAt < g.lastPostCreatedAt)),
    }));
  }
  // Les instances de groupe ouvertes EN CE MOMENT dans tes groupes
  async groupInstances() {
    const r = await this.request('GET', `/users/${encodeURIComponent(this.user.id)}/instances/groups`);
    return (r.instances || []).map(i => ({
      location: i.location || `${i.worldId}:${i.instanceId}`, groupId: i.ownerId, worldId: i.worldId,
      world: i.world ? { name: i.world.name, thumb: i.world.thumbnailImageUrl } : null,
      users: i.n_users ?? i.userCount ?? 0, capacity: i.capacity || 0, full: !!i.full,
      region: (i.region || '').toUpperCase(), access: i.groupAccessType || i.type, name: i.displayName || i.name || '',
      platforms: i.platforms || {}, queue: i.queueEnabled ? i.queueSize || 0 : null, ageGate: !!i.ageGate,
    }));
  }
  // Fiche complète d'un groupe : description, règles, liens, annonce, dernières publications
  async groupDetails(id) {
    const gid = encodeURIComponent(id);
    const g = await this.request('GET', `/groups/${gid}?includeRoles=false&purpose=group`);
    let announcement = null, posts = [];
    try { const a = await this.request('GET', `/groups/${gid}/announcement`); if (a?.id) announcement = { title: a.title, text: a.text, image: a.imageUrl, date: a.createdAt }; } catch {}
    try { posts = ((await this.request('GET', `/groups/${gid}/posts?n=5&offset=0&publicOnly=false`)).posts || []).map(p => ({ title: p.title, text: p.text, image: p.imageUrl, date: p.createdAt })); } catch {}
    return {
      id, name: g.name, code: g.shortCode ? `${g.shortCode}.${g.discriminator}` : '', icon: g.iconUrl, banner: g.bannerUrl,
      description: g.description || '', rules: g.rules || '', links: g.links || [], languages: g.languages || [],
      members: g.memberCount || 0, online: g.onlineMemberCount || 0, verified: !!g.isVerified, privacy: g.privacy, joinState: g.joinState,
      createdAt: g.createdAt, joinedAt: g.myMember?.joinedAt || null, representing: !!g.myMember?.isRepresenting,
      storeId: g.storeId || null, announcement, posts,
    };
  }
  // Petite fiche d'un groupe (avec l'identifiant de sa boutique)
  async group(id) {
    if (!this.groups) this.groups = new Map();
    if (this.groups.has(id)) return this.groups.get(id);
    const g = await this.request('GET', `/groups/${encodeURIComponent(id)}?includeRoles=false&purpose=other`);
    const s = { id, name: g.name, icon: g.iconUrl, banner: g.bannerUrl, members: g.memberCount, storeId: g.storeId || null, shortCode: g.shortCode, discriminator: g.discriminator };
    this.groups.set(id, s);
    return s;
  }
  // Boutique d'un monde ou d'un groupe (LECTURE SEULE : aucun achat possible depuis VRCLogs)
  async store(storeId) {
    const s = await this.request('GET', `/economy/store?storeId=${encodeURIComponent(storeId)}&hydrateListings=true`);
    return {
      id: s.id || storeId, name: s.displayName, type: s.storeType, seller: s.sellerDisplayName,
      worldId: s.worldId || null, groupId: s.groupId || null, description: s.description || '',
      listings: (s.listings || []).filter(l => l.active !== false && !l.archived).map(l => ({
        id: l.id, name: l.displayName, description: l.description || '', price: l.priceTokens,
        vrcPlusPrice: l.vrcPlusDiscountPrice || null, listingType: l.listingType,
        duration: l.duration, durationType: l.durationType, types: l.productTypes || [],
        image: l.imageUrl || '', created: l.created, updated: l.updated, soldByVrc: !!l.soldByVrc,
      })),
    };
  }
  async world(id) {
    if (this.worlds.has(id)) return this.worlds.get(id);
    const w = await this.request('GET', `/worlds/${encodeURIComponent(id)}`);
    const s = { id, name: w.name, thumb: w.thumbnailImageUrl, author: w.authorName, storeId: w.storeId || null, occupants: w.occupants || 0 };
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
      image: a.imageUrl, thumb: a.thumbnailImageUrl, status: a.releaseStatus,
      created: a.created_at, updated: a.updated_at, version: a.version, author: a.authorName,
      tags: (a.tags || []).filter(t => !t.startsWith('admin_')),
      styles: [a.styles?.primary, a.styles?.secondary].filter(Boolean),
      platforms: [...new Set((a.unityPackages || []).map(u => u.platform))],
      // Note de performance par plateforme (Excellent → Very Poor)
      performance: Object.fromEntries((a.unityPackages || []).filter(u => u.performanceRating && u.variant !== 'impostor')
        .map(u => [u.platform, u.performanceRating])),
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
