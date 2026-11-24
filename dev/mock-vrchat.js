// =====================================================================
//  dev/mock-vrchat.js — FAUX compte VRChat, pour tester l'interface
//  sans se connecter. Activé seulement avec la variable VRCLOGS_MOCK=1.
//  Il n'est jamais inclus dans l'installateur.
// =====================================================================
const STATUSES = ['join me', 'active', 'ask me', 'busy'];

// Petite image SVG colorée qui remplace les vraies images d'avatar
function fakeImage(seed, w, h) {
  let x = 0;
  for (const c of seed) x = (x * 31 + c.charCodeAt(0)) | 0;
  const hue = Math.abs(x) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="hsl(${hue},70%,55%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},70%,30%)"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/><circle cx="50%" cy="42%" r="${h / 5}" fill="#fff8"/>
    <rect x="30%" y="62%" width="40%" height="${h / 3}" rx="${h / 10}" fill="#fff8"/></svg>`;
}

class MockVRChat {
  constructor(events) {
    this.worlds = new Map();
    const seen = new Map();
    const worlds = new Map();
    for (const e of events) {
      if (e.type === 'join' && e.userId) seen.set(e.userId, (seen.get(e.userId) || 0) + 1);
      if (e.type === 'world') worlds.set(e.worldId, e.world);
    }
    this.worldList = [...worlds.entries()];
    for (const [id, name] of this.worldList) this.worlds.set(id, { id, name, thumb: `https://api.vrchat.cloud/mock/w/${id}`, author: 'Mock' });
    const names = new Map(events.filter(e => e.type === 'join' && e.userId).map(e => [e.userId, e.name]));
    this.people = [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(1, 40).map(([id], i) => ({ id, name: names.get(id), i }));
  }
  user() {
    return { id: 'usr_mock', name: 'TheGoddessQc', status: 'join me', statusDescription: 'Test', location: 'private',
      avatarThumb: 'https://api.vrchat.cloud/mock/a/me', avatarImage: 'https://api.vrchat.cloud/mock/a/me', icon: '', online: true };
  }
  async restore() { return this.user(); }
  async login() { return { need2fa: ['totp', 'otp'] }; }
  async verify2fa() { return { user: this.user() }; }
  async logout() {}
  clear() {}
  async friends(offline) {
    return this.people.filter(p => (p.i % 3 === 2) === offline).map(p => {
      const w = this.worldList[p.i % this.worldList.length];
      const loc = offline ? 'offline' : p.i % 4 === 0 ? 'private' : p.i % 5 === 1 ? 'offline' : `${w[0]}:${10000 + p.i}~hidden(usr_x)~region(eu)`;
      return {
        id: p.id, name: p.name, status: offline ? 'offline' : STATUSES[p.i % 4],
        statusDescription: ['', 'chill 🌙', 'au club', 'AFK'][p.i % 4], location: loc, platform: p.i % 2 ? 'android' : 'standalonewindows',
        avatarThumb: `https://api.vrchat.cloud/mock/a/${p.id}`, avatarImage: `https://api.vrchat.cloud/mock/a/${p.id}`,
        icon: '', bio: 'Bio de test', lastLogin: new Date(Date.now() - p.i * 3600e3).toISOString(),
        rank: ['Trusted User', 'Known User', 'User', 'New User'][p.i % 4], online: !offline,
      };
    });
  }
  async favorites() {
    return { groups: [{ name: 'group_0', displayName: 'Meilleurs amis' }, { name: 'group_1', displayName: 'Club' }],
      favs: this.people.slice(0, 6).map((p, i) => ({ userId: p.id, tags: [i < 3 ? 'group_0' : 'group_1'] })) };
  }
  async world(id) { return this.worlds.get(id); }
  async userDetails(id) { return (await this.friends(false)).concat(await this.friends(true)).find(f => f.id === id); }
  async myAvatars() {
    return ['Juno Collie', 'Goddess Fox', 'Night Dragon', 'Neon Kitty', 'Royal Wolf', 'Pastel Bun'].map((n, i) => ({
      id: `avtr_mock${i}`, name: n, description: 'Avatar de test', image: `https://api.vrchat.cloud/mock/av/${i}`,
      thumb: `https://api.vrchat.cloud/mock/av/${i}`, status: i % 2 ? 'public' : 'private',
      updated: new Date(Date.now() - i * 86400e3).toISOString(), platforms: i % 2 ? ['standalonewindows', 'android'] : ['standalonewindows'],
    }));
  }
  async fetchImage(url) {
    const big = url.includes('/a/') || url.includes('/av/');
    return new Response(fakeImage(url, big ? 400 : 256, big ? 300 : 192), { headers: { 'Content-Type': 'image/svg+xml' } });
  }
}

module.exports = MockVRChat;
