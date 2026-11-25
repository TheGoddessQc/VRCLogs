// =====================================================================
//  ui/discord.js — page "💬 Discord"
//   1. Statut sur ton profil Discord (Rich Presence) — AUTOMATIQUE, réglé ici dans le code
//   2. Alertes dans un salon de ton serveur (webhook)
// =====================================================================

// ---------- 1. STATUT DISCORD : tout est réglé ICI, dans le code ----------
// Il n'y a rien à configurer dans l'app : dès que Discord est ouvert sur le PC,
// le statut s'affiche tout seul (comme VRCX).
// Pour changer ce qui est affiché, modifie ces valeurs :
const RICH_PRESENCE = {
  appId: '1574994157393543292', // l'application Discord officielle de VRCLogs (numéro PUBLIC, pas un secret)
  hidePrivateWorlds: true,      // dans une instance Invite / Invite+ : on cache le nom du monde
  showPlayers: true,            // « Public · 12 joueur(s) »
  showWorldImage: true,         // l'image du monde (si le compte VRChat est connecté), sinon le logo
  worldButton: true,            // bouton « Voir le monde »
  logo: 'logo',                 // nom de l'image dans Discord Developer Portal → Rich Presence → Art Assets
  refresh: 15000,               // on met à jour toutes les 15 secondes
};

const DISCORD = Object.assign({
  hooks: { alerts: true, friends: true, status: true, world: false }, // quoi envoyer au webhook
}, load('discord', {}));
const DSTATE = { conn: { enabled: false, connected: false, user: null, error: '' }, hasWebhook: false, webhookError: '', lastJson: '', lastSession: null };
const saveDiscord = () => save('discord', DISCORD);

// Ce qu'on montre sur ton profil (on garde la même "carte" tant que rien ne change, pour ne pas spammer Discord)
const isPrivateInst = t => /^Invite/.test(t || '');
async function buildActivity() {
  const c = M?.current;
  if (!LIVE || !c) return null; // VRChat fermé : on efface le statut
  const P = RICH_PRESENCE;
  const hide = P.hidePrivateWorlds && isPrivateInst(c.instType);
  let img = null;
  if (!hide && P.showWorldImage && c.worldId && VRC.user) {
    try { img = (await window.api.worldBrief(c.worldId))?.thumb || null; } catch {}
  }
  const where = hide ? '🔒' : c.instType;
  return {
    details: hide ? tr('Dans une instance privée') : c.world,
    state: P.showPlayers ? tr(`${where} · ${c.present.size} joueur(s)`) : where,
    start: c.start,
    image: img || P.logo,
    imageText: hide ? 'VRChat' : c.world,
    smallImage: img ? P.logo : undefined,
    smallText: 'VRCLogs',
    buttons: !hide && P.worldButton && c.worldId ? [{ label: tr('Voir le monde'), url: `https://vrchat.com/home/world/${c.worldId}` }] : [],
  };
}
async function updatePresence() {
  // Nouveau monde → alerte webhook (si demandé)
  const c = LIVE ? M?.current : null;
  if (c && DSTATE.lastSession !== null && c.id !== DSTATE.lastSession && DISCORD.hooks.world && DSTATE.hasWebhook && !isPrivateInst(c.instType)) {
    window.api.discord.post({ title: tr('🌍 Nouveau monde') + ' : ' + c.world, text: c.instType, color: 0x42a5ff });
  }
  DSTATE.lastSession = c ? c.id : DSTATE.lastSession ?? null;
  const a = await buildActivity();
  const json = JSON.stringify(a);
  if (json === DSTATE.lastJson) return;
  DSTATE.lastJson = json;
  window.api.discord.activity(a);
  if ($('dPreview')) $('dPreview').innerHTML = previewHtml(a);
}

