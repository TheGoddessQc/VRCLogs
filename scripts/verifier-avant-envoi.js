// =====================================================================
//  scripts/verifier-avant-envoi.js
//  Vérifie qu'AUCUNE donnée personnelle ni secret ne part sur GitHub.
//  Lancé automatiquement avant chaque "git push" (et avant une Release).
//
//    node scripts/verifier-avant-envoi.js                 → vérifie le code
//    node scripts/verifier-avant-envoi.js --installateur  → + l'app emballée (dist/)
//
//  Tes infos personnelles à protéger sont dans ".verif-perso.json" :
//  ce fichier reste sur TON PC et n'est jamais envoyé.
// =====================================================================
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const git = cmd => execSync(`git ${cmd}`, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const problems = [];

// ---------- 1. Ce qu'on cherche ----------
// a) Tes infos personnelles (fichier privé, jamais publié)
let perso = [];
try { perso = JSON.parse(fs.readFileSync(path.join(ROOT, '.verif-perso.json'), 'utf8')).proteger || []; } catch {}
// b) Infos de cet ordinateur, détectées automatiquement
perso.push(os.userInfo().username, os.homedir(), os.homedir().replace(/\\/g, '/'), os.homedir().replace(/\\/g, '\\\\'));
perso = [...new Set(perso.filter(s => s && s.length >= 4))];
// c) Formats de secrets connus (peu importe à qui ils appartiennent)
const SECRETS = [
  [/authcookie_[\w-]{10,}/, 'jeton de session VRChat'],
  [/twoFactorAuth=[\w.-]{10,}/, 'jeton 2FA VRChat'],
  [/\b(gho|ghp|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}/, 'jeton GitHub'],
  [/\b[0-9A-F]{32}\b/, 'clé API Steam (32 caractères hexadécimaux)'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'clé privée'],
  [/\busr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/, 'identifiant de compte VRChat'],
  [/\b7656119\d{10}\b/, 'identifiant de compte Steam'],
  [/[\w.+-]+@(gmail|hotmail|outlook|yahoo|icloud|live)\.\w+/i, 'adresse e-mail'],
];
// d) Fichiers qui ne doivent JAMAIS être publiés
const FORBIDDEN = /(^|\/)(session\.bin|steam-key\.bin|history\.jsonl|state\.json|[\w-]*-cache\.json|\.env[\w.]*|\.verif-perso\.json|Local State|Preferences)$/;

function check(text, where) {
  // 76561197960265728 = constante publique de Steam (la même pour tout le monde), pas un compte
  text = text.replace(/76561197960265728/g, '');
  for (const p of perso) if (text.includes(p)) problems.push(`${where} : contient une de tes infos personnelles (« ${p.slice(0, 4)}… »)`);
  for (const [re, label] of SECRETS) {
    const m = text.match(re);
    if (m) problems.push(`${where} : ${label} (« ${m[0].slice(0, 12)}… »)`);
  }
}

// ---------- 2. Les fichiers suivis par Git ----------
const files = git('ls-files').split('\n').filter(Boolean);
for (const f of files) {
  if (FORBIDDEN.test(f)) problems.push(`${f} : ce fichier ne doit jamais être publié`);
  if (/\.(png|jpg|ico|exe|bin|zip)$/i.test(f) || f === 'package-lock.json') continue;
  check(fs.readFileSync(path.join(ROOT, f), 'utf8'), f);
}

// ---------- 3. Les commits qui vont partir (pas encore sur GitHub) ----------
let outgoing = '';
try { outgoing = git('log origin/main..HEAD -p --format=commit:%h:%ae'); } catch { outgoing = git('log -p --format=commit:%h:%ae'); }
for (const m of outgoing.matchAll(/^commit:(\w+):(.+)$/gm)) {
  if (!m[2].endsWith('@users.noreply.github.com')) problems.push(`commit ${m[1]} : signé avec une vraie adresse e-mail (${m[2].replace(/(.{3}).*@/, '$1…@')})`);
}
check(outgoing.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).join('\n'), 'nouveaux commits');

// ---------- 4. L'installateur (option --installateur) ----------
if (process.argv.includes('--installateur')) {
  const asarFile = path.join(ROOT, 'dist', 'win-unpacked', 'resources', 'app.asar');
  if (!fs.existsSync(asarFile)) problems.push('dist/ : installateur introuvable (lance "npm run dist" d\'abord)');
  else {
    const asar = require('@electron/asar');
    const inside = asar.listPackage(asarFile).filter(x => !x.includes('node_modules'));
    for (const x of inside) {
      const rel = x.replace(/^[\\/]/, '').replace(/\\/g, '/');
      if (FORBIDDEN.test(rel)) problems.push(`installateur : contient ${rel}`);
      if (rel.startsWith('dev/')) problems.push(`installateur : contient l'outil de test ${rel}`);
      if (/\.(js|json|html|css)$/.test(rel)) check(asar.extractFile(asarFile, rel.replace(/\//g, path.sep)).toString(), `installateur/${rel}`);
    }
  }
}

// ---------- 5. Résultat ----------
if (problems.length) {
  console.error(`\n⛔ ENVOI BLOQUÉ : ${problems.length} problème(s) trouvé(s)\n`);
  for (const p of problems) console.error('  • ' + p);
  console.error('\nCorrige ces points, puis réessaie.\n');
  process.exit(1);
}
console.log(`✅ Vérification OK : ${files.length} fichiers${process.argv.includes('--installateur') ? ' + installateur' : ''}, aucune donnée personnelle ni secret.`);
