// =====================================================================
//  ui/chatbox.js — page "💭 Chatbox" : ton texte au-dessus de ta tête
//  On fabrique le texte ici, et main.js l'envoie à VRChat par OSC (chatbox.js).
// =====================================================================
const CHATBOX = Object.assign({
  auto: false,                // mode automatique (rotation des messages)
  interval: 8,                // secondes entre deux messages
  sound: false,               // petit son de notification dans VRChat
  messages: ['🕐 {time} · 🌍 {world}', '👥 {players} joueurs ici · ⏱️ {session}'],
  draft: '',
}, load('chatbox', {}));
const CB = { idx: -1, lastAuto: 0, pausedUntil: 0, lastText: '', focus: null };
const saveChatbox = () => save('chatbox', CHATBOX);
const CB_MAX = 144;

// ---------- Les variables : {time} est remplacé par l'heure, etc. ----------
const CB_VARS = [
  ['time', 'Heure', () => fmtTime(Date.now())],
  ['date', 'Date', () => new Date().toLocaleDateString(LOCALE, { day: 'numeric', month: 'long' })],
  ['world', 'Monde actuel', () => M?.current?.world || '—'],
  ['players', 'Joueurs dans l\'instance', () => String(M?.current?.present.size ?? 0)],
  ['session', 'Temps dans ce monde', () => M?.current ? fmtDur(Date.now() - M.current.start) : '—'],
  ['today', 'Temps de jeu aujourd\'hui', () => {
    const t0 = startOfDay(Date.now());
    return fmtDur(M.sessions.reduce((a, s) => a + Math.max(0, sessionEnd(s) - Math.max(s.start, t0)), 0));
  }],
  ['friends', 'Amis en ligne (compte VRChat)', () => VRC.user ? String(VRC.friends.filter(f => f.online).length) : '—'],
];
function fillVars(text) {
  return String(text || '').replace(/\{(\w+)\}/g, (all, k) => {
    const v = CB_VARS.find(x => x[0] === k);
    try { return v ? v[2]() : all; } catch { return '—'; }
  });
}
const cbLen = t => [...t].length; // les emojis comptent pour 1

const CB_PRESETS = [
  ['💤 AFK', '💤 AFK — je reviens bientôt !'],
  ['🕐 Horloge', '🕐 {time}'],
  ['🌍 Monde', '🌍 {world} · 👥 {players}'],
  ['⏱️ Temps', '⏱️ {session} ici · {today} aujourd\'hui'],
  ['🎧 Occupé(e)', '🎧 Occupé(e), écris-moi plus tard'],
];

// ---------- Envoi ----------
async function cbSend(text, sound = CHATBOX.sound) {
  const filled = fillVars(text);
  CB.lastText = filled;
  await window.api.chatbox.send(filled, sound);
  if ($('cbLast')) $('cbLast').innerHTML = lastHtml();
}
// Toutes les secondes : faut-il envoyer le prochain message automatique ?
setInterval(() => {
  if (!CHATBOX.auto || !LIVE || Date.now() < CB.pausedUntil) return;
  const list = CHATBOX.messages.filter(m => m.trim());
  if (!list.length || Date.now() - CB.lastAuto < CHATBOX.interval * 1000) return;
  CB.lastAuto = Date.now();
  CB.idx = (CB.idx + 1) % list.length;
  cbSend(list[CB.idx], false); // pas de son en automatique (ce serait agaçant)
  if (currentView === 'chatbox') document.querySelectorAll('.cbmsg').forEach((m, i) => m.classList.toggle('on', i === CHATBOX.messages.indexOf(list[CB.idx])));
}, 1000);

