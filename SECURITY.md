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
- **« Se connecter avec Steam »** ouvre la page officielle de Steam dans une fenêtre qui ne peut aller **que** sur les sites de Steam. Ton mot de passe est tapé chez Steam, jamais dans VRCLogs. VRCLogs lit seulement la clé affichée, puis **efface** la connexion Steam de cette fenêtre (cookies, cache).

## Discord (optionnel)

- **Statut** : VRCLogs parle à l'app Discord ouverte sur ton PC (tuyau local). Il a seulement besoin d'un *Application ID*, un numéro **public** qui ne donne aucun accès à ton compte.
- **Alertes** : l'adresse du webhook est gardée **chiffrée par Windows** et envoyée **uniquement à Discord**. VRCLogs ne mentionne jamais personne.
- VRCLogs ne lit **jamais** tes amis, messages ou serveurs Discord, et ne te demande **jamais** ton mot de passe ni ton « token » Discord (ce serait interdit par Discord).

## Chatbox (OSC)

- Le texte est envoyé à VRChat **sur ton propre PC** (`127.0.0.1`, port 9000), avec le système officiel OSC de VRChat. Rien ne passe par Internet.

## Protections de l'application

- VRCLogs utilise une version **récente d'Electron** (le moteur de l'app, basé sur Chrome), avec les correctifs de sécurité à jour.
- Toutes les fenêtres refusent la caméra, le micro, la position, les pop-ups, les pages intégrées et les téléchargements automatiques. L'interface a seulement droit aux notifications et au presse-papiers.
- Les données reçues par la partie cachée de l'app (identifiants de mondes, de groupes, de comptes Steam, adresses) sont **vérifiées** avant d'être utilisées.
- Une seule copie de VRCLogs peut tourner à la fois.

- L'interface tourne dans un **bac à sable** isolé, sans accès à tes fichiers ni à tes programmes.
- Tout texte venant d'Internet (pseudos, bios, noms de mondes…) est **neutralisé** avant d'être affiché.
- Une règle de sécurité (CSP) **bloque tout script** qui ne fait pas partie de l'application.
- La fenêtre ne peut ouvrir **aucune autre page**. Les liens s'ouvrent dans ton navigateur, et ceux qui ne sont pas des sites connus demandent une **confirmation** (protection contre l'hameçonnage).
- Les images ne sont téléchargées que depuis les serveurs de VRChat, Steam et avtrDB, et tes cookies VRChat ne sont **jamais** envoyés à un autre site.

## ⚠️ Conseils

- Télécharge VRCLogs **uniquement** depuis la page officielle des [Releases](https://github.com/TheGoddessQc/VRCLogs/releases).
- Ne tape **jamais** ton mot de passe VRChat sur un site qui n'est pas `vrchat.com`.
- Ne partage **jamais** ta clé API Steam ni l'adresse de ton webhook Discord.

## Signaler un problème de sécurité

Si tu trouves une faille, merci de **ne pas** la publier dans une *issue* publique :
utilise l'onglet **Security → Report a vulnerability** du dépôt GitHub.