// ---------- 2. Les alertes de VRCLogs → ton salon Discord ----------
// kind : alerts (quelqu'un arrive) | friends (ami en ligne) | status (serveurs VRChat) | test
function discordHook(kind, title, body) {
  if (!DSTATE.hasWebhook || (kind !== 'test' && !DISCORD.hooks[kind])) return;
  const color = { alerts: 0xffc857, friends: 0xb388ff, status: 0xff5c6c, test: 0x5ee6a0 }[kind];
  window.api.discord.post({ title: tr(title), text: tr(body), color });
}

// ---------- La page ----------
function renderDiscord() {
  const el = $('view-discord');
  const st = DSTATE.conn;
  const badge = st.connected ? `<span class="badge new">● Connecté${st.user ? ` · ${esc(st.user)}` : ''}</span>`
    : `<span class="badge">○ ${esc(st.error || 'Connexion à Discord…')}</span>`;
  el.innerHTML = `
    <header class="bar"><h1>💬 Discord</h1></header>

    <div class="card dcard">
      <h2>🎮 Statut sur ton profil Discord ${badge}</h2>
      <p class="muted">Automatique : dès que Discord est ouvert sur ce PC, tes amis Discord voient le monde VRChat où tu es, depuis combien de temps et combien de joueurs. Rien à configurer.</p>
      <h3>Aperçu</h3>
      <div id="dPreview" class="dpreview">${previewHtml(null)}</div>
      <ul class="privacy">
        <li>🔒 Dans une instance privée (Invite), le nom du monde est caché.</li>
        <li>💻 Le statut passe par l'app Discord ouverte sur ton PC : VRCLogs n'envoie rien sur Internet pour ça.</li>
        <li>🙈 Pour le cacher : dans Discord, Paramètres → Confidentialité de l'activité → « Partager mon activité ».</li>
      </ul>
    </div>

    <div class="card dcard">
      <h2>🔔 Alertes dans ton serveur Discord ${DSTATE.hasWebhook ? '<span class="badge new">● Activé</span>' : ''}</h2>
      <p class="muted">VRCLogs poste un message dans un salon de <b>ton</b> serveur : un favori arrive, un ami se connecte, VRChat a un problème…</p>
      ${DSTATE.hasWebhook ? webhookOptionsHtml() : webhookSetupHtml()}
    </div>

    <div class="card dcard">
      <h2>🚫 Ce que VRCLogs ne fera jamais</h2>
      <ul class="privacy">
        <li>Lire ta liste d'amis Discord, tes messages ou tes serveurs : il faudrait utiliser ton compte comme un robot (« self-bot »), c'est <b>interdit par Discord</b> et ton compte pourrait être banni.</li>
        <li>Te demander ton mot de passe ou ton « token » Discord. Si une app te le demande, c'est une arnaque.</li>
      </ul>
    </div>`;
  bindDiscord();
}

function previewHtml(a) {
  if (!a) return `<div class="muted">${LIVE ? '…' : 'VRChat est fermé : rien n\'est affiché sur ton profil.'}</div>`;
  return `<div class="dpimg">${/^https:/.test(a.image || '') ? vimg(a.image) : '🎮'}</div>
    <div><div class="muted small">Joue à …</div><b>${esc(a.details)}</b><div>${esc(a.state)}</div>
    <div class="muted small">⏱️ ${fmtDur(Date.now() - a.start)}</div>
    ${a.buttons.map(b => `<span class="dpbtn">${esc(b.label)}</span>`).join('')}</div>`;
}

