// =====================================================================
//  groups.js — page "🏛️ Groupes VRChat"
//   • les instances de groupe ouvertes EN CE MOMENT dans tes groupes
//   • la liste de tous tes groupes
//   • la fiche d'un groupe : description, annonce, publications, règles…
// =====================================================================
const VG = { groups: null, instances: null, at: 0, error: '', q: '', sort: 'activity', unreadOnly: false, showAllInst: false };
const ACCESS_NAMES = { public: '🌍 Public', plus: '➕ Group+', members: '👥 Membres' };

async function renderVGroups(force = false) {
  const el = $('view-vgroups');
  if (!VRC.user) {
    el.innerHTML = `<header class="bar"><h1>🏛️ Groupes VRChat</h1></header>
      <div class="empty">Connecte ton compte VRChat (onglet 💜 Amis) pour voir tes groupes.</div>`;
    return;
  }
  // On recharge les instances toutes les 2 minutes (elles changent vite)
  if (force || !VG.groups || Date.now() - VG.at > 2 * 60000) {
    if (!VG.groups) el.innerHTML = '<header class="bar"><h1>🏛️ Groupes VRChat</h1></header><div class="empty">Chargement de tes groupes…</div>';
    const [g, i] = [await window.api.myGroups(), await window.api.groupInstances()];
    if (g.error) VG.error = g.error; else { VG.groups = g; VG.error = ''; }
    VG.instances = i.error ? [] : i;
    VG.at = Date.now();
    if (currentView !== 'vgroups') return;
  }
  if (VG.error) { el.innerHTML = `<header class="bar"><h1>🏛️ Groupes VRChat</h1></header><div class="empty">⚠️ ${esc(VG.error)}</div>`; return; }
  keepFocus(drawVGroups);
}

function drawVGroups() {
  const el = $('view-vgroups');
  const byId = new Map(VG.groups.map(g => [g.id, g]));
  const q = VG.q.toLowerCase();
  let list = VG.groups.filter(g => (!q || g.name.toLowerCase().includes(q) || g.code.toLowerCase().includes(q)) && (!VG.unreadOnly || g.unread));
  const sorters = {
    activity: (a, b) => (b.lastPost || '').localeCompare(a.lastPost || ''),
    members: (a, b) => b.members - a.members,
    name: (a, b) => a.name.localeCompare(b.name),
  };
  list.sort((a, b) => b.representing - a.representing || sorters[VG.sort](a, b));
  const inst = VG.instances.slice().sort((a, b) => b.users - a.users);
  const shown = VG.showAllInst ? inst : inst.slice(0, 8);

  el.innerHTML = `
    <header class="bar">
      <h1>🏛️ Groupes VRChat <span class="muted">(${VG.groups.length})</span></h1>
      <input id="vgSearch" type="search" placeholder="Nom ou code du groupe…" value="${esc(VG.q)}">
      <select id="vgSort">
        <option value="activity" ${VG.sort === 'activity' ? 'selected' : ''}>Trier : activité récente</option>
        <option value="members" ${VG.sort === 'members' ? 'selected' : ''}>Trier : nombre de membres</option>
        <option value="name" ${VG.sort === 'name' ? 'selected' : ''}>Trier : nom</option>
      </select>
      <label class="inline"><input type="checkbox" id="vgUnread" ${VG.unreadOnly ? 'checked' : ''}> 🔔 Nouveautés</label>
      <button class="ghost" id="vgRefresh" title="Actualiser">🔄</button>
    </header>

    <h2>🔴 En direct dans tes groupes <span class="muted">(${inst.length} instance(s) ouverte(s))</span></h2>
    ${inst.length ? `<div class="instgrid">${shown.map(i => instanceCard(i, byId.get(i.groupId))).join('')}</div>
      ${inst.length > 8 ? `<button class="ghost more" id="vgMoreInst">${VG.showAllInst ? 'Voir moins' : `Voir les ${inst.length} instances`}</button>` : ''}`
      : '<div class="empty">Aucune instance de groupe ouverte pour l\'instant.</div>'}

    <h2>📋 Mes groupes <span class="muted">(${list.length})</span></h2>
    <div class="vggrid">${list.map(g => `
      <div class="vgcard" data-vgroup="${esc(g.id)}">
        <div class="vgbanner">${vimg(g.banner)}</div>
        <div class="vgbody">
          ${vimg(g.icon, 'vgicon')}
          <div class="vginfo">
            <div class="n">${esc(g.name)} ${g.representing ? '<span class="badge">⭐ Affiché</span>' : ''}${g.owner ? '<span class="badge">👑 Propriétaire</span>' : ''}${g.unread ? '<span class="badge new">🔔 Nouveau</span>' : ''}</div>
            <div class="s">${esc(g.code)} · 👥 ${g.members.toLocaleString('fr')} · ${g.privacy === 'private' ? '🔒 Privé' : '🌍 Public'}</div>
          </div>
        </div>
      </div>`).join('') || '<div class="empty">Aucun groupe ne correspond.</div>'}</div>`;

  $('vgSearch').oninput = e => { VG.q = e.target.value; keepFocus(drawVGroups); };
  $('vgSort').onchange = e => { VG.sort = e.target.value; drawVGroups(); };
  $('vgUnread').onchange = e => { VG.unreadOnly = e.target.checked; drawVGroups(); };
  $('vgRefresh').onclick = () => renderVGroups(true);
  if ($('vgMoreInst')) $('vgMoreInst').onclick = () => { VG.showAllInst = !VG.showAllInst; drawVGroups(); };
}

