// =====================================================================
//  extras.js — pages "🎮 Steam" et "📰 Nouveautés"
// =====================================================================

// ---------------------------------------------------------------------
//  🎮 STEAM : heures de jeu + amis Steam qui jouent à VRChat
// ---------------------------------------------------------------------
const STEAM = { local: null, hasKey: false, time: null, friends: null, total: 0, progress: null, error: '', keyError: '', loading: false };

async function renderSteam() {
  const el = $('view-steam');
  if (!STEAM.local) {
    el.innerHTML = '<div class="empty">Lecture de Steam…</div>';
    STEAM.local = await window.api.steam.local();
    STEAM.hasKey = await window.api.steam.hasKey();
  }
  const accounts = STEAM.local.accounts.filter(a => a.minutes != null || a.mostRecent);
  if (!STEAM.local.found || !accounts.length) {
    el.innerHTML = `<header class="bar"><h1>🎮 Steam</h1></header>
      <div class="empty">Steam n'a pas été trouvé sur ce PC, ou VRChat n'a jamais été lancé avec Steam.</div>`;
    return;
  }
  const acc = accounts.find(a => a.steamId === SETTINGS.steamAccount) || accounts[0];
  const t = STEAM.time && STEAM.time.steamId === acc.steamId && STEAM.time.owns ? STEAM.time : null; // heures exactes via l'API
  const minutes = t?.minutes ?? acc.minutes ?? 0;
  const two = t?.minutes2wks ?? acc.minutes2wks ?? 0;
  const last = t?.lastPlayed ?? acc.lastPlayed;
  const tracked = M.sessions.reduce((a, s) => a + (sessionEnd(s) - s.start), 0);

  el.innerHTML = `
    <header class="bar">
      <h1>🎮 Steam</h1>
      ${accounts.length > 1 ? `<select id="steamAccount">${accounts.map(a => `<option value="${a.steamId}" ${a.steamId === acc.steamId ? 'selected' : ''}>${esc(a.name)}${a.minutes != null ? ` — ${Math.round(a.minutes / 60)} h` : ''}</option>`).join('')}</select>` : `<span class="muted">${esc(acc.name)}</span>`}
    </header>
    <div class="kpis">
      <div class="card kpi"><div class="v">${Math.floor(minutes / 60).toLocaleString('fr')} h</div><div class="l">Sur VRChat au total ${t ? '<span class="badge">exact</span>' : '<span class="muted">(lu sur ton PC)</span>'}</div></div>
      <div class="card kpi"><div class="v">${fmtDur(two * 60000)}</div><div class="l">Ces 2 dernières semaines</div></div>
      <div class="card kpi"><div class="v">${last ? ago(last) : '—'}</div><div class="l">Dernière session${last ? ` · ${fmtDate(last)}` : ''}</div></div>
      <div class="card kpi"><div class="v">${fmtDur(tracked)}</div><div class="l">Suivies par VRCLogs</div></div>
    </div>
    <p class="muted small">Soit environ <b>${(minutes / 60 / 24).toFixed(1)} jours</b> complets passés dans VRChat 😮</p>

    <h2>👥 Tes amis Steam qui jouent à VRChat</h2>
    ${STEAM.hasKey ? steamFriendsHtml() : steamKeyHtml(acc)}`;

  if ($('steamAccount')) $('steamAccount').onchange = e => {
    SETTINGS.steamAccount = e.target.value; save('settings', SETTINGS);
    STEAM.time = null; STEAM.friends = null; renderSteam();
  };
  bindSteam(acc);
  // Avec une clé : heures exactes + amis (une seule fois, puis bouton 🔄)
  if (STEAM.hasKey && !STEAM.loading) {
    if (!STEAM.time || STEAM.time.steamId !== acc.steamId) {
      window.api.steam.time(acc.steamId).then(r => { STEAM.time = { steamId: acc.steamId, ...r }; if (currentView === 'steam') renderSteam(); });
    }
    if (!STEAM.friends && !STEAM.error) loadSteamFriends(acc, false);
  }
}