// ---------- La page ----------
function lastHtml() {
  return CB.lastText ? `<div class="bubble">${esc(CB.lastText).replace(/\n/g, '<br>')}</div>` : '<span class="muted">Rien envoyé pour l\'instant.</span>';
}
function renderChatbox() {
  const el = $('view-chatbox');
  const live = LIVE ? '<span class="badge new">● VRChat ouvert</span>' : '<span class="badge">○ VRChat fermé</span>';
  el.innerHTML = `
    <header class="bar"><h1>💭 Chatbox</h1>${live}</header>
    <p class="muted">Écris un texte qui s'affiche <b>au-dessus de ta tête</b> dans VRChat, comme quand tu tapes dans le clavier du jeu. Tout le monde dans ton instance peut le lire.</p>

    <details class="card" ${load('cbHelpSeen', false) ? '' : 'open'} id="cbHelp">
      <summary><b>⚙️ À faire une seule fois : activer l'OSC dans VRChat</b></summary>
      <ol class="cbsteps">
        <li>Dans VRChat, ouvre le <b>menu rapide</b> (Action Menu : touche R ou le bouton de menu de ta manette).</li>
        <li>Va dans <b>Options</b> → <b>OSC</b> → <b>Enabled</b>.</li>
        <li>C'est tout ! VRChat s'en souvient pour la prochaine fois.</li>
      </ol>
      <p class="muted small">L'OSC est un système officiel de VRChat : VRCLogs envoie le texte à VRChat sur ton propre PC (rien ne passe par Internet).</p>
    </details>

    <div class="cbgrid">
      <div class="card">
        <h2>✍️ Écrire maintenant</h2>
        <textarea id="cbText" class="cbtext" rows="3" maxlength="400" placeholder="Ton message… (tu peux utiliser les variables comme {time})">${esc(CHATBOX.draft)}</textarea>
        <div class="cbmeta"><span id="cbCount"></span>
          <label class="inline small"><input type="checkbox" id="cbSound" ${CHATBOX.sound ? 'checked' : ''}> 🔔 Petit son</label></div>
        <div class="bar small-bar">
          <button class="primary" id="cbSendBtn">📤 Afficher dans VRChat</button>
          <button class="ghost" id="cbClear">🧹 Effacer la bulle</button>
        </div>
        <h3>Raccourcis</h3>
        <div class="chips">${CB_PRESETS.map(([n, t], i) => `<button class="chip" data-cbpreset="${i}">${esc(n)}</button>`).join('')}</div>
        <h3>Dernier message envoyé</h3>
        <div id="cbLast">${lastHtml()}</div>
      </div>

      <div class="card">
        <h2>🔁 Mode automatique ${CHATBOX.auto ? '<span class="badge new">● En marche</span>' : ''}</h2>
        <p class="muted small">Les messages s'affichent chacun leur tour (et se mettent à jour : l'heure, le monde…). Ça s'arrête tout seul quand VRChat est fermé.</p>
        <div class="cbmsgs">${CHATBOX.messages.map((m, i) => `
          <div class="cbmsg"><textarea data-cbmsg="${i}" rows="2" maxlength="400">${esc(m)}</textarea>
            <button class="ghost" data-cbdel="${i}" title="Supprimer">🗑️</button>
            <div class="muted small cbprev">${esc(fillVars(m))} <span class="${cbLen(fillVars(m)) > CB_MAX ? 't-leave' : ''}">(${cbLen(fillVars(m))}/${CB_MAX})</span></div></div>`).join('')}
        </div>
        <button class="ghost" id="cbAdd">➕ Ajouter un message</button>
        <div class="bar small-bar">
          <label class="inline">Changer toutes les
            <select id="cbInterval">${[3, 5, 8, 10, 15, 30, 60].map(s => `<option value="${s}" ${CHATBOX.interval === s ? 'selected' : ''}>${s} s</option>`).join('')}</select></label>
          <button class="${CHATBOX.auto ? 'ghost' : 'primary'}" id="cbAuto">${CHATBOX.auto ? '⏸️ Arrêter' : '▶️ Démarrer'}</button>
        </div>
        <h3>Variables (clique pour l'ajouter)</h3>
        <div class="chips">${CB_VARS.map(([k, n]) => `<button class="chip" data-cbvar="${k}" title="${esc(n)}"><code>{${k}}</code> ${esc(n)}</button>`).join('')}</div>
      </div>
    </div>`;
  bindChatbox();
}

function bindChatbox() {
  const count = () => {
    const t = fillVars($('cbText').value);
    $('cbCount').innerHTML = `<span class="${cbLen(t) > CB_MAX ? 't-leave' : 'muted'}">${cbLen(t)} / ${CB_MAX}</span>`;
  };
  count();
  // On retient le dernier champ utilisé, pour y ajouter les variables
  CB.focus = CB.focus && document.contains(CB.focus) ? CB.focus : $('cbText');
  document.querySelectorAll('#view-chatbox textarea').forEach(t => t.addEventListener('focus', () => { CB.focus = t; }));
  $('cbText').oninput = e => { CHATBOX.draft = e.target.value; saveChatbox(); count(); };
  $('cbSound').onchange = e => { CHATBOX.sound = e.target.checked; saveChatbox(); };
  $('cbSendBtn').onclick = () => {
    if (!$('cbText').value.trim()) return;
    if (!LIVE) toast('⚠️ VRChat semble fermé : le message sera perdu.');
    CB.pausedUntil = Date.now() + 30000; // le mode automatique attend 30 s pour qu'on lise ton message
    cbSend($('cbText').value);
  };
  $('cbClear').onclick = () => { window.api.chatbox.clear(); CB.lastText = ''; $('cbLast').innerHTML = lastHtml(); };
  document.querySelectorAll('[data-cbpreset]').forEach(b => b.onclick = () => {
    $('cbText').value = CB_PRESETS[+b.dataset.cbpreset][1];
    CHATBOX.draft = $('cbText').value; saveChatbox(); count();
  });
  document.querySelectorAll('[data-cbvar]').forEach(b => b.onclick = () => {
    const t = CB.focus || $('cbText');
    const pos = t.selectionStart ?? t.value.length;
    t.value = t.value.slice(0, pos) + `{${b.dataset.cbvar}}` + t.value.slice(t.selectionEnd ?? pos);
    t.dispatchEvent(new Event('input'));
    t.focus();
  });
  document.querySelectorAll('[data-cbmsg]').forEach(t => t.oninput = () => {
    CHATBOX.messages[+t.dataset.cbmsg] = t.value; saveChatbox();
    const f = fillVars(t.value);
    t.parentElement.querySelector('.cbprev').innerHTML = `${esc(f)} <span class="${cbLen(f) > CB_MAX ? 't-leave' : ''}">(${cbLen(f)}/${CB_MAX})</span>`;
  });
  document.querySelectorAll('[data-cbdel]').forEach(b => b.onclick = () => { CHATBOX.messages.splice(+b.dataset.cbdel, 1); saveChatbox(); renderChatbox(); });
  $('cbAdd').onclick = () => { CHATBOX.messages.push(''); saveChatbox(); renderChatbox(); document.querySelector('.cbmsg:last-child textarea')?.focus(); };
  $('cbInterval').onchange = e => { CHATBOX.interval = +e.target.value; saveChatbox(); };
  $('cbAuto').onclick = () => {
    CHATBOX.auto = !CHATBOX.auto; saveChatbox();
    CB.lastAuto = 0; CB.pausedUntil = 0;
    if (!CHATBOX.auto) { window.api.chatbox.clear(); CB.lastText = ''; }
    renderChatbox();
  };
  $('cbHelp').ontoggle = e => { if (!e.target.open) save('cbHelpSeen', true); };
}
