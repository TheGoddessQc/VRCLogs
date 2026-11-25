// =====================================================================
//  i18n.js — le traducteur de VRCLogs (i18n = "internationalisation" :
//  il y a 18 lettres entre le i et le n 😄)
//
//  Comment ça marche :
//   • L'app est écrite en français.
//   • Chaque langue a un fichier (ui/lang/en.js, ja.js…) qui dit :
//       "phrase en français" → "traduction"
//     Les parties qui changent s'écrivent {0}, {1}… :
//       "il y a {0} min" → "{0} min ago"
//   • Dès qu'un texte apparaît à l'écran, on le remplace par sa traduction.
//     Les pseudos, bios et noms de mondes ne sont jamais dans le
//     dictionnaire, donc ils restent intacts.
//
//  Pour ajouter une langue : copie ui/lang/en.js, traduis la colonne de
//  droite, et ajoute la langue dans LANGUAGES ci-dessous.
// =====================================================================
window.I18N = window.I18N || {};

const LANGUAGES = [
  { code: 'fr', name: 'Français', flag: 'FR', locale: 'fr-FR' },
  { code: 'en', name: 'English', flag: 'EN', locale: 'en-US' },
  { code: 'es', name: 'Español', flag: 'ES', locale: 'es-ES' },
  { code: 'pt', name: 'Português', flag: 'PT', locale: 'pt-BR' },
  { code: 'de', name: 'Deutsch', flag: 'DE', locale: 'de-DE' },
  { code: 'it', name: 'Italiano', flag: 'IT', locale: 'it-IT' },
  { code: 'ru', name: 'Русский', flag: 'RU', locale: 'ru-RU' },
  { code: 'ja', name: '日本語', flag: 'JA', locale: 'ja-JP' },
  { code: 'ko', name: '한국어', flag: 'KO', locale: 'ko-KR' },
  { code: 'zh', name: '中文', flag: 'ZH', locale: 'zh-CN' },
];

// Langue choisie (sinon : celle de Windows, sinon le français)
const LANG = (() => {
  try {
    const s = JSON.parse(localStorage.getItem('settings') || '{}');
    if (s.lang && LANGUAGES.some(l => l.code === s.lang)) return s.lang;
  } catch {}
  const sys = (navigator.language || 'fr').slice(0, 2).toLowerCase();
  return LANGUAGES.some(l => l.code === sys) ? sys : 'fr';
})();
const LOCALE = LANGUAGES.find(l => l.code === LANG).locale; // pour les dates et les nombres

// ---------- Préparation du dictionnaire ----------
let EXACT = new Map();   // phrase exacte → traduction
let TEMPLATES = [];      // [regex, traduction] pour les phrases avec {0}, {1}…
function compileDictionary() {
  const dict = window.I18N[LANG] || {};
  EXACT = new Map();
  TEMPLATES = [];
  for (const [fr, tr] of Object.entries(dict)) {
    if (!/\{\d\}/.test(fr)) { EXACT.set(fr, tr); continue; }
    // "il y a {0} min" → /^il y a (.+?) min$/
    const re = new RegExp('^' + fr.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\?\{(\d)\\?\}/g, '(.+?)') + '$', 's');
    const order = [...fr.matchAll(/\{(\d)\}/g)].map(m => +m[1]);
    TEMPLATES.push([re, tr, order]);
  }
  // les gabarits les plus longs d'abord (plus précis)
  TEMPLATES.sort((a, b) => b[0].source.length - a[0].source.length);
}

// Traduit un texte (renvoie null s'il n'y a pas de traduction)
function translate(text, depth = 0) {
  if (LANG === 'fr' || !text) return null;
  const core = text.trim();
  if (!core || !/\p{L}/u.test(core)) return null;
  const pre = text.slice(0, text.indexOf(core)), post = text.slice(text.indexOf(core) + core.length);
  if (EXACT.has(core)) return pre + EXACT.get(core) + post;
  if (depth > 5) return null;
  for (const [re, tr, order] of TEMPLATES) {
    const m = core.match(re);
    if (!m) continue;
    let out = tr;
    order.forEach((n, i) => {
      const part = m[i + 1];
      out = out.replace(`{${n}}`, translate(part, depth + 1) ?? part); // les morceaux variables peuvent aussi se traduire
    });
    return pre + out + post;
  }
  return null;
}
// Pour le code : tr("Phrase") → la phrase traduite (ou telle quelle)
function tr(text) { return translate(text) ?? text; }

// ---------- Traduction de l'écran ----------
const DONE = new WeakSet();
function translateNode(root) {
  if (LANG === 'fr' || !root) return;
  if (root.nodeType === Node.TEXT_NODE) return translateText(root);
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  // 1. Tous les textes (sauf dans les zones de saisie et le code)
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.parentElement?.closest('script,style,textarea,code') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  let n;
  while ((n = walker.nextNode())) translateText(n);
  // 2. Les textes d'aide (placeholder) et les infobulles (title)
  const els = [root, ...root.querySelectorAll('[placeholder],[title]')];
  for (const el of els) {
    for (const attr of ['placeholder', 'title']) {
      const v = el.getAttribute?.(attr);
      const t = v && translate(v);
      if (t && t !== v) el.setAttribute(attr, t);
    }
  }
}
function translateText(node) {
  if (DONE.has(node)) return;
  const t = translate(node.nodeValue);
  DONE.add(node);
  if (t != null && t !== node.nodeValue) node.nodeValue = t;
}

// On surveille l'écran : tout nouveau texte est traduit aussitôt
function startI18n() {
  compileDictionary();
  document.documentElement.lang = LANG;
  window.api?.setLang?.(LANG); // pour les fenêtres de confirmation de main.js
  if (LANG === 'fr') return;
  translateNode(document.body);
  new MutationObserver(muts => {
    for (const m of muts) {
      if (m.type === 'characterData') { DONE.delete(m.target); translateText(m.target); }
      for (const n of m.addedNodes) translateNode(n);
      if (m.type === 'attributes') translateNode(m.target);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'title'] });
}

document.addEventListener('DOMContentLoaded', startI18n);

// Outil de développement : liste les textes affichés qui n'ont pas de traduction
function i18nMissing() {
  const out = new Set();
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    const s = n.nodeValue.trim();
    if (s && /\p{L}{2}/u.test(s) && translate(s) == null && !n.parentElement.closest('script,style,textarea,code')) out.add(s);
  }
  return [...out];
}
