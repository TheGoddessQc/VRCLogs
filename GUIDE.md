# 📚 Comprendre VRCLogs — guide du code

## 1. Les outils

| Outil | C'est quoi | Pourquoi on l'utilise |
|---|---|---|
| **JavaScript** | Un langage de programmation | C'est le langage de tout le projet |
| **Node.js** | Un programme qui exécute du JavaScript sur ton PC | Pour lire des fichiers (les logs) |
| **Electron** | Node.js + un navigateur Chrome dans une fenêtre | Pour faire une vraie app avec une belle interface |
| **HTML** | La structure d'une page (titres, boutons, listes) | L'interface |
| **CSS** | L'apparence (couleurs, tailles, animations) | Le design et les thèmes |
| **npm** | Le "magasin" de bibliothèques de Node.js | Pour installer Electron |

## 2. Les fichiers du projet

```
package.json     → la carte d'identité du projet (nom, commande "npm start")
main.js          → le CERVEAU CACHÉ : lit les logs, sauvegarde l'historique
parser.js        → le TRADUCTEUR : transforme une ligne de log en événement
preload.js       → le PONT sécurisé entre main.js et l'interface
vrchat.js        → la CONNEXION au compte VRChat (amis, favoris, avatars)
dev/             → outils de test (faux amis), jamais inclus dans l'installateur
ui/index.html    → la STRUCTURE de l'interface
ui/style.css     → l'APPARENCE (les thèmes sont tout en haut)
ui/app.js        → le CERVEAU VISIBLE : calculs + affichage des pages
```

## 3. Le trajet d'une information

Quand quelqu'un arrive dans ton instance :

```
VRChat écrit une ligne dans son fichier de log :
  "2026.11.24 15:37:12 Debug - [Behaviour] OnPlayerJoined hortemuus (usr_...)"
        │
        ▼
main.js regarde le fichier chaque seconde (setInterval) et voit une nouvelle ligne
        │
        ▼
parser.js la reconnaît grâce à une "regex" (un modèle de texte) et crée :
  { type: 'join', name: 'hortemuus', userId: 'usr_...', t: 1732480632000 }
        │
        ▼
main.js l'ajoute à history.jsonl (sauvegarde) et l'envoie à l'interface
        │
        ▼
app.js reçoit l'événement → build() recalcule tout → render() redessine la page
        │
        ▼
checkAlerts() vérifie si c'est un favori / un tag → notification Windows 🔔
```

## 4. Les notions de code à connaître

- **Variable** : une boîte avec un nom qui contient une valeur.
  `let LIVE = false;` → une boîte nommée LIVE qui contient "faux".
- **Fonction** : un bout de code réutilisable qu'on appelle par son nom.
  `fmtDur(90000)` → renvoie `"2 min"`.
- **Objet** : un regroupement de valeurs avec des noms.
  `{ name: 'hortemuus', time: 3600000 }`
- **Tableau (Array)** : une liste. `[1, 2, 3]`
- **Map** : un dictionnaire clé → valeur, pratique pour retrouver un joueur par son identifiant.
- **Boucle `for`** : répéter une action pour chaque élément d'une liste.
- **`if`** : faire quelque chose seulement si une condition est vraie.
- **Template string** : du texte avec des trous à remplir, entre accents graves :
  `` `Bonjour ${name}` `` → `"Bonjour hortemuus"`.
  C'est comme ça que app.js fabrique le HTML de chaque page.

## 5. Exercices pour pratiquer 💪

Ouvre le fichier, modifie, sauvegarde, puis relance l'app (`npm start`) pour voir le résultat.

1. **Facile — couleurs** : dans `ui/style.css`, change `--accent` du thème Goddess
   (tout en haut) par `#ff69b4` et regarde ce qui change.
2. **Facile — texte** : dans `ui/app.js`, cherche `Première rencontre ✨` et remplace
   par ton propre texte.
3. **Moyen — nouveau thème** : dans `style.css`, copie le bloc `[data-theme="menthe"]`,
   renomme-le `[data-theme="nuit"]` avec tes couleurs, puis ajoute-le dans la liste
   `THEMES` de `app.js`.
4. **Moyen — statistique** : dans `renderStats()`, ajoute une 5e case qui affiche
   le nombre de groupes détectés (`M.groups.list.length`).
5. **Difficile — nouvel événement** : regarde dans tes logs une ligne qui t'intéresse,
   et ajoute une règle dans `parser.js` pour la reconnaître.

Bloqué(e) ? Ouvre une *issue* sur GitHub pour poser ta question.