function steamKeyHtml(acc) {
  return `<div class="card steamkey">
    <p>Pour voir tes amis Steam, il faut une <b>clé API Steam</b>. Elle est gratuite et c'est <b>toi</b> qui la crées :</p>
    <ol>
      <li>Ouvre <a class="link" data-url="https://steamcommunity.com/dev/apikey">steamcommunity.com/dev/apikey</a> et connecte-toi à Steam.</li>
      <li>Dans <b>« Domain Name »</b>, écris <code>localhost</code> (c'est juste un nom, il n'est pas utilisé).</li>
      <li>Accepte les conditions, clique <b>Register</b>, puis copie la clé (32 caractères).</li>
      <li>Colle-la ici :</li>
    </ol>
    <form id="steamKeyForm" class="keyform">
      <input id="steamKey" type="password" autocomplete="off" placeholder="Ta clé API Steam" required>
      <button class="primary">Enregistrer</button>
    </form>
    ${STEAM.keyError ? `<p class="t-leave">⚠️ ${esc(STEAM.keyError)}</p>` : ''}
    <ul class="privacy">
      <li>🔒 La clé est gardée <b>chiffrée par Windows</b> et envoyée <b>uniquement à Steam</b>.</li>
      <li>🤫 Ne la donne jamais à personne : elle est liée à ton compte Steam.</li>
      <li>ℹ️ Steam ne donne une clé qu'aux comptes qui ont déjà dépensé au moins 5 $ sur Steam.</li>
      <li>👀 On ne voit les heures que des amis dont le profil Steam est public.</li>
    </ul>
  </div>`;
}

function steamFriendsHtml() {
  const head = `<div class="bar small-bar">
    <button class="ghost" id="steamRefresh">🔄 Analyser à nouveau</button>
    <button class="ghost" id="steamForget">🗑️ Retirer ma clé</button>
    ${STEAM.friends ? `<span class="muted">${STEAM.friends.length} ami(s) sur ${STEAM.total} jouent à VRChat</span>` : ''}
  </div>`;
  if (STEAM.error) return head + `<div class="card">⚠️ ${esc(STEAM.error)}${/privé/i.test(STEAM.error) ? '<p class="muted">Dans Steam : Profil → Modifier le profil → Confidentialité → « Liste d\'amis » en Public.</p>' : ''}</div>`;
  if (!STEAM.friends) {
    const p = STEAM.progress;
    return head + `<div class="card">⏳ Analyse de tes amis Steam : <span id="steamProg">${p ? `${p.done} / ${p.total}` : '…'}</span>
      <div class="progress"><div id="steamBar" style="width:${p ? (p.done / p.total) * 100 : 0}%"></div></div>
      <p class="muted small">La première fois, ça peut prendre une minute (une petite pause entre chaque ami, pour respecter Steam).</p></div>`;
  }
  const list = STEAM.friends.slice().sort((a, b) => b.inVRChat - a.inVRChat || (b.minutes ?? -1) - (a.minutes ?? -1));
  const stateTxt = f => f.inVRChat ? '<span class="t-join">🎮 Dans VRChat maintenant</span>'
    : f.playing ? `🎮 Joue à ${esc(f.playing)}` : f.state > 0 ? '<span class="t-join">● En ligne</span>' : `💤 Hors ligne${f.lastOnline ? ` · ${ago(f.lastOnline)}` : ''}`;
  return head + `<div class="fgrid">${list.map(f => `
    <div class="fcard steamf" data-url="${esc(f.url)}">
      <div class="fimg">${dot(f.steamId, f.name, 'big')}${vimg(f.avatar)}<span class="sdot" style="background:${f.inVRChat ? '#5ee6a0' : f.state > 0 ? '#42a5ff' : '#777'}"></span></div>
      <div class="finfo">
        <div class="n">${esc(f.name)}</div>
        <div class="s where">${stateTxt(f)}</div>
        <div class="s">${f.minutes != null ? `⏱️ ${Math.round(f.minutes / 60).toLocaleString('fr')} h sur VRChat${f.minutes2wks ? ` · ${Math.round(f.minutes2wks / 60)} h ces 2 sem.` : ''}` : '🔒 Heures privées'}</div>
        <div class="s">${f.since ? `Ami Steam depuis ${fmtDate(f.since)}` : ''}</div>
      </div>
    </div>`).join('') || '<div class="empty">Aucun ami Steam ne joue à VRChat (ou leurs profils sont privés).</div>'}</div>`;
}

