// =====================================================================
//  changelog.js — les notes de version de VRCLogs ("patch notes")
//
//  À CHAQUE NOUVELLE VERSION : ajoute un bloc tout en haut de la liste,
//  avec le même numéro que "version" dans package.json.
//  fr = notes en français · en = notes en anglais (utilisées pour les autres langues)
//  Après une mise à jour, l'app affiche toute seule les nouveautés.
// =====================================================================
const CHANGELOG = [
  {
    version: '0.4.1', date: '2026-11-25',
    fr: [
      '🐛 Correction : on pouvait choisir une langue, mais l\'affichage ne changeait pas',
      '🟢 Statut des serveurs VRChat : savoir tout de suite si VRChat est en panne (dans le menu et dans 📰 Nouveautés)',
      '🔔 Notification quand VRChat tombe en panne et quand il revient',
      '✨ Notes de version : les nouveautés de VRCLogs s\'affichent après chaque mise à jour',
    ],
    en: [
      '🐛 Fix: choosing a language did not change the display',
      '🟢 VRChat server status: see right away if VRChat is down (in the menu and in 📰 What\'s New)',
      '🔔 Notification when VRChat goes down and when it comes back',
      '✨ Release notes: VRCLogs news now show up after every update',
    ],
  },
  {
    version: '0.4.0', date: '2026-11-25',
    fr: ['🔄 Onglet Mises à jour dans les Paramètres : VRCLogs te prévient quand une nouvelle version sort'],
    en: ['🔄 Updates tab in Settings: VRCLogs lets you know when a new version is out'],
  },
  {
    version: '0.3.0', date: '2026-11-25',
    fr: [
      '🌍 10 langues : français, anglais, espagnol, portugais, allemand, italien, russe, japonais, coréen, chinois',
      '🎮 Steam : heures exactes sur VRChat et amis Steam qui y jouent',
      '🏛️ Groupes VRChat : instances de groupe ouvertes en direct, annonces, règles',
      '🛍️ Boutique : vitrine officielle de la Marketplace et boutiques des mondes (affichage seulement)',
      '📰 Nouveautés VRChat · 🎨 12 thèmes et ta propre palette · 🔒 Sécurité renforcée',
    ],
    en: [
      '🌍 10 languages: French, English, Spanish, Portuguese, German, Italian, Russian, Japanese, Korean, Chinese',
      '🎮 Steam: exact VRChat play time and Steam friends who play it',
      '🏛️ VRChat groups: live group instances, announcements, rules',
      '🛍️ Store: official Marketplace spotlight and world stores (display only)',
      '📰 VRChat news · 🎨 12 themes and your own palette · 🔒 Stronger security',
    ],
  },
  {
    version: '0.2.0', date: '2026-11-24',
    fr: [
      '💜 Amis VRChat (connexion optionnelle) avec favoris et bouton Rejoindre',
      '👤 Profils complets · 🧍 Avatars en grand · 🧠 Cerveau d\'amis · 📌 Choisir un moment dans le graphique',
    ],
    en: [
      '💜 VRChat friends (optional login) with favorites and a Join button',
      '👤 Full profiles · 🧍 Big avatar view · 🧠 Friend brain · 📌 Pick a moment in the chart',
    ],
  },
  {
    version: '0.1.0', date: '2026-11-24',
    fr: ['🎉 Première version : en direct, journal, mondes, personnes, statistiques et historique permanent'],
    en: ['🎉 First version: live view, log, worlds, people, statistics and permanent history'],
  },
];
