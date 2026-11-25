// =====================================================================
//  chatbox.js — écrire au-dessus de ta tête dans VRChat (la « chatbox »)
//
//  VRChat écoute un système OFFICIEL appelé OSC : des petits messages
//  envoyés sur ton propre PC (adresse 127.0.0.1, port 9000).
//  Le message "/chatbox/input" affiche un texte dans ta bulle de chat.
//  C'est permis par VRChat (MagicChatbox, VRCX… font pareil).
//
//  À activer une fois dans VRChat : menu rapide (Action Menu) → Options → OSC → Enabled.
//
//  Règles de VRChat : 144 caractères maximum, 9 lignes maximum,
//  et pas trop de messages d'affilée (sinon VRChat les ignore un moment).
// =====================================================================
const dgram = require('dgram');

const HOST = '127.0.0.1';  // uniquement ton PC, jamais Internet
const PORT = 9000;         // le port où VRChat écoute
const MIN_GAP = 1600;      // au moins 1,6 s entre deux messages
const MAX_LEN = 144;

// Une "chaîne OSC" = le texte + un zéro, complété jusqu'à un multiple de 4 octets
function oscString(s) {
  const b = Buffer.from(s + '\0', 'utf8');
  return Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
}
// Un message OSC = adresse + types (",s" = texte, T/F = vrai/faux) + valeurs
function oscMessage(address, types, ...strings) {
  return Buffer.concat([oscString(address), oscString(',' + types), ...strings.map(oscString)]);
}

// On coupe proprement : 9 lignes et 144 caractères maximum (sans couper un emoji en deux)
function clean(text) {
  let lines = String(text || '').replace(/\r/g, '').split('\n').slice(0, 9).join('\n');
  const chars = [...lines];
  if (chars.length > MAX_LEN) lines = chars.slice(0, MAX_LEN - 1).join('') + '…';
  return lines;
}

class Chatbox {
  constructor() {
    this.sock = dgram.createSocket('udp4');
    this.sock.on('error', () => {});
    this.last = 0;
    this.pending = null;
    this.timer = null;
    this.lastText = '';
    this.count = 0;
  }

  raw(buf) { this.sock.send(buf, PORT, HOST); }

  // send(texte, son) : si on envoie trop vite, on garde seulement le DERNIER texte voulu
  send(text, sound = false) {
    this.pending = { text: clean(text), sound: !!sound };
    const wait = this.last + MIN_GAP - Date.now();
    if (wait <= 0) this.flush();
    else if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.flush(); }, wait);
    return { ok: true, text: this.pending?.text ?? this.lastText };
  }

  flush() {
    if (!this.pending) return;
    const { text, sound } = this.pending;
    this.pending = null;
    this.last = Date.now();
    this.lastText = text;
    this.count++;
    // "T" = afficher tout de suite (sans passer par le clavier), puis T/F = jouer le petit son
    this.raw(oscMessage('/chatbox/input', 's' + 'T' + (sound ? 'T' : 'F'), text));
  }

  // Le petit indicateur « … en train d'écrire »
  typing(on) { this.raw(oscMessage('/chatbox/typing', on ? 'T' : 'F')); }

  clear() { return this.send('', false); }

  state() { return { last: this.last, text: this.lastText, count: this.count }; }
}

module.exports = { Chatbox, clean, MAX_LEN };
