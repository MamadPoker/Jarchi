// Chat: runs the Kick and Twitch connectors for the channels in the chat settings, adds 7TV emotes and profile
// pictures, keeps the last messages for widgets that (re)connect, and makes test messages.
// Everything goes through the event bus: 'chat', 'chatClear', 'chatAvatar'.
const { EventEmitter } = require('node:events');
const { bus, emitChat, emitChatClear } = require('./events');
const settings = require('./settings');
const seventv = require('./seventv');
const strings = require('../i18n/en.json');
const kick = require('../connectors/kick-chat');
const twitch = require('../connectors/twitch-chat');
const twitchBadges = require('../connectors/twitch-badges');

const KEEP = 100; // messages kept in memory for widgets that (re)connect
const CONNECTORS = { kick, twitch };
const chat = new EventEmitter(); // 'status'
const status = { kick: { state: 'off', detail: '' }, twitch: { state: 'off', detail: '' } };
const running = { kick: null, twitch: null }; // { channel, conn }
const recent = [];
let globalRequested = false;

function setStatus(platform, state, detail = '') {
  status[platform] = { state, detail };
  chat.emit('status', status);
}

// Start/stop connectors to match the settings. Called at startup and whenever chat settings change.
function sync() {
  const c = settings.get().chat;
  for (const platform of ['kick', 'twitch']) {
    const want = c.enabled ? c[`${platform}Channel`].toLowerCase() : '';
    if (running[platform]?.channel === want) continue;
    running[platform]?.conn.stop();
    running[platform] = null;
    if (!want) {
      setStatus(platform, 'off');
      continue;
    }
    if (!globalRequested) { globalRequested = true; seventv.loadGlobal(); }
    running[platform] = {
      channel: want,
      conn: CONNECTORS[platform].connect(want, {
        onStatus: (state, detail) => setStatus(platform, state, detail),
        onMessage: publish,
        onClear: emitChatClear,
        onChannel: ({ userId }) => {
          seventv.loadChannel(platform, userId);
          if (platform === 'twitch') twitchBadges.loadChannel(userId);
        },
      }),
    };
  }
}

// A connector's message -> 7TV emotes added -> the bus.
function publish(m) {
  const msg = emitChat({ ...m, parts: seventv.enrich(m.platform, m.parts ?? []) });
  if (!msg.user.avatar && settings.get().chat.avatars) lookUpAvatar(msg);
}

// ---------- Profile pictures: cached, and Kick lookups rate-limited (one website API call per new chatter) ----------
const avatars = new Map(); // 'platform:login' -> url | null
const queue = [];
let draining = false;
function lookUpAvatar(msg) {
  const key = `${msg.platform}:${msg.user.login}`;
  if (avatars.has(key)) return avatars.get(key) && announceAvatar(msg, avatars.get(key));
  if (queue.length > 50 || queue.some((q) => q.key === key) || msg.platform === 'test') return;
  queue.push({ key, msg });
  if (!draining) drain();
}
async function drain() {
  draining = true;
  while (queue.length) {
    const { key, msg } = queue.shift();
    let url = null;
    try {
      url = msg.platform === 'kick' ? await kick.avatar(msg.user.login) : await twitchBadges.avatar(msg.user.login);
    } catch {}
    if (avatars.size > 500) avatars.delete(avatars.keys().next().value);
    avatars.set(key, url);
    if (url) announceAvatar(msg, url);
    await new Promise((r) => setTimeout(r, 1000)); // gentle on Kick's website API during long streams
  }
  draining = false;
}
function announceAvatar(msg, url) {
  for (const m of recent) if (m.platform === msg.platform && m.user.login === msg.user.login) m.user.avatar = url;
  bus.emit('chatAvatar', { platform: msg.platform, login: msg.user.login, avatar: url });
}

// ---------- Recent messages (for widgets that connect later), kept in sync with deletions ----------
bus.on('chat', (m) => {
  recent.push(m);
  if (recent.length > KEEP) recent.shift();
});
bus.on('chatClear', (c) => {
  for (let i = recent.length - 1; i >= 0; i--) {
    const m = recent[i];
    if (m.platform === c.platform && (c.messageId ? m.id === c.messageId : c.userId ? m.user.id === c.userId : true)) recent.splice(i, 1);
  }
});

// ---------- Test messages ----------
const T = strings.chatTest;
const twitchEmote = (id, name) => ({ t: 'emote', name, provider: 'twitch', src: `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/2.0`, still: `https://static-cdn.jtvnw.net/emoticons/v2/${id}/static/dark/2.0` });
const tBadge = (set) => ({ type: { moderator: 'moderator', vip: 'vip', subscriber: 'subscriber', broadcaster: 'broadcaster' }[set] ?? 'other', name: set, img: twitchBadges.image(set, '1'), title: set });
const kickLevel = { type: 'other', name: 'level', title: 'level', img: 'https://ext.cdn.kick.com/chat/badges/25_f055d38e-8e80-4a99-8419-467bad3eb1ab.png' };

function samples() {
  const c = settings.get().chat;
  const streamer = c.twitchChannel || c.kickChannel || 'streamer';
  const seven = seventv.someGlobal(1)[0];
  const kickText = T.kick;
  return [
    { platform: 'twitch', user: { id: 't1', name: T.names[0], color: '#1e90ff', badges: [tBadge('moderator'), tBadge('subscriber')] }, text: T.mod,
      parts: [twitchEmote(25, 'Kappa'), { t: 'text', v: T.mod.slice(5, -7) }, twitchEmote(30259, 'HeyGuys')] },
    { platform: 'kick', user: { id: 'k1', name: T.names[1], color: '#53fc18', badges: [{ type: 'broadcaster', name: 'broadcaster', img: null, title: 'Broadcaster' }, kickLevel] },
      text: kickText.replace(/\[emote:\d+:([^\]]*)\]/g, '$1'), parts: kick.kickParts(kickText) },
    { platform: 'twitch', kind: 'sub', user: { id: 't3', name: T.names[2], color: '#ffd700', badges: [tBadge('subscriber')] }, system: T.subSystem, text: T.subText, parts: [{ t: 'text', v: T.subText }] },
    { platform: 'twitch', first: true, user: { id: 't4', name: T.names[3], color: '#ff69b4', badges: [tBadge('vip')] }, text: T.first,
      parts: [{ t: 'text', v: `${T.first} ` }, ...(seven ? [{ t: 'emote', name: seven.name, src: seven.src, still: seven.still, provider: '7tv' }] : [])] },
    { platform: 'kick', user: { id: 'k5', name: T.names[4], color: '#ff8c00', badges: [] }, text: T.mention.replace('{streamer}', streamer), parts: [{ t: 'text', v: T.mention.replace('{streamer}', streamer) }] },
  ];
}

// kind 'sample': one of each effect. kind 'burst': 10 quick messages to see them move up and fade.
function test(kind) {
  if (!globalRequested) { globalRequested = true; seventv.loadGlobal(); }
  const list = kind === 'burst'
    ? T.burst.map((text, i) => ({ platform: i % 2 ? 'kick' : 'twitch', user: { id: `b${i}`, name: T.burstNames[i], color: null, badges: [] }, text, parts: [{ t: 'text', v: text }] }))
    : samples();
  const c = settings.get().chat;
  list.forEach((m, i) => setTimeout(() => emitChat({ ...m, test: true, channel: m.platform === 'kick' ? c.kickChannel : c.twitchChannel }), i * (kind === 'burst' ? 180 : 450)));
  return list.length;
}

module.exports = { sync, test, status: () => status, recent: () => recent, events: chat };
