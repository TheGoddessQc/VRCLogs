// =====================================================================
//  brain.js — le "cerveau d'amis" : une carte de tes relations
//
//  Comment ça marche (une petite simulation physique) :
//   • TOI au centre.
//   • Chaque personne est une bulle. Plus tu as passé de temps avec elle,
//     plus la bulle est grosse et PROCHE de toi (un ressort court).
//   • Deux personnes souvent dans les mêmes instances sont reliées par
//     un fil : elles s'attirent et forment des grappes (tes groupes).
//   • Toutes les bulles se repoussent un peu pour ne pas se chevaucher.
//   On calcule ces forces des centaines de fois par seconde, et les
//   bulles finissent par trouver leur place toutes seules.
// =====================================================================

const BRAIN = {
  nodes: [], links: [], byId: new Map(),
  cam: { x: 0, y: 0, z: 1 },     // caméra : déplacement + zoom
  heat: 0,                        // "énergie" de la simulation (diminue jusqu'à l'arrêt)
  hover: null, drag: null, pan: null, moved: false,
  canvas: null, ctx: null, raf: 0, built: false,
  opts: { count: 80, who: 'all', links: true, q: '' },
};

function renderBrain() {
  const el = $('view-brain');
  if (!el.querySelector('canvas')) {
    el.innerHTML = `
      <header class="bar">
        <h1>🧠 Cerveau d'amis</h1>
        <input id="brainSearch" type="search" placeholder="Trouver quelqu'un…">
        <select id="brainWho">
          <option value="all">Tout le monde</option>
          <option value="friends">Amis seulement</option>
          <option value="favs">Favoris seulement</option>
        </select>
        <label class="inline">👥 <input type="range" id="brainCount" min="20" max="250" step="10" value="${BRAIN.opts.count}"> <span id="brainCountVal">${BRAIN.opts.count}</span></label>
        <label class="inline"><input type="checkbox" id="brainLinks" checked> Liens entre eux</label>
        <button class="ghost" id="brainReset" title="Recentrer">🎯</button>
      </header>
      <div class="brain-wrap">
        <canvas id="brainCanvas"></canvas>
        <div id="brainTip" class="brain-tip hidden"></div>
        <div class="brain-legend">
          <span><i class="lg you"></i>Toi</span><span><i class="lg friend"></i>Ami</span>
          <span><i class="lg fav"></i>Favori</span><span><i class="lg online"></i>En ligne</span>
          <span class="muted">Taille = temps ensemble · Molette = zoom · Glisser = déplacer · Clic = fiche</span>
        </div>
      </div>`;
    BRAIN.canvas = $('brainCanvas');
    BRAIN.ctx = BRAIN.canvas.getContext('2d');
    bindBrainEvents();
    new ResizeObserver(() => { sizeBrain(); drawBrain(); }).observe(BRAIN.canvas);
    $('brainSearch').oninput = e => { BRAIN.opts.q = e.target.value.trim().toLowerCase(); drawBrain(); };
    $('brainSearch').onkeydown = e => { if (e.key === 'Enter') focusBrainSearch(); };
    $('brainWho').onchange = e => { BRAIN.opts.who = e.target.value; buildBrain(); };
    $('brainCount').oninput = e => { BRAIN.opts.count = +e.target.value; $('brainCountVal').textContent = e.target.value; };
    $('brainCount').onchange = () => buildBrain();
    $('brainLinks').onchange = e => { BRAIN.opts.links = e.target.checked; drawBrain(); };
    $('brainReset').onclick = () => { BRAIN.cam = { x: 0, y: 0, z: 1 }; drawBrain(); };
  }
  sizeBrain();
  if (!BRAIN.built) buildBrain();
  else drawBrain();
}

