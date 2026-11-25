// =====================================================================
//  extras.js — pages "🎮 Steam" et "📰 Nouveautés"
// =====================================================================

// ---------------------------------------------------------------------
//  🎮 STEAM : heures de jeu + amis Steam qui jouent à VRChat
// ---------------------------------------------------------------------
const STEAM = { local: null, contacts: null, contactsFor: null, contactQ: '', hasKey: false, time: null, friends: null, total: 0, progress: null, error: '', keyError: '', loading: false };

async function renderSteam() {
  const el = $('view-steam');
  if (!STEAM.local) {
    el.innerHTML = '<div class="empty">Lecture de Steam…</div>';
    STEAM.local = await window.api.steam.local();
    STEAM.hasKey = await window.api.steam.hasKey();
  }
  // Par défaut : seulement les comptes enregistrés dans Steam. Les "anciens comptes" sont des
  // dossiers laissés par d'autres comptes qui se sont déjà connectés à Steam sur ce PC.
  const withVRChat = STEAM.local.accounts.filter(a => a.minutes != null || a.mostRecent);
  const oldCount = withVRChat.filter(a => !a.remembered).length;
  const accounts = withVRChat.filter(a => a.remembered || SETTINGS.steamShowOld);
  const oldToggle = oldCount ? `<label class="inline small"><input type="checkbox" id="steamShowOld" ${SETTINGS.steamShowOld ? 'checked' : ''}> Afficher les anciens comptes de ce PC (${oldCount})</label>` : '';
  if (!STEAM.local.found || !accounts.length) {
    el.innerHTML = `<header class="bar"><h1>🎮 Steam</h1>${oldToggle}</header>
      <div class="empty">Steam n'a pas été trouvé sur ce PC, ou VRChat n'a jamais été lancé avec ton compte Steam.</div>`;
    bindOldToggle();
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
      ${oldToggle}
      ${accounts.length > 1 ? `<select id="steamAccount">${accounts.map(a => `<option value="${a.steamId}" ${a.steamId === acc.steamId ? 'selected' : ''}>${esc(a.name)}${a.remembered ? '' : ' (ancien compte)'}${a.minutes != null ? ` — ${Math.round(a.minutes / 60)} h` : ''}</option>`).join('')}</select>` : `<span class="muted">${esc(acc.name)}</span>`}
    </header>
    <div class="kpis">
      <div class="card kpi"><div class="v">${Math.floor(minutes / 60).toLocaleString(LOCALE)} h</div><div class="l">Sur VRChat au total ${t ? '<span class="badge">exact</span>' : '<span class="muted">(lu sur ton PC)</span>'}</div></div>
      <div class="card kpi"><div class="v">${fmtDur(two * 60000)}</div><div class="l">Ces 2 dernières semaines</div></div>
      <div class="card kpi"><div class="v">${last ? ago(last) : '—'}</div><div class="l">Dernière session${last ? ` · ${fmtDate(last)}` : ''}</div></div>
      <div class="card kpi"><div class="v">${fmtDur(tracked)}</div><div class="l">Suivies par VRCLogs</div></div>
    </div>
    <p class="muted small">Soit environ <b>${(minutes / 60 / 24).toFixed(1)} jours</b> complets passés dans VRChat 😮</p>

    ${STEAM.hasKey ? `<h2>👥 Tes amis Steam qui jouent à VRChat</h2>${steamFriendsHtml()}` : steamKeyHtml(acc) + steamContactsHtml()}`;

  if ($('steamAccount')) $('steamAccount').onchange = e => {
    SETTINGS.steamAccount = e.target.value; save('settings', SETTINGS);
    STEAM.time = null; STEAM.friends = null; renderSteam();
  };
  bindSteam(acc);
  bindOldToggle();
  // Sans clé : les contacts gardés par Steam sur ton PC
  if (!STEAM.hasKey && STEAM.contactsFor !== acc.steamId) {
    STEAM.contactsFor = acc.steamId;
    window.api.steam.localFriends(acc.steamId).then(r => { STEAM.contacts = r; if (currentView === 'steam') renderSteam(); });
  }
  if ($('steamContactQ')) $('steamContactQ').oninput = e => {
    STEAM.contactQ = e.target.value;
    $('steamContacts').innerHTML = steamContactCards();
  };
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
    <h3>⭐ Bonus : qui joue à VRChat parmi tes amis, et combien d'heures</h3>
    <button class="steambtn" id="steamLogin">${STEAM.loggingIn ? '⏳ Connexion à Steam en cours…' : '<b>STEAM</b> Se connecter avec Steam'}</button>
    <ol class="cbsteps small">
      <li>La page officielle de Steam s'ouvre : connecte-toi (mot de passe ou <b>QR code</b> avec l'app Steam mobile).</li>
      <li>Si tu n'as pas encore de clé : coche la case des conditions, clique <b>Register</b>, et confirme dans l'app Steam mobile.</li>
      <li>VRCLogs récupère la clé tout seul et ferme la fenêtre. 🎉</li>
    </ol>
    <p class="muted small">🔒 Ton mot de passe est tapé <b>chez Steam</b>, jamais dans VRCLogs. Après, VRCLogs oublie ta connexion Steam : il garde seulement la clé.</p>
    ${STEAM.keyError ? `<p class="t-leave">⚠️ ${esc(STEAM.keyError)}</p>` : ''}
    <details class="small"><summary>Autres méthodes (copier-coller la clé)</summary>
      <div class="keysteps">
        <div class="keystep"><b>1</b>
          <div><button class="ghost" data-url="https://steamcommunity.com/dev/apikey">🌐 Ouvrir la page Steam</button>
          <p class="muted small">Connecte-toi, écris <code>localhost</code> dans « Domain Name », coche la case, clique <b>Register</b>, puis <b>copie la clé</b> (Ctrl+C).</p></div></div>
        <div class="keystep"><b>2</b>
          <div><button class="ghost" id="steamPaste">📋 Coller ma clé</button>
          <p class="muted small">VRCLogs lit la clé copiée, la vérifie, l'enregistre, puis vide le presse-papiers.</p></div></div>
      </div>
      <form id="steamKeyForm" class="keyform">
        <input id="steamKey" type="password" autocomplete="off" placeholder="Ta clé API Steam" required>
        <button class="primary">Enregistrer</button>
      </form>
    </details>
    <ul class="privacy">
      <li>🔒 La clé est gardée <b>chiffrée par Windows</b> et envoyée <b>uniquement à Steam</b>.</li>
      <li>🤫 Ne la donne jamais à personne : elle est liée à ton compte Steam.</li>
      <li>ℹ️ Steam ne donne une clé qu'aux comptes qui ont déjà dépensé au moins 5 $ sur Steam.</li>
      <li>👀 On ne voit les heures que des amis dont le profil Steam est public.</li>
    </ul>
  </div>`;
}

// Contacts Steam lus sur ton PC (sans clé)
function steamContactsHtml() {
  if (!STEAM.contacts) return '<h2>👥 Tes contacts Steam</h2><div class="empty">Lecture…</div>';
  if (!STEAM.contacts.length) return '';
  return `<h2>👥 Tes contacts Steam <span class="muted small">(${STEAM.contacts.length} · lus sur ton PC, sans clé)</span></h2>
    <p class="muted small">Steam garde sur ton PC le nom et l'image des personnes que tu connais (amis, et parfois d'anciens contacts). Clique pour ouvrir un profil.</p>
    <div class="bar small-bar"><input id="steamContactQ" type="search" placeholder="Rechercher un contact…" value="${esc(STEAM.contactQ)}"></div>
    <div class="fgrid" id="steamContacts">${steamContactCards()}</div>`;
}
function steamContactCards() {
  const q = STEAM.contactQ.trim().toLowerCase();
  const list = STEAM.contacts.filter(f => !q || f.name.toLowerCase().includes(q));
  return list.map(f => `
    <div class="fcard steamf" data-url="${esc(f.url)}">
      <div class="fimg">${dot(f.steamId, f.name, 'big')}${f.avatar ? vimg(f.avatar) : ''}</div>
      <div class="finfo"><div class="n">${esc(f.name)}</div><div class="s muted">Profil Steam ↗</div></div>
    </div>`).join('') || '<div class="empty">Aucun contact trouvé.</div>';
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
        <div class="s">${f.minutes != null ? `⏱️ ${Math.round(f.minutes / 60).toLocaleString(LOCALE)} h sur VRChat${f.minutes2wks ? ` · ${Math.round(f.minutes2wks / 60)} h ces 2 sem.` : ''}` : '🔒 Heures privées'}</div>
        <div class="s">${f.since ? `Ami Steam depuis ${fmtDate(f.since)}` : ''}</div>
      </div>
    </div>`).join('') || '<div class="empty">Aucun ami Steam ne joue à VRChat (ou leurs profils sont privés).</div>'}</div>`;
}

function bindOldToggle() {
  if ($('steamShowOld')) $('steamShowOld').onchange = e => {
    SETTINGS.steamShowOld = e.target.checked;
    save('settings', SETTINGS);
    STEAM.time = null; STEAM.friends = null;
    renderSteam();
  };
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
  if ($('steamLogin')) $('steamLogin').onclick = async () => {
    if (STEAM.loggingIn) return;
    STEAM.loggingIn = true; STEAM.keyError = ''; renderSteam();
    const r = await window.api.steam.login();
    STEAM.loggingIn = false;
    if (r.error) STEAM.keyError = r.error;
    else if (r.ok) {
      STEAM.hasKey = true;
      // on affiche le compte avec lequel tu viens de te connecter
      if (r.steamId && STEAM.local.accounts.some(a => a.steamId === r.steamId)) { SETTINGS.steamAccount = r.steamId; save('settings', SETTINGS); }
      STEAM.time = null; STEAM.friends = null;
      toast('✅ Connecté(e) à Steam : clé enregistrée');
    }
    renderSteam();
  };
  if ($('steamPaste')) $('steamPaste').onclick = async e => {
    const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Vérification…';
    const r = await window.api.steam.pasteKey(acc.steamId);
    if (r.error) STEAM.keyError = r.error;
    else { STEAM.keyError = ''; STEAM.hasKey = true; toast('✅ Clé Steam enregistrée'); }
    renderSteam();
  };
  if ($('steamRefresh')) $('steamRefresh').onclick = () => loadSteamFriends(acc, true);
  if ($('steamForget')) $('steamForget').onclick = async () => {
    if (!confirm(tr('Retirer ta clé API Steam de VRCLogs ?'))) return;
    await window.api.steam.clearKey();
    Object.assign(STEAM, { hasKey: false, time: null, friends: null, error: '', contactsFor: null });
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
//  📰 NOUVEAUTÉS : mises à jour officielles de VRChat
// ---------------------------------------------------------------------
const NEWS = { items: null, error: '', officialOnly: true, stores: new Map() };

async function renderNews() {
  const tab = NEWS.tab || 'vrchat';
  $('view-news').innerHTML = `
    <header class="bar"><h1>📰 Nouveautés</h1>
      <button class="ghost" id="newsRefresh" title="Actualiser">🔄</button></header>
    <div class="tabs">
      <button class="tabbtn ${tab === 'vrchat' ? 'on' : ''}" data-ntab="vrchat">📢 Mises à jour VRChat</button>
      <button class="tabbtn ${tab === 'status' ? 'on' : ''}" data-ntab="status">🟢 Statut des serveurs</button>
      <button class="tabbtn ${tab === 'app' ? 'on' : ''}" data-ntab="app">✨ Notes de version VRCLogs</button>
    </div>
    <div id="newsBody"></div>`;
  $('newsRefresh').onclick = () => {
    if (tab === 'status') return refreshStatus(false);
    NEWS.items = null; NEWS.error = ''; window.api.news(true).then(() => renderNews());
  };
  if (tab === 'status') drawStatus();
  else if (tab === 'app') drawChangelog();
  else await drawNews();
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-ntab]');
  if (t) { NEWS.tab = t.dataset.ntab; renderNews(); return; }
  if (e.target.closest('#srvStatus')) { NEWS.tab = 'status'; goTo('news'); }
});

// ---------------------------------------------------------------------
//  🟢 STATUT DES SERVEURS VRCHAT (status.vrchat.com)
// ---------------------------------------------------------------------
const SRV = { data: null, error: '', at: 0 };
const SRV_LEVEL = {
  none: ['ok', '🟢', 'Serveurs VRChat : tout fonctionne'],
  minor: ['warn', '🟠', 'Serveurs VRChat : problèmes mineurs'],
  major: ['down', '🔴', 'Serveurs VRChat : panne importante'],
  critical: ['down', '🔴', 'Serveurs VRChat : panne majeure'],
  maintenance: ['maint', '🔧', 'Serveurs VRChat : maintenance'],
};
const COMP_STATUS = {
  operational: ['ok', 'Opérationnel'], degraded_performance: ['warn', 'Ralenti'], partial_outage: ['warn', 'Panne partielle'],
  major_outage: ['down', 'Panne majeure'], under_maintenance: ['maint', 'En maintenance'],
};
const INC_STATUS = { investigating: 'Enquête en cours', identified: 'Cause identifiée', monitoring: 'Surveillance', resolved: 'Résolu', postmortem: 'Analyse',
  scheduled: 'Prévue', in_progress: 'En cours', verifying: 'Vérification', completed: 'Terminée' };

async function refreshStatus(notifyChange) {
  const r = await window.api.vrcStatus();
  if (r.error) SRV.error = r.error;
  else {
    const before = SRV.data?.indicator;
    SRV.data = r;
    SRV.error = '';
    // Prévenir quand VRChat tombe… et quand il revient
    if (notifyChange && before && before !== r.indicator) {
      if (r.indicator === 'none') notify('✅ VRChat fonctionne à nouveau', 'Tous les services VRChat sont opérationnels.', 'status');
      else notify(`${SRV_LEVEL[r.indicator]?.[1] || '⚠️'} ${SRV_LEVEL[r.indicator]?.[2] || 'VRChat a des problèmes'}`, r.incidents[0]?.name || '', 'status');
    }
  }
  SRV.at = Date.now();
  paintSrvBadge();
  if (currentView === 'news' && (NEWS.tab || 'vrchat') === 'status') drawStatus();
}
function paintSrvBadge() {
  const el = $('srvStatus');
  if (!el) return;
  if (!SRV.data) { el.className = 'status srv'; el.textContent = SRV.error ? '⚪ Statut VRChat inconnu' : '⚪ Statut VRChat…'; return; }
  const [cls] = SRV_LEVEL[SRV.data.indicator] || SRV_LEVEL.minor;
  // Version courte pour le menu (la version longue est dans 📰 Nouveautés → Statut)
  const SHORT = { ok: '🟢 VRChat : en ligne', warn: '🟠 VRChat : problèmes', down: '🔴 VRChat : en panne', maint: '🔧 VRChat : maintenance' };
  el.className = `status srv ${cls}`;
  el.textContent = SHORT[cls];
}
function drawStatus() {
  const box = $('newsBody');
  if (!box) return;
  if (!SRV.data) { box.innerHTML = `<div class="empty">${SRV.error ? `⚠️ ${esc(SRV.error)}` : 'Chargement du statut…'}</div>`; return; }
  const d = SRV.data;
  const [cls, ico, label] = SRV_LEVEL[d.indicator] || SRV_LEVEL.minor;
  const byGroup = new Map();
  for (const c of d.components) { const g = c.group || 'VRChat'; if (!byGroup.has(g)) byGroup.set(g, []); byGroup.get(g).push(c); }
  box.innerHTML = `
    <div class="card srvhero ${cls}">
      <div class="srvbig">${ico}</div>
      <div><div class="srvtitle">${label}</div>
        <div class="muted small">Vérifié ${ago(SRV.at)} · Mis à jour automatiquement toutes les 5 minutes ·
          <a class="link" data-url="https://status.vrchat.com">status.vrchat.com ↗</a></div></div>
    </div>
    ${d.incidents.length ? `<h2>⚠️ Incidents en cours</h2>${d.incidents.map(i => `
      <div class="card incident" data-url="${esc(i.url)}">
        <div class="ititle">${esc(i.name)} <span class="badge">${INC_STATUS[i.status] || esc(i.status)}</span></div>
        <div class="muted small">${fmtDT(Date.parse(i.updated))}</div>
        ${i.text ? `<div class="bio notr">${esc(i.text)}</div>` : ''}
      </div>`).join('')}` : ''}
    ${d.maintenances.length ? `<h2>🔧 Maintenances prévues</h2>${d.maintenances.map(m => `
      <div class="card incident" data-url="${esc(m.url)}">
        <div class="ititle">${esc(m.name)} <span class="badge">${INC_STATUS[m.status] || esc(m.status)}</span></div>
        <div class="muted small">${fmtDT(Date.parse(m.start))} → ${fmtDT(Date.parse(m.end))}</div>
      </div>`).join('')}` : ''}
    <h2>🖥️ Services</h2>
    <div class="srvgrid">${[...byGroup.entries()].map(([g, comps]) => `
      <div class="card"><div class="srvgroup notr">${esc(g)}</div>
        ${comps.map(c => { const [k, t] = COMP_STATUS[c.status] || ['warn', c.status]; return `
          <div class="srvrow"><span class="notr">${esc(c.name)}</span><span class="srvst ${k}">● ${t}</span></div>`; }).join('')}
      </div>`).join('')}
    </div>
    <p class="muted small">Source : page de statut officielle de VRChat.</p>`;
}

// ---------------------------------------------------------------------
//  ✨ NOTES DE VERSION DE VRCLOGS (fichier ui/changelog.js)
// ---------------------------------------------------------------------
const notesOf = entry => (LANG === 'fr' ? entry.fr : entry.en);
function drawChangelog() {
  $('newsBody').innerHTML = `<div class="changelog">${CHANGELOG.map(c => `
    <div class="card cl ${c.version === UPDATE.current ? 'current' : ''}">
      <div class="cltitle">VRCLogs ${esc(c.version)} ${c.version === UPDATE.current ? '<span class="badge">Ta version</span>' : ''}
        <span class="muted small">${fmtDate(Date.parse(c.date + 'T12:00:00'))}</span></div>
      <ul class="notr">${notesOf(c).map(n => `<li>${esc(n)}</li>`).join('')}</ul>
    </div>`).join('')}</div>`;
}
// Après une mise à jour : la fenêtre "Quoi de neuf" (versions depuis la dernière vue)
function showWhatsNew(sinceVersion) {
  const idx = CHANGELOG.findIndex(c => c.version === sinceVersion);
  const entries = sinceVersion && idx > 0 ? CHANGELOG.slice(0, idx) : CHANGELOG.slice(0, 1);
  if (!entries.length) return;
  showModal(`
    <div class="whatsnew">
      <div class="wnicon">✨</div>
      <h1>Quoi de neuf dans VRCLogs ${esc(entries[0].version)} ?</h1>
      ${entries.map(c => `<div class="card cl"><div class="cltitle">VRCLogs ${esc(c.version)}</div>
        <ul class="notr">${notesOf(c).map(n => `<li>${esc(n)}</li>`).join('')}</ul></div>`).join('')}
      <div class="fbtns center">
        <button class="primary" id="wnOk">Super !</button>
        <button class="ghost" id="wnAll">📜 Toutes les notes de version</button>
      </div>
    </div>`);
  $('wnOk').onclick = hideModal;
  $('wnAll').onclick = () => { hideModal(); NEWS.tab = 'app'; goTo('news'); };
}

// ---------------------------------------------------------------------
//  🛍️ BOUTIQUE : les boutiques des mondes (affichage seulement)
// ---------------------------------------------------------------------
const SHOP = { tab: 'spot', spot: null, briefs: new Map(), error: '' };

function renderShop() {
  $('view-shop').innerHTML = `
    <header class="bar"><h1>🛍️ Boutique</h1></header>
    <div class="tabs">
      <button class="tabbtn ${SHOP.tab === 'spot' ? 'on' : ''}" data-stab2="spot">⭐ Vitrine VRChat</button>
      <button class="tabbtn ${SHOP.tab === 'visited' ? 'on' : ''}" data-stab2="visited">🌍 Mondes visités</button>
    </div>
    <div class="card note">👀 <b>Affichage seulement</b> : VRCLogs ne permet aucun achat, tout se passe dans VRChat.</div>
    <div id="shopBody"></div>`;
  if (SHOP.tab === 'spot') drawSpotlight();
  else drawStores();
}

// ⭐ La vitrine officielle : les mondes et groupes mis en avant par VRChat
async function drawSpotlight() {
  const box = $('shopBody');
  if (!VRC.user) { box.innerHTML = '<div class="empty">Connecte ton compte VRChat (onglet 💜 Amis) pour voir la vitrine de la Marketplace.</div>'; return; }
  if (!SHOP.spot && !SHOP.error) {
    box.innerHTML = '<div class="empty">Chargement de la vitrine…</div>';
    const r = await window.api.spotlight();
    if (r.error) SHOP.error = r.error; else SHOP.spot = r;
    if (currentView !== 'shop' || SHOP.tab !== 'spot') return;
  }
  if (SHOP.error) { $('shopBody').innerHTML = `<div class="empty">⚠️ ${esc(SHOP.error)}</div>`; return; }
  const card = (kind, id) => `<div class="spotcard" data-spot="${kind}:${esc(id)}"><div class="simg"><span class="muted">⏳</span></div><div class="sname muted">…</div></div>`;
  $('shopBody').innerHTML = `
    <p class="muted small">La sélection officielle de la Marketplace VRChat (« Spotlight »)${SHOP.spot.updated ? `, mise à jour le ${fmtDate(Date.parse(SHOP.spot.updated))}` : ''}. Clique sur un monde ou un groupe pour voir sa boutique.</p>
    <h2>🌍 Mondes en vedette <span class="muted">(${SHOP.spot.worlds.length})</span></h2>
    <div class="spotgrid">${SHOP.spot.worlds.map(id => card('world', id)).join('')}</div>
    <h2>👥 Groupes en vedette <span class="muted">(${SHOP.spot.groups.length})</span></h2>
    <div class="spotgrid">${SHOP.spot.groups.map(id => card('group', id)).join('')}</div>`;
  // On charge chaque fiche une par une (petite pause entre chaque, gérée par main.js)
  for (const [kind, ids] of [['world', SHOP.spot.worlds], ['group', SHOP.spot.groups]]) {
    for (const id of ids) {
      const key = `${kind}:${id}`;
      let b = SHOP.briefs.get(key);
      if (!b) {
        b = await (kind === 'world' ? window.api.worldBrief(id) : window.api.groupBrief(id));
        if (!b.error) SHOP.briefs.set(key, b);
      }
      if (currentView !== 'shop' || SHOP.tab !== 'spot') return;
      paintSpot(key, kind, b);
    }
  }
}
function paintSpot(key, kind, b) {
  const el = document.querySelector(`[data-spot="${CSS.escape(key)}"]`);
  if (!el) return;
  if (b.error) { el.querySelector('.sname').textContent = '⚠️ indisponible'; return; }
  el.querySelector('.simg').innerHTML = vimg(kind === 'world' ? b.thumb : (b.banner || b.icon));
  el.querySelector('.sname').classList.remove('muted');
  el.querySelector('.sname').innerHTML = `${kind === 'group' && b.icon ? vimg(b.icon, 'gicon') : ''}<span><b>${esc(b.name)}</b>
    <span class="muted small">${kind === 'world' ? `par ${esc(b.author || '?')}${b.occupants ? ` · 👥 ${b.occupants}` : ''}` : `👥 ${Number(b.members || 0).toLocaleString(LOCALE)} membres`}</span></span>`;
  el.classList.toggle('nostore', !b.storeId);
}
async function openStoreModal(key) {
  const b = SHOP.briefs.get(key);
  if (!b) return;
  const [kind, id] = key.split(':');
  const link = esc(kind === 'world' ? `https://vrchat.com/home/world/${id}` : `https://vrchat.com/home/group/${id}`);
  showModal(`<h1>🛍️ ${esc(b.name)}</h1>
    <p class="muted">${kind === 'world' ? '🌍 Monde' : '👥 Groupe'} · <a class="link" data-url="${link}">Voir sur VRChat ↗</a></p>
    <div class="card note">👀 Affichage seulement : les achats se font dans VRChat.</div>
    <div class="listings" id="modalListings"><span class="muted">${b.storeId ? 'Chargement de la boutique…' : 'Pas de boutique.'}</span></div>`);
  if (!b.storeId) return;
  let s = NEWS.stores.get(b.storeId);
  if (!s) { s = await window.api.store(b.storeId); if (!s.error) NEWS.stores.set(b.storeId, s); }
  if (!$('modalListings')) return;
  if (s.error) { $('modalListings').innerHTML = `<span class="muted">⚠️ ${esc(s.error)}</span>`; return; }
  if (s.seller) $('modalBody').querySelector('p.muted').insertAdjacentHTML('beforeend', ` · Vendu par <b>${esc(s.seller)}</b>`);
  $('modalListings').innerHTML = s.listings.slice().sort((a, b2) => Date.parse(b2.created || 0) - Date.parse(a.created || 0)).map(listingHtml).join('')
    || '<span class="muted">Boutique vide pour l\'instant.</span>';
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-stab2]');
  if (t) { SHOP.tab = t.dataset.stab2; renderShop(); return; }
  const s = e.target.closest('[data-spot]');
  if (s) openStoreModal(s.dataset.spot);
});

