// Lit les lignes des logs VRChat et les transforme en "événements".
// Exemple de ligne :
// 2026.11.24 08:20:33 Debug      -  [Behaviour] OnPlayerJoined Pseudo (usr_xxxx)

const LINE_RE = /^(\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2}):(\d{2}) \S+\s+-\s+(.*)$/;

function parseInstance(s) {
  let type = 'Public';
  if (s.includes('~private(')) type = s.includes('~canRequestInvite') ? 'Invite+' : 'Invite';
  else if (s.includes('~friends(')) type = 'Friends';
  else if (s.includes('~hidden(')) type = 'Friends+';
  else if (s.includes('~group(')) {
    const g = s.match(/~groupAccessType\((\w+)\)/);
    type = 'Group' + (g ? ' ' + g[1] : '');
  }
  const region = ((s.match(/~region\((\w+)\)/) || [])[1] || '').toUpperCase();
  return { type, region };
}

class LogParser {
  constructor(file) {
    this.file = file;
    this.pendingWorld = null;
    this.lastT = 0;
    this.quit = false;
  }

  parseLine(raw) {
    const m = LINE_RE.exec(raw.trim());
    if (!m) return null;
    const t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
    this.lastT = t;
    const msg = m[7];
    const file = this.file;
    let r;

    if ((r = /^\[Behaviour\] Entering Room: (.*)$/.exec(msg))) {
      this.pendingWorld = r[1];
      return null;
    }
    if ((r = /^\[Behaviour\] Joining (wrld_[^:]+):(.*)$/.exec(msg))) {
      const inst = parseInstance(r[2]);
      const world = this.pendingWorld || r[1];
      this.pendingWorld = null;
      return { t, file, type: 'world', worldId: r[1], world, instance: r[2], instType: inst.type, region: inst.region };
    }
    if ((r = /^\[Behaviour\] OnPlayerJoined (.+?)(?: \((usr_[^)]+)\))?$/.exec(msg))) {
      return { t, file, type: 'join', name: r[1], userId: r[2] || null };
    }
    if ((r = /^\[Behaviour\] OnPlayerLeft (.+?)(?: \((usr_[^)]+)\))?$/.exec(msg))) {
      return { t, file, type: 'leave', name: r[1], userId: r[2] || null };
    }
    if ((r = /^\[Behaviour\] Switching (.+) to avatar (.+)$/.exec(msg))) {
      return { t, file, type: 'avatar', name: r[1], avatar: r[2] };
    }
    if ((r = /^\[Video Playback\] Attempting to resolve URL '(.+)'$/.exec(msg))) {
      return { t, file, type: 'video', url: r[1] };
    }
    if ((r = /User Authenticated: (.+?) \((usr_[^)]+)\)/.exec(msg))) {
      return { t, file, type: 'self', name: r[1], userId: r[2] };
    }
    if (msg.includes('OnApplicationQuit')) {
      this.quit = true;
      return { t, file, type: 'quit' };
    }
    return null;
  }
}

module.exports = { LogParser, parseInstance };
