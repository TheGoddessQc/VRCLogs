// =====================================================================
//  discord.js — deux liens avec Discord, tous les deux PERMIS par Discord
//
//  1. STATUT (« Rich Presence ») : ton profil Discord affiche le monde
//     VRChat où tu es. On parle à l'app Discord de TON PC par un « tuyau »
//     local (named pipe \\?\pipe\discord-ipc-0). Rien ne passe par Internet
//     depuis VRCLogs : c'est Discord qui affiche ton statut.
//     Il faut un « Application ID » : un numéro public qui dit à Discord
//     quel nom afficher (« Joue à VRChat »).
//
//  2. ALERTES (« webhook ») : une adresse secrète créée dans un salon de
//     TON serveur. VRCLogs y poste un message (favori arrivé, VRChat en
//     panne…). L'adresse est gardée chiffrée par Windows.
//
//  ⚠️ Ce qu'on ne fait PAS : lire tes amis ou tes messages Discord avec ton
//  compte (« self-bot »). C'est interdit par Discord et peut faire bannir.
// =====================================================================
const { safeStorage } = require('electron');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------
//  1. STATUT DISCORD (Rich Presence)
// ---------------------------------------------------------------------
// Un message dans le tuyau = 8 octets d'en-tête (type + longueur) + du JSON
const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };
function encode(op, data) {
  const json = Buffer.from(JSON.stringify(data), 'utf8');
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(json.length, 4);
  return Buffer.concat([head, json]);
}

// Discord exige entre 2 et 128 caractères par ligne
const line = (s, max = 128) => {
  s = String(s || '').trim();
  if (s.length > max) s = s.slice(0, max - 1) + '…';
  return s.length >= 2 ? s : s ? s + ' ' : undefined;
};

class DiscordPresence {
  constructor(onState) {
    this.clientId = null;
    this.sock = null;
    this.ready = false;
    this.activity = null;     // le dernier statut voulu (renvoyé après une reconnexion)
    this.user = null;         // ton pseudo Discord, pour afficher « connecté à … »
    this.error = '';
    this.onState = onState;   // prévient l'interface quand ça change
    this.retry = null;
  }

  state() { return { enabled: !!this.clientId, connected: this.ready, user: this.user, error: this.error }; }
  emit() { this.onState?.(this.state()); }

  // Activer (avec un Application ID) ou désactiver (null)
  setClient(clientId) {
    clientId = clientId ? String(clientId).trim() : null;
    if (clientId && !/^\d{17,20}$/.test(clientId)) throw new Error('Un Application ID Discord est un nombre de 17 à 20 chiffres.');
    if (clientId === this.clientId) return this.state();
    this.close();
    this.clientId = clientId;
    this.error = '';
    if (clientId) this.connect();
    this.emit();
    return this.state();
  }

  close() {
    this.gen = (this.gen || 0) + 1; // les essais de connexion en cours deviennent "périmés"
    clearTimeout(this.retry);
    this.retry = null;
    if (this.sock) { this.sock.removeAllListeners(); this.sock.destroy(); }
    this.sock = null;
    this.ready = false;
    this.user = null;
  }

