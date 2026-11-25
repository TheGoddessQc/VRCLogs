# 🔒 Sécurité de VRCLogs

## Tes données restent chez toi

- VRCLogs **n'a pas de serveur**. Chaque installation est indépendante : personne (pas même l'auteur) n'a accès à tes données ni à ton compte.
- Tout est rangé dans **ton** dossier Windows : `%AppData%\VRCLogs`.
- L'installateur ne contient **que le code** de l'application, aucune donnée.

## Ton compte VRChat (optionnel)

- Ton mot de passe est envoyé **uniquement à VRChat** (`api.vrchat.cloud`) et **n'est jamais enregistré**.
- Seul le jeton de session est gardé, **chiffré par Windows (DPAPI)** : il est lié à ton compte Windows sur ton PC et ne peut pas être lu ailleurs.
- Tu peux te déconnecter à tout moment (💜 Amis → 🚪 Se déconnecter) : le jeton est supprimé.

## Ta clé Steam (optionnelle)

- Gardée **chiffrée par Windows**, envoyée **uniquement à Steam** (`api.steampowered.com`).
- Tu peux la retirer à tout moment (🎮 Steam → 🗑️ Retirer ma clé).

## Protections de l'application

- L'interface tourne dans un **bac à sable** isolé, sans accès à tes fichiers ni à tes programmes.
- Tout texte venant d'Internet (pseudos, bios, noms de mondes…) est **neutralisé** avant d'être affiché.
- Une règle de sécurité (CSP) **bloque tout script** qui ne fait pas partie de l'application.
- La fenêtre ne peut ouvrir **aucune autre page**. Les liens s'ouvrent dans ton navigateur, et ceux qui ne sont pas des sites connus demandent une **confirmation** (protection contre l'hameçonnage).
- Les images ne sont téléchargées que depuis les serveurs de VRChat, Steam et avtrDB, et tes cookies VRChat ne sont **jamais** envoyés à un autre site.

## ⚠️ Conseils

- Télécharge VRCLogs **uniquement** depuis la page officielle des [Releases](https://github.com/TheGoddessQc/VRCLogs/releases).
- Ne tape **jamais** ton mot de passe VRChat sur un site qui n'est pas `vrchat.com`.
- Ne partage **jamais** ta clé API Steam.

## Signaler un problème de sécurité

Si tu trouves une faille, merci de **ne pas** la publier dans une *issue* publique :
utilise l'onglet **Security → Report a vulnerability** du dépôt GitHub.
