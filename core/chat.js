// Chat: runs the Kick and Twitch connectors for the channels in the chat settings, adds 7TV emotes and profile
// pictures, keeps the last messages for widgets that (re)connect, and makes test messages.
// Everything goes through the event bus: 'chat', 'chatClear', 'chatAvatar'.
const { EventEmitter } = require('node:events');
const { bus, emitChat, chatMessage, emitChatClear } = require('./events');
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
let kickSubs = { channel: '', list: [] }; // the Kick channel's own sub badges, for test messages

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
        onChannel: ({ userId, subBadges }) => {
          seventv.loadChannel(platform, userId);
          if (platform === 'twitch') twitchBadges.loadChannel(userId);
          else kickSubs = { channel: want, list: subBadges ?? [] };
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

// ---------- Test messages: random fake viewers with badge sets seen in real chat ----------
// Their badges go through the same converters as real chat, so they get the same images (the channel's own sub
// badges included: Kick's always, Twitch's with the key) and the same text tags where there's no image.
const T = strings.chatTest;
const PLATFORMS = ['twitch', 'kick'];
const SUB_MONTHS = [1, 2, 3, 6, 9, 12, 18, 24, 36];
const GIFTS = [1, 5, 10, 25, 50, 100, 250, 500, 1000];
const COLORS = ['#1e90ff', '#ff4500', '#9acd32', '#ff69b4', '#daa520', '#00ff7f', '#8a2be2', '#5f9ea0', '#d2691e', '#53fc18', '#ff7f50', null];
// Twitch: IRC badge sets. Kick: chat identity badge types. [] = no badges.
const COMBOS = {
  twitch: [['broadcaster'], ['moderator'], ['vip'], ['subscriber'], ['subscriber'], ['moderator', 'subscriber'], ['vip', 'subscriber'],
    ['founder'], ['subscriber', 'sub-gifter'], ['premium'], ['sub-gifter', 'premium'], [], []],
  kick: [['broadcaster'], ['moderator'], ['vip'], ['subscriber'], ['subscriber'], ['moderator', 'subscriber'], ['vip', 'subscriber'],
    ['og'], ['founder'], ['subscriber', 'sub_gifter'], ['og', 'subscriber'], ['verified', 'subscriber'], ['staff'], [], []],
};
// One of Kick's image badges (badges_v2), as seen in real chat.
const KICK_IMAGE_BADGE = { name: 'level', image_url: 'https://ext.cdn.kick.com/chat/badges/25_f055d38e-8e80-4a99-8419-467bad3eb1ab.png' };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const shuffled = (a) => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
};

// One send's viewers: each call is someone new, with the next badge set from a shuffled deck.
function viewers() {
  const c = settings.get().chat;
  const subs = kickSubs.channel === c.kickChannel.toLowerCase() ? kickSubs.list : [];
  const names = shuffled(T.people);
  const decks = { twitch: [], kick: [] };
  return (platform, set, months = pick(SUB_MONTHS)) => {
    if (!set && !decks[platform].length) decks[platform] = shuffled(COMBOS[platform]);
    set ??= decks[platform].pop();
    const name = names.pop() ?? pick(T.people);
    const badges = platform === 'twitch'
      ? twitch.toBadges(set.map((b) => `${b}/${b === 'subscriber' ? twitchBadges.subVersion(months) : b === 'sub-gifter' ? pick(GIFTS) : b === 'founder' ? 0 : 1}`).join(','), `subscriber/${months}`)
      : kick.kickBadges({
        badges: set.map((type) => ({ type, count: type === 'subscriber' ? months : type === 'sub_gifter' ? pick(GIFTS) : undefined })),
        badges_v2: Math.random() < 0.25 ? [KICK_IMAGE_BADGE] : [],
      }, subs);
    return { id: `test-${platform}-${name}`, name, color: pick(COLORS), badges };
  };
}

const twitchEmote = (id, name) => ({ t: 'emote', name, provider: 'twitch', src: `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/2.0`, still: `https://static-cdn.jtvnw.net/emoticons/v2/${id}/static/dark/2.0` });

// One of each effect: emotes, a sub, a first message, a mention.
function samples() {
  const c = settings.get().chat;
  const streamer = c.twitchChannel || c.kickChannel || 'streamer';
  const seven = seventv.someGlobal(1)[0];
  const viewer = viewers();
  const months = pick(SUB_MONTHS.slice(1));
  const fan = viewer('twitch', ['subscriber'], months);
  const mentionFrom = pick(PLATFORMS);
  const mention = T.mention.replace('{streamer}', streamer);
  return [
    { platform: 'twitch', user: viewer('twitch'), text: T.mod, parts: [twitchEmote(25, 'Kappa'), { t: 'text', v: T.mod.slice(5, -7) }, twitchEmote(30259, 'HeyGuys')] },
    { platform: 'kick', user: viewer('kick'), text: T.kick.replace(/\[emote:\d+:([^\]]*)\]/g, '$1'), parts: kick.kickParts(T.kick) },
    { platform: 'twitch', kind: 'sub', user: fan, system: T.subSystem.replace('{user}', fan.name).replace('{months}', months), text: T.subText, parts: [{ t: 'text', v: T.subText }] },
    { platform: 'twitch', first: true, user: viewer('twitch', pick([[], ['premium']])), text: T.first,
      parts: [{ t: 'text', v: `${T.first} ` }, ...(seven ? [{ t: 'emote', name: seven.name, src: seven.src, still: seven.still, provider: '7tv' }] : [])] },
    { platform: mentionFrom, user: viewer(mentionFrom), text: mention, parts: [{ t: 'text', v: mention }] },
  ];
}

// 10 quick messages from Kick and Twitch viewers.
function burst() {
  const viewer = viewers();
  return T.burst.map((text) => {
    const platform = pick(PLATFORMS);
    return { platform, user: viewer(platform), text, parts: [{ t: 'text', v: text }] };
  });
}

// kind 'sample': one of each effect. kind 'burst': 10 quick messages to see them move up and fade.
function test(kind) {
  if (!globalRequested) { globalRequested = true; seventv.loadGlobal(); }
  const list = kind === 'burst' ? burst() : samples();
  const c = settings.get().chat;
  list.forEach((m, i) => setTimeout(() => emitChat({ ...m, test: true, channel: m.platform === 'kick' ? c.kickChannel : c.twitchChannel }), i * (kind === 'burst' ? 180 : 450)));
  return list.length;
}

// The panel's style thumbnails: the same sample messages, not sent anywhere.
const thumbs = () => samples().map((m) => chatMessage({ ...m, test: true }));

module.exports = { sync, test, thumbs, status: () => status, recent: () => recent, events: chat };