function webhookSetupHtml() {
  return `<div class="keysteps">
      <div class="keystep"><b>1</b><div>Dans Discord, sur <b>ton</b> serveur : clic droit sur un salon → <b>Modifier le salon</b> → <b>Intégrations</b> → <b>Webhooks</b> → <b>Nouveau webhook</b>.</div></div>
      <div class="keystep"><b>2</b><div>Clique <b>Copier l'URL du webhook</b> et colle-la ici :
        <form id="dHookForm" class="keyform"><input id="dHookUrl" type="password" autocomplete="off" placeholder="https://discord.com/api/webhooks/…" required><button class="primary">Enregistrer</button></form>
        ${DSTATE.webhookError ? `<p class="t-leave">⚠️ ${esc(DSTATE.webhookError)}</p>` : ''}</div></div>
    </div>
    <ul class="privacy">
      <li>🔒 L'adresse est gardée <b>chiffrée par Windows</b> et envoyée <b>uniquement à Discord</b>.</li>
      <li>🤫 Ne la partage pas : quelqu'un qui l'a peut écrire dans ce salon.</li>
      <li>🔕 VRCLogs ne mentionne jamais personne (pas de @everyone).</li>
    </ul>`;
}

function webhookOptionsHtml() {
  const chk = (k, t) => `<label class="inline"><input type="checkbox" data-dhook="${k}" ${DISCORD.hooks[k] ? 'checked' : ''}> ${t}</label>`;
  return `<div class="dopts">
      ${chk('alerts', '🔔 Mes alertes (favoris, tags, nouvelles personnes)')}
      ${chk('friends', '💜 Un ami favori se connecte')}
      ${chk('status', '⚠️ Serveurs VRChat en panne ou rétablis')}
      ${chk('world', '🌍 J\'arrive dans un nouveau monde')}
    </div>
    <div class="bar small-bar"><button class="ghost" id="dHookTest">📨 Envoyer un test</button><button class="ghost" id="dHookForget">🗑️ Retirer le webhook</button></div>`;
}

function bindDiscord() {
  if ($('dHookForm')) $('dHookForm').onsubmit = async e => {
    e.preventDefault();
    const btn = e.submitter; btn.disabled = true; btn.textContent = 'Vérification…';
    const r = await window.api.discord.setWebhook($('dHookUrl').value);
    $('dHookUrl').value = '';
    if (r.error) DSTATE.webhookError = r.error;
    else { DSTATE.webhookError = ''; DSTATE.hasWebhook = true; toast(`✅ Webhook « ${esc(r.name)} » enregistré`); }
    renderDiscord();
  };
  document.querySelectorAll('[data-dhook]').forEach(i => i.onchange = () => { DISCORD.hooks[i.dataset.dhook] = i.checked; saveDiscord(); });
  if ($('dHookTest')) $('dHookTest').onclick = async () => {
    const r = await window.api.discord.post({ title: tr('👋 Test de VRCLogs'), text: tr('Les alertes Discord fonctionnent !'), color: 0x5ee6a0 });
    toast(r.error ? `⚠️ ${esc(r.error)}` : '✅ Message envoyé dans ton salon');
  };
  if ($('dHookForget')) $('dHookForget').onclick = async () => {
    if (!confirm(tr('Retirer le webhook Discord de VRCLogs ?'))) return;
    await window.api.discord.clearWebhook();
    DSTATE.hasWebhook = false;
    renderDiscord();
  };
  refreshPreview();
}
async function refreshPreview() {
  if (!$('dPreview')) return;
  const a = await buildActivity();
  if ($('dPreview')) $('dPreview').innerHTML = previewHtml(a);
}

// ---------- Démarrage ----------
(async () => {
  DSTATE.hasWebhook = await window.api.discord.hasWebhook();
  window.api.discord.onState(s => {
    DSTATE.conn = s;
    if (s.connected) DSTATE.lastJson = ''; // reconnecté : on renvoie le statut
    // on redessine la page, sauf si tu es en train d'écrire dedans
    if (currentView === 'discord' && $('modal').classList.contains('hidden') && !document.activeElement?.closest('#view-discord input')) renderDiscord();
    if (s.connected) updatePresence();
  });
  // Connexion automatique à l'app Discord du PC (elle réessaie toute seule si Discord est fermé)
  DSTATE.conn = await window.api.discord.setClient(RICH_PRESENCE.appId);
  setTimeout(updatePresence, 3000);
  setInterval(updatePresence, RICH_PRESENCE.refresh);
})();