function instanceCard(i, g) {
  const pct = i.capacity ? Math.min(100, (i.users / i.capacity) * 100) : 0;
  return `<div class="instcard">
    <div class="iimg">${vimg(i.world?.thumb)}<span class="icount">👥 ${i.users}${i.capacity ? `/${i.capacity}` : ''}</span></div>
    <div class="ibody">
      <div class="n">${esc(i.world?.name || 'Monde')}</div>
      <div class="s"><a class="link" data-vgroup="${esc(i.groupId)}">${g ? vimg(g.icon, 'tinyicon') : ''}${esc(g?.name || 'Groupe')}</a></div>
      <div class="ibar"><div style="width:${pct}%"></div></div>
      <div class="s">${ACCESS_NAMES[i.access] || esc(i.access || '')} ${i.region ? `<span class="badge">${esc(i.region)}</span>` : ''}${i.ageGate ? '<span class="badge">🔞 18+</span>' : ''}${i.queue != null ? `<span class="badge">⏳ File : ${i.queue}</span>` : ''}</div>
      ${i.full ? '<span class="badge">Complet</span>' : `<a class="ghost btn" data-url="vrchat://launch?ref=vrclogs&id=${esc(i.location)}">🚀 Rejoindre</a>`}
    </div>
  </div>`;
}