function sizeBrain() {
  const c = BRAIN.canvas;
  if (!c) return;
  const r = c.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  c.width = Math.max(1, r.width * dpr);
  c.height = Math.max(1, r.height * dpr);
  BRAIN.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ---------- 1. Construire les bulles et les fils ----------
function buildBrain() {
  BRAIN.built = true;
  const o = BRAIN.opts;
  let people = [...M.players.values()];
  if (o.who === 'friends') people = people.filter(p => FRIENDS.has(p.key));
  if (o.who === 'favs') people = people.filter(p => FAVS.has(p.key) || vrcFavGroups.has(p.key));
  people = people.sort((a, b) => playerTime(b) - playerTime(a)).slice(0, o.count);
  const maxT = Math.max(1, ...people.map(playerTime));

  const old = BRAIN.byId;
  BRAIN.nodes = [];
  BRAIN.byId = new Map();
  const me = { id: '__me', name: VRC.user?.name || M.self?.name || 'Toi', me: true, r: 26, x: 0, y: 0, vx: 0, vy: 0, fixed: true,
    img: loadBrainImg(VRC.user?.avatarThumb) };
  BRAIN.nodes.push(me);
  BRAIN.byId.set(me.id, me);

  people.forEach((p, i) => {
    const f = FRIENDS.get(p.key);
    const k = Math.sqrt(playerTime(p) / maxT); // 0..1 : proximité
    const prev = old.get(p.key);
    const angle = i * 2.399963; // "angle d'or" : répartit bien les bulles au départ
    const dist = 90 + 320 * (1 - k);
    const n = {
      id: p.key, name: p.name, time: playerTime(p), meets: p.sessions.length, k,
      r: 7 + 20 * k, friend: !!f, fav: FAVS.has(p.key) || vrcFavGroups.has(p.key), online: !!f?.online,
      x: prev?.x ?? Math.cos(angle) * dist, y: prev?.y ?? Math.sin(angle) * dist, vx: 0, vy: 0,
      want: dist, img: f ? loadBrainImg(f.avatarThumb) : null, hue: hash(p.key) % 360,
    };
    BRAIN.nodes.push(n);
    BRAIN.byId.set(n.id, n);
  });

  // Fils entre deux personnes : nombre d'instances partagées (+ bonus si détectées "groupe")
  const ids = new Set(BRAIN.nodes.map(n => n.id));
  const pair = new Map();
  for (const s of M.sessions) {
    const here = [...s.people.keys()].filter(k => ids.has(k));
    for (let a = 0; a < here.length; a++) {
      for (let b = a + 1; b < here.length; b++) {
        const key = here[a] < here[b] ? `${here[a]}|${here[b]}` : `${here[b]}|${here[a]}`;
        pair.set(key, (pair.get(key) || 0) + 1);
      }
    }
  }
  for (const [k, links] of M.groups.links) {
    for (const l of links) {
      if (!ids.has(k) || !ids.has(l.key)) continue;
      const key = k < l.key ? `${k}|${l.key}` : `${l.key}|${k}`;
      pair.set(key, (pair.get(key) || 0) + 2 * l.n);
    }
  }
  const maxW = Math.max(1, ...pair.values());
  BRAIN.links = [...pair.entries()].filter(([, w]) => w >= 2)
    .map(([key, w]) => { const [a, b] = key.split('|'); return { a: BRAIN.byId.get(a), b: BRAIN.byId.get(b), w: w / maxW }; });

  BRAIN.heat = 1;
  startBrain();
}

const BRAIN_IMGS = new Map();
function loadBrainImg(url) {
  if (!url) return null;
  if (BRAIN_IMGS.has(url)) return BRAIN_IMGS.get(url);
  const img = new Image();
  img.onload = () => { img.ok = true; drawBrain(); };
  img.src = `vrcimg://img/?u=${encodeURIComponent(url)}`;
  BRAIN_IMGS.set(url, img);
  return img;
}

// ---------- 2. La simulation (forces) ----------
function stepBrain() {
  const N = BRAIN.nodes, heat = BRAIN.heat;
  // a) Répulsion : toutes les bulles se repoussent
  for (let i = 0; i < N.length; i++) {
    const a = N[i];
    for (let j = i + 1; j < N.length; j++) {
      const b = N[j];
      let dx = b.x - a.x, dy = b.y - a.y;
      let d2 = dx * dx + dy * dy || 0.01;
      const min = a.r + b.r + 6;
      const f = (900 / d2 + (d2 < min * min ? 0.6 : 0)) * heat;
      const d = Math.sqrt(d2);
      dx /= d; dy /= d;
      a.vx -= dx * f; a.vy -= dy * f;
      b.vx += dx * f; b.vy += dy * f;
    }
  }
  // b) Ressort vers TOI : à la distance "want" (proche si beaucoup de temps ensemble)
  for (const n of N) {
    if (n.me) continue;
    const d = Math.hypot(n.x, n.y) || 1;
    const f = (d - n.want) * 0.012 * heat;
    n.vx -= (n.x / d) * f;
    n.vy -= (n.y / d) * f;
  }
  // c) Fils entre amis : ils s'attirent (plus le lien est fort, plus ils se rapprochent)
  for (const l of BRAIN.links) {
    const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y;
    const d = Math.hypot(dx, dy) || 1;
    const f = (d - 60) * 0.004 * l.w * heat;
    l.a.vx += (dx / d) * f; l.a.vy += (dy / d) * f;
    l.b.vx -= (dx / d) * f; l.b.vy -= (dy / d) * f;
  }
  // d) On applique les vitesses, avec du "frottement" pour que ça se calme
  for (const n of N) {
    if (n.fixed || n === BRAIN.drag) { n.vx = n.vy = 0; continue; }
    n.vx *= 0.82; n.vy *= 0.82;
    n.x += n.vx; n.y += n.vy;
  }
  BRAIN.heat *= 0.985;
}

function startBrain() {
  cancelAnimationFrame(BRAIN.raf);
  const loop = () => {
    if (currentView !== 'brain') return; // on arrête quand tu quittes la page
    stepBrain();
    drawBrain();
    if (BRAIN.heat > 0.02 || BRAIN.drag) BRAIN.raf = requestAnimationFrame(loop);
  };
  BRAIN.raf = requestAnimationFrame(loop);
}

// ---------- 3. Le dessin ----------
function brainColors() {
  const cs = getComputedStyle(document.documentElement);
  return { accent: cs.getPropertyValue('--accent').trim(), accent2: cs.getPropertyValue('--accent2').trim(),
    text: cs.getPropertyValue('--text').trim(), muted: cs.getPropertyValue('--muted').trim(), line: cs.getPropertyValue('--line').trim() };
}
function toScreen(x, y) {
  const c = BRAIN.canvas.getBoundingClientRect();
  return [c.width / 2 + (x + BRAIN.cam.x) * BRAIN.cam.z, c.height / 2 + (y + BRAIN.cam.y) * BRAIN.cam.z];
}
function toWorld(sx, sy) {
  const c = BRAIN.canvas.getBoundingClientRect();
  return [(sx - c.width / 2) / BRAIN.cam.z - BRAIN.cam.x, (sy - c.height / 2) / BRAIN.cam.z - BRAIN.cam.y];
}
function drawBrain() {
  const ctx = BRAIN.ctx, c = BRAIN.canvas;
  if (!ctx || currentView !== 'brain') return;
  const W = c.getBoundingClientRect().width, H = c.getBoundingClientRect().height;
  const col = brainColors();
  const z = BRAIN.cam.z;
  const q = BRAIN.opts.q;
  const hov = BRAIN.hover;
  // voisins de la bulle survolée (pour les mettre en valeur)
  const near = new Set();
  if (hov) { near.add(hov.id); near.add('__me'); for (const l of BRAIN.links) { if (l.a === hov) near.add(l.b.id); if (l.b === hov) near.add(l.a.id); } }
  const dim = n => (hov && !near.has(n.id)) || (q && !n.me && !n.name.toLowerCase().includes(q));

  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(z, z);
  ctx.translate(BRAIN.cam.x, BRAIN.cam.y);

  // Fils toi → personne
  const me = BRAIN.byId.get('__me');
  for (const n of BRAIN.nodes) {
    if (n.me) continue;
    ctx.globalAlpha = dim(n) ? 0.04 : 0.12 + 0.3 * n.k;
    ctx.strokeStyle = col.accent;
    ctx.lineWidth = (0.5 + 2.5 * n.k) / z;
    ctx.beginPath(); ctx.moveTo(me.x, me.y); ctx.lineTo(n.x, n.y); ctx.stroke();
  }
  // Fils entre personnes
  if (BRAIN.opts.links) {
    ctx.strokeStyle = col.text;
    for (const l of BRAIN.links) {
      const lit = hov && (l.a === hov || l.b === hov);
      ctx.globalAlpha = lit ? 0.7 : (dim(l.a) || dim(l.b)) ? 0.02 : 0.05 + 0.25 * l.w;
      ctx.lineWidth = (lit ? 2 : 0.5 + 2 * l.w) / z;
      ctx.beginPath(); ctx.moveTo(l.a.x, l.a.y); ctx.lineTo(l.b.x, l.b.y); ctx.stroke();
    }
  }
  // Bulles
  for (const n of BRAIN.nodes) {
    ctx.globalAlpha = dim(n) ? 0.18 : 1;
    ctx.save();
    ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.closePath();
    if (n.img?.ok) {
      ctx.clip();
      const s = n.r * 2, iw = n.img.naturalWidth, ih = n.img.naturalHeight, sc = Math.max(s / iw, s / ih);
      ctx.drawImage(n.img, n.x - iw * sc / 2, n.y - ih * sc / 2, iw * sc, ih * sc);
    } else {
      const g = ctx.createLinearGradient(n.x - n.r, n.y - n.r, n.x + n.r, n.y + n.r);
      g.addColorStop(0, n.me ? col.accent : `hsl(${n.hue} 70% 55%)`);
      g.addColorStop(1, n.me ? col.accent2 : `hsl(${(n.hue + 40) % 360} 75% 42%)`);
      ctx.fillStyle = g; ctx.fill();
      if (n.r > 9) {
        ctx.fillStyle = '#fff'; ctx.font = `700 ${n.r * 0.9}px Segoe UI`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(([...String(n.name).replace(/[^\p{L}\p{N}]/gu, '')][0] || '?').toUpperCase(), n.x, n.y + 1);
      }
    }
    ctx.restore();
    // Contour : toi / favori / ami / en ligne
    ctx.lineWidth = (n === hov ? 4 : 2.5) / z;
    ctx.strokeStyle = n.me ? col.accent : n.fav ? '#ffd166' : n.friend ? col.accent2 : 'rgba(255,255,255,.25)';
    ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.stroke();
    if (n.online) {
      ctx.fillStyle = '#5ee6a0';
      ctx.beginPath(); ctx.arc(n.x + n.r * 0.72, n.y + n.r * 0.72, Math.max(3, n.r * 0.24), 0, Math.PI * 2); ctx.fill();
    }
  }
  // Noms : les plus proches, ceux qu'on cherche, ou tous si on zoome
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  BRAIN.nodes.forEach((n, i) => {
    const match = q && n.name.toLowerCase().includes(q);
    if (!(n.me || i <= 18 || z > 1.4 || n === hov || near.has(n.id) && hov || match)) return;
    if (dim(n) && !match) return;
    ctx.globalAlpha = 1;
    ctx.font = `${n.me || n === hov ? 700 : 500} ${12 / z}px Segoe UI`;
    ctx.fillStyle = n === hov || match ? col.accent : col.text;
    ctx.fillText(n.me ? `👑 ${n.name}` : n.name, n.x, n.y + n.r + 4 / z);
  });
  ctx.restore();
  ctx.globalAlpha = 1;
}

// ---------- 4. Souris : survoler, glisser, zoomer, cliquer ----------
function brainHit(ev) {
  const r = BRAIN.canvas.getBoundingClientRect();
  const [x, y] = toWorld(ev.clientX - r.left, ev.clientY - r.top);
  for (let i = BRAIN.nodes.length - 1; i >= 0; i--) {
    const n = BRAIN.nodes[i];
    if (Math.hypot(n.x - x, n.y - y) <= n.r + 3 / BRAIN.cam.z) return n;
  }
  return null;
}
function bindBrainEvents() {
  const c = BRAIN.canvas, tip = $('brainTip');
  c.addEventListener('mousedown', ev => {
    BRAIN.moved = false;
    const n = brainHit(ev);
    if (n && !n.me) { BRAIN.drag = n; BRAIN.heat = Math.max(BRAIN.heat, 0.3); startBrain(); }
    else BRAIN.pan = { sx: ev.clientX, sy: ev.clientY, x: BRAIN.cam.x, y: BRAIN.cam.y };
  });
  window.addEventListener('mousemove', ev => {
    if (currentView !== 'brain' || !BRAIN.canvas) return;
    const r = c.getBoundingClientRect();
    if (BRAIN.drag) {
      BRAIN.moved = true;
      [BRAIN.drag.x, BRAIN.drag.y] = toWorld(ev.clientX - r.left, ev.clientY - r.top);
      drawBrain();
      return;
    }
    if (BRAIN.pan) {
      BRAIN.moved = true;
      BRAIN.cam.x = BRAIN.pan.x + (ev.clientX - BRAIN.pan.sx) / BRAIN.cam.z;
      BRAIN.cam.y = BRAIN.pan.y + (ev.clientY - BRAIN.pan.sy) / BRAIN.cam.z;
      drawBrain();
      return;
    }
    if (ev.target !== c) return;
    const n = brainHit(ev);
    if (n !== BRAIN.hover) { BRAIN.hover = n; drawBrain(); }
    c.style.cursor = n ? 'pointer' : 'grab';
    if (n && !n.me) {
      const f = FRIENDS.get(n.id);
      tip.innerHTML = `<b>${esc(n.name)}</b>${n.fav ? ' ⭐' : ''}${n.friend ? ' <span class="badge">💜 Ami</span>' : ''}
        <div>🕒 ${fmtDur(n.time)} ensemble · ${n.meets} rencontre(s)</div>
        ${f ? `<div class="muted">${friendWhere(f)}</div>` : ''}`;
      tip.style.left = `${ev.clientX - r.left + 16}px`;
      tip.style.top = `${ev.clientY - r.top + 12}px`;
      tip.classList.remove('hidden');
    } else tip.classList.add('hidden');
  });
  window.addEventListener('mouseup', ev => {
    if (currentView !== 'brain') return;
    const n = BRAIN.drag;
    BRAIN.drag = null; BRAIN.pan = null;
    // un clic sans bouger = ouvrir la fiche
    if (!BRAIN.moved && ev.target === c) {
      const hit = brainHit(ev);
      if (hit && !hit.me) (FRIENDS.has(hit.id) ? openFriend : openPlayer)(hit.id);
    }
    if (n) startBrain();
  });
  c.addEventListener('wheel', ev => {
    ev.preventDefault();
    const r = c.getBoundingClientRect();
    const [wx, wy] = toWorld(ev.clientX - r.left, ev.clientY - r.top);
    BRAIN.cam.z = Math.min(5, Math.max(0.2, BRAIN.cam.z * (ev.deltaY < 0 ? 1.15 : 1 / 1.15)));
    // on garde le point sous la souris au même endroit (zoom "vers" la souris)
    const [nx, ny] = toWorld(ev.clientX - r.left, ev.clientY - r.top);
    BRAIN.cam.x += nx - wx; BRAIN.cam.y += ny - wy;
    drawBrain();
  }, { passive: false });
  c.addEventListener('mouseleave', () => { BRAIN.hover = null; tip.classList.add('hidden'); drawBrain(); });
}
function focusBrainSearch() {
  const q = BRAIN.opts.q;
  const n = q && BRAIN.nodes.find(x => !x.me && x.name.toLowerCase().includes(q));
  if (!n) return;
  BRAIN.cam = { x: -n.x, y: -n.y, z: 2 };
  BRAIN.hover = n;
  drawBrain();
}
