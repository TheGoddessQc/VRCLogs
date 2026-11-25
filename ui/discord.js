// =====================================================================
//  ui/discord.js — page "💬 Discord"
//   1. Statut sur ton profil Discord (Rich Presence) — AUTOMATIQUE, réglé ici dans le code
//   2. Alertes dans un salon de ton serveur (webhook)
// =====================================================================

// ---------- 1. STATUT DISCORD (Rich Presence) ----------
// Les valeurs PAR DÉFAUT sont écrites ici, dans le code : le statut marche tout seul,
// sans rien configurer. Chacun peut ensuite les changer dans ⚙️ Paramètres → 🔌 Intégrations.
const RICH_PRESENCE = {
  appId: '1574994157393543292', // l'application Discord officielle de VRCLogs (numéro PUBLIC, pas un secret)
  logo: 'logo',                 // nom de l'image dans Discord Developer Portal → Rich Presence → Art Assets
  refresh: 15000,               // on met à jour toutes les 15 secondes
  // --- options (modifiables dans les Paramètres) ---
  enabled: true,                // statut activé
  worldIntegration: true,       // « Regarde … » / « Écoute … » quand une vidéo ou musique joue dans le monde
  showPlayers: true,            // type d'instance + nombre de joueurs
  showPlatform: true,           // 🥽 VR ou 🖥️ Bureau
  showPrivateDetails: false,    // montrer le monde même dans une instance privée (Invite, Invite+, Group Members)
  joinButton: false,            // bouton « Rejoindre » (instances publiques seulement)
  worldButton: true,            // bouton « Voir le monde »
  showWorldImage: true,         // image du monde (compte VRChat connecté), sinon le logo
  showMediaImage: false,        // image de la vidéo en cours (quand c'est YouTube)
  worldNameAsActivity: false,   // dans ton statut : le nom du monde au lieu de « VRCLogs »
};
// Les options = celles du code, remplacées par tes choix dans les Paramètres
const RP = () => Object.assign({}, RICH_PRESENCE, SETTINGS.rp);
// La liste affichée dans l'onglet 🔌 Intégrations (comme VRCX)
const RP_OPTIONS = [
  ['enabled', 'Activer', ''],
  ['worldIntegration', 'Intégration des mondes', 'Affiche « Regarde … » / « Écoute … » quand une vidéo ou une musique joue (mondes cinéma, karaoké, danse…)'],
  ['showPlayers', "Type d'instance et nombre de joueurs", ''],
  ['showPlatform', 'Afficher la plateforme', '🥽 VR ou 🖥️ Bureau'],
  ['showPrivateDetails', 'Détails dans les instances privées', 'Montre le monde même dans les instances Invite, Invite+ et Group Members'],
  ['joinButton', 'Bouton « Rejoindre » (public seulement)', ''],
  ['worldButton', 'Bouton « Voir le monde »', ''],
  ['showWorldImage', 'Images des mondes', 'Nécessite le compte VRChat connecté'],
  ['showMediaImage', 'Images des vidéos', 'Utilise la miniature de la vidéo en cours (YouTube)'],
  ['worldNameAsActivity', "Nom du monde comme activité", 'Affiche le nom du monde au lieu de « VRCLogs » dans ton statut Discord'],
];

const DISCORD = Object.assign({
  hooks: { alerts: true, friends: true, status: true, world: false }, // quoi envoyer au webhook
}, load('discord', {}));
const DSTATE = { conn: { enabled: false, connected: false, user: null, error: '' }, hasWebhook: false, webhookError: '', lastJson: '', lastSession: null };
const saveDiscord = () => save('discord', DISCORD);

const isPrivateInst = t => /^Invite|^Group members/i.test(t || '');
const MEDIA_RECENT = 15 * 60 * 1000; // une vidéo lancée il y a moins de 15 min = « en cours »

