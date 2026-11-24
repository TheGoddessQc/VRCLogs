// =====================================================================
//  news.js — les actualités de VRChat (via les actualités publiques de Steam)
//  Pas besoin de clé : c'est la même liste que la page "Actualités" de
//  VRChat sur Steam. Les annonces officielles ont le flux
//  "steam_community_announcements".
// =====================================================================
const { VRCHAT_APP } = require('./steam');

const URL_NEWS = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${VRCHAT_APP}&count=30&maxlength=700&format=json`;
let cache = null; // { at, items }

// Le texte des annonces Steam contient du "BBCode" ([b], [img]…) : on le nettoie
function clean(text) {
  return String(text || '')
    .replace(/\{STEAM_CLAN_IMAGE\}/g, 'https://clan.akamai.steamstatic.com/images/')
    .replace(/\[img\][\s\S]*?\[\/img\]/gi, ' ')
    .replace(/<img[^>]*>/gi, ' ')
    .replace(/\[\/?[^\]]+\]/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
function firstImage(text) {
  const t = String(text || '').replace(/\{STEAM_CLAN_IMAGE\}/g, 'https://clan.akamai.steamstatic.com/images/');
  const m = t.match(/\[img\]\s*(https?:\/\/[^\s[]+)\s*\[\/img\]/i) || t.match(/<img[^>]+src="(https?:\/\/[^"]+)"/i);
  return m ? m[1] : null;
}

async function getNews(force = false) {
  if (!force && cache && Date.now() - cache.at < 30 * 60000) return cache.items;
  const res = await fetch(URL_NEWS);
  if (!res.ok) throw new Error(`Steam a répondu ${res.status}`);
  const items = ((await res.json()).appnews?.newsitems || []).map(n => ({
    id: n.gid, title: n.title, url: n.url, date: n.date * 1000, author: n.author || '',
    official: n.feedname === 'steam_community_announcements',
    source: n.feedlabel, excerpt: clean(n.contents).slice(0, 400), image: firstImage(n.contents),
  }));
  cache = { at: Date.now(), items };
  return items;
}

module.exports = { getNews };
