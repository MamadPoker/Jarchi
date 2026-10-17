// Chat: runs the Kick and Twitch connectors for the channels in the chat settings, adds 7TV emotes and profile
// pictures, keeps the last messages for widgets that (re)connect, and makes test messages.
// Everything goes through the event bus: 'chat', 'chatClear', 'chatAvatar'.
const { EventEmitter } = require('node:events');
const { bus, emitChat, chatMessage, emitChatClear, emitEvent } = require('./events');
const settings = require('./settings');
const goals = require('./goals');
const net = require('./net');
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
// They run whenever a channel is set, also with the chat widget off (that only hides it): Kick alerts come from here.
function sync() {
  const c = settings.get().chat;
  for (const platform of ['kick', 'twitch']) {
    const want = c[`${platform}Channel`].toLowerCase();
    if (running[platform]?.channel === want) continue;
    running[platform]?.conn.stop();
    running[platform] = null;
    if (!want) {
      setStatus(platform, 'off');
      if (platform === 'kick') goals.kickGoals(null); // no Kick channel: no Kick goals
      continue;
    }
    if (!globalRequested) { globalRequested = true; seventv.loadGlobal(); }
    running[platform] = {
      channel: want,
      conn: CONNECTORS[platform].connect(want, {
        onStatus: (state, detail) => setStatus(platform, state, detail),
        onMessage: publish,
        onClear: emitChatClear,
        onAlert: (a) => emitEvent({ ...a, platform }),
        onGoals: goals.kickGoals, // Kick: the channel's goals (creator dashboard), read every minute
        onGoal: goals.kickGoal, // Kick: one of them changed (live event)
        onChannel: ({ userId, subBadges }) => {
          seventv.loadChannel(platform, userId);
          if (platform === 'twitch') twitchBadges.loadChannel(userId);
          else kickSubs = { channel: want, list: subBadges ?? [] };
        },
      }),
    };
  }
}

// ---------- "Test connection": can we reach each service (through the proxy setting)? ----------
// Each service = what Jarchi talks to (API, chat socket) + where its emotes / badges / pictures come from.
const CHECKS = {
  kick: async () => {
    const { status } = await kick.kickGet(`/api/v2/channels/${encodeURIComponent(settings.get().chat.kickChannel || 'kick')}`);
    if (status === 403) throw net.fail('blocked');
    if (status !== 200 && status !== 404) throw net.fail('network');
    await Promise.all([new URL(kick.PUSHER).hostname, 'files.kick.com'].map(net.reach));
  },
  twitch: () => Promise.all(['irc-ws.chat.twitch.tv', 'static-cdn.jtvnw.net'].map(net.reach)),
  sevenTv: async () => {
    const res = await fetch('https://7tv.io/v3/emote-sets/global', { signal: AbortSignal.timeout(10000) });
    await res.arrayBuffer();
    if (!res.ok) throw net.fail(res.status === 403 ? 'blocked' : 'network');
    await net.reach('cdn.7tv.app');
  },
};
// -> { mode, proxy: { type, host, port } | null, results: { kick | twitch | sevenTv: 'ok' | net.why() code } }
async function check() {
  const out = await Promise.all(Object.entries(CHECKS).map(([id, fn]) => fn().then(() => [id, 'ok'], (err) => [id, net.why(err)])));
  return { mode: settings.get().proxyMode, proxy: await net.current(), results: Object.fromEntries(out) };
}

// Reconnect everything (the proxy setting changed).
function restart() {
  for (const platform in running) {
    running[platform]?.conn.stop();
    running[platform] = null;
  }
  sync();
  if (globalRequested) seventv.loadGlobal();
}