// Ce qu'on montre sur ton profil (on garde la même "carte" tant que rien ne change, pour ne pas spammer Discord)
async function buildActivity() {
  const c = M?.current;
  const P = RP();
  if (!P.enabled || !LIVE || !c) return null; // VRChat fermé : on efface le statut
  const hide = !P.showPrivateDetails && isPrivateInst(c.instType);
  const where = hide ? '🔒' : c.instType;
  const platform = P.showPlatform && M.vr != null ? (M.vr ? '🥽 VR' : tr('🖥️ Bureau')) : '';
  let state = [P.showPlayers ? tr(`${where} · ${c.present.size} joueur(s)`) : '', platform].filter(Boolean).join(' · ') || where;
  let details = hide ? tr('Dans une instance privée') : c.world;
  let type = 0, start = c.start, image = null;

  // Une vidéo / musique joue dans le monde ? → « Regarde … » / « Écoute … »
  const video = !hide && c.videos.length ? c.videos[c.videos.length - 1] : null;
  if (video && Date.now() - video.t < MEDIA_RECENT && (P.worldIntegration || P.showMediaImage)) {
    let info = null;
    try { info = await window.api.mediaInfo(video.url); } catch {}
    if (P.worldIntegration && info) {
      type = info.music ? 2 : 3;
      details = info.title || info.host;
      state = c.world + (platform ? ' · ' + platform : '');
      start = video.t;
    }
    if (P.showMediaImage && info?.image) image = info.image;
  }
  if (!image && !hide && P.showWorldImage && c.worldId && VRC.user) {
    try { image = (await window.api.worldBrief(c.worldId))?.thumb || null; } catch {}
  }
  const buttons = [];
  if (!hide && P.joinButton && c.instType === 'Public' && c.instance) {
    buttons.push({ label: tr('Rejoindre'), url: `https://vrchat.com/home/launch?worldId=${encodeURIComponent(c.worldId)}&instanceId=${encodeURIComponent(c.instance)}` });
  }
  if (!hide && P.worldButton && c.worldId) buttons.push({ label: tr('Voir le monde'), url: `https://vrchat.com/home/world/${c.worldId}` });
  return {
    type, details, state, start,
    showDetails: P.worldNameAsActivity && !hide,
    image: image || P.logo,
    imageText: hide ? 'VRChat' : c.world,
    smallImage: image ? P.logo : undefined,
    smallText: 'VRCLogs',
    buttons,
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
// Une option a changé dans les Paramètres
async function rpChanged(key) {
  DSTATE.lastJson = '';
  if (key === 'enabled') {
    DSTATE.conn = await window.api.discord.setClient(RP().enabled ? RICH_PRESENCE.appId : null);
    if (settingsTab === 'integrations' && !$('modal').classList.contains('hidden')) openSettings('integrations');
  }
  updatePresence();
}
// L'onglet ⚙️ Paramètres → 🔌 Intégrations
function integrationsTabHtml() {
  const P = RP();
  const st = DSTATE.conn;
  return `
    <h2>💬 Statut Discord (Rich Presence)</h2>
    <p class="muted small">* Seulement quand tu es dans une instance VRChat. Désactive la « Rich Presence » de VRChat (dans ses options) pour éviter les conflits.</p>
    <p class="small">${!P.enabled ? '○ Désactivé' : st.connected ? `<span class="t-join">● Connecté${st.user ? ` · ${esc(st.user)}` : ''}</span>` : `○ ${esc(st.error || 'Connexion à Discord…')}`}</p>
    <div class="rpopts">${RP_OPTIONS.map(([k, label, help]) => `
      <label class="opt ${k !== 'enabled' && !P.enabled ? 'dim' : ''}"><span>${label}${help ? `<br><span class="muted small">${help}</span>` : ''}</span>
        <input type="checkbox" class="switch" data-rp="${k}" ${P[k] ? 'checked' : ''}></label>`).join('')}
    </div>
    <p class="muted small">Les réglages par défaut sont écrits dans le code (ui/discord.js → RICH_PRESENCE).</p>
    <button class="ghost" id="rpReset">↩️ Remettre les réglages par défaut</button>`;
}
document.addEventListener('click', e => {
  if (e.target.id !== 'rpReset') return;
  delete SETTINGS.rp; save('settings', SETTINGS);
  rpChanged('enabled');
  openSettings('integrations');
});

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
  const badge = !RP().enabled ? '<span class="badge">Désactivé</span>' : st.connected ? `<span class="badge new">● Connecté${st.user ? ` · ${esc(st.user)}` : ''}</span>`
    : `<span class="badge">○ ${esc(st.error || 'Connexion à Discord…')}</span>`;
  el.innerHTML = `
    <header class="bar"><h1>💬 Discord</h1></header>

    <div class="card dcard">
      <h2>🎮 Statut sur ton profil Discord ${badge}</h2>
      <p class="muted">Automatique : dès que Discord est ouvert sur ce PC, tes amis Discord voient le monde VRChat où tu es, depuis combien de temps et combien de joueurs. Rien à configurer.</p>
      <button class="ghost" data-stab="integrations">⚙️ Options du statut</button>
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
  DSTATE.conn = await window.api.discord.setClient(RP().enabled ? RICH_PRESENCE.appId : null);
  setTimeout(updatePresence, 3000);
  setInterval(updatePresence, RICH_PRESENCE.refresh);
})();