async function drawNews() {
  const box = $('newsBody');
  if (!NEWS.items && !NEWS.error) {
    box.innerHTML = '<div class="empty">Chargement des actualités…</div>';
    const r = await window.api.news(false);
    if (r.error) NEWS.error = r.error; else NEWS.items = r;
    if (currentView !== 'news') return;
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
  const box = $('shopBody');
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
  box.innerHTML = list.map(listingHtml).join('') || '<span class="muted">Boutique vide pour l\'instant.</span>';
}

// Un article de boutique (utilisé dans la vitrine ET pour les mondes visités)
function listingHtml(l) {
    const isNew = l.created && Date.now() - Date.parse(l.created) < 14 * 86400000;
    return `<div class="listing">
      <div class="limg">${l.image ? vimg(l.image) : '🛍️'}</div>
      <div>
        <div class="n">${esc(l.name)} ${isNew ? '<span class="badge new">✨ Nouveau</span>' : ''}</div>
        ${l.description ? `<div class="s">${esc(l.description)}</div>` : ''}
        <div class="s">${l.types.map(t => `<span class="badge">${TYPE_NAMES[t] || esc(t)}</span>`).join('')}
          ${l.duration ? `<span class="badge">⏳ ${l.duration} ${{ days: 'jours', months: 'mois', weeks: 'semaines', hours: 'heures' }[l.durationType] || esc(l.durationType || '')}</span>` : '<span class="badge">♾️ Permanent</span>'}</div>
      </div>
      <div class="price">💳 ${Number(l.price || 0).toLocaleString(LOCALE)}<span>crédits VRChat</span>${l.vrcPlusPrice ? `<span class="muted">VRC+ : ${l.vrcPlusPrice}</span>` : ''}</div>
    </div>`;
}