// A connector's message -> 7TV emotes added -> the bus, right away. A chatter seen before brings their profile picture
// along; a new one's is looked up after the message went out, and widgets swap it in when it comes ('chatAvatar').
function publish(m) {
  const cached = avatars.get(`${m.platform}:${String(m.user?.login ?? m.user?.name ?? '').toLowerCase()}`);
  const msg = emitChat({ ...m, user: { ...m.user, avatar: m.user?.avatar ?? cached }, parts: seventv.enrich(m.platform, m.parts ?? []) });
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
// The streamer's own pictures (the panel's background art): { kick, twitch } for the channels set, null where none.
// Same cache as the chatters'; a failed lookup is tried again next time.
async function streamer() {
  const c = settings.get().chat;
  const one = async (platform, login) => {
    const key = `${platform}:${login.toLowerCase()}`;
    if (login && !avatars.get(key)) avatars.set(key, await (platform === 'kick' ? kick.avatar(login) : twitchBadges.avatar(login)).catch(() => null));
    return (login && avatars.get(key)) || null;
  };
  const [k, t] = await Promise.all([one('kick', c.kickChannel), one('twitch', c.twitchChannel)]);
  return { kick: k, twitch: t };
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

// ---------- "Show chat timing" (debug): one line in the server output per message a widget drew ----------
// created (Kick's / Twitch's own clock) -> received (Jarchi got it) -> sent (to widgets) -> shown (the widget drew it).
// Each step is the time since the one before; total = created -> shown. Only "created" is another computer's clock.
// r: { id, shown, where } from the widget (only an id we know and a number are used); transport: websocket | polling.
const WHERE = ['OBS', 'panel', 'browser'];
const clock = (t) => new Date(t - new Date(t).getTimezoneOffset() * 60000).toISOString().slice(11, 23); // local time with ms
const step = (a, b) => `${b >= a ? '+' : '-'}${(Math.abs(b - a) / 1000).toFixed(2)}s`;
function timing(r, transport) {
  const m = settings.get().chat.showTiming && recent.find((x) => x.id === r?.id);
  const shown = Number(r?.shown);
  if (!m || !Number.isFinite(shown)) return null;
  const who = `${m.user.name}: ${m.text || m.system}`.replace(/\p{Cc}/gu, ' ').slice(0, 50); // viewers' text: no terminal control codes
  const line = `chat timing  ${m.platform.padEnd(6)} created ${clock(m.time)}  received ${step(m.time, m.received)}  sent ${step(m.received, m.sent)}  `
    + `shown ${step(m.sent, shown)}  total ${step(m.time, shown)}  ${WHERE.includes(r.where) ? r.where : '?'}/${transport}  ${who}`;
  console.log(line);
  return line;
}

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
// Twitch's default profile pictures (what Twitch shows for viewers without their own), for the profile picture test.
const AVATARS = ['215b7342-def9-11e9-9a66-784f43822e80', '13e5fa74-defa-11e9-809c-784f43822e80', '998f01ae-def8-11e9-b95c-784f43822e80', 'ce57700a-def9-11e9-842d-784f43822e80',
  'de130ab0-def7-11e9-b668-784f43822e80', 'dbdc9198-def8-11e9-8681-784f43822e80', 'ebe4cd89-b4f4-4cd9-adac-2f30151b4209', '294c98b5-e34d-42cd-a8f0-140b72fba9b0']
  .map((id) => `https://static-cdn.jtvnw.net/user-default-pictures-uv/${id}-profile_image-70x70.png`);

// Plain messages with emotes.
const plain = {
  twitch: (viewer) => ({ platform: 'twitch', user: viewer('twitch'), text: T.mod, parts: [twitchEmote(25, 'Kappa'), { t: 'text', v: T.mod.slice(5, -7) }, twitchEmote(30259, 'HeyGuys')] }),
  kick: (viewer) => ({ platform: 'kick', user: viewer('kick'), text: T.kick.replace(/\[emote:\d+:([^\]]*)\]/g, '$1'), parts: kick.kickParts(T.kick) }),
};

// Messages that trigger each fancy effect: key -> () => a message, or a run of messages (combo). The widget shows an
// effect only when it's on in the settings; the panel says which ones are off.
function effects(viewer) {
  const c = settings.get().chat;
  const streamer = c.twitchChannel || c.kickChannel || 'streamer';
  const seven = seventv.someGlobal(1)[0];
  const text = (v) => [{ t: 'text', v }];
  return {
    sub: () => {
      const months = pick(SUB_MONTHS.slice(1));
      const fan = viewer('twitch', ['subscriber'], months);
      return { platform: 'twitch', kind: 'sub', user: fan, system: T.subSystem.replace('{user}', fan.name).replace('{months}', months), text: T.subText, parts: text(T.subText) };
    },
    first: () => ({ platform: 'twitch', first: true, user: viewer('twitch', pick([[], ['premium']])), text: T.first,
      parts: [...text(`${T.first} `), ...(seven ? [{ t: 'emote', name: seven.name, src: seven.src, still: seven.still, provider: '7tv' }] : [])] }),
    vip: () => {
      const platform = pick(PLATFORMS);
      return { platform, user: viewer(platform, pick([['vip'], ['vip', 'subscriber']])), text: T.vip, parts: text(T.vip) };
    },
    mention: () => {
      const platform = pick(PLATFORMS), v = T.mention.replace('{streamer}', streamer);
      return { platform, user: viewer(platform), text: v, parts: text(v) };
    },
    avatar: () => ({ platform: 'twitch', user: { ...viewer('twitch'), avatar: pick(AVATARS) }, text: T.avatar, parts: text(T.avatar) }),
    // Several viewers send the same single emote in a row: the widget counts them on one message ("x5").
    combo: () => {
      const emote = seven ? { t: 'emote', name: seven.name, src: seven.src, still: seven.still, provider: '7tv' } : twitchEmote(25, 'Kappa');
      return Array.from({ length: 4 + Math.floor(Math.random() * 3) }, () => {
        const platform = seven ? pick(PLATFORMS) : 'twitch'; // a 7TV emote works on both platforms
        return { platform, user: viewer(platform), text: emote.name, parts: [emote] };
      });
    },
  };
}
const EFFECTS = ['sub', 'first', 'vip', 'mention', 'avatar', 'combo'];

// "Send test message": emotes and 3 random effects. "Send 10 messages": 10 messages, 2 of them (or a combo run) effects.
// "Show all effects": every effect in a row. A combo run stays together.
function build(kind) {
  const viewer = viewers();
  const fx = effects(viewer);
  const picked = kind === 'all' ? EFFECTS : shuffled(EFFECTS).slice(0, kind === 'burst' ? 2 : 3);
  const runs = picked.map((k) => [].concat(fx[k]()));
  if (kind === 'all') return { list: runs.flat(), effects: picked };
  const fill = kind === 'burst'
    ? shuffled(T.burst).slice(0, 10 - runs.flat().length).map((v) => { const platform = pick(PLATFORMS); return [{ platform, user: viewer(platform), text: v, parts: [{ t: 'text', v }] }]; })
    : [[plain.twitch(viewer)], [plain.kick(viewer)]];
  return { list: shuffled([...runs, ...fill]).flat(), effects: picked };
}

// kind 'sample' | 'burst' | 'all' -> { sent, effects }.
function test(kind) {
  if (!globalRequested) { globalRequested = true; seventv.loadGlobal(); }
  const { list, effects: used } = build(kind);
  const c = settings.get().chat;
  list.forEach((m, i) => setTimeout(() => emitChat({ ...m, test: true, channel: m.platform === 'kick' ? c.kickChannel : c.twitchChannel }), i * (kind === 'burst' ? 180 : 450)));
  return { sent: list.length, effects: used };
}

// The panel's style thumbnails (and the preview before any message): emotes and the effects that fit a still picture.
function thumbs() {
  const viewer = viewers();
  const fx = effects(viewer);
  return [plain.twitch(viewer), fx.sub(), fx.first(), fx.vip(), fx.mention()].map((m) => chatMessage({ ...m, test: true }));
}

module.exports = { sync, restart, check, test, thumbs, timing, streamer, status: () => status, recent: () => recent, events: chat };
