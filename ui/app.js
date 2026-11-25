// =====================================================================
//  app.js — le "cerveau" de l'interface de VRCLogs
//
//  Comment ça marche, en résumé :
//   1. main.js lit les logs VRChat et nous envoie une liste d'ÉVÉNEMENTS
//      (ex : { type: 'join', name: 'hortemuus', t: 1732460400000 }).
//   2. build() transforme cette liste en un MODÈLE plus pratique :
//      les sessions (mondes visités), les joueurs, les groupes…
//   3. Les fonctions render…() fabriquent le HTML de chaque page
//      à partir du modèle.
//   4. Quand un nouvel événement arrive, on refait build() puis render().
// =====================================================================

// ---------- Variables globales (l'"état" de l'app) ----------
let EVENTS = [];          // tous les événements reçus
let LIVE = false;         // VRChat est-il ouvert ?
let M = null;             // le modèle calculé par build()
let currentView = 'live'; // la page affichée
let feedLimit = 300;      // nombre de lignes affichées dans le journal
let DAY = startOfDay(Date.now()); // jour affiché dans "Résumé du jour"

// localStorage = petite mémoire du navigateur qui reste après fermeture de l'app.
// On y range les favoris, les notes, les tags et les paramètres.
const load = (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } };
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const FAVS = new Set(load('favs', []));
const META = load('meta', {}); // { cléJoueur: { note: '...', tags: ['ami', ...] } }
const SETTINGS = Object.assign({ theme: 'goddess', compact: false, anim: true, avtrdb: true, autoUpdate: true }, load('settings', {}));
const ALERTS = Object.assign({ favs: true, friendOnline: true, newPeople: false, minMeets: 0, tags: [], silent: false }, load('alerts', {}));