async function loadSteamFriends(acc, force) {
  STEAM.loading = true; STEAM.friends = null; STEAM.error = ''; STEAM.progress = null;
  if (currentView === 'steam') renderSteam();
  const r = await window.api.steam.friends(acc.steamId, force);
  STEAM.loading = false;
  if (r.error) STEAM.error = r.error;
  else { STEAM.friends = r.friends; STEAM.total = r.total; }
  if (currentView === 'steam') renderSteam();
}

function bindSteam(acc) {
  if ($('steamKeyForm')) $('steamKeyForm').onsubmit = async e => {
    e.preventDefault();
    const btn = e.submitter; btn.disabled = true; btn.textContent = 'Vérification…';
    const r = await window.api.steam.setKey($('steamKey').value, acc.steamId);
    $('steamKey').value = ''; // on efface la clé de l'écran
    if (r.error) { STEAM.keyError = r.error; }
    else { STEAM.keyError = ''; STEAM.hasKey = true; toast('✅ Clé Steam enregistrée'); }
    renderSteam();
  };
  if ($('steamRefresh')) $('steamRefresh').onclick = () => loadSteamFriends(acc, true);
  if ($('steamForget')) $('steamForget').onclick = async () => {
    if (!confirm('Retirer ta clé API Steam de VRCLogs ?')) return;
    await window.api.steam.clearKey();
    Object.assign(STEAM, { hasKey: false, time: null, friends: null, error: '' });
    renderSteam();
  };
}
window.api.steam.onProgress(p => {
  STEAM.progress = p;
  // On met juste à jour le texte et la barre (pas toute la page)
  if ($('steamProg')) $('steamProg').textContent = `${p.done} / ${p.total}`;
  if ($('steamBar')) $('steamBar').style.width = `${(p.done / p.total) * 100}%`;
});

// ---------------------------------------------------------------------
//  📰 NOUVEAUTÉS : mises à jour VRChat + boutiques des mondes
// ---------------------------------------------------------------------
const NEWS = { tab: 'news', items: null, error: '', officialOnly: true, stores: new Map() };

async function renderNews() {
  const el = $('view-news');
  el.innerHTML = `
    <header class="bar"><h1>📰 Nouveautés</h1></header>
    <div class="tabs">
      <button class="tabbtn ${NEWS.tab === 'news' ? 'on' : ''}" data-ntab="news">📢 Mises à jour VRChat</button>
      <button class="tabbtn ${NEWS.tab === 'stores' ? 'on' : ''}" data-ntab="stores">🛍️ Boutiques des mondes</button>
    </div>
    <div id="newsBody"></div>`;
  if (NEWS.tab === 'news') await drawNews();
  else drawStores();
}

async function drawNews() {
  const box = $('newsBody');
  if (!NEWS.items && !NEWS.error) {
    box.innerHTML = '<div class="empty">Chargement des actualités…</div>';
    const r = await window.api.news(false);
    if (r.error) NEWS.error = r.error; else NEWS.items = r;
    if (currentView !== 'news' || NEWS.tab !== 'news') return;
  }
  if (NEWS.error) { $('newsBody').innerHTML = `<div class="empty">⚠️ ${esc(NEWS.error)}</div>`; return; }
  const list = NEWS.items.filter(n => !NEWS.officialOnly || n.official);
  $('newsBody').innerHTML = `
    <label class="inline newsfilter"><input type="checkbox" id="newsOfficial" ${NEWS.officialOnly ? 'checked' : ''}> Annonces officielles de VRChat seulement</label>
    <div class="newslist">${list.map(n => `
      <div class="card newscard" data-url="${esc(n.url)}">
        ${n.image ? `<div class="nimg">${vimg(n.image)}</div>` : ''}
        <div>
          <div class="ntitle">${esc(n.title)}</div>
          <div class="muted small">${fmtDT(n.date)} · ${n.official ? '<span class="badge">📢 Officiel</span>' : esc(n.source)}</div>
          <p>${esc(n.excerpt)}${n.excerpt.length >= 400 ? '…' : ''}</p>
          <span class="link">Lire la suite ↗</span>
        </div>
      </div>`).join('') || '<div class="empty">Aucune actualité.</div>'}</div>
    <p class="muted small">Source : actualités publiques de VRChat sur Steam.</p>`;
  $('newsOfficial').onchange = e => { NEWS.officialOnly = e.target.checked; drawNews(); };
}

