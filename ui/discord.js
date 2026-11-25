// =====================================================================
//  ui/discord.js — page "💬 Discord"
//   1. Statut sur ton profil Discord (Rich Presence)
//   2. Alertes dans un salon de ton serveur (webhook)
// =====================================================================
// L'application Discord OFFICIELLE de VRCLogs (comme VRCX) : créée une fois par l'autrice,
// sur discord.com/developers. Ce numéro est PUBLIC (il dit juste à Discord quel nom et quel logo
// afficher) : tout le monde peut l'utiliser, sans rien configurer.
const VRCLOGS_APP_ID = '';

const DISCORD = Object.assign({
  clientId: '',          // (avancé) Application ID personnel, à la place de celui de VRCLogs
  presence: false,       // afficher le statut (tu l'actives toi-même, comme dans VRCX)
  showWorld: 'notinvite',// always | notinvite | never
  showPlayers: true,
  showImage: true,
  worldButton: true,     // bouton « Voir le monde »
  hooks: { alerts: true, friends: true, status: true, world: false }, // quoi envoyer au webhook
}, load('discord', {}));
const DSTATE = { conn: { enabled: false, connected: false, user: null, error: '' }, hasWebhook: false, webhookError: '', idError: '', lastJson: '', lastSession: null };
const saveDiscord = () => save('discord', DISCORD);
const appId = () => DISCORD.clientId || VRCLOGS_APP_ID; // ton application, sinon celle de VRCLogs
// Allume ou éteint la connexion avec l'app Discord de ton PC
async function connectPresence() {
  DSTATE.lastJson = '';
  DSTATE.conn = await window.api.discord.setClient(DISCORD.presence && appId() ? appId() : null);
  updatePresence();
}

// ---------- Ce qu'on montre sur ton profil ----------
// (on garde la même "carte" tant que rien ne change, pour ne pas spammer Discord)
const isPrivateInst = t => /^Invite/.test(t || '');
async function buildActivity() {
  const c = M?.current;
  if (!LIVE || !c || !DISCORD.presence) return null;
  const hide = DISCORD.showWorld === 'never' || (DISCORD.showWorld === 'notinvite' && isPrivateInst(c.instType));
  const n = c.present.size;
  let img = null;
  if (!hide && DISCORD.showImage && c.worldId && VRC.user) {
    try { img = (await window.api.worldBrief(c.worldId))?.thumb || null; } catch {}
  }
  return {
    details: hide ? tr('Dans une instance privée') : c.world,
    // sans image du monde : le logo de l'application (image "logo" dans Rich Presence → Art Assets)
    image: img || 'logo',
    smallImage: img ? 'logo' : undefined,
    smallText: 'VRCLogs',
    state: DISCORD.showPlayers ? tr(`${hide ? '🔒' : c.instType} · ${n} joueur(s)`) : (hide ? '🔒' : c.instType),
    start: c.start,
    imageText: hide ? undefined : c.world,
    buttons: !hide && DISCORD.worldButton && c.worldId ? [{ label: tr('Voir le monde'), url: `https://vrchat.com/home/world/${c.worldId}` }] : [],
  };
}
async function updatePresence() {
  // Nouveau monde → alerte webhook (si demandé)
  const c = LIVE ? M?.current : null;
  if (c && DSTATE.lastSession !== null && c.id !== DSTATE.lastSession && DISCORD.hooks.world && DSTATE.hasWebhook
      && !(DISCORD.showWorld !== 'always' && isPrivateInst(c.instType))) {
    window.api.discord.post({ title: tr('🌍 Nouveau monde') + ' : ' + c.world, text: c.instType, color: 0x42a5ff });
  }
  DSTATE.lastSession = c ? c.id : DSTATE.lastSession ?? null;
  if (!DSTATE.conn.enabled) return;
  const a = await buildActivity();
  const json = JSON.stringify(a);
  if (json === DSTATE.lastJson) return;
  DSTATE.lastJson = json;
  window.api.discord.activity(a);
}