// ---------- Petits outils ----------
const $ = id => document.getElementById(id);
// esc() empêche un pseudo bizarre (ex : "<script>") de casser la page
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
function startOfDay(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
function fmtTime(t) { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function fmtDate(t) { const d = new Date(t); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; }
function fmtDT(t) { return `${fmtDate(t)} ${fmtTime(t)}`; }
function fmtDayLong(t) { return new Date(t).toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' }); }
function fmtDur(ms) {
  const m = Math.max(0, Math.round((ms || 0) / 60000));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${pad(m % 60)}`;
}
function ago(t) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  if (m < 1440) return `il y a ${Math.round(m / 60)} h`;
  return `il y a ${Math.round(m / 1440)} j`;
}
function hash(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.codePointAt(0)) | 0; return Math.abs(h); }

// ---------- Pastilles de couleur et liens ----------
// La couleur vient d'un "hash" de l'identifiant : même joueur = toujours même couleur.
function dot(key, name, cls = '') {
  const h = hash(key);
  const letter = ([...String(name).replace(/[^\p{L}\p{N}]/gu, '')][0] || '?').toUpperCase();
  return `<span class="dot ${cls}" style="background:linear-gradient(135deg, hsl(${h % 360} 70% 55%), hsl(${(h % 360 + 40) % 360} 75% 45%))">${esc(letter)}</span>`;
}
const tagsOf = key => META[key]?.tags || [];
const tagChips = key => tagsOf(key).map(t => `<span class="tag small">#${esc(t)}</span>`).join('');
const pLink = (key, name) => `<a class="link" data-player="${esc(key)}">${dot(key, name)}${esc(name)}</a>`;
const sLink = (sid, name) => `<a class="link" data-session="${sid}">${esc(name)}</a>`;
const isFresh = e => e.fresh && Date.now() - e.fresh < 2000;

// =====================================================================
//  build() : transforme la liste d'événements en modèle
// =====================================================================
function build() {
  const sessions = [];          // un "passage" dans un monde
  const players = new Map();    // Map = dictionnaire clé → valeur
  const nameToKey = new Map();  // pseudo → identifiant (pour les avatars)
  const avAuthor = new Map();   // nom d'avatar → créateur
  let self = null;
  let cur = null;               // la session en cours pendant la lecture
  let lastT = 0;
  let xrDevice = null;          // « None » = mode bureau, sinon le casque VR

  const getP = (key, name, id) => {
    let p = players.get(key);
    if (!p) {
      p = { key, id, name, names: new Set(), first: Infinity, last: 0, time: 0,
        sessions: [], worlds: new Map(), avatarHist: [] };
      players.set(key, p);
    }
    p.name = name;
    p.names.add(name);
    if (id) p.id = id;
    return p;
  };
  // Ajoute du "temps ensemble" à un joueur
  const addTime = (key, ms) => {
    const p = players.get(key);
    if (p) { p.time += ms; p.worlds.set(cur.world, (p.worlds.get(cur.world) || 0) + ms); }
    const sp = cur.people.get(key);
    if (sp) sp.time += ms;
  };
  // Ferme la session en cours (tu as changé de monde ou quitté le jeu)
  const close = t => {
    if (!cur) return;
    for (const [k, since] of cur.present) addTime(k, t - since);
    cur.present.clear();
    cur.end = t;
    cur = null;
  };
  const tick = t => { // un point du graphique d'instance
    cur.timeline.push({ t, c: cur.present.size });
    if (cur.present.size > cur.peak.c) cur.peak = { t, c: cur.present.size };
  };

  // On parcourt tous les événements dans l'ordre, comme si on rejouait l'histoire
  for (const e of EVENTS) {
    lastT = e.t;
    e.sid = cur ? cur.id : null;
    switch (e.type) {
      case 'self':
        self = { id: e.userId, name: e.name };
        break;
      case 'world':
        close(e.t);
        cur = { id: sessions.length, worldId: e.worldId, world: e.world, instance: e.instance, instType: e.instType, region: e.region,
          start: e.t, end: null, present: new Map(), people: new Map(), videos: [], events: [],
          timeline: [{ t: e.t, c: 0 }], peak: { t: e.t, c: 0 } };
        sessions.push(cur);
        e.sid = cur.id;
        break;
      case 'join': {
        if (!cur) break;
        const key = e.userId || e.name;
        nameToKey.set(e.name, key);
        const p = getP(key, e.name, e.userId);
        p.first = Math.min(p.first, e.t);
        p.last = Math.max(p.last, e.t);
        if (!cur.people.has(key)) {
          cur.people.set(key, { key, name: e.name, first: e.t, time: 0 });
          p.sessions.push(cur.id);
        }
        if (!cur.present.has(key)) { cur.present.set(key, e.t); tick(e.t); }
        e.key = key;
        break;
      }
      case 'leave': {
        if (!cur) break;
        const key = e.userId || nameToKey.get(e.name) || e.name;
        const since = cur.present.get(key);
        if (since != null) { addTime(key, e.t - since); cur.present.delete(key); tick(e.t); }
        const p = players.get(key);
        if (p) p.last = Math.max(p.last, e.t);
        e.key = key;
        break;
      }
      case 'avatar': {
        const key = nameToKey.get(e.name);
        if (!key) break;
        e.key = key;
        const h = players.get(key).avatarHist;
        // on ignore si c'est le même avatar que juste avant
        if (!h.length || h[h.length - 1].avatar !== e.avatar) h.push({ t: e.t, avatar: e.avatar, world: cur?.world });
        break;
      }
      case 'avatarinfo': // qui a créé cet avatar (pour mieux le retrouver dans la base publique)
        avAuthor.set(e.avatar, e.author);
        break;
      case 'xr': // VR ou mode bureau (lu au démarrage de VRChat)
        xrDevice = e.device;
        break;
      case 'worldstore': // ce monde a une boutique
        if (cur) cur.storeId = e.storeId;
        break;
      case 'video':
        if (cur) cur.videos.push(e);
        break;
      case 'quit':
      case 'end':
        close(e.t);
        break;
    }
    if (cur && !['self', 'avatarinfo', 'worldstore', 'xr'].includes(e.type)) cur.events.push(e);
  }

  let current = null;
  if (cur) { if (LIVE) current = cur; else close(lastT); }

  // Ton propre compte : la personne présente dans (presque) toutes les sessions
  if (!self && sessions.length) {
    let best = null;
    for (const p of players.values()) if (!best || p.sessions.length > best.sessions.length) best = p;
    if (best && best.sessions.length >= sessions.length * 0.8) self = { id: best.key, name: best.name };
  }
  if (self) players.delete(self.id);

  // vr : true = casque, false = mode bureau, null = on ne sait pas
  M = { sessions, players, self, current, avAuthor, vr: xrDevice == null ? null : !/^none$/i.test(xrDevice) };
  M.groups = detectGroups();
}

// ---------------------------------------------------------------------
//  Détection des groupes d'amis
//  Idée : si deux personnes ARRIVENT (ou PARTENT) à moins de 20 secondes
//  d'intervalle, dans au moins 2 sessions différentes, elles sont
//  probablement ensemble.
// ---------------------------------------------------------------------
function detectGroups() {
  const WINDOW = 20000;
  const pairs = new Map(); // "a|b" → Set des sessions
  const selfId = M.self?.id;
  const addPairs = (list, sid) => {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length && list[j].t - list[i].t <= WINDOW; j++) {
        const a = list[i].key, b = list[j].key;
        if (a === b) continue;
        const k = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (!pairs.has(k)) pairs.set(k, new Set());
        pairs.get(k).add(sid);
      }
    }
  };
  for (const s of M.sessions) {
    const end = s.end ?? Date.now();
    const ok = e => e.key && e.key !== selfId && M.players.has(e.key);
    // on ignore la 1re minute (tout le monde "arrive" quand TU arrives) et la dernière (quand tu pars)
    // Chaque "signal" compte : arrivés ensemble (j) ou repartis ensemble (l), dans chaque session
    addPairs(s.events.filter(e => e.type === 'join' && ok(e) && e.t - s.start > 60000), `${s.id}j`);
    addPairs(s.events.filter(e => e.type === 'leave' && ok(e) && end - e.t > 60000), `${s.id}l`);
  }

  // Liens forts = au moins 2 signaux (ex : arrivés ET repartis ensemble)
  const links = new Map(); // joueur → [{ key, n }]
  const parent = new Map(); // pour regrouper (algorithme "union-find")
  const find = x => { while (parent.get(x) !== x) x = parent.get(x); return x; };
  for (const [k, set] of pairs) {
    if (set.size < 2) continue;
    const [a, b] = k.split('|');
    for (const [x, y] of [[a, b], [b, a]]) {
      if (!links.has(x)) links.set(x, []);
      links.get(x).push({ key: y, n: set.size });
      if (!parent.has(x)) parent.set(x, x);
    }
    parent.set(find(a), find(b));
  }
  const groups = new Map();
  for (const k of parent.keys()) {
    const r = find(k);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(k);
  }
  for (const l of links.values()) l.sort((a, b) => b.n - a.n);
  const list = [...groups.values()]
    .map(members => ({ members, strength: members.reduce((a, k) => a + links.get(k).reduce((x, l) => x + l.n, 0), 0) / 2 }))
    .sort((a, b) => b.strength - a.strength);
  return { list, links };
}

// Temps "en direct" pour la session en cours (pas encore fermée)
function liveExtra(key) {
  const c = M.current;
  if (!c || !c.present.has(key)) return 0;
  return Date.now() - c.present.get(key);
}
const playerTime = p => p.time + liveExtra(p.key);
const sessionEnd = s => s.end ?? Date.now();

// =====================================================================
//  Page : EN DIRECT
// =====================================================================
function renderLive() {
  const c = M.current;
  const el = $('view-live');
  if (!c) {
    const last = M.sessions[M.sessions.length - 1];
    el.innerHTML = `<div class="hero"><div class="muted">VRChat n'est pas ouvert</div>
      <div class="world">Rien en direct pour l'instant</div>
      ${last ? `<div class="muted">Dernier monde : ${sLink(last.id, last.world)} · ${ago(sessionEnd(last))}</div>` : ''}</div>
      <div class="empty">Lance VRChat : les arrivées, départs et vidéos s'afficheront ici en temps réel.</div>`;
    return;
  }
  const present = [...c.present.entries()]
    .filter(([k]) => !M.self || k !== M.self.id)
    .map(([k, since]) => ({ k, since, p: M.players.get(k) }))
    .sort((a, b) => FAVS.has(b.k) - FAVS.has(a.k) || a.since - b.since);
  const recent = c.events.filter(e => e.type !== 'avatar').slice(-40).reverse();

  el.innerHTML = `
    <div class="hero">
      <div class="muted">Tu es dans</div>
      <div class="world">${esc(c.world)} <span class="badge">${esc(c.instType)}</span>${c.region ? `<span class="badge">${esc(c.region)}</span>` : ''}</div>
      <div class="muted">Depuis ${fmtTime(c.start)} · ${fmtDur(Date.now() - c.start)} · ${present.length} autre(s) joueur(s) · pic : ${c.peak.c}
        · <a class="link" data-url="https://vrchat.com/home/world/${esc(c.worldId)}">Voir le monde ↗</a></div>
    </div>
    <h2>Joueurs dans l'instance</h2>
    ${instanceChart(c)}
    <h2>Présents maintenant</h2>
    <div class="grid">${present.map(({ k, since, p }) => {
      const meets = p ? p.sessions.length : 1;
      const isNew = Date.now() - since < 6000;
      return `<div class="pcard ${FAVS.has(k) ? 'fav' : ''} ${isNew ? 'new' : ''}" data-player="${esc(k)}">
        ${dot(k, p?.name || k)}
        <div><div class="n">${FAVS.has(k) ? '⭐ ' : ''}${esc(p?.name || k)} ${FRIENDS.has(k) ? '<span class="badge">💜 Ami</span>' : ''} ${tagChips(k)}</div>
        <div class="s">Ici depuis ${fmtDur(Date.now() - since)} · ${meets === 1 ? 'Première rencontre ✨' : `Vu ${meets} fois · ${fmtDur(playerTime(p))} au total`}</div>
        ${META[k]?.note ? `<div class="s note">📝 ${esc(META[k].note)}</div>` : ''}</div>
      </div>`;
    }).join('') || '<div class="muted">Personne d\'autre ici.</div>'}</div>
    ${c.videos.length ? `<h2>Vidéos jouées ici</h2><div class="list">${c.videos.slice().reverse().map(rowHtml).join('')}</div>` : ''}
    <h2>Activité de l'instance</h2>
    <div class="list">${recent.map(rowHtml).join('')}</div>`;
}

// ---------------------------------------------------------------------
//  Graphique d'instance (SVG = image dessinée avec du code)
// ---------------------------------------------------------------------
function instanceChart(s, width) {
  // Largeur réelle disponible : le texte garde la même taille, que la fenêtre soit petite ou en plein écran
  const W = width || Math.max(600, Math.round((document.querySelector('main')?.clientWidth || 860) - 90)), H = 170, L = 34, R = 10, T = 12, B = 22;
  const t0 = s.start, t1 = Math.max(sessionEnd(s), t0 + 60000);
  const max = Math.max(1, ...s.timeline.map(p => p.c));
  const x = t => L + (t - t0) / (t1 - t0) * (W - L - R);
  const y = c => H - B - (c / max) * (H - T - B);
  // On dessine un "escalier" : le nombre de joueurs change d'un coup à chaque arrivée/départ
  let d = `M${x(t0)},${y(0)}`, prev = 0;
  for (const p of s.timeline) { d += ` L${x(p.t)},${y(prev)} L${x(p.t)},${y(p.c)}`; prev = p.c; }
  d += ` L${x(t1)},${y(prev)}`;
  const area = `${d} L${x(t1)},${y(0)} Z`;
  return `<div class="card ichart" data-sid="${s.id}" data-t0="${t0}" data-t1="${t1}" data-l="${L}" data-r="${R}" data-w="${W}">
    <svg viewBox="0 0 ${W} ${H}">
      <defs><linearGradient id="ig${s.id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" style="stop-color:var(--accent);stop-opacity:.45"/><stop offset="1" style="stop-color:var(--accent);stop-opacity:0"/>
      </linearGradient></defs>
      <line x1="${L}" x2="${W - R}" y1="${y(max)}" y2="${y(max)}" class="grid-line"/>
      <line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" class="grid-line"/>
      <text x="${L - 6}" y="${y(max) + 4}" class="axis" text-anchor="end">${max}</text>
      <text x="${L - 6}" y="${y(0) + 4}" class="axis" text-anchor="end">0</text>
      <text x="${L}" y="${H - 4}" class="axis">${fmtTime(t0)}</text>
      <text x="${W - R}" y="${H - 4}" class="axis" text-anchor="end">${s.end ? fmtTime(t1) : 'maintenant'}</text>
      <path d="${area}" fill="url(#ig${s.id})"/>
      <path d="${d}" fill="none" style="stroke:var(--accent)" stroke-width="2"/>
      <line class="cursor" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>
      <line class="pin" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>
    </svg>
    <div class="ichart-controls">
      <button class="ghost" data-chartstep="-1" title="Arrivée/départ précédent">⏮</button>
      <input type="range" class="chart-slider" min="${t0}" max="${t1}" step="1000" value="${t1}">
      <button class="ghost" data-chartstep="1" title="Arrivée/départ suivant">⏭</button>
      <input type="time" class="chart-time" step="1" title="Aller à une heure précise">
      <button class="ghost chart-unpin" title="Désépingler">📌✕</button>
    </div>
    <div class="ichart-info muted">🖱️ Survole pour explorer · <b>clique</b> pour épingler un moment · ou utilise le curseur, ⏮ ⏭ et l'heure</div>
  </div>`;
}

// ---------------------------------------------------------------------
//  Choisir un moment dans le graphique
//  CHART_PIN garde le moment épinglé, même quand la page se redessine.
// ---------------------------------------------------------------------
let CHART_PIN = null; // { sid, t }
function chartGeom(box) {
  return { W: +box.dataset.w, L: +box.dataset.l, R: +box.dataset.r, t0: +box.dataset.t0, t1: +box.dataset.t1 };
}
// Montre le moment t : ligne verticale + liste de qui était là
function showChartTime(box, t, pinned) {
  const g = chartGeom(box);
  t = Math.min(g.t1, Math.max(g.t0, t));
  const x = g.L + (t - g.t0) / (g.t1 - g.t0) * (g.W - g.L - g.R);
  const line = box.querySelector(pinned ? '.pin' : '.cursor');
  line.setAttribute('x1', x); line.setAttribute('x2', x); line.setAttribute('visibility', 'visible');
  const s = M.sessions[+box.dataset.sid];
  const who = presentAt(s, t);
  // Qui vient d'arriver / de partir dans la minute autour de ce moment
  const near = s.events.filter(e => (e.type === 'join' || e.type === 'leave') && e.key && Math.abs(e.t - t) <= 60000 && (!M.self || e.key !== M.self.id));
  const d = new Date(t);
  box.querySelector('.ichart-info').innerHTML =
    `${pinned ? '📌 ' : ''}<b>${fmtTime(t)}:${pad(d.getSeconds())}</b> — ${who.size} autre(s) joueur(s)` +
    (near.length ? `<div class="near">${near.map(e => `<span class="${e.type === 'join' ? 't-join' : 't-leave'}">${e.type === 'join' ? '➜' : '←'} ${esc(e.name)}</span>`).join(' ')}</div>` : '') +
    `<div class="who">${[...who.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([k, n]) => pLink(k, n)).join(' ')}</div>`;
  if (pinned) {
    box.querySelector('.chart-slider').value = t;
    box.querySelector('.chart-time').value = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    box.classList.add('pinned');
  }
}
function pinChart(box, t) {
  CHART_PIN = { sid: +box.dataset.sid, t };
  box.querySelector('.cursor').setAttribute('visibility', 'hidden');
  showChartTime(box, t, true);
}
// Après chaque affichage : on remet le moment épinglé s'il y en a un
function initCharts() {
  document.querySelectorAll('.ichart').forEach(box => {
    if (CHART_PIN && CHART_PIN.sid === +box.dataset.sid) pinChart(box, CHART_PIN.t);
  });
}
function timeFromMouse(box, ev) {
  const g = chartGeom(box);
  const r = box.querySelector('svg').getBoundingClientRect();
  const vx = (ev.clientX - r.left) / r.width * g.W;
  if (vx < g.L || vx > g.W - g.R) return null;
  return g.t0 + (vx - g.L) / (g.W - g.L - g.R) * (g.t1 - g.t0);
}
document.addEventListener('click', ev => {
  const box = ev.target.closest?.('.ichart');
  if (!box) return;
  if (ev.target.closest('svg')) { const t = timeFromMouse(box, ev); if (t) pinChart(box, t); }
  const step = ev.target.closest('[data-chartstep]');
  if (step) {
    // saute à l'arrivée/au départ précédent ou suivant
    const s = M.sessions[+box.dataset.sid];
    const cur = CHART_PIN?.sid === s.id ? CHART_PIN.t : +box.dataset.t1;
    // On se place toujours OFFSET ms APRÈS un événement (pour l'inclure dans la liste).
    // Donc l'événement où on est = cur - OFFSET : on cherche strictement avant / après lui.
    const OFFSET = 500;
    const times = [...new Set(s.timeline.map(p => p.t))].sort((a, b) => a - b);
    const here = cur - OFFSET;
    const next = +step.dataset.chartstep > 0 ? times.find(t => t > here) : [...times].reverse().find(t => t < here);
    if (next != null) pinChart(box, next + OFFSET);
  }
  if (ev.target.closest('.chart-unpin')) {
    CHART_PIN = null;
    box.classList.remove('pinned');
    box.querySelector('.pin').setAttribute('visibility', 'hidden');
    box.querySelector('.ichart-info').innerHTML = '🖱️ Survole pour explorer · <b>clique</b> pour épingler un moment';
  }
});
document.addEventListener('input', ev => {
  const box = ev.target.closest?.('.ichart');
  if (!box) return;
  if (ev.target.classList.contains('chart-slider')) pinChart(box, +ev.target.value);
  if (ev.target.classList.contains('chart-time') && ev.target.value) {
    const [h, m, sec = 0] = ev.target.value.split(':').map(Number);
    const g = chartGeom(box);
    // l'heure tapée, le jour de la session (ou le lendemain si la session passe minuit)
    let t = new Date(g.t0).setHours(h, m, sec, 0);
    if (t < g.t0 - 1000) t += 86400000;
    pinChart(box, t);
  }
});
// Qui était présent à l'instant t ? On "rejoue" les arrivées/départs jusqu'à t.
function presentAt(s, t) {
  const set = new Map();
  for (const e of s.events) {
    if (e.t > t) break;
    if (e.type === 'join' && e.key) set.set(e.key, e.name);
    if (e.type === 'leave' && e.key) set.delete(e.key);
  }
  if (M.self) set.delete(M.self.id);
  return set;
}
// Survol : on explore… sauf si un moment est épinglé (alors la liste ne bouge plus)
document.addEventListener('mousemove', ev => {
  const box = ev.target.closest?.('.ichart');
  if (!box || !ev.target.closest('svg')) return;
  const t = timeFromMouse(box, ev);
  if (t == null) return;
  if (box.classList.contains('pinned')) {
    const g = chartGeom(box);
    const x = g.L + (t - g.t0) / (g.t1 - g.t0) * (g.W - g.L - g.R);
    const line = box.querySelector('.cursor');
    line.setAttribute('x1', x); line.setAttribute('x2', x); line.setAttribute('visibility', 'visible');
    return;
  }
  showChartTime(box, t, false);
});

// ---------- Une ligne d'événement (utilisée partout) ----------
function rowHtml(e) {
  const s = e.sid != null ? M.sessions[e.sid] : null;
  const ctx = s && e.type !== 'world' ? `<span class="ctx"> · ${esc(s.world)}</span>` : '';
  let ico = '', txt = '', cls = '';
  switch (e.type) {
    case 'world':
      ico = '🌍'; cls = 'world';
      txt = `Arrivée dans ${sLink(e.sid, e.world)} <span class="badge">${esc(e.instType)}</span>`;
      break;
    case 'join':
      ico = '<span class="t-join">➜</span>';
      txt = `${pLink(e.key, e.name)} <span class="t-join">a rejoint</span>${ctx}`;
      break;
    case 'leave':
      ico = '<span class="t-leave">←</span>';
      txt = `${pLink(e.key, e.name)} <span class="t-leave">est parti</span>${ctx}`;
      break;
    case 'avatar':
      ico = '<span class="t-avatar">🎭</span>';
      txt = `${e.key ? pLink(e.key, e.name) : esc(e.name)} porte <b>${esc(e.avatar)}</b>${ctx}`;
      break;
    case 'video':
      ico = '<span class="t-video">▶</span>';
      txt = `<a class="link" data-url="${esc(e.url)}">${esc(e.url)}</a>${ctx}`;
      break;
  }
  return `<div class="row ${cls} ${isFresh(e) ? 'new' : ''}"><span class="time">${fmtDT(e.t)}</span><span class="ico">${ico}</span><span>${txt}</span></div>`;
}

// =====================================================================
//  Page : RÉSUMÉ DU JOUR
// =====================================================================
function renderDay() {
  const d0 = DAY, d1 = DAY + 86400000;
  const overlap = s => Math.max(0, Math.min(sessionEnd(s), d1) - Math.max(s.start, d0));
  const S = M.sessions.filter(s => overlap(s) > 0);
  const total = S.reduce((a, s) => a + overlap(s), 0);

  const worldTime = new Map();
  for (const s of S) worldTime.set(s.world, (worldTime.get(s.world) || 0) + overlap(s));
  const topW = [...worldTime.entries()].sort((a, b) => b[1] - a[1]);

  const people = new Map(); // temps passé avec chaque joueur ce jour-là
  for (const s of S) for (const p of s.people.values()) {
    if (!M.players.has(p.key)) continue;
    people.set(p.key, (people.get(p.key) || 0) + p.time + (s === M.current ? liveExtra(p.key) : 0));
  }
  const topP = [...people.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const newbies = [...M.players.values()].filter(p => p.first >= d0 && p.first < d1);
  const peak = S.reduce((best, s) => (!best || s.peak.c > best.peak.c ? s : best), null);
  const videos = S.reduce((a, s) => a + s.videos.length, 0);
  const isToday = DAY === startOfDay(Date.now());

  $('view-day').innerHTML = `
    <header class="bar">
      <h1>Résumé du jour</h1>
      <button class="ghost" data-day="-1">◀</button>
      <span class="daylabel">${fmtDayLong(DAY)}${isToday ? ' (aujourd\'hui)' : ''}</span>
      <button class="ghost" data-day="1" ${isToday ? 'disabled' : ''}>▶</button>
    </header>
    ${!S.length ? '<div class="empty">Pas de VRChat ce jour-là 💤</div>' : `
    <div class="kpis">
      <div class="card kpi"><div class="v">${fmtDur(total)}</div><div class="l">Temps en jeu</div></div>
      <div class="card kpi"><div class="v">${worldTime.size}</div><div class="l">Mondes</div></div>
      <div class="card kpi"><div class="v">${people.size}</div><div class="l">Personnes croisées</div></div>
      <div class="card kpi"><div class="v">${newbies.length}</div><div class="l">Nouvelles rencontres</div></div>
    </div>
    <h2>Ta journée heure par heure</h2>
    <div class="card"><div class="daybar">
      ${S.map(s => {
        const a = Math.max(s.start, d0), b = Math.min(sessionEnd(s), d1);
        return `<div class="seg" data-session="${s.id}" title="${esc(s.world)} · ${fmtTime(a)} → ${fmtTime(b)}"
          style="left:${(a - d0) / 864000}%;width:${Math.max(0.3, (b - a) / 864000)}%;background:hsl(${hash(s.worldId) % 360} 60% 50%)"></div>`;
      }).join('')}
    </div><div class="dayticks">${[0, 3, 6, 9, 12, 15, 18, 21, 24].map(h => `<span>${h}h</span>`).join('')}</div></div>
    ${peak && peak.peak.c > 1 ? `<div class="card highlight">🔥 <b>Moment fort :</b> ${sLink(peak.id, peak.world)} avec <b>${peak.peak.c} joueurs</b> en même temps à ${fmtTime(peak.peak.t)}${videos ? ` · ${videos} vidéo(s) jouée(s) dans la journée` : ''}</div>` : ''}
    <div class="cols">
      <div><h2>Mondes</h2><div class="card">${topW.map(([w, ms]) => hbar(esc(w), ms, topW[0][1], fmtDur(ms))).join('')}</div></div>
      <div><h2>Avec qui tu as passé le plus de temps</h2><div class="card">${topP.map(([k, ms]) => hbar(pLink(k, M.players.get(k).name), ms, topP[0][1], fmtDur(ms))).join('') || '<div class="muted">—</div>'}</div></div>
    </div>
    <h2>Nouvelles rencontres ✨ (${newbies.length})</h2>
    <div class="tags">${newbies.map(p => `<a class="tag link" data-player="${esc(p.key)}">${dot(p.key, p.name)}${esc(p.name)}</a>`).join('') || '<span class="muted">Personne de nouveau.</span>'}</div>`}`;
}

// =====================================================================
//  Page : JOURNAL
// =====================================================================
function feedFiltered() {
  const types = new Set([...document.querySelectorAll('#feedTypes input:checked')].map(i => i.value));
  const q = $('feedSearch').value.trim().toLowerCase();
  const days = +$('feedRange').value;
  let from = 0;
  if (days === 1) from = startOfDay(Date.now());
  else if (days) from = Date.now() - days * 86400000;
  const out = [];
  for (let i = EVENTS.length - 1; i >= 0; i--) {
    const e = EVENTS[i];
    if (e.t < from) break;
    if (!types.has(e.type)) continue;
    if (q) {
      const s = e.sid != null ? M.sessions[e.sid].world : '';
      const hay = `${e.name || ''} ${e.world || ''} ${e.avatar || ''} ${e.url || ''} ${s}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    out.push(e);
  }
  return out;
}
function renderFeed() {
  const list = feedFiltered();
  $('feedCount').textContent = `${list.length.toLocaleString(LOCALE)} événement(s)`;
  $('feedList').innerHTML = list.slice(0, feedLimit).map(rowHtml).join('') || '<div class="empty">Aucun résultat.</div>';
  $('feedMore').style.display = list.length > feedLimit ? '' : 'none';
}
async function exportCsv() {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = ['Date;Heure;Type;Joueur;Monde;Détail'];
  for (const e of feedFiltered().reverse()) {
    const s = e.sid != null ? M.sessions[e.sid].world : '';
    lines.push([fmtDate(e.t), fmtTime(e.t), e.type, e.name, e.world || s, e.avatar || e.url || e.instType].map(q).join(';'));
  }
  if (await window.api.exportCsv(lines.join('\r\n'))) toast('✅ Export CSV enregistré');
}

// =====================================================================
//  Page : MONDES  +  fiche d'une session
// =====================================================================
function renderWorlds() {
  const q = $('worldSearch').value.trim().toLowerCase();
  const list = M.sessions.filter(s => !q || s.world.toLowerCase().includes(q)).slice(-400).reverse();
  let lastDay = '';
  $('worldList').innerHTML = list.map(s => {
    const day = fmtDate(s.start);
    const head = day !== lastDay ? `<h2>${day}</h2>` : '';
    lastDay = day;
    const others = [...s.people.keys()].filter(k => !M.self || k !== M.self.id).length;
    return `${head}<div class="card click wcard" data-session="${s.id}">
      <div class="title">${esc(s.world)} <span class="badge">${esc(s.instType)}</span>${s === M.current ? '<span class="badge">EN COURS</span>' : ''}</div>
      <div class="muted">${fmtTime(s.start)} → ${s.end ? fmtTime(s.end) : 'maintenant'}</div>
      <div class="muted">${others} personne(s) · pic ${s.peak.c} · ${s.videos.length} vidéo(s)</div>
      <div><b>${fmtDur(sessionEnd(s) - s.start)}</b></div>
    </div>`;
  }).join('') || '<div class="empty">Aucun monde trouvé.</div>';
}

function openSession(id) {
  const s = M.sessions[id];
  const people = [...s.people.values()]
    .filter(p => M.players.has(p.key))
    .map(p => ({ ...p, time: p.time + (s === M.current ? liveExtra(p.key) : 0) }))
    .sort((a, b) => b.time - a.time);
  const visits = M.sessions.filter(x => x.worldId === s.worldId);
  showModal(`
    <h1>${esc(s.world)} <span class="badge">${esc(s.instType)}</span></h1>
    <p class="muted">${fmtDT(s.start)} → ${s.end ? fmtTime(s.end) : 'en cours'} · ${fmtDur(sessionEnd(s) - s.start)}
      · Visité ${visits.length} fois · <a class="link" data-url="https://vrchat.com/home/world/${esc(s.worldId)}">Page du monde ↗</a></p>
    <h2>Joueurs dans l'instance</h2>
    ${instanceChart(s, 740)}
    <h2>Personnes présentes (${people.length})</h2>
    ${people.map(p => hbar(pLink(p.key, p.name), p.time, people[0]?.time || 1, fmtDur(p.time))).join('') || '<div class="muted">Personne.</div>'}
    ${s.videos.length ? `<h2>Vidéos</h2><div class="list">${s.videos.map(rowHtml).join('')}</div>` : ''}
    <h2>Chronologie</h2>
    <div class="list">${s.events.filter(e => e.type !== 'avatar').map(rowHtml).join('')}</div>`);
}

// =====================================================================
//  Page : PERSONNES  +  fiche joueur (notes, tags, avatars, amis)
// =====================================================================
function renderPeople() {
  const q = $('peopleSearch').value.trim().toLowerCase();
  const sort = $('peopleSort').value;
  const favOnly = $('favOnly').checked;
  const match = p => {
    if (!q) return true;
    const m = META[p.key] || {};
    const hay = [...p.names, m.note || '', ...(m.tags || []).map(t => '#' + t)].join(' ').toLowerCase();
    return hay.includes(q);
  };
  const list = [...M.players.values()].filter(p => (!favOnly || FAVS.has(p.key)) && match(p));
  const sorters = {
    time: (a, b) => playerTime(b) - playerTime(a),
    meets: (a, b) => b.sessions.length - a.sessions.length,
    last: (a, b) => b.last - a.last,
    name: (a, b) => a.name.localeCompare(b.name),
  };
  list.sort(sorters[sort]);
  $('peopleList').innerHTML = `<div class="trow head"><span></span><span>Joueur (${list.length})</span><span>Rencontres</span><span>Temps ensemble</span><span>Dernière fois</span></div>` +
    list.slice(0, 500).map(p => `<div class="trow" data-player="${esc(p.key)}">
      <span class="star ${FAVS.has(p.key) ? 'on' : ''}" data-fav="${esc(p.key)}" title="Favori (alerte quand il/elle arrive)">★</span>
      <span>${dot(p.key, p.name)}${esc(p.name)} ${tagChips(p.key)}${META[p.key]?.note ? ' <span title="A une note">📝</span>' : ''}</span>
      <span>${p.sessions.length}</span><span>${fmtDur(playerTime(p))}</span><span class="muted">${ago(p.last)}</span>
    </div>`).join('');
}

let openPlayerKey = null; // le joueur dont la fiche est ouverte
function openPlayer(key) {
  const p = M.players.get(key);
  if (!p) return;
  openPlayerKey = key;
  lastSheet = { type: 'player', id: key };
  const meta = META[key] || {};
  const worlds = [...p.worlds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const sess = p.sessions.slice().reverse().slice(0, 30).map(id => M.sessions[id]);
  const friends = (M.groups.links.get(key) || []).slice(0, 12);
  const allTags = [...new Set(Object.values(META).flatMap(m => m.tags || []))];
  showModal(`
    <h1>${dot(key, p.name, 'big')}${esc(p.name)} <span class="star ${FAVS.has(key) ? 'on' : ''}" data-fav="${esc(key)}" title="Favori">★</span></h1>
    <p class="muted">Première rencontre : ${fmtDT(p.first)} · Dernière fois : ${fmtDT(p.last)} (${ago(p.last)})
      ${p.id ? ` · <a class="link" data-url="https://vrchat.com/home/user/${esc(p.id)}">Profil VRChat ↗</a>` : ''}</p>
    <div class="kpis">
      <div class="card kpi"><div class="v">${p.sessions.length}</div><div class="l">Rencontres</div></div>
      <div class="card kpi"><div class="v">${fmtDur(playerTime(p))}</div><div class="l">Temps ensemble</div></div>
      <div class="card kpi"><div class="v">${p.worlds.size}</div><div class="l">Mondes partagés</div></div>
      <div class="card kpi"><div class="v">${new Set(p.avatarHist.map(a => a.avatar)).size}</div><div class="l">Avatars vus</div></div>
    </div>

    ${VRC.user && String(key).startsWith('usr_') ? '<div id="vprofile"><p class="muted">⏳ Chargement du profil VRChat…</p></div>' : ''}
    <h2>📝 Ta note VRCLogs</h2>
    <textarea id="noteBox" placeholder="Ex : super gentil, rencontré au club, aime la musique…">${esc(meta.note || '')}</textarea>
    <h2>🏷️ Tags</h2>
    <div class="tags" id="tagZone">
      ${(meta.tags || []).map(t => `<span class="tag">#${esc(t)} <a class="x" data-untag="${esc(t)}">✕</a></span>`).join('')}
      <input id="tagInput" list="tagList" placeholder="+ ajouter un tag (Entrée)">
      <datalist id="tagList">${allTags.map(t => `<option value="${esc(t)}">`).join('')}</datalist>
    </div>

    ${friends.length ? `<h2>🫂 Arrive souvent avec</h2>
      <div class="tags">${friends.map(f => `<a class="tag link" data-player="${esc(f.key)}">${dot(f.key, M.players.get(f.key)?.name || f.key)}${esc(M.players.get(f.key)?.name || f.key)} <span class="muted">×${f.n}</span></a>`).join('')}</div>` : ''}
    ${p.names.size > 1 ? `<h2>Anciens pseudos</h2><div class="tags">${[...p.names].map(n => `<span class="tag">${esc(n)}</span>`).join('')}</div>` : ''}
    <h2>Mondes où vous étiez ensemble</h2>
    ${worlds.map(([w, ms]) => hbar(esc(w), ms, worlds[0][1] || 1, fmtDur(ms))).join('')}
    ${avatarHistoryHtml(p, 40, '🎭 Historique des avatars')}
    <h2>Rencontres récentes</h2>
    <div class="list">${sess.map(s => `<div class="row"><span class="time">${fmtDT(s.start)}</span><span class="ico">🌍</span><span>${sLink(s.id, s.world)} <span class="ctx">· ${fmtDur((s.people.get(key)?.time || 0) + (s === M.current ? liveExtra(key) : 0))} ensemble</span></span></div>`).join('')}</div>`);

  // Sauvegarde de la note à chaque frappe
  $('noteBox').oninput = e => { setMeta(key, { note: e.target.value }); };
  // Ajout d'un tag avec la touche Entrée
  $('tagInput').onkeydown = e => {
    if (e.key !== 'Enter') return;
    const t = e.target.value.trim().replace(/^#/, '').toLowerCase();
    if (!t) return;
    setMeta(key, { tags: [...new Set([...(META[key]?.tags || []), t])] });
    openPlayer(key);
    $('tagInput').focus();
  };
  resolveAvatars();
  loadProfile(key);
}

// ---------------------------------------------------------------------
//  Historique des avatars : public (on peut le voir) ou privé
// ---------------------------------------------------------------------
const AV_RESULTS = new Map(); // nom d'avatar → résultat de la recherche
let lastSheet = null;         // dernière fiche ouverte : { type: 'player' | 'friend', id }
function avatarHistoryHtml(p, limit, title) {
  if (!p.avatarHist.length) return '';
  const rows = p.avatarHist.slice().reverse().slice(0, limit).map(a => `
    <div class="row avrow" data-avrow="${esc(a.avatar)}">
      <span class="time">${fmtDT(a.t)}</span>
      <span class="ico avthumb">🎭</span>
      <span><b>${esc(a.avatar)}</b>${M.avAuthor.get(a.avatar) ? ` <span class="ctx">par ${esc(M.avAuthor.get(a.avatar))}</span>` : ''}${a.world ? `<span class="ctx"> · ${esc(a.world)}</span>` : ''}</span>
      <span class="avstate"><span class="muted">…</span></span>
    </div>`).join('');
  return `<h2>${title}</h2><div class="list">${rows}</div>`;
}
// Met à jour chaque ligne quand on connaît la réponse
function paintAvatarRows(name, r) {
  document.querySelectorAll(`[data-avrow="${CSS.escape(name)}"]`).forEach(row => {
    const state = row.querySelector('.avstate');
    if (r.found) {
      row.classList.add('public');
      row.dataset.avview = name;
      row.querySelector('.avthumb').innerHTML = r.explicit ? '🔞' : vimg(r.image, 'avmini');
      state.innerHTML = `<span class="badge pub">🌍 Public · Voir</span>`;
    } else if (r.found === false) {
      state.innerHTML = `<span class="badge priv" title="Introuvable dans la base des avatars publics : privé (ou pas encore répertorié)">🔒 Privé</span>`;
    } else {
      state.innerHTML = `<span class="muted" title="${esc(r.error || '')}">⚠️ hors ligne</span>`;
    }
  });
}
async function resolveAvatars() {
  if (!SETTINGS.avtrdb) {
    document.querySelectorAll('.avrow .avstate').forEach(s => { s.innerHTML = ''; });
    return;
  }
  const names = [...new Set([...document.querySelectorAll('[data-avrow]')].map(r => r.dataset.avrow))].slice(0, 25);
  for (const name of names) {
    let r = AV_RESULTS.get(name);
    if (!r) {
      r = await window.api.avatarLookup(name, M.avAuthor.get(name) || '');
      if (!r.error) AV_RESULTS.set(name, r);
    }
    paintAvatarRows(name, r);
  }
}
function openAvatarView(name) {
  const r = AV_RESULTS.get(name);
  if (!r?.found) return;
  openZoom(r.explicit ? '' : r.image, r.name, lastSheet, 'avtrDB'); // "← Retour" ramène à la fiche d'où on vient
  $('modalBody').insertAdjacentHTML('beforeend', avatarDetailHtml({ ...r, status: 'public' }, 'avtrDB'));
}

// Fiche détaillée d'un avatar (les tiens comme ceux des autres)
const PLATFORM_NAMES = { pc: '💻 PC', standalonewindows: '💻 PC', android: '📱 Quest/Android', ios: '📱 iOS' };
const PERF_NAMES = { Excellent: 'Excellent', Good: 'Bon', Medium: 'Moyen', Poor: 'Faible', VeryPoor: 'Très faible' };
function avatarDetailHtml(a, source) {
  const perf = Object.entries(a.performance || {}).filter(([, v]) => v);
  const row = (label, value) => value ? `<dt>${label}</dt><dd>${value}</dd>` : '';
  return `<div class="card avinfo">
    ${a.explicit ? '<p>🔞 Image masquée : cet avatar est marqué comme contenu pour adultes.</p>' : ''}
    ${a.description ? `<div class="bio">${esc(a.description)}</div>` : ''}
    <dl class="avdetail">
      ${row('👤 Créateur', a.author ? `<b>${esc(a.author)}</b>` : '')}
      ${row('🔓 Visibilité', a.status === 'public' ? '🌍 Public' : a.status ? '🔒 Privé' : '')}
      ${row('🖥️ Plateformes', (a.platforms || []).map(p => `<span class="badge">${PLATFORM_NAMES[p] || esc(p)}</span>`).join(''))}
      ${row('⚡ Performance', perf.map(([p, v]) => `${PLATFORM_NAMES[p] || esc(p)} : <span class="perf ${esc(v)}">${PERF_NAMES[v] || esc(v)}</span>`).join(' · '))}
      ${row('🎨 Style', (a.styles || []).map(esc).join(', '))}
      ${row('🏷️ Tags', (a.tags || []).slice(0, 15).map(t => `<span class="tag small">${esc(t.replace(/^(author_tag_|content_)/, ''))}</span>`).join(' '))}
      ${row('📅 Créé le', a.created ? fmtDate(Date.parse(a.created)) : '')}
      ${row('🔄 Mis à jour', a.updated ? `${fmtDate(Date.parse(a.updated))} (${ago(Date.parse(a.updated))})` : '')}
      ${row('🔢 Version', a.version)}
    </dl>
    ${a.id && a.status === 'public' ? `<div class="fbtns"><a class="ghost btn" data-url="https://vrchat.com/home/avatar/${esc(a.id)}">Voir sur VRChat ↗</a></div>` : ''}
    ${source === 'avtrDB' ? '<p class="muted small">Recherche d\'avatars publics fournie par avtrDB.</p>' : ''}
  </div>`;
}
function setMeta(key, patch) {
  META[key] = Object.assign({ note: '', tags: [] }, META[key], patch);
  save('meta', META);
}

// =====================================================================
//  Page : GROUPES
// =====================================================================
function renderGroups() {
  const { list, links } = M.groups;
  $('view-groups').innerHTML = `
    <header class="bar"><h1>🫂 Cercles d'amis détectés</h1></header>
    <p class="muted">Des joueurs qui arrivent ou repartent à moins de 20 secondes d'écart, au moins 2 fois, sont probablement venus ensemble : ils forment un cercle d'amis.
      <br>(Pour tes vrais groupes VRChat, va dans 🏛️ Groupes VRChat.)</p>
    ${list.length ? list.map((g, i) => `
      <div class="card group">
        <div class="title">Cercle ${i + 1} <span class="badge">${g.members.length} personnes</span></div>
        <div class="tags">${g.members
          .sort((a, b) => links.get(b).length - links.get(a).length)
          .map(k => `<a class="tag link" data-player="${esc(k)}">${dot(k, M.players.get(k)?.name || k)}${esc(M.players.get(k)?.name || k)}</a>`).join('')}</div>
      </div>`).join('') : '<div class="empty">Pas encore assez de données. Plus tu joues, plus la détection sera précise !</div>'}`;
}

// =====================================================================
//  Page : VIDÉOS
// =====================================================================
// Une même vidéo YouTube peut avoir plusieurs URL : on les ramène à un seul identifiant
function videoKey(url) {
  const m = url.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/live\/)([\w-]{11})/);
  return m ? `https://youtu.be/${m[1]}` : url.split('#')[0];
}
function renderVideos() {
  const map = new Map();
  for (const s of M.sessions) for (const v of s.videos) {
    const k = videoKey(v.url);
    if (!map.has(k)) map.set(k, { url: k, count: 0, last: 0, first: v.t, worlds: new Set() });
    const o = map.get(k);
    o.count++; o.last = Math.max(o.last, v.t); o.worlds.add(s.world);
  }
  const q = $('videoSearch').value.trim().toLowerCase();
  const list = [...map.values()].filter(v => !q || (v.url + [...v.worlds].join(' ')).toLowerCase().includes(q));
  list.sort($('videoSort').value === 'count' ? (a, b) => b.count - a.count || b.last - a.last : (a, b) => b.last - a.last);
  $('videoList').innerHTML = `<div class="muted">${list.length} vidéo(s) différente(s)</div>` + list.map(v => `
    <div class="row vrow"><span class="time">${fmtDT(v.last)}</span><span class="ico t-video">▶</span>
      <span><a class="link" data-url="${esc(v.url)}">${esc(v.url)}</a>
      <span class="ctx"> · ${[...v.worlds].map(esc).join(', ')}</span></span>
      <span class="badge">×${v.count}</span></div>`).join('');
}

// =====================================================================
//  Page : STATISTIQUES
// =====================================================================
function hbar(label, v, max, valTxt) {
  return `<div class="hbar"><span class="lab">${label}</span><span class="track"><span class="fill" style="width:${Math.max(2, (v / max) * 100)}%;display:block"></span></span><span class="val">${valTxt}</span></div>`;
}
function renderStats() {
  const S = M.sessions;
  const total = S.reduce((a, s) => a + (sessionEnd(s) - s.start), 0);
  const worldTime = new Map();
  const worldIds = new Set();
  for (const s of S) { worldTime.set(s.world, (worldTime.get(s.world) || 0) + sessionEnd(s) - s.start); worldIds.add(s.worldId); }
  const topW = [...worldTime.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const topP = [...M.players.values()].sort((a, b) => playerTime(b) - playerTime(a)).slice(0, 10);

  // Avatars les plus populaires = portés par le plus de joueurs différents
  const avPop = new Map();
  for (const p of M.players.values()) for (const a of new Set(p.avatarHist.map(h => h.avatar))) avPop.set(a, (avPop.get(a) || 0) + 1);
  const topA = [...avPop.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

  const hours = new Array(24).fill(0);
  for (const s of S) for (let t = s.start; t < sessionEnd(s); t += 60000) hours[new Date(t).getHours()] += 1;
  const days = [];
  const today = startOfDay(Date.now());
  for (let i = 13; i >= 0; i--) {
    const d0 = today - i * 86400000, d1 = d0 + 86400000;
    let ms = 0;
    for (const s of S) ms += Math.max(0, Math.min(sessionEnd(s), d1) - Math.max(s.start, d0));
    days.push({ d0, ms });
  }
  const maxH = Math.max(1, ...hours), maxD = Math.max(1, ...days.map(d => d.ms));
  const since = S.length ? fmtDate(S[0].start) : '—';

  $('view-stats').innerHTML = `
    <header class="bar"><h1>Statistiques</h1><span class="muted">Historique sauvegardé depuis le ${since}</span></header>
    <div class="kpis">
      <div class="card kpi"><div class="v">${fmtDur(total)}</div><div class="l">Temps en jeu</div></div>
      <div class="card kpi"><div class="v">${worldIds.size}</div><div class="l">Mondes différents</div></div>
      <div class="card kpi"><div class="v">${M.players.size}</div><div class="l">Personnes rencontrées</div></div>
      <div class="card kpi"><div class="v">${S.reduce((a, s) => a + s.videos.length, 0)}</div><div class="l">Vidéos vues</div></div>
    </div>
    <h2>Temps de jeu — 14 derniers jours</h2>
    <div class="card"><div class="vbars">${days.map(d => `<div class="col" data-gotoday="${d.d0}" title="${fmtDate(d.d0)} : ${fmtDur(d.ms)} (clique pour le résumé)"><div class="b" style="height:${(d.ms / maxD) * 100}%"></div><span class="x">${new Date(d.d0).getDate()}</span></div>`).join('')}</div></div>
    <h2>À quelle heure tu joues</h2>
    <div class="card"><div class="vbars">${hours.map((m, h) => `<div class="col" title="${h}h : ${fmtDur(m * 60000)}"><div class="b" style="height:${(m / maxH) * 100}%"></div><span class="x">${h}</span></div>`).join('')}</div></div>
    <div class="cols">
      <div><h2>Mondes favoris</h2><div class="card">${topW.map(([w, ms]) => hbar(esc(w), ms, topW[0][1], fmtDur(ms))).join('') || '<div class="muted">—</div>'}</div></div>
      <div><h2>Personnes les plus vues</h2><div class="card">${topP.map(p => hbar(pLink(p.key, p.name), playerTime(p), playerTime(topP[0]), fmtDur(playerTime(p)))).join('') || '<div class="muted">—</div>'}</div></div>
    </div>
    <h2>🎭 Avatars les plus populaires <span class="muted">(nombre de joueurs qui l'ont porté)</span></h2>
    <div class="card">${topA.map(([a, n]) => hbar(esc(a), n, topA[0][1], `${n} joueur(s)`)).join('') || '<div class="muted">—</div>'}</div>`;
}

// =====================================================================
//  AMIS (compte VRChat)
//  Les données viennent de main.js → vrchat.js. Ici on ne fait qu'afficher.
// =====================================================================
let VRC = { user: null, friends: [], favorites: { groups: [], favs: [] }, updated: 0, error: null };
let FRIENDS = new Map();          // id → ami
let vrcFavGroups = new Map();     // id → [noms des groupes de favoris VRChat]
let pending2fa = null;            // méthodes de code demandées par VRChat
let loginError = '';
let loginDraft = '';              // le pseudo en cours de saisie (pour ne jamais l'effacer)
let friendFilter = 'all';         // all | game | web | offline
let friendGroup = '';             // '' | 'local' | nom d'un groupe VRChat
let myAvatars = null;             // liste chargée à la demande

// Une image VRChat passe par notre adresse "vrcimg://" (voir main.js)
const vimg = (url, cls = '') => url ? `<img class="${cls}" src="vrcimg://img/?u=${encodeURIComponent(url)}" loading="lazy" alt="">` : '';
// Si une image ne charge pas, on la cache au lieu d'afficher une icône cassée
document.addEventListener('error', e => { if (e.target.tagName === 'IMG') e.target.classList.add('broken'); }, true);

const STATUS_COLORS = { 'join me': '#42a5ff', active: '#5ee6a0', 'ask me': '#ffa94d', busy: '#ff5c6c', offline: '#777' };
const STATUS_NAMES = { 'join me': 'Rejoins-moi', active: 'En ligne', 'ask me': 'Demande-moi', busy: 'Occupé(e)', offline: 'Hors ligne' };
const PLATFORMS = { standalonewindows: '💻 PC', android: '📱 Quest/Android', ios: '📱 iOS', web: '🌐 Site' };

function friendCategory(f) {
  if (!f.online) return 'offline';
  return f.location === 'offline' ? 'web' : 'game';
}
function isFavFriend(id) { return FAVS.has(id) || vrcFavGroups.has(id); }
function friendWhere(f) {
  if (f.location?.startsWith('wrld_')) return `🌍 ${esc(f.world?.name || 'Monde inconnu')} <span class="badge">${esc(f.instType || '')}</span>`;
  if (f.location === 'private') return '🔒 Instance privée';
  if (f.location === 'traveling') return '✈️ En déplacement';
  if (f.online) return '🌐 Sur le site ou l\'app';
  return `💤 Hors ligne${f.lastLogin ? ` · vu ${ago(Date.parse(f.lastLogin))}` : ''}`;
}

function setVRC(s) {
  const before = FRIENDS;
  VRC = s;
  FRIENDS = new Map(s.friends.map(f => [f.id, f]));
  vrcFavGroups = new Map();
  const gName = new Map(s.favorites.groups.map(g => [g.name, g.displayName]));
  for (const f of s.favorites.favs) vrcFavGroups.set(f.userId, f.tags.map(t => gName.get(t) || t));
  const online = s.friends.filter(f => f.online).length;
  $('friendCount').textContent = s.user ? online : '';
  // Alerte : un ami favori vient de se connecter
  if (ALERTS.friendOnline && before.size) {
    for (const f of s.friends) {
      const old = before.get(f.id);
      if (f.online && old && !old.online && isFavFriend(f.id)) notify(`💜 ${f.name} est en ligne`, friendWhere(f).replace(/<[^>]+>/g, ''), 'friends');
    }
  }
}

// Redessine une page sans perdre le champ où tu étais en train d'écrire
function keepFocus(draw) {
  const a = document.activeElement;
  const id = a?.id, pos = a?.selectionStart;
  draw();
  const n = id && document.getElementById(id);
  if (n && n !== document.activeElement) { n.focus(); if (pos != null && n.setSelectionRange) n.setSelectionRange(pos, pos); }
}

function renderFriends() { keepFocus(drawFriends); }
function drawFriends() {
  const el = $('view-friends');
  if (!VRC.user) return renderLogin(el);
  const q = ($('friendSearch')?.value || '').trim().toLowerCase();
  const counts = { all: VRC.friends.length, game: 0, web: 0, offline: 0 };
  for (const f of VRC.friends) counts[friendCategory(f)]++;

  let list = VRC.friends.filter(f =>
    (friendFilter === 'all' || friendCategory(f) === friendFilter) &&
    (!friendGroup || (friendGroup === 'local' ? FAVS.has(f.id) : (vrcFavGroups.get(f.id) || []).includes(friendGroup))) &&
    (!q || f.name.toLowerCase().includes(q) || (f.world?.name || '').toLowerCase().includes(q) || f.statusDescription.toLowerCase().includes(q)));
  const order = { game: 0, web: 1, offline: 2 };
  list.sort((a, b) => order[friendCategory(a)] - order[friendCategory(b)] || a.name.localeCompare(b.name));

  const favs = list.filter(f => isFavFriend(f.id));
  const rest = list.filter(f => !isFavFriend(f.id));
  const section = (title, arr) => arr.length ? `<h2>${title} <span class="muted">(${arr.length})</span></h2><div class="fgrid">${arr.map(friendCard).join('')}</div>` : '';
  const groupOptions = VRC.favorites.groups.map(g => `<option value="${esc(g.displayName)}" ${friendGroup === g.displayName ? 'selected' : ''}>💜 ${esc(g.displayName)}</option>`).join('');

  el.innerHTML = `
    <header class="bar">
      <div class="me">${vimg(VRC.user.avatarThumb, 'meimg')}<div><h1>Amis</h1>
        <div class="muted">Connecté(e) : <b>${esc(VRC.user.name)}</b> · ${VRC.updated ? `mis à jour ${ago(VRC.updated)}` : 'chargement…'}${VRC.error ? ` · <span class="t-leave">⚠️ ${esc(VRC.error)}</span>` : ''}</div></div></div>
      <input id="friendSearch" type="search" placeholder="Nom, monde, statut…" value="${esc(q)}">
      <select id="friendGroup">
        <option value="">Tous les groupes</option>
        <option value="local" ${friendGroup === 'local' ? 'selected' : ''}>⭐ Mes favoris VRCLogs</option>
        ${groupOptions}
      </select>
      <button class="ghost" id="friendRefresh" title="Actualiser">🔄</button>
      <button class="ghost" id="vrcLogout" title="Se déconnecter du compte VRChat">🚪 Se déconnecter</button>
    </header>
    <div class="chips">
      ${[['all', 'Tous'], ['game', '🎮 En jeu'], ['web', '🌐 Sur le site'], ['offline', '💤 Hors ligne']]
        .map(([k, n]) => `<button class="chip ${friendFilter === k ? 'on' : ''}" data-ffilter="${k}">${n} <span class="muted">${counts[k]}</span></button>`).join('')}
    </div>
    ${section('⭐ Favoris', favs)}
    ${section(friendGroup ? 'Amis' : 'Tous les amis', rest)}
    ${!list.length ? `<div class="empty">${VRC.updated ? 'Aucun ami ne correspond.' : 'Chargement de tes amis…'}</div>` : ''}`;

  $('friendSearch').oninput = renderFriends;
  $('friendGroup').onchange = e => { friendGroup = e.target.value; renderFriends(); };
  $('friendRefresh').onclick = () => { window.api.vrc.refresh(); toast('🔄 Actualisation des amis…'); };
}

function friendCard(f) {
  const p = M.players.get(f.id);
  const groups = vrcFavGroups.get(f.id) || [];
  return `<div class="fcard ${friendCategory(f)}" data-friend="${esc(f.id)}">
    <div class="fimg">${dot(f.id, f.name, 'big')}${vimg(f.avatarThumb)}<span class="sdot" style="background:${STATUS_COLORS[f.online ? f.status : 'offline'] || '#777'}"></span></div>
    <div class="finfo">
      <div class="n"><span class="star ${FAVS.has(f.id) ? 'on' : ''}" data-fav="${esc(f.id)}" title="Favori VRCLogs (alertes)">★</span> ${esc(f.name)}</div>
      ${f.statusDescription ? `<div class="s">${esc(f.statusDescription)}</div>` : ''}
      <div class="s where">${friendWhere(f)}</div>
      <div class="s">${p ? `🕒 ${fmtDur(playerTime(p))} ensemble` : ''}${groups.length ? ` · 💜 ${groups.map(esc).join(', ')}` : ''}</div>
    </div>
  </div>`;
}

function renderLogin(el) {
  if (pending2fa) {
    const m = pending2fa.includes('totp') ? 'totp' : pending2fa.includes('emailOtp') ? 'emailOtp' : 'otp';
    const label = { totp: 'le code de ton application d\'authentification (6 chiffres)', emailOtp: 'le code reçu par e-mail', otp: 'un code de récupération' }[m];
    el.innerHTML = `<div class="login card">
      <h1>🔐 Double authentification</h1>
      <p>VRChat demande ${label}.</p>
      <form id="tfaForm">
        <input id="tfaCode" inputmode="numeric" autocomplete="one-time-code" placeholder="Code" required>
        <input type="hidden" id="tfaMethod" value="${m}">
        <button class="primary">Valider</button>
        <button type="button" class="ghost" id="tfaCancel">Annuler</button>
      </form>
      ${loginError ? `<p class="t-leave">⚠️ ${esc(loginError)}</p>` : ''}
    </div>`;
    $('tfaCode').focus();
    $('tfaCancel').onclick = () => { pending2fa = null; loginError = ''; renderFriends(); };
    $('tfaForm').onsubmit = async e => {
      e.preventDefault();
      const r = await window.api.vrc.verify2fa($('tfaMethod').value, $('tfaCode').value);
      if (r.error) { loginError = r.error; return renderFriends(); }
      pending2fa = null; loginError = '';
    };
    return;
  }
  el.innerHTML = `<div class="login card">
    <h1>💜 Connecte ton compte VRChat</h1>
    <p class="muted">Pour voir ta liste d'amis, tes favoris et les avatars. C'est <b>optionnel</b> : le reste de VRCLogs fonctionne sans.</p>
    <form id="loginForm">
      <input id="loginUser" autocomplete="username" placeholder="Pseudo ou e-mail VRChat" value="${esc(loginDraft)}" required>
      <input id="loginPass" type="password" autocomplete="current-password" placeholder="Mot de passe" required>
      <button class="primary">Se connecter</button>
    </form>
    ${loginError ? `<p class="t-leave">⚠️ ${esc(loginError)}</p>` : ''}
    <ul class="privacy">
      <li>🔒 Ton mot de passe est envoyé <b>uniquement à VRChat</b> et n'est <b>jamais enregistré</b>.</li>
      <li>🔑 Seul le jeton de session est gardé, <b>chiffré par Windows</b>, sur ton PC.</li>
      <li>⚠️ Comme VRCX, VRCLogs utilise l'API web de VRChat, qui n'est pas officiellement documentée.</li>
    </ul>
  </div>`;
  $('loginUser').oninput = e => { loginDraft = e.target.value; }; // on retient ce que tu tapes
  $('loginForm').onsubmit = async e => {
    e.preventDefault();
    const btn = e.submitter; btn.disabled = true; btn.textContent = 'Connexion…';
    const r = await window.api.vrc.login($('loginUser').value.trim(), $('loginPass').value);
    $('loginPass').value = ''; // on efface le mot de passe tout de suite
    if (r.error) loginError = r.error;
    else if (r.need2fa) { pending2fa = r.need2fa; loginError = ''; }
    else loginError = '';
    renderFriends();
  };
}

let openFriendId = null;
function openFriend(id) {
  const f = FRIENDS.get(id);
  if (!f) return;
  openFriendId = id;
  lastSheet = { type: 'friend', id };
  const p = M.players.get(id);
  const wid = f.location?.startsWith('wrld_') ? f.location.split(':')[0] : null;
  const canJoin = wid && f.instType && !/^Invite$/.test(f.instType);
  showModal(`
    <div class="fhead">
      <div class="favatar" data-zoom="${esc(f.avatarImage)}" title="Agrandir">${vimg(f.avatarImage || f.avatarThumb)}<span class="zoomhint">🔍</span></div>
      <div>
        <h1>${esc(f.name)} <span class="star ${FAVS.has(id) ? 'on' : ''}" data-fav="${esc(id)}" title="Favori">★</span></h1>
        <div><span class="sdot inline" style="background:${STATUS_COLORS[f.online ? f.status : 'offline']}"></span>
          ${STATUS_NAMES[f.online ? f.status : 'offline'] || esc(f.status)}${f.statusDescription ? ` — ${esc(f.statusDescription)}` : ''}</div>
        <div class="muted">${esc(f.rank)}${f.platform ? ` · ${PLATFORMS[f.platform] || esc(f.platform)}` : ''}
          ${(vrcFavGroups.get(id) || []).map(g => `<span class="badge">💜 ${esc(g)}</span>`).join('')}</div>
        <div class="fbtns">
          <a class="ghost btn" data-url="https://vrchat.com/home/user/${esc(id)}">Profil VRChat ↗</a>
          ${p ? `<a class="ghost btn" data-player="${esc(id)}">📜 Fiche VRCLogs</a>` : ''}
        </div>
      </div>
    </div>
    <h2>Où ?</h2>
    <div class="card floc">
      ${f.world ? vimg(f.world.thumb, 'wthumb') : ''}
      <div><div>${friendWhere(f)}</div>
        ${wid ? `<div class="fbtns"><a class="ghost btn" data-url="https://vrchat.com/home/world/${esc(wid)}">Page du monde ↗</a>
          ${canJoin ? `<a class="ghost btn" data-url="vrchat://launch?ref=vrclogs&id=${esc(f.location)}">🚀 Rejoindre</a>` : ''}</div>` : ''}
      </div>
    </div>
    <div id="vprofile"><p class="muted">⏳ Chargement du profil VRChat…</p></div>
    ${p ? `<h2>Avec toi (d'après tes logs)</h2>
      <div class="kpis">
        <div class="card kpi"><div class="v">${p.sessions.length}</div><div class="l">Rencontres</div></div>
        <div class="card kpi"><div class="v">${fmtDur(playerTime(p))}</div><div class="l">Temps ensemble</div></div>
        <div class="card kpi"><div class="v">${p.worlds.size}</div><div class="l">Mondes partagés</div></div>
        <div class="card kpi"><div class="v">${ago(p.last)}</div><div class="l">Dernière fois</div></div>
      </div>
      ${avatarHistoryHtml(p, 10, '🎭 Ses derniers avatars')}`
      : '<p class="muted">Vous ne vous êtes pas encore croisés dans tes logs.</p>'}`);
  resolveAvatars();
  loadProfile(id);
}

// ---------------------------------------------------------------------
//  Profil VRChat détaillé (bio, liens, badges, langues, groupes…)
// ---------------------------------------------------------------------
const LANGS = { eng: 'Anglais', fra: 'Français', spa: 'Espagnol', deu: 'Allemand', ita: 'Italien', por: 'Portugais',
  jpn: 'Japonais', kor: 'Coréen', zho: 'Chinois', rus: 'Russe', pol: 'Polonais', nld: 'Néerlandais', swe: 'Suédois',
  nor: 'Norvégien', dan: 'Danois', fin: 'Finnois', tur: 'Turc', ara: 'Arabe', hin: 'Hindi', tha: 'Thaï', vie: 'Vietnamien',
  ind: 'Indonésien', ukr: 'Ukrainien', ces: 'Tchèque', hun: 'Hongrois', ron: 'Roumain', ell: 'Grec', heb: 'Hébreu',
  ase: 'Langue des signes (ASL)', bfi: 'Langue des signes (BSL)', fsl: 'Langue des signes (LSF)', jsl: 'Langue des signes (JSL)', kvk: 'Langue des signes (KSL)' };
const PROFILE_CACHE = new Map(); // id → { t, d } (gardé 5 minutes pour ne pas redemander)

function linkLabel(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') + new URL(url).pathname.replace(/\/$/, ''); } catch { return url; }
}
function profileHtml(d) {
  const facts = [
    d.pronouns && `💬 ${esc(d.pronouns)}`,
    d.vrcPlus && '<span class="badge vplus">VRC+</span>',
    d.ageVerified && '<span class="badge">✅ Âge vérifié</span>',
    d.dateJoined && `📅 Sur VRChat depuis le ${fmtDate(Date.parse(d.dateJoined))}`,
    d.lastActivity && `🕒 Dernière activité ${ago(Date.parse(d.lastActivity))}`,
  ].filter(Boolean);
  const links = d.bioLinks.map(l => (/^https?:\/\//i.test(l) ? l : `https://${l}`));
  return `
    <div class="pfacts">${facts.join('<span class="sep">·</span>')}</div>
    ${d.languages.length ? `<div class="tags">${d.languages.map(l => `<span class="tag">🗣️ ${esc(LANGS[l] || l.toUpperCase())}</span>`).join('')}</div>` : ''}
    ${d.badges.length ? `<h2>🏅 Badges</h2><div class="badges">${d.badges.map(b => `
      <div class="pbadge" title="${esc(b.desc || '')}">${vimg(b.image)}<span>${esc(b.name)}</span></div>`).join('')}</div>` : ''}
    <h2>📝 Bio</h2>
    <div class="card bio">${d.bio ? esc(d.bio) : '<span class="muted">Pas de bio.</span>'}</div>
    ${links.length ? `<h2>🔗 Liens</h2><div class="plinks">${links.map(l => `<a class="ghost btn" data-url="${esc(l)}">${esc(linkLabel(l))} ↗</a>`).join('')}</div>` : ''}
    ${d.note ? `<h2>🗒️ Ta note VRChat</h2><div class="card bio">${esc(d.note)}</div>` : ''}
    ${d.representedGroup || d.groups.length ? `<h2>👥 Groupes ${d.groupCount ? `<span class="muted">(${d.groupCount})</span>` : ''}</h2>
      <div class="pgroups">
        ${d.representedGroup ? `<a class="pgroup rep" data-url="https://vrchat.com/home/group/${esc(d.representedGroup.id)}">${vimg(d.representedGroup.icon)}<span>⭐ ${esc(d.representedGroup.name)}</span></a>` : ''}
        ${d.groups.filter(g => g.id !== d.representedGroup?.id).map(g => `<a class="pgroup" data-url="https://vrchat.com/home/group/${esc(g.id)}">${vimg(g.icon)}<span>${esc(g.name)}</span></a>`).join('')}
      </div>` : ''}
    ${d.worlds.length ? `<h2>🌍 Ses mondes publiés <span class="muted">(${d.worldCount})</span></h2>
      <div class="pworlds">${d.worlds.map(w => `<a class="pworld" data-url="https://vrchat.com/home/world/${esc(w.id)}">${vimg(w.thumb)}<span>${esc(w.name)}</span></a>`).join('')}</div>` : ''}
    <p class="muted small">Copie d'avatar : ${d.allowAvatarCopying ? 'autorisée' : 'désactivée'} · Rang : ${esc(d.rank)}</p>`;
}
async function loadProfile(id) {
  const box = $('vprofile');
  if (!box) return;
  if (!VRC.user || !String(id).startsWith('usr_')) { box.innerHTML = ''; return; }
  let c = PROFILE_CACHE.get(id);
  if (!c || Date.now() - c.t > 5 * 60000) {
    const d = await window.api.vrc.user(id);
    if (d.error) { if ($('vprofile') && lastSheet?.id === id) $('vprofile').innerHTML = `<p class="muted">⚠️ Profil indisponible : ${esc(d.error)}</p>`; return; }
    c = { t: Date.now(), d };
    PROFILE_CACHE.set(id, c);
  }
  if (lastSheet?.id !== id || !$('vprofile')) return; // tu as ouvert une autre fiche entre-temps
  $('vprofile').innerHTML = profileHtml(c.d);
  // La bannière de profil en haut de la fiche
  if (c.d.banner && !$('modalBody').querySelector('.pbanner')) {
    $('modalBody').insertAdjacentHTML('afterbegin', `<div class="pbanner">${vimg(c.d.banner)}</div>`);
  }
}

// Visionneuse : une image en grand
function openZoom(url, title = '', back = null, source = 'VRChat') {
  showModal(`<div class="zoom">
    ${back ? `<button class="ghost" data-${back.type}="${esc(back.id)}">← Retour</button>` : ''}
    ${title ? `<h1>${esc(title)}</h1>` : ''}
    ${vimg(url, 'zoomimg')}
    <p class="muted">👀 Image d'aperçu fournie par ${source}. Pour respecter les créateurs, VRCLogs permet de regarder les avatars, jamais de les télécharger ou de les copier.</p>
  </div>`);
}

// =====================================================================
//  MES AVATARS
// =====================================================================
async function renderAvatars(force = false) {
  const el = $('view-avatars');
  if (!VRC.user) {
    el.innerHTML = `<header class="bar"><h1>Mes avatars</h1></header>
      <div class="empty">Connecte ton compte VRChat dans l'onglet <a class="link" data-goto="friends">💜 Amis</a> pour voir tes avatars.</div>`;
    return;
  }
  if (!myAvatars || force) {
    el.innerHTML = '<header class="bar"><h1>Mes avatars</h1></header><div class="empty">Chargement de tes avatars…</div>';
    const r = await window.api.vrc.avatars();
    myAvatars = r.avatars || [];
    if (r.error) toast(`⚠️ ${esc(r.error)}`);
    if (currentView !== 'avatars') return;
  }
  const q = ($('avatarSearch')?.value || '').trim().toLowerCase();
  const list = myAvatars.filter(a => !q || a.name.toLowerCase().includes(q));
  el.innerHTML = `
    <header class="bar"><h1>Mes avatars <span class="muted">(${myAvatars.length})</span></h1>
      <input id="avatarSearch" type="search" placeholder="Rechercher un avatar…" value="${esc(q)}">
      <button class="ghost" id="avatarRefresh">🔄</button></header>
    <div class="agrid">${list.map(a => `
      <div class="acard" data-avatar="${esc(a.id)}">
        <div class="aimg">${vimg(a.thumb)}</div>
        <div class="n">${esc(a.name)}</div>
        <div class="s"><span class="badge">${a.status === 'public' ? '🌍 Public' : '🔒 Privé'}</span>
          ${a.platforms.map(p => `<span class="badge">${PLATFORMS[p] || esc(p)}</span>`).join('')}</div>
        <div class="s muted">Modifié ${a.updated ? ago(Date.parse(a.updated)) : '—'}</div>
      </div>`).join('') || '<div class="empty">Aucun avatar.</div>'}</div>`;
  const s = $('avatarSearch');
  s.oninput = () => { const pos = s.selectionStart; renderAvatars(); const n = $('avatarSearch'); n.focus(); n.setSelectionRange(pos, pos); };
  $('avatarRefresh').onclick = () => renderAvatars(true);
}
function openAvatar(id) {
  const a = myAvatars?.find(x => x.id === id);
  if (!a) return;
  openZoom(a.image || a.thumb, a.name);
  $('modalBody').insertAdjacentHTML('beforeend', avatarDetailHtml(a, 'vrchat'));
}

// =====================================================================
//  PARAMÈTRES (apparence, alertes, données)
// =====================================================================
// ---------------------------------------------------------------------
//  THÈMES : chaque thème = 5 couleurs de base.
//  Les autres nuances (bordures, texte gris, dégradés…) sont CALCULÉES
//  à partir de ces 5 couleurs par themeVars().
// ---------------------------------------------------------------------
const THEMES = [
  { id: 'goddess', name: 'Goddess', bg: '#110b0a', card: '#1d1513', text: '#f7ede6', a: '#ffc857', b: '#e8323f' },
  { id: 'violet', name: 'Violet', bg: '#0f0d17', card: '#1c1829', text: '#ece8f6', a: '#b388ff', b: '#ff7ac6' },
  { id: 'ocean', name: 'Océan', bg: '#0a0f17', card: '#131b27', text: '#e6eef8', a: '#4fd1ff', b: '#6c7bff' },
  { id: 'menthe', name: 'Menthe', bg: '#0b1210', card: '#14201c', text: '#e8f6f0', a: '#5ef0b6', b: '#2fc4c4' },
  { id: 'bonbon', name: 'Bonbon', bg: '#170b12', card: '#25121e', text: '#fbe9f3', a: '#ff8fd1', b: '#ffb86b' },
  { id: 'neon', name: 'Néon', bg: '#07060d', card: '#120f1f', text: '#eef0ff', a: '#00e5ff', b: '#ff2fd0' },
  { id: 'sunset', name: 'Coucher de soleil', bg: '#140c0a', card: '#23140f', text: '#fdeee4', a: '#ffb347', b: '#ff5e62' },
  { id: 'lavande', name: 'Lavande', bg: '#12101a', card: '#1d1a29', text: '#efeaff', a: '#c8a8ff', b: '#8fd3ff' },
  { id: 'foret', name: 'Forêt', bg: '#0c110b', card: '#162014', text: '#eaf3e4', a: '#a3d977', b: '#e0c068' },
  { id: 'glace', name: 'Glace', bg: '#0d1216', card: '#17202a', text: '#eef6fb', a: '#bfe9ff', b: '#7aa7ff' },
  { id: 'vampire', name: 'Vampire', bg: '#0d0608', card: '#1a0d10', text: '#f3e6e8', a: '#ff3355', b: '#b0003a' },
  { id: 'clair', name: 'Clair', bg: '#f4f1f7', card: '#ffffff', text: '#1d1a24', a: '#8a4dff', b: '#ff4f8b' },
];
const PALETTE_FIELDS = [
  ['bg', '🖼️ Fond'], ['card', '🗂️ Cartes'], ['text', '🔤 Texte'], ['a', '⭐ Couleur principale'], ['b', '💖 Couleur secondaire'],
];

// Petits outils de couleur : mélanger deux couleurs "#rrggbb"
function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function rgbToHex(r, g, b) { return '#' + [r, g, b].map(x => Math.round(x).toString(16).padStart(2, '0')).join(''); }
// Couleur "teinte / saturation / luminosité" → "#rrggbb"
function hslHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => 255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)));
  return rgbToHex(f(0), f(8), f(4));
}
function mix(c1, c2, t) { const a = hexToRgb(c1), b = hexToRgb(c2); return rgbToHex(...a.map((v, i) => v + (b[i] - v) * t)); }

function currentPalette() {
  if (SETTINGS.theme === 'custom' && SETTINGS.custom) return SETTINGS.custom;
  return THEMES.find(t => t.id === SETTINGS.theme) || THEMES[0];
}
function themeVars(p) {
  return {
    '--bg': p.bg, '--card': p.card, '--text': p.text, '--accent': p.a, '--accent2': p.b,
    '--card2': mix(p.card, p.text, 0.06),   // carte un peu plus claire (survol, zones)
    '--line': mix(p.card, p.text, 0.14),    // bordures
    '--muted': mix(p.text, p.bg, 0.42),     // texte secondaire
    '--hero': mix(p.bg, p.b, 0.38),         // fond du bandeau "Tu es dans"
    '--worldrow': mix(p.card, p.b, 0.22),   // lignes "Arrivée dans un monde"
  };
}
let settingsTab = 'look';
function applySettings() {
  const vars = themeVars(currentPalette());
  for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v);
  document.documentElement.dataset.theme = SETTINGS.theme;
  document.body.classList.toggle('compact', SETTINGS.compact);
  document.body.classList.toggle('no-anim', !SETTINGS.anim);
  save('settings', SETTINGS);
  if (currentView === 'brain' && typeof drawBrain === 'function') drawBrain(); // le cerveau lit les couleurs
}
function openSettings(tab = settingsTab) {
  settingsTab = tab;
  const tabs = [['look', '🎨 Apparence'], ['alerts', '🔔 Alertes'], ['integrations', '🔌 Intégrations'], ['data', '💾 Données'], ['update', '🔄 Mises à jour']];
  let body = '';
  if (tab === 'integrations') {
    body = integrationsTabHtml(); // dans ui/discord.js
  } else if (tab === 'update') {
    body = updateTabHtml();
  } else if (tab === 'look') {
    const p = currentPalette();
    body = `
      <h2>🌍 Langue</h2>
      <div class="langs">${LANGUAGES.map(l => `
        <button class="langbtn ${l.code === LANG ? 'on' : ''}" data-lang="${l.code}"><span class="flag">${l.flag}</span><span class="notr">${l.name}</span></button>`).join('')}
      </div>
      <h2>Thèmes</h2>
      <div class="themes">${THEMES.map(t => `
        <div class="theme ${SETTINGS.theme === t.id ? 'on' : ''}" data-theme-pick="${t.id}" style="background:${t.bg};color:${t.text}">
          <div class="sw" style="background:linear-gradient(135deg, ${t.a}, ${t.b})"></div>
          <div class="dots">${[t.bg, t.card, t.text, t.a, t.b].map(c => `<i style="background:${c}"></i>`).join('')}</div>${t.name}
        </div>`).join('')}
        ${SETTINGS.custom ? `<div class="theme ${SETTINGS.theme === 'custom' ? 'on' : ''}" data-theme-pick="custom" style="background:${SETTINGS.custom.bg};color:${SETTINGS.custom.text}">
          <div class="sw" style="background:linear-gradient(135deg, ${SETTINGS.custom.a}, ${SETTINGS.custom.b})"></div>
          <div class="dots">${PALETTE_FIELDS.map(([k]) => `<i style="background:${SETTINGS.custom[k]}"></i>`).join('')}</div>🎨 Ma palette</div>` : ''}
      </div>
      <h2>🎨 Ma palette personnalisée</h2>
      <p class="muted small">Choisis tes 5 couleurs : tout le reste s'adapte automatiquement. Ça part du thème actuel.</p>
      <div class="palette">${PALETTE_FIELDS.map(([k, label]) => `
        <label class="pcolor"><input type="color" data-pal="${k}" value="${p[k]}"><span>${label}</span><code>${p[k]}</code></label>`).join('')}
      </div>
      <div class="fbtns">
        <button class="ghost" id="palCopy" title="Copier le code de ta palette pour la partager">📋 Copier le code</button>
        <button class="ghost" id="palPaste" title="Coller le code d'une palette partagée">📥 Coller un code</button>
        <button class="ghost" id="palRandom">🎲 Au hasard</button>
      </div>
      <h2>Options</h2>
      <label class="opt"><span>📏 Mode compact <span class="muted">— lignes plus petites</span></span><input type="checkbox" data-set="compact" ${SETTINGS.compact ? 'checked' : ''}></label>
      <label class="opt"><span>✨ Animations</span><input type="checkbox" data-set="anim" ${SETTINGS.anim ? 'checked' : ''}></label>`;
  } else if (tab === 'alerts') {
    const allTags = [...new Set(Object.values(META).flatMap(m => m.tags || []))];
    body = `
      <p class="muted">Tu reçois une notification Windows quand quelqu'un qui correspond arrive dans ton instance.</p>
      <label class="opt"><span>⭐ Mes favoris arrivent dans mon instance</span><input type="checkbox" data-alert="favs" ${ALERTS.favs ? 'checked' : ''}></label>
      <label class="opt"><span>💜 Un ami favori se connecte à VRChat <span class="muted">(compte VRChat connecté)</span></span><input type="checkbox" data-alert="friendOnline" ${ALERTS.friendOnline ? 'checked' : ''}></label>
      <label class="opt"><span>✨ Une personne que je n'ai jamais vue</span><input type="checkbox" data-alert="newPeople" ${ALERTS.newPeople ? 'checked' : ''}></label>
      <label class="opt"><span>🔁 Quelqu'un que j'ai déjà croisé au moins <input type="number" min="0" max="999" class="num" data-alert="minMeets" value="${ALERTS.minMeets}"> fois <span class="muted">(0 = désactivé)</span></span></label>
      <label class="opt"><span>🏷️ Ces tags : <input class="txt" data-alert="tags" value="${esc(ALERTS.tags.join(', '))}" placeholder="ex : ami, club"></span></label>
      ${allTags.length ? `<p class="muted">Tes tags existants : ${allTags.map(t => '#' + esc(t)).join(' ')}</p>` : ''}
      <label class="opt"><span>🔇 Notifications silencieuses (sans son)</span><input type="checkbox" data-alert="silent" ${ALERTS.silent ? 'checked' : ''}></label>
      <button class="ghost" id="testAlert">🔔 Tester une notification</button>`;
  } else {
    body = `
      <p>VRChat efface ses vieux logs. VRCLogs garde une <b>copie permanente</b> de tout ton historique.</p>
      <div class="opt"><span>${EVENTS.length.toLocaleString(LOCALE)} événements sauvegardés depuis le ${EVENTS.length ? fmtDate(EVENTS[0].t) : '—'}</span></div>
      <div class="opt"><span>⭐ ${FAVS.size} favori(s) · 📝 ${Object.values(META).filter(m => m.note).length} note(s) · 🏷️ ${Object.values(META).filter(m => m.tags?.length).length} joueur(s) tagués</span></div>
      <div class="opt"><span>💜 Compte VRChat : ${VRC.user ? `connecté(e) en tant que <b>${esc(VRC.user.name)}</b>` : 'non connecté'}</span>
        ${VRC.user ? '<button class="ghost" id="vrcLogout">Se déconnecter</button>' : '<button class="ghost" data-goto="friends">Se connecter</button>'}</div>
      <label class="opt"><span>🔎 Chercher les avatars publics dans avtrDB <span class="muted">— envoie seulement le nom de l'avatar</span></span><input type="checkbox" data-set="avtrdb" ${SETTINGS.avtrdb ? 'checked' : ''}></label>
      <button class="ghost" id="openData">💾 Ouvrir le dossier de sauvegarde</button>
      <button class="ghost" id="openLogs">📁 Ouvrir le dossier des logs VRChat</button>`;
  }
  showModal(`<h1>⚙️ Paramètres</h1>
    <div class="tabs">${tabs.map(([id, n]) => `<button class="tabbtn ${id === tab ? 'on' : ''}" data-stab="${id}">${n}</button>`).join('')}</div>
    ${body}`);
  if ($('updCheck')) $('updCheck').onclick = () => checkUpdate(true);
  if ($('palCopy')) {
    // Code de partage : "VRCLogs:#fond-#cartes-#texte-#principale-#secondaire"
    $('palCopy').onclick = async () => {
      const p = currentPalette();
      await navigator.clipboard.writeText('VRCLogs:' + PALETTE_FIELDS.map(([k]) => p[k]).join('-'));
      toast('📋 Code de palette copié : partage-le à tes amis !');
    };
    $('palPaste').onclick = async () => {
      const m = (await navigator.clipboard.readText()).match(/VRCLogs:(#[0-9a-f]{6})-(#[0-9a-f]{6})-(#[0-9a-f]{6})-(#[0-9a-f]{6})-(#[0-9a-f]{6})/i);
      if (!m) return toast('⚠️ Aucun code de palette dans le presse-papiers');
      SETTINGS.custom = Object.fromEntries(PALETTE_FIELDS.map(([k], i) => [k, m[i + 1].toLowerCase()]));
      SETTINGS.theme = 'custom';
      applySettings();
      openSettings('look');
    };
    $('palRandom').onclick = () => {
      // Une palette au hasard, mais harmonieuse : on part d'une teinte et on choisit des voisines
      const h = Math.floor(Math.random() * 360), h2 = (h + 40 + Math.floor(Math.random() * 100)) % 360;
      SETTINGS.custom = { bg: hslHex(h, 25, 6), card: hslHex(h, 22, 11), text: hslHex(h, 30, 93), a: hslHex(h, 90, 66), b: hslHex(h2, 85, 60) };
      SETTINGS.theme = 'custom';
      applySettings();
      openSettings('look');
    };
  }
  if ($('testAlert')) $('testAlert').onclick = () => notify('🔔 Test', 'Les alertes fonctionnent !', 'test');
  if ($('openData')) $('openData').onclick = () => window.api.openDataFolder();
  if ($('openLogs')) $('openLogs').onclick = () => window.api.openLogFolder();
}
// ---------------------------------------------------------------------
//  🔄 MISES À JOUR
// ---------------------------------------------------------------------
const UPDATE = { current: '', result: null, checking: false, at: 0 };

// Les notes de version GitHub sont écrites en "Markdown" : on en garde l'essentiel
function miniMarkdown(md) {
  return esc(md).split('\n').map(line => {
    let l = line.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>');
    if (/^#{1,4} /.test(l)) return `<div class="mdh">${l.replace(/^#{1,4} /, '')}</div>`;
    if (/^\s*[-*] /.test(l)) return `<div class="mdli">• ${l.replace(/^\s*[-*] /, '')}</div>`;
    if (/^&gt; /.test(l)) return `<div class="mdq">${l.replace(/^&gt; /, '')}</div>`;
    if (/^---+$/.test(l.trim())) return '<hr>';
    return l.trim() ? `<div>${l}</div>` : '';
  }).join('').replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, (m, txt, url) => `<a class="link" data-url="${url}">${txt}</a>`);
}

function updateTabHtml() {
  const r = UPDATE.result;
  let status = '';
  if (UPDATE.checking) status = '<div class="card">⏳ Vérification…</div>';
  else if (r?.error) status = `<div class="card">⚠️ Impossible de vérifier : ${esc(r.error)}</div>`;
  else if (r && !r.newer) status = `<div class="card upd-ok">✅ Tu as la dernière version (${esc(r.current)}).</div>`;
  else if (r?.newer) status = `
    <div class="card upd-new">
      <div class="upd-title">✨ Nouvelle version disponible : ${esc(r.latest)}</div>
      <div class="muted small">Publiée le ${fmtDate(Date.parse(r.date))}${r.size ? ` · ${(r.size / 1048576).toFixed(0)} Mo` : ''}</div>
      <div class="fbtns">
        <a class="primary btn" data-url="${esc(r.download)}">⬇️ Télécharger la mise à jour</a>
        <a class="ghost btn" data-url="${esc(r.page)}">Voir sur GitHub ↗</a>
      </div>
      <p class="muted small">Lance le fichier téléchargé et installe par-dessus : ton historique, tes notes et tes favoris sont conservés.</p>
    </div>
    ${r.notes ? `<h2>📝 Nouveautés de cette version</h2><div class="card mdnotes">${miniMarkdown(r.notes)}</div>` : ''}`;
  return `
    <div class="opt"><span>📦 Version installée</span><b class="notr">${esc(UPDATE.current)}</b></div>
    <div class="fbtns"><button class="ghost" id="updCheck" ${UPDATE.checking ? 'disabled' : ''}>🔍 Vérifier maintenant</button>
      ${UPDATE.at ? `<span class="muted small">Dernière vérification : ${ago(UPDATE.at)}</span>` : ''}</div>
    ${status}
    <h2>Options</h2>
    <label class="opt"><span>🔁 Vérifier automatiquement au démarrage <span class="muted">— rien n'est envoyé, on regarde seulement la dernière version sur GitHub</span></span><input type="checkbox" data-set="autoUpdate" ${SETTINGS.autoUpdate ? 'checked' : ''}></label>`;
}

async function checkUpdate(manual) {
  UPDATE.checking = true;
  if (manual && settingsTab === 'update' && !$('modal').classList.contains('hidden')) openSettings('update');
  UPDATE.result = await window.api.checkUpdate();
  UPDATE.checking = false;
  UPDATE.at = Date.now();
  // Une pastille sur le bouton Paramètres quand une mise à jour attend
  $('openSettings').classList.toggle('has-update', !!UPDATE.result?.newer);
  if (!manual && UPDATE.result?.newer) toast(`✨ VRCLogs ${esc(UPDATE.result.latest)} est disponible !<br>Va dans ⚙️ Paramètres → 🔄 Mises à jour.`);
  if (settingsTab === 'update' && !$('modal').classList.contains('hidden')) openSettings('update');
}

// Quand on modifie une option dans les paramètres
document.addEventListener('input', e => {
  // Un sélecteur de couleur de "Ma palette" a changé : on passe en thème personnalisé
  if (e.target.dataset.pal) {
    SETTINGS.custom = { ...Object.fromEntries(PALETTE_FIELDS.map(([k]) => [k, currentPalette()[k]])), [e.target.dataset.pal]: e.target.value };
    SETTINGS.theme = 'custom';
    e.target.parentElement.querySelector('code').textContent = e.target.value;
    document.querySelectorAll('.theme').forEach(t => t.classList.toggle('on', t.dataset.themePick === 'custom'));
    applySettings();
    return;
  }
  const s = e.target.dataset.set, a = e.target.dataset.alert;
  if (s) { SETTINGS[s] = e.target.checked; applySettings(); }
  // Une option du statut Discord (onglet 🔌 Intégrations)
  if (e.target.dataset.rp) {
    SETTINGS.rp = { ...SETTINGS.rp, [e.target.dataset.rp]: e.target.checked };
    save('settings', SETTINGS);
    rpChanged(e.target.dataset.rp);
  }
  if (a) {
    const t = e.target;
    ALERTS[a] = t.type === 'checkbox' ? t.checked : a === 'minMeets' ? +t.value || 0
      : t.value.split(',').map(x => x.trim().replace(/^#/, '').toLowerCase()).filter(Boolean);
    save('alerts', ALERTS);
  }
});

// =====================================================================
//  ALERTES
// =====================================================================
function notify(title, body, kind = 'alerts') {
  if (typeof discordHook === 'function') discordHook(kind, title, body); // copie dans ton salon Discord (si activé)
  // Les notifications Windows ne sont pas dans la page : on les traduit nous-mêmes
  new Notification(tr(title), { body: tr(body), silent: ALERTS.silent });
  toast(`<b>${esc(title)}</b><br>${esc(body)}`);
}
function toast(html) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = html;
  $('toasts').appendChild(t);
  setTimeout(() => t.remove(), 6000);
}
// Pour chaque nouvelle arrivée : est-ce qu'elle correspond à une alerte ?
function checkAlerts(newEvents) {
  const hits = [];
  for (const e of newEvents) {
    if (e.type !== 'join' || !e.key || !M.players.has(e.key)) continue;
    const p = M.players.get(e.key);
    const why = [];
    if (ALERTS.favs && FAVS.has(e.key)) why.push('⭐ favori');
    if (ALERTS.newPeople && p.sessions.length === 1) why.push('✨ nouvelle personne');
    if (ALERTS.minMeets > 0 && p.sessions.length - 1 >= ALERTS.minMeets) why.push(`🔁 vu ${p.sessions.length - 1} fois`);
    const tagHit = tagsOf(e.key).filter(t => ALERTS.tags.includes(t));
    if (tagHit.length) why.push(tagHit.map(t => '#' + t).join(' '));
    if (why.length) hits.push({ name: e.name, why });
  }
  if (!hits.length) return;
  const where = M.current?.world || 'ton instance';
  // Si beaucoup d'alertes d'un coup (ex : tu arrives dans un monde), on regroupe
  if (hits.length > 3) notify(`🔔 ${hits.length} alertes dans ${where}`, hits.map(h => h.name).join(', '));
  else for (const h of hits) notify(`🔔 ${h.name} est arrivé(e)`, `${h.why.join(' · ')} — ${where}`);
}

// =====================================================================
//  Fenêtre détail, rendu général, clics
// =====================================================================
function showModal(html) { $('modalBody').innerHTML = html; $('modal').classList.remove('hidden'); initCharts(); }
function hideModal() { $('modal').classList.add('hidden'); }

const RENDERERS = { live: renderLive, friends: renderFriends, brain: () => renderBrain(),
  steam: () => renderSteam(), discord: () => renderDiscord(), chatbox: () => renderChatbox(), news: () => renderNews(), shop: () => renderShop(), vgroups: () => renderVGroups(), avatars: () => renderAvatars(), day: renderDay, feed: renderFeed, worlds: renderWorlds,
  people: renderPeople, groups: renderGroups, videos: renderVideos, stats: renderStats };
function render() { RENDERERS[currentView](); initCharts(); }
function goTo(view) {
  currentView = view;
  document.querySelectorAll('.nav').forEach(n => n.classList.toggle('active', n.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  render();
}
function setStatus() {
  const s = $('status');
  s.className = 'status ' + (LIVE ? 'on' : 'off');
  s.textContent = LIVE ? 'VRChat ouvert' : 'VRChat fermé';
}

// UN SEUL écouteur de clics pour toute l'app ("délégation d'événements") :
// on regarde sur quoi on a cliqué grâce aux attributs data-…
document.addEventListener('click', e => {
  const hit = sel => e.target.closest(sel);
  let el;
  if ((el = hit('[data-fav]'))) {
    e.stopPropagation();
    const k = el.dataset.fav;
    FAVS.has(k) ? FAVS.delete(k) : FAVS.add(k);
    save('favs', [...FAVS]);
    el.classList.toggle('on', FAVS.has(k));
    render();
    return;
  }
  if ((el = hit('[data-untag]'))) {
    const key = openPlayerKey;
    if (key) { setMeta(key, { tags: tagsOf(key).filter(t => t !== el.dataset.untag) }); openPlayer(key); }
    return;
  }
  if ((el = hit('[data-theme-pick]'))) {
    SETTINGS.theme = el.dataset.themePick;
    applySettings();
    document.querySelectorAll('.theme').forEach(t => t.classList.toggle('on', t === el));
    return;
  }
  if ((el = hit('[data-stab]'))) return openSettings(el.dataset.stab);
  if ((el = hit('[data-lang]'))) {
    // Nouvelle langue : on l'enregistre et on recharge l'affichage
    SETTINGS.lang = el.dataset.lang;
    save('settings', SETTINGS);
    return window.api.reload(); // on demande à main.js de recharger (la sécurité bloque location.reload)
  }
  if ((el = hit('[data-day]'))) { DAY = startOfDay(DAY + +el.dataset.day * 86400000 + 3600000 * 2); return renderDay(); }
  if ((el = hit('[data-gotoday]'))) { DAY = +el.dataset.gotoday; return goTo('day'); }
  if ((el = hit('[data-zoom]'))) {
    const f = FRIENDS.get(openFriendId);
    return openZoom(el.dataset.zoom, f ? `Avatar de ${f.name}` : '', f ? { type: 'friend', id: f.id } : null);
  }
  if ((el = hit('[data-avview]'))) return openAvatarView(el.dataset.avview);
  if ((el = hit('[data-friend]'))) return openFriend(el.dataset.friend);
  if ((el = hit('[data-avatar]'))) return openAvatar(el.dataset.avatar);
  if ((el = hit('[data-ffilter]'))) { friendFilter = el.dataset.ffilter; return renderFriends(); }
  if ((el = hit('[data-goto]'))) return goTo(el.dataset.goto);
  if ((el = hit('#vrcLogout'))) {
    if (!confirm(tr('Se déconnecter du compte VRChat ? Tes logs, notes et favoris restent sur ton PC.'))) return;
    window.api.vrc.logout();
    myAvatars = null;
    hideModal();
    return toast('👋 Déconnecté(e) de VRChat');
  }
  if ((el = hit('[data-url]'))) return window.api.openUrl(el.dataset.url);
  if ((el = hit('[data-player]'))) return openPlayer(el.dataset.player);
  if ((el = hit('[data-session]'))) return openSession(+el.dataset.session);
  if ((el = hit('.nav'))) return goTo(el.dataset.view);
});
$('modalClose').onclick = hideModal;
$('modal').onclick = e => { if (e.target.id === 'modal') hideModal(); };
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideModal(); });
$('openSettings').onclick = () => openSettings();
$('exportCsv').onclick = exportCsv;
$('feedMore').onclick = () => { feedLimit += 300; renderFeed(); };
['feedSearch', 'feedRange'].forEach(id => $(id).addEventListener('input', () => { feedLimit = 300; renderFeed(); }));
$('feedTypes').addEventListener('change', () => { feedLimit = 300; renderFeed(); });
$('worldSearch').addEventListener('input', renderWorlds);
['peopleSearch', 'peopleSort', 'favOnly'].forEach(id => $(id).addEventListener('input', renderPeople));
['videoSearch', 'videoSort'].forEach(id => $(id).addEventListener('input', renderVideos));
applySettings();

// =====================================================================
//  DÉMARRAGE
// =====================================================================
(async () => {
  // "await" = on attend la réponse de main.js avant de continuer
  const init = await window.api.init();
  EVENTS = init.events;
  LIVE = init.live;
  build();
  UPDATE.current = await window.api.version();
  if (SETTINGS.autoUpdate) setTimeout(() => checkUpdate(false), 5000); // vérifie 5 s après le démarrage
  // Statut des serveurs VRChat : maintenant, puis toutes les 5 minutes
  setTimeout(() => refreshStatus(false), 1500);
  setInterval(() => refreshStatus(true), 5 * 60 * 1000);
  // Nouvelle version installée depuis la dernière ouverture ? On montre "Quoi de neuf"
  const seen = SETTINGS.lastSeenVersion;
  if (seen !== UPDATE.current) {
    SETTINGS.lastSeenVersion = UPDATE.current;
    save('settings', SETTINGS);
    setTimeout(() => showWhatsNew(seen), 2000);
  }
  setVRC(await window.api.vrc.get());
  setStatus();
  render();

  // Mises à jour du compte VRChat (amis, connexion…)
  window.api.vrc.onUpdate(s => {
    const wasLogged = !!VRC.user;
    setVRC(s);
    if (!s.user) myAvatars = null;
    if (!$('modal').classList.contains('hidden')) return;
    if (!s.user && !wasLogged) return; // toujours déconnecté : on ne touche pas au formulaire de connexion
    if (['friends', 'avatars'].includes(currentView) || wasLogged !== !!s.user) render();
  });

  // Nouveaux événements en direct
  window.api.onEvents(evs => {
    const now = Date.now();
    evs.forEach(e => { e.fresh = now; }); // pour l'animation des nouvelles lignes
    EVENTS.push(...evs);
    build();
    checkAlerts(evs);
    // On ne redessine pas si une fenêtre est ouverte (pour ne pas te déranger pendant que tu écris une note)
    if (!$('modal').classList.contains('hidden')) return;
    // Les pages Amis et Avatars ne dépendent pas des logs : on ne les redessine pas
    // (sinon ce que tu es en train de taper serait effacé à chaque seconde)
    if (['friends', 'avatars', 'brain', 'steam', 'discord', 'chatbox', 'news', 'shop', 'vgroups'].includes(currentView)) return;
    // Pendant que tu explores le graphique (souris dessus ou curseur en main), on attend
    if (document.querySelector('.ichart:hover') || document.activeElement?.closest?.('.ichart')) return;
    if (currentView !== 'feed' || document.querySelector('main').scrollTop < 50) render();
  });
  window.api.onStatus(s => {
    if (s.live !== LIVE) { LIVE = s.live; build(); setStatus(); render(); }
  });
  setInterval(() => { if (currentView === 'live' && $('modal').classList.contains('hidden')) renderLive(); }, 30000);
})();