function drawStores() {
  const box = $('newsBody');
  // Les boutiques des mondes que tu as visités (trouvées dans tes logs)
  const seen = new Map();
  for (const s of M.sessions) {
    if (!s.storeId) continue;
    const o = seen.get(s.storeId) || { id: s.storeId, worlds: new Set(), last: 0, worldId: s.worldId };
    o.worlds.add(s.world); o.last = Math.max(o.last, s.start);
    seen.set(s.storeId, o);
  }
  const stores = [...seen.values()].sort((a, b) => b.last - a.last);
  box.innerHTML = `
    <div class="card note">🛍️ Les boutiques des mondes que tu as visités. <b>Affichage seulement</b> : VRCLogs ne permet aucun achat, tout se passe dans VRChat.
      <span class="muted">La boutique officielle de VRChat n'est pas accessible par son API, elle reste visible dans le jeu.</span></div>
    ${!VRC.user ? '<div class="empty">Connecte ton compte VRChat (onglet 💜 Amis) pour voir le contenu des boutiques.</div>' : ''}
    ${stores.map(st => `
      <div class="card storecard" id="store-${esc(st.id)}">
        <div class="title">🛍️ ${[...st.worlds].map(esc).join(', ')}</div>
        <div class="muted small">Dernière visite ${ago(st.last)} · <a class="link" data-url="https://vrchat.com/home/world/${esc(st.worldId)}">Page du monde ↗</a></div>
        <div class="listings">${VRC.user ? '<span class="muted">Chargement…</span>' : ''}</div>
      </div>`).join('') || '<div class="empty">Aucun monde avec une boutique dans tes logs pour l\'instant.</div>'}`;
  if (!VRC.user) return;
  for (const st of stores) loadStore(st.id);
}

const TYPE_NAMES = { udon: '⚙️ Monde (Udon)', avatar: '🧍 Avatar', prop: '📦 Objet', sticker: '🏷️ Sticker', emoji: '😀 Emoji', inventory: '🎒 Inventaire', permission: '🔑 Accès' };
async function loadStore(id) {
  let s = NEWS.stores.get(id);
  if (!s) { s = await window.api.store(id); if (!s.error) NEWS.stores.set(id, s); }
  const box = document.querySelector(`#store-${CSS.escape(id)} .listings`);
  if (!box) return;
  if (s.error) { box.innerHTML = `<span class="muted">⚠️ ${esc(s.error)}</span>`; return; }
  box.previousElementSibling.insertAdjacentHTML('beforeend', s.seller ? ` · Vendu par <b>${esc(s.seller)}</b>` : '');
  const list = s.listings.slice().sort((a, b) => Date.parse(b.created || 0) - Date.parse(a.created || 0));
  box.innerHTML = list.map(l => {
    const isNew = l.created && Date.now() - Date.parse(l.created) < 14 * 86400000;
    return `<div class="listing">
      <div class="limg">${l.image ? vimg(l.image) : '🛍️'}</div>
      <div>
        <div class="n">${esc(l.name)} ${isNew ? '<span class="badge new">✨ Nouveau</span>' : ''}</div>
        ${l.description ? `<div class="s">${esc(l.description)}</div>` : ''}
        <div class="s">${l.types.map(t => `<span class="badge">${TYPE_NAMES[t] || esc(t)}</span>`).join('')}
          ${l.duration ? `<span class="badge">⏳ ${l.duration} ${{ days: 'jours', months: 'mois', weeks: 'semaines', hours: 'heures' }[l.durationType] || esc(l.durationType || '')}</span>` : '<span class="badge">♾️ Permanent</span>'}</div>
      </div>
      <div class="price">💳 ${Number(l.price || 0).toLocaleString('fr')}<span>crédits VRChat</span>${l.vrcPlusPrice ? `<span class="muted">VRC+ : ${l.vrcPlusPrice}</span>` : ''}</div>
    </div>`;
  }).join('') || '<span class="muted">Boutique vide pour l\'instant.</span>';
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-ntab]');
  if (t) { NEWS.tab = t.dataset.ntab; renderNews(); }
});
