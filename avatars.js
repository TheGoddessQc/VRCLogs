// =====================================================================
//  avatars.js — savoir si un avatar est PUBLIC
//
//  Les logs ne donnent que le NOM des avatars des autres joueurs.
//  On cherche ce nom dans avtrDB, une base publique qui répertorie
//  uniquement les avatars publics de VRChat :
//   - trouvé     → public : on a son identifiant et son image
//   - pas trouvé → privé (ou pas encore répertorié)
//
//  On envoie seulement le nom de l'avatar, rien sur toi.
//  Les résultats sont gardés 7 jours pour ne pas redemander.
// =====================================================================
const fs = require('fs');
const path = require('path');
const { version } = require('./package.json');

const UA = `VRCLogs/${version} (https://github.com/TheGoddessQc/VRCLogs)`;
const SEARCH = 'https://api.avtrdb.com/v2/avatar/search';
const GAP = 1000;                  // pause entre deux recherches (1 seconde)
const KEEP = 7 * 24 * 3600 * 1000; // durée du cache

const norm = s => String(s || '').trim().toLowerCase();

class AvatarSearch {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'avatars-cache.json');
    try { this.cache = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { this.cache = {}; }
    this.queue = Promise.resolve();
    this.last = 0;
  }
  save() {
    try { fs.writeFileSync(this.file, JSON.stringify(this.cache)); } catch {}
  }

  lookup(name, author) {
    const key = `${norm(name)}|${norm(author)}`;
    const c = this.cache[key];
    if (c && Date.now() - c.t < KEEP) return Promise.resolve(c.r);

    const run = async () => {
      const wait = this.last + GAP - Date.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      this.last = Date.now();
      try {
        let res;
        // Si avtrDB dit "trop de recherches" (erreur 429), on attend un peu et on réessaie (2 fois max)
        for (let attempt = 0; attempt < 3; attempt++) {
          res = await fetch(`${SEARCH}?query=${encodeURIComponent(name)}&page_size=10`, { headers: { 'User-Agent': UA } });
          if (res.status !== 429 && res.status < 500) break;
          const retry = Number(res.headers.get('retry-after')) || 3 * (attempt + 1);
          await new Promise(r => setTimeout(r, retry * 1000));
        }
        this.last = Date.now();
        if (!res.ok) return { error: `Erreur ${res.status}` };
        const list = (await res.json()).avatars || [];
        // Même nom exact… et même créateur si on le connaît
        const same = list.filter(a => norm(a.name) === norm(name));
        const best = author ? same.find(a => norm(a.author?.name) === norm(author)) : same[0];
        const r = best
          ? { found: true, id: best.vrc_id, name: best.name, author: best.author?.name || '', image: best.image_url,
              platforms: best.compatibility || [], explicit: !!best.explicit }
          : { found: false };
        this.cache[key] = { t: Date.now(), r };
        this.save();
        return r;
      } catch (e) {
        return { error: e.message }; // pas d'Internet, etc. : on ne garde pas en cache
      }
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }
}

module.exports = { AvatarSearch, UA };
