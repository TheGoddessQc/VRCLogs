<div align="center">

<img src="build/icon.png" width="110" alt="VRCLogs">

# VRCLogs

**Les logs avancés de tes soirées VRChat.**
Qui était là, combien de temps, dans quel monde, avec quel avatar — tout, en direct et pour toujours.

[⬇️ Télécharger](../../releases/latest) · [🐛 Signaler un bug](../../issues) · [📚 Comprendre le code](GUIDE.md)

</div>

---

## ✨ Fonctionnalités

- 🟢 **En direct** — l'instance où tu es, qui est présent, depuis combien de temps, première rencontre ou non
- 📈 **Graphique d'instance** — le nombre de joueurs au fil du temps ; survole-le pour voir qui était là à chaque minute
- 📅 **Résumé du jour** — temps de jeu, mondes, nouvelles rencontres, moment fort de la journée
- 📜 **Journal** — arrivées, départs, avatars, vidéos ; recherche, filtres et export CSV
- 🌍 **Historique des mondes** — chaque instance visitée avec sa chronologie complète
- 👥 **Personnes** — temps passé ensemble, rencontres, anciens pseudos, historique des avatars
- 📝 **Notes et tags** — écris une note sur quelqu'un, classe tes contacts avec des `#tags`
- 🔔 **Alertes** — notification quand un favori, un tag ou une nouvelle personne arrive dans ton instance
- 🫂 **Groupes d'amis** — détecte les joueurs qui arrivent et repartent ensemble
- 🎵 **Vidéos** — toutes les vidéos et musiques jouées, avec compteur
- 📊 **Statistiques** — heures de jeu, mondes favoris, personnes les plus vues, avatars populaires
- 💾 **Historique permanent** — VRChat efface ses vieux logs, VRCLogs les garde
- 🎨 **Thèmes** — Goddess, Violet, Océan, Menthe + mode compact

## 📥 Installation

1. Va dans les [Releases](../../releases/latest) et télécharge `VRCLogs-Setup-x.x.x.exe`
2. Lance l'installateur
3. Ouvre VRCLogs, puis lance VRChat — c'est tout !

> **Windows affiche « Windows a protégé votre ordinateur » ?**
> C'est normal pour une petite app pas encore connue de Microsoft. Clique sur **Informations complémentaires → Exécuter quand même**.

## 🔒 Vie privée et sécurité

- VRCLogs **lit uniquement les fichiers de log** que VRChat écrit sur ton PC
  (`%LocalAppData%Low\VRChat\VRChat\output_log_*.txt`).
- **Aucune connexion à ton compte VRChat**, aucun mot de passe demandé.
- **Aucune donnée n'est envoyée sur Internet.** Tout reste sur ton ordinateur
  (`%AppData%\VRCLogs`).
- VRCLogs **ne modifie pas** le jeu et n'interagit pas avec lui.

## 🛠️ Lancer depuis le code source

Il faut [Node.js](https://nodejs.org) (version LTS).

```bash
git clone https://github.com/TheGoddessQc/VRCLogs.git
cd VRCLogs
npm install
npm start
```

Créer l'installateur Windows : `npm run dist` (le fichier apparaît dans `dist/`).

## 🤝 Contribuer

Les idées et rapports de bugs sont les bienvenus dans les [Issues](../../issues).
Pour comprendre comment le code est organisé, lis le [guide](GUIDE.md).

## ⚖️ Avertissement

VRCLogs est un projet personnel et **n'est pas affilié à VRChat Inc.**, ni approuvé ou soutenu par VRChat Inc.
« VRChat » est une marque de VRChat Inc. Ce logiciel est fourni « tel quel », sans garantie.

## 📄 Licence

[MIT](LICENSE) © 2026 TheGoddessQc