// ---------- Les alertes de VRCLogs → ton salon Discord ----------
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
  const badge = !appId() ? '<span class="badge">Pas configuré</span>'
    : !DISCORD.presence ? '<span class="badge">Désactivé</span>'
    : st.connected ? `<span class="badge new">● Connecté${st.user ? ` · ${esc(st.user)}` : ''}</span>`
    : `<span class="badge">○ ${esc(st.error || 'Connexion à Discord…')}</span>`;
  el.innerHTML = `
    <header class="bar"><h1>💬 Discord</h1></header>

    <div class="card dcard">
      <h2>🎮 Statut sur ton profil Discord ${badge}</h2>
      <p class="muted">Tes amis Discord voient le monde VRChat où tu es, depuis combien de temps et combien de joueurs, comme sur ton profil quand tu joues à un jeu.</p>
      ${appId() ? presenceOptionsHtml() : presenceSetupHtml()}
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

function presenceSetupHtml() {
  return `<p>À faire <b>une seule fois</b> (2 minutes) : créer une « application Discord ». C'est gratuit, et ça dit à Discord quel nom afficher.</p>
    <div class="keysteps">
      <div class="keystep"><b>1</b><div><button class="primary" data-url="https://discord.com/developers/applications">🌐 Ouvrir le portail Discord</button>
        <p class="muted small">Connecte-toi, clique <b>New Application</b>, et donne-lui le nom à afficher (par exemple <code>VRChat</code> → « Joue à VRChat »).</p></div></div>
      <div class="keystep"><b>2</b><div>Dans <b>General Information</b>, copie l'<b>Application ID</b> (un grand nombre) et colle-le ici :
        <form id="dClientForm" class="keyform"><input id="dClientId" inputmode="numeric" autocomplete="off" placeholder="Application ID (ex : 1234567890123456789)" required><button class="primary">Activer</button></form>
        ${DSTATE.idError ? `<p class="t-leave">⚠️ ${esc(DSTATE.idError)}</p>` : ''}
        <p class="muted small">Ce numéro n'est pas secret : il n'ouvre aucun accès à ton compte.</p></div></div>
      <div class="keystep"><b>3</b><div class="muted small">Facultatif : dans <b>Rich Presence → Art Assets</b>, ajoute une image : elle s'affichera quand le monde n'a pas d'image.</div></div>
    </div>
    <ul class="privacy"><li>💻 Le statut passe par l'app Discord ouverte sur ton PC : VRCLogs n'envoie rien sur Internet pour ça.</li></ul>`;
}

function presenceOptionsHtml() {
  const opt = (v, t) => `<option value="${v}" ${DISCORD.showWorld === v ? 'selected' : ''}>${t}</option>`;
  const chk = (k, t) => `<label class="inline"><input type="checkbox" data-dset="${k}" ${DISCORD[k] ? 'checked' : ''}> ${t}</label>`;
  const own = DISCORD.clientId
    ? `<p class="muted small">Tu utilises ta propre application Discord (${esc(DISCORD.clientId)}).</p><button class="ghost" id="dForgetId">🗑️ Retirer l'Application ID</button>`
    : `<p class="muted small">Pour afficher un autre nom que celui de VRCLogs, crée ta propre application sur <a class="link" data-url="https://discord.com/developers/applications">discord.com/developers</a> et colle son Application ID :</p>
       <form id="dClientForm" class="keyform"><input id="dClientId" inputmode="numeric" autocomplete="off" placeholder="Application ID (ex : 1234567890123456789)" required><button class="primary">Activer</button></form>
       ${DSTATE.idError ? `<p class="t-leave">⚠️ ${esc(DSTATE.idError)}</p>` : ''}`;
  const advanced = `<details class="small dadv"><summary>Avancé : utiliser ma propre application Discord</summary>${own}</details>`;
  if (!DISCORD.presence) return `
    <label class="bigtoggle"><input type="checkbox" data-dset="presence"> <b>Afficher mon statut VRChat sur Discord</b></label>
    <p class="muted small">C'est tout ! Il suffit que l'app Discord soit ouverte sur ce PC. Rien à créer, rien à copier.</p>
    ${VRCLOGS_APP_ID ? advanced : ''}`;
  return `<label class="bigtoggle"><input type="checkbox" data-dset="presence" checked> <b>Afficher mon statut VRChat sur Discord</b></label>
    <div class="dopts">
      <label class="inline">Montrer le monde : <select id="dShowWorld">${opt('always', 'Toujours')}${opt('notinvite', 'Sauf instances privées (Invite)')}${opt('never', 'Jamais')}</select></label>
      ${chk('showPlayers', 'Nombre de joueurs')}
      ${chk('showImage', 'Image du monde (compte VRChat connecté)')}
      ${chk('worldButton', 'Bouton « Voir le monde »')}
    </div>
    <h3>Aperçu</h3>
    <div id="dPreview" class="dpreview">${previewHtml(null)}</div>
    <p class="muted small">Discord doit être ouvert sur ce PC. Dans Discord : Paramètres → Confidentialité de l'activité → « Partager mon activité » doit être activé.</p>
    ${VRCLOGS_APP_ID ? advanced : `<button class="ghost" id="dForgetId">🗑️ Retirer l'Application ID</button>`}`;
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
  if ($('dClientForm')) $('dClientForm').onsubmit = async e => {
    e.preventDefault();
    const id = $('dClientId').value.trim();
    if (!/^\d{17,20}$/.test(id)) { DSTATE.idError = tr('Un Application ID Discord est un nombre de 17 à 20 chiffres.'); return renderDiscord(); }
    DSTATE.idError = '';
    DISCORD.clientId = id; DISCORD.presence = true; saveDiscord();
    await connectPresence();
    renderDiscord();
  };
  if ($('dForgetId')) $('dForgetId').onclick = async () => {
    DISCORD.clientId = ''; saveDiscord();
    await connectPresence();
    renderDiscord();
  };
  document.querySelectorAll('[data-dset]').forEach(i => i.onchange = async () => {
    DISCORD[i.dataset.dset] = i.checked; saveDiscord();
    if (i.dataset.dset === 'presence') { await connectPresence(); return renderDiscord(); } // la grande case : on (dé)connecte
    DSTATE.lastJson = ''; updatePresence(); refreshPreview();
  });
  if ($('dShowWorld')) $('dShowWorld').onchange = e => { DISCORD.showWorld = e.target.value; saveDiscord(); DSTATE.lastJson = ''; updatePresence(); refreshPreview(); };
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
  if (DISCORD.presence && appId()) await connectPresence();
  setTimeout(updatePresence, 3000);
  setInterval(updatePresence, 15000); // toutes les 15 s (le nombre de joueurs change)
})();