  // On essaie les tuyaux 0 à 9 (il y en a un par app Discord ouverte : normale, PTB, Canary…)
  connect(i = 0) {
    if (!this.clientId) return;
    if (i > 9) {
      this.error = 'Discord n\'est pas ouvert sur ce PC.';
      this.emit();
      this.retry = setTimeout(() => this.connect(), 20000); // on réessaie dans 20 s
      return;
    }
    const gen = this.gen;
    const sock = net.createConnection(`\\\\?\\pipe\\discord-ipc-${i}`);
    let buf = Buffer.alloc(0), opened = false;
    // Pas de tuyau n°i : on essaie le suivant (après la connexion, c'est "close" qui s'en occupe)
    sock.on('error', () => { if (!opened) { sock.destroy(); if (gen === this.gen) this.connect(i + 1); } });
    sock.once('connect', () => {
      if (gen !== this.gen) return sock.destroy();
      opened = true;
      this.sock = sock;
      sock.write(encode(OP.HANDSHAKE, { v: 1, client_id: this.clientId }));
    });
    sock.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 8) {
        const op = buf.readInt32LE(0), len = buf.readInt32LE(4);
        if (buf.length < 8 + len) break;
        let msg = {};
        try { msg = JSON.parse(buf.subarray(8, 8 + len).toString('utf8')); } catch {}
        buf = buf.subarray(8 + len);
        this.onMessage(op, msg);
      }
    });
    sock.on('close', () => {
      if (this.sock !== sock) return;
      this.sock = null;
      this.ready = false;
      this.user = null;
      this.emit();
      if (this.clientId) this.retry = setTimeout(() => this.connect(), 15000); // Discord fermé : on réessaie
    });
  }

  onMessage(op, msg) {
    if (op === OP.PING) return this.sock?.write(encode(OP.PONG, msg));
    if (op === OP.CLOSE) { // ex : Application ID inconnu
      this.error = msg.message || 'Discord a refusé la connexion (vérifie l\'Application ID).';
      const id = this.clientId;
      this.close();
      this.clientId = id;
      this.emit();
      return;
    }
    if (msg.evt === 'READY') {
      this.ready = true;
      this.error = '';
      this.user = msg.data?.user ? (msg.data.user.global_name || msg.data.user.username) : null;
      this.emit();
      this.send();
    } else if (msg.evt === 'ERROR') {
      this.error = msg.data?.message || 'Erreur Discord';
      this.emit();
    }
  }

  // a = { details, state, start, image, imageText, smallImage, smallText, buttons:[{label,url}] } ou null pour effacer
  setActivity(a) {
    if (!a) this.activity = null;
    else {
      const act = {
        type: 0, // « Joue à … »
        details: line(a.details),
        state: line(a.state),
        timestamps: a.start ? { start: Math.floor(a.start) } : undefined,
        assets: {
          large_image: /^https:\/\//.test(a.image || '') ? a.image : undefined,
          large_text: line(a.imageText),
          small_image: /^https:\/\//.test(a.smallImage || '') ? a.smallImage : undefined,
          small_text: line(a.smallText),
        },
        buttons: (a.buttons || []).filter(b => b?.label && /^https:\/\//.test(b.url || '')).slice(0, 2)
          .map(b => ({ label: String(b.label).slice(0, 32), url: String(b.url).slice(0, 512) })),
        instance: false,
      };
      if (!act.assets.large_image && !act.assets.small_image) delete act.assets;
      if (!act.buttons.length) delete act.buttons;
      this.activity = act;
    }
    this.send();
    return this.state();
  }

  send() {
    if (!this.ready || !this.sock) return;
    this.sock.write(encode(OP.FRAME, {
      cmd: 'SET_ACTIVITY', nonce: crypto.randomUUID(),
      args: { pid: process.pid, activity: this.activity || undefined },
    }));
  }
}

// ---------------------------------------------------------------------
//  2. ALERTES DANS TON SERVEUR (webhook)
// ---------------------------------------------------------------------
const WEBHOOK_RE = /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d{17,20}\/[\w-]{30,100}$/;

class DiscordWebhook {
  constructor(dataDir, UA) {
    this.file = path.join(dataDir, 'discord-webhook.bin');
    this.UA = UA;
    this.queue = Promise.resolve();
    this.last = 0;
  }
  getUrl() { try { return safeStorage.decryptString(fs.readFileSync(this.file)); } catch { return null; } }
  has() { return !!this.getUrl(); }
  clear() { try { fs.unlinkSync(this.file); } catch {} }

  async set(url) {
    url = String(url || '').trim();
    if (!WEBHOOK_RE.test(url)) throw new Error('Ce n\'est pas une adresse de webhook Discord (elle commence par https://discord.com/api/webhooks/).');
    // On vérifie qu'elle existe (un GET ne poste rien)
    const res = await fetch(url, { headers: { 'User-Agent': this.UA } });
    if (!res.ok) throw new Error('Discord ne reconnaît pas ce webhook (supprimé ?).');
    const info = await res.json().catch(() => ({}));
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Chiffrement Windows indisponible : webhook non enregistré.');
    fs.writeFileSync(this.file, safeStorage.encryptString(url));
    return { name: info.name || 'Webhook' };
  }

  // Un message à la fois, avec une pause (Discord limite à ~30 messages par minute)
  post({ title, text, color }) {
    const url = this.getUrl();
    if (!url) return Promise.resolve({ error: 'Aucun webhook' });
    const run = async () => {
      const wait = this.last + 1500 - Date.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      this.last = Date.now();
      const body = JSON.stringify({
        username: 'VRCLogs',
        embeds: [{ title: String(title || '').slice(0, 256), description: String(text || '').slice(0, 2000) || undefined,
          color: color ?? 0xd4a24c, timestamp: new Date().toISOString() }],
        allowed_mentions: { parse: [] }, // jamais de @everyone ni de mention
      });
      for (let tries = 0; tries < 3; tries++) {
        const res = await fetch(url + '?wait=false', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': this.UA }, body });
        if (res.status === 429) { // trop de messages : Discord dit combien attendre
          const j = await res.json().catch(() => ({}));
          await new Promise(r => setTimeout(r, Math.min(10, j.retry_after || 2) * 1000));
          continue;
        }
        if (!res.ok) return { error: `Discord a répondu ${res.status}` };
        return { ok: true };
      }
      return { error: 'Discord est surchargé, message abandonné' };
    };
    const p = this.queue.then(run, run).catch(e => ({ error: e.message }));
    this.queue = p;
    return p;
  }
}

module.exports = { DiscordPresence, DiscordWebhook };
