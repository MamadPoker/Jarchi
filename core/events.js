// Internal event bus. Connectors (Kick, Twitch, test button) call emitEvent(); widgets only ever see what comes out of here.
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DATA_DIR } = require('./config');
const store = require('./store');

const TYPES = ['follow', 'sub', 'resub', 'gift_sub', 'kicks', 'bits', 'raid'];
const PLATFORMS = ['kick', 'twitch', 'test'];

const bus = new EventEmitter();
const DEDUPE_MS = 6 * 60 * 60 * 1000; // about a stream: a viewer shares a resub once, a host with the same viewer count is the same host
const seen = new Map(); // key -> when (oldest first)

// e.key (optional): connectors give one to events that can reach them twice (the same Kick event on two of its
// sockets, a reconnect). An event whose key was seen in the last 6 hours is dropped: returns null.
function emitEvent(e) {
  if (!PLATFORMS.includes(e.platform) || !TYPES.includes(e.type)) throw new Error(`bad event: ${e.platform}/${e.type}`);
  if (e.key) {
    const now = Date.now();
    for (const [k, t] of seen) { if (now - t < DEDUPE_MS && seen.size < 5000) break; seen.delete(k); }
    if (seen.has(e.key)) return null;
    seen.set(e.key, now);
  }
  const ev = {
    id: randomUUID(),
    time: Date.now(),
    platform: e.platform,
    type: e.type,
    user: String(e.user ?? '').slice(0, 64),
    amount: Number(e.amount) || 0,
    months: Number(e.months) || 0,
    message: String(e.message ?? '').slice(0, 500),
    test: !!e.test, // so future widgets (leaderboard, recent events) can ignore test events
  };
  if (!ev.test) count('alerts');
  bus.emit('event', ev);
  return ev;
}

// The panel's Home numbers: real (not test) alerts and chat messages since local midnight, kept in today.json across
// restarts. Saved at most every 2 s (a busy chat would write all the time); a crash loses those last seconds.
const TODAY_FILE = path.join(DATA_DIR, 'today.json');
const saved = store.load(TODAY_FILE);
let day = { date: String(saved.date ?? ''), alerts: Number(saved.alerts) || 0, chat: Number(saved.chat) || 0 };
let saving = null;
function count(kind) {
  const date = new Date().toDateString();
  if (day.date !== date) day = { date, alerts: 0, chat: 0 }; // a new day
  if (kind) {
    day[kind]++;
    saving ??= setTimeout(() => {
      saving = null;
      store.save(TODAY_FILE, day);
    }, 2000);
    saving.unref?.(); // never what keeps Jarchi from closing
  }
  return { alerts: day.alerts, chat: day.chat };
}
const today = () => count();

// Chat. Connectors call emitChat() for every message and emitChatClear() when a moderator removes messages.
// Message: { id, platform, time (Kick's / Twitch's own), received (by Jarchi), kind: 'message' | 'sub', channel, text, first, action, system, test,
//   user: { id, login, name, color, avatar, badges: [{ type: 'broadcaster'|'moderator'|'vip'|'subscriber'|'other', name, img, title }] },
//   parts: [{ t: 'text', v } | { t: 'emote', name, src, still, provider: 'twitch'|'kick'|'7tv' } | { t: 'cheer', name, amount, gem }] }
const https = (v) => typeof v === 'string' && v.startsWith('https://');
const badgeImg = (v) => https(v) || /^\/assets\/kick-badges\/[\w-]+\.svg$/.test(v); // remote, or Kick's own icons shipped here
function emitChat(m) {
  const msg = chatMessage(m);
  if (!msg.test) count('chat');
  bus.emit('chat', msg);
  return msg;
}
// A connector's message -> the shape above (checked), without sending it.
function chatMessage(m) {
  if (!PLATFORMS.includes(m.platform)) throw new Error(`bad chat platform: ${m.platform}`);
  const u = m.user ?? {};
  return {
    id: String(m.id ?? randomUUID()),
    platform: m.platform,
    time: Number(m.time) || Date.now(),
    received: Date.now(), // connectors hand a message over in the same tick their socket got it
    kind: m.kind === 'sub' ? 'sub' : 'message',
    channel: String(m.channel ?? '').toLowerCase(),
    text: String(m.text ?? '').slice(0, 1000),
    first: !!m.first,
    action: !!m.action,
    system: String(m.system ?? '').slice(0, 300),
    test: !!m.test,
    user: {
      id: String(u.id ?? ''),
      login: String(u.login ?? u.name ?? '').toLowerCase().slice(0, 64),
      name: String(u.name ?? u.login ?? '').slice(0, 64),
      color: /^#[0-9a-f]{6}$/i.test(u.color) ? u.color : null,
      avatar: https(u.avatar) ? u.avatar : null,
      badges: (u.badges ?? []).slice(0, 8).map((b) => ({ type: b.type, name: String(b.name ?? ''), img: badgeImg(b.img) ? b.img : null, title: String(b.title ?? b.name ?? '') })),
    },
    parts: (m.parts ?? [{ t: 'text', v: m.text ?? '' }]).filter((p) => (p.t === 'emote' ? https(p.src) : p.t === 'cheer' ? Number.isInteger(p.gem) && Number.isInteger(p.amount) : p.t === 'text')).slice(0, 300),
  };
}
// { platform, messageId }: one message. { platform, userId }: everything a user said (ban / timeout). { platform }: the whole chat.
function emitChatClear(c) {
  bus.emit('chatClear', { platform: c.platform, messageId: c.messageId ? String(c.messageId) : null, userId: c.userId ? String(c.userId) : null });
}

// Which platform accounts are connected. Connectors will call setConnected(); until then nothing is connected.
const connected = new Set();
function setConnected(platform, on) {
  if (!PLATFORMS.includes(platform)) throw new Error(`bad platform: ${platform}`);
  if (on) connected.add(platform);
  else connected.delete(platform);
  bus.emit('connections');
}
const connectedPlatforms = () => [...connected];

// The alert events Kick and Twitch sent (subs, gifts, Kicks, raids, bits; not chat messages), as they came, before
// Jarchi decides what to show: data/logs/events.log, the last 500 lines, "local time  platform  event  data".
const LOG_FILE = path.join(DATA_DIR, 'logs', 'events.log');
const LOG_LINES = 500;
function logIncoming(platform, name, data) {
  try {
    const now = new Date();
    const time = new Date(now - now.getTimezoneOffset() * 60000).toISOString().slice(0, 23).replace('T', ' ');
    let lines = [];
    try { lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean); } catch {} // none yet
    lines.push(`${time} ${platform} ${name} ${typeof data === 'string' ? data : JSON.stringify(data)}`);
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    // ponytail: rewrites the whole (500-line) file per event; append and trim every ~100 lines if Kicks floods make it slow.
    fs.writeFileSync(LOG_FILE, `${lines.slice(-LOG_LINES).join('\n')}\n`);
  } catch (err) {
    console.warn('Event log:', err.message); // never in the way of the alert itself
  }
}

module.exports = { bus, emitEvent, emitChat, chatMessage, emitChatClear, setConnected, connectedPlatforms, logIncoming, today, TYPES, PLATFORMS };