async function openVGroup(id) {
  const brief = VG.groups?.find(g => g.id === id);
  showModal(`<div id="vgModal"><h1>${esc(brief?.name || 'Groupe')}</h1><p class="muted">⏳ Chargement…</p></div>`);
  const d = await window.api.groupDetails(id);
  if (!$('vgModal')) return;
  if (d.error) { $('vgModal').innerHTML = `<h1>${esc(brief?.name || 'Groupe')}</h1><p>⚠️ ${esc(d.error)}</p>`; return; }
  const links = d.links.map(l => (/^https?:\/\//i.test(l) ? l : `https://${l}`));
  const inst = (VG.instances || []).filter(i => i.groupId === id);
  $('vgModal').innerHTML = `
    ${d.banner ? `<div class="pbanner">${vimg(d.banner)}</div>` : ''}
    <div class="vghead">${vimg(d.icon, 'vgbigicon')}
      <div>
        <h1>${esc(d.name)} ${d.verified ? '<span class="badge">✔️ Vérifié</span>' : ''}</h1>
        <div class="muted">${esc(d.code)} · ${d.privacy === 'private' ? '🔒 Privé' : '🌍 Public'}${d.representing ? ' · ⭐ Tu affiches ce groupe' : ''}</div>
        <div class="pfacts">
          <span>👥 ${d.members.toLocaleString('fr')} membres</span><span class="sep">·</span>
          <span class="t-join">● ${d.online.toLocaleString('fr')} en ligne</span>
          ${d.joinedAt ? `<span class="sep">·</span><span>📅 Membre depuis le ${fmtDate(Date.parse(d.joinedAt))}</span>` : ''}
          ${d.createdAt ? `<span class="sep">·</span><span>🏗️ Créé le ${fmtDate(Date.parse(d.createdAt))}</span>` : ''}
        </div>
        <div class="fbtns">
          <a class="ghost btn" data-url="https://vrchat.com/home/group/${esc(id)}">Page VRChat ↗</a>
          ${d.storeId ? `<a class="ghost btn" data-gstore="${esc(d.storeId)}">🛍️ Voir la boutique</a>` : ''}
        </div>
      </div>
    </div>
    ${d.languages.length ? `<div class="tags">${d.languages.map(l => `<span class="tag">🗣️ ${esc(LANGS[l] || l.toUpperCase())}</span>`).join('')}</div>` : ''}
    ${d.description ? `<h2>📝 Description</h2><div class="card bio">${esc(d.description)}</div>` : ''}
    ${links.length ? `<h2>🔗 Liens</h2><div class="plinks">${links.map(l => `<a class="ghost btn" data-url="${esc(l)}">${esc(linkLabel(l))} ↗</a>`).join('')}</div>` : ''}
    <div id="gstore"></div>
    ${inst.length ? `<h2>🔴 Instances ouvertes</h2><div class="instgrid">${inst.map(i => instanceCard(i, brief)).join('')}</div>` : ''}
    ${d.announcement ? `<h2>📢 Annonce</h2><div class="card post">
      ${d.announcement.image ? vimg(d.announcement.image, 'postimg') : ''}
      <div><b>${esc(d.announcement.title)}</b> <span class="muted small">${d.announcement.date ? fmtDT(Date.parse(d.announcement.date)) : ''}</span>
      <div class="bio">${esc(d.announcement.text)}</div></div></div>` : ''}
    ${d.posts.length ? `<h2>📰 Dernières publications</h2>${d.posts.map(p => `<div class="card post">
      ${p.image ? vimg(p.image, 'postimg') : ''}
      <div><b>${esc(p.title)}</b> <span class="muted small">${p.date ? fmtDT(Date.parse(p.date)) : ''}</span>
      <div class="bio">${esc(p.text)}</div></div></div>`).join('')}` : ''}
    ${d.rules ? `<h2>📜 Règles</h2><details class="card rules"><summary>Afficher les règles</summary><div class="bio">${esc(d.rules)}</div></details>` : ''}`;
}

document.addEventListener('click', async e => {
  const g = e.target.closest('[data-vgroup]');
  if (g) { e.stopPropagation(); return openVGroup(g.dataset.vgroup); }
  const s = e.target.closest('[data-gstore]');
  if (s) {
    const box = $('gstore');
    box.innerHTML = '<h2>🛍️ Boutique</h2><div class="card note">👀 Affichage seulement : les achats se font dans VRChat.</div><div class="listings"><span class="muted">Chargement…</span></div>';
    let st = NEWS.stores.get(s.dataset.gstore);
    if (!st) { st = await window.api.store(s.dataset.gstore); if (!st.error) NEWS.stores.set(s.dataset.gstore, st); }
    box.querySelector('.listings').innerHTML = st.error ? `⚠️ ${esc(st.error)}` : (st.listings.map(listingHtml).join('') || '<span class="muted">Boutique vide.</span>');
    s.remove();
  }
}, true);
