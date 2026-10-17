// Twitch chat, read anonymously (no login) over Twitch's IRC-on-WebSocket: messages, sub notices,
// deleted messages and bans/timeouts, plus the events that become alerts (subs, resubs, gifted subs, raids, bits;
// see alertOf()). Reconnects by itself.
const badges = require('./twitch-badges');
const { logIncoming } = require('../core/events');

const URL = 'wss://irc-ws.chat.twitch.tv:443';
const ROLE = { broadcaster: 'broadcaster', moderator: 'moderator', vip: 'vip', subscriber: 'subscriber', founder: 'subscriber' };
const SUB_NOTICES = new Set(['sub', 'resub', 'subgift', 'submysterygift', 'anonsubgift', 'anonsubmysterygift', 'giftpaidupgrade', 'primepaidupgrade']);
const QUIET_MS = 6 * 60 * 1000; // Twitch pings every ~5 minutes; silence longer than this means the socket is dead

const unescapeTag = (v) => v.replace(/\\(.)/g, (m, c) => ({ s: ' ', ':': ';', '\\': '\\', r: '\r', n: '\n' })[c] ?? c);

// "@tags :prefix COMMAND params :trailing" -> parts.
function parseLine(line) {
  let rest = line;
  const tags = {};
  if (rest[0] === '@') {
    const i = rest.indexOf(' ');
    for (const kv of rest.slice(1, i).split(';')) {
      const j = kv.indexOf('=');
      if (j > 0) tags[kv.slice(0, j)] = unescapeTag(kv.slice(j + 1));
    }
    rest = rest.slice(i + 1);
  }
  let prefix = '';
  if (rest[0] === ':') {
    const i = rest.indexOf(' ');
    prefix = rest.slice(1, i);
    rest = rest.slice(i + 1);
  }
  const t = rest.indexOf(' :');
  const trailing = t >= 0 ? rest.slice(t + 2) : null;
  const [command, ...params] = (t >= 0 ? rest.slice(0, t) : rest).split(' ');
  return { tags, prefix, command, params, trailing };
}

// Twitch's emotes tag ("25:0-4,6-10/1902:12-16") -> text and emote parts. Positions count characters (code points).
function emoteParts(text, tag) {
  const chars = Array.from(text);
  const ranges = [];
  for (const spec of (tag || '').split('/').filter(Boolean)) {
    const [id, pos] = spec.split(':');
    for (const r of (pos || '').split(',')) {
      const [a, b] = r.split('-').map(Number);
      if (Number.isInteger(a) && Number.isInteger(b) && b >= a) ranges.push({ id, a, b });
    }
  }
  ranges.sort((x, y) => x.a - y.a);
  const parts = [];
  const pushText = (v) => v && parts.push({ t: 'text', v });
  let i = 0;
  for (const r of ranges) {
    if (r.a < i) continue;
    pushText(chars.slice(i, r.a).join(''));
    const cdn = `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(r.id)}`;
    parts.push({ t: 'emote', name: chars.slice(r.a, r.b + 1).join(''), src: `${cdn}/default/dark/2.0`, still: `${cdn}/static/dark/2.0`, provider: 'twitch' });
    i = r.b + 1;
  }
  pushText(chars.slice(i).join(''));
  return parts;
}

// badges "broadcaster/1,subscriber/12" (+ badge-info "subscriber/14") -> badge list. Badges we have no image for are dropped.
function toBadges(tag, info) {
  const months = /subscriber\/(\d+)/.exec(info || '')?.[1];
  return (tag || '').split(',').filter(Boolean).map((b) => {
    const [set, version] = b.split('/');
    const title = set === 'subscriber' && months ? `Subscriber (${months} months)` : set.replace(/[-_]/g, ' ');
    return { type: ROLE[set] ?? 'other', name: set, img: badges.image(set, version), title };
  }).filter((b) => b.img);
}

// A cheer in a message with bits: one of Twitch's global cheermote prefixes + a number, as its own word ("Cheer100").
// Channels' own cheermotes need the Twitch API: they stay text. Any case, like Twitch.
const CHEER = /(^|\s)(Cheer|BibleThump|cheerwhal|Corgo|uni|ShowLove|Party|SeemsGood|Pride|Kappa|FrankerZ|HeyGuys|DansGame|EleGiggle|TriHard|Kreygasm|4Head|SwiftRage|NotLikeThis|FailFish|VoHiYo|PJSalt|MrDestructoid|bday|RIPCheer|Shamrock)(\d+)(?=\s|$)/gi;
// Twitch's default gems, by amount: assets/twitch-bits/<gem>.gif (same amounts as the bits tiers in core/settings.js).
const GEMS = [10000, 5000, 1000, 100, 1];

// Text parts -> text and cheer parts ({ t: 'cheer', name, amount, gem }): the chat shows the gem and the amount, like Twitch.
function cheerParts(parts) {
  return parts.flatMap((p) => {
    if (p.t !== 'text') return [p];
    const out = [];
    let i = 0;
    for (const m of p.v.matchAll(CHEER)) {
      const at = m.index + m[1].length;
      if (at > i) out.push({ t: 'text', v: p.v.slice(i, at) });
      const amount = Number(m[3]);
      out.push({ t: 'cheer', name: m[2] + m[3], amount, gem: GEMS.find((g) => amount >= g) ?? 1 });
      i = at + m[2].length + m[3].length;
    }
    if (i < p.v.length) out.push({ t: 'text', v: p.v.slice(i) });
    return out;
  });
}

// One IRC line -> the alert it is (for cb.onAlert), or null. Key: Twitch's message id, so a repeat is dropped (core/events).
//   USERNOTICE sub / resub        sub, or resub with months (msg-param-cumulative-months) and the viewer's message
//   USERNOTICE submysterygift     gifted subs: ONE alert per gift, amount = msg-param-mass-gift-count. Twitch then sends a
//                                 subgift per viewer with the same msg-param-community-gift-id: those are no alert
//   USERNOTICE subgift            a sub gifted to one chosen viewer (no community gift id): gifted subs, amount 1
//   USERNOTICE raid               raid, amount = msg-param-viewerCount
//   PRIVMSG with a bits tag       bits, with the message minus its cheermotes
// anon* msg-ids (older anonymous gifts) count as the same. Follows need a login: none here.
function alertOf(command, t, trailing) {
  if (t['source-room-id'] && t['source-room-id'] !== t['room-id']) return null; // another channel's, in a shared chat
  const user = t['display-name'] || t.login || '';
  const key = `twitch:${t.id}`;
  if (command === 'PRIVMSG') return t.bits ? { type: 'bits', user, amount: Number(t.bits) || 0, message: (trailing ?? '').replace(CHEER, '').trim(), key } : null;
  if (command !== 'USERNOTICE') return null;
  const message = trailing ?? '';
  switch (t['msg-id']?.replace(/^anon/, '')) {
    case 'sub': return { type: 'sub', user, months: 1, message, key };
    case 'resub': return { type: 'resub', user, months: Number(t['msg-param-cumulative-months']) || 2, message, key };
    case 'submysterygift': return { type: 'gift_sub', user, amount: Number(t['msg-param-mass-gift-count']) || 1, key };
    case 'subgift': return t['msg-param-community-gift-id'] ? null : { type: 'gift_sub', user, amount: 1, key };
    case 'raid': return { type: 'raid', user, amount: Number(t['msg-param-viewerCount']) || 0, key };
  }
  return null;
}

// One IRC line -> callbacks (onMessage / onClear / onChannel / onAlert). Exported for tests.
// A line that is an alert also carries it (event) for the chat's special lines; a raid gets a chat line of its own.
function handle(line, channel, cb) {
  const { tags: t, prefix, command, trailing } = parseLine(line);
  const user = () => {
    const login = t.login || prefix.split('!')[0]; // notices come from tmi.twitch.tv and name the viewer in a tag
    return { id: t['user-id'], login, name: t['display-name'] || login, color: t.color || null, badges: toBadges(t.badges, t['badge-info']) };
  };
  // Alert events (subs, gifts, raids, bits) go to the event log (data/logs/events.log) as they came; chat messages don't.
  if (command === 'USERNOTICE' && (SUB_NOTICES.has(t['msg-id']) || t['msg-id'] === 'raid')) logIncoming('twitch', t['msg-id'], line);
  if (command === 'PRIVMSG' && t.bits) logIncoming('twitch', 'bits', line);
  const alert = alertOf(command, t, trailing);
  const event = alert && { type: alert.type, amount: alert.amount, months: alert.months };
  if (command === 'PRIVMSG') {
    let text = trailing ?? '';
    const action = text.startsWith('\u0001ACTION ') && text.endsWith('\u0001');
    if (action) text = text.slice(8, -1);
    const parts = emoteParts(text, t.emotes);
    cb.onMessage({ platform: 'twitch', id: t.id, channel, time: Number(t['tmi-sent-ts']) || Date.now(), text, action, first: t['first-msg'] === '1', user: user(), parts: t.bits ? cheerParts(parts) : parts, event });
  } else if (command === 'USERNOTICE' && (SUB_NOTICES.has(t['msg-id']) || t['msg-id'] === 'raid')) {
    const text = trailing ?? '';
    cb.onMessage({ platform: 'twitch', id: t.id, channel, kind: t['msg-id'] === 'raid' ? 'event' : 'sub', system: t['system-msg'] || '', time: Number(t['tmi-sent-ts']) || Date.now(), text, user: user(), parts: emoteParts(text, t.emotes), event });
  } else if (command === 'CLEARMSG') {
    cb.onClear({ platform: 'twitch', messageId: t['target-msg-id'] });
  } else if (command === 'CLEARCHAT') {
    cb.onClear(trailing ? { platform: 'twitch', userId: t['target-user-id'] } : { platform: 'twitch' }); // ban/timeout, or /clear
  } else if (command === 'ROOMSTATE' && t['room-id']) {
    cb.onChannel({ userId: t['room-id'] });
  }
  if (alert) cb.onAlert?.(alert);
}

// cb: { onStatus(state, detail), onMessage(msg), onClear(clear), onChannel({ userId }), onAlert(alert) }. Returns { stop() }.
function connect(channel, cb) {
  let ws, timer, last = Date.now(), retry = 0, stopped = false;
  const watchdog = setInterval(() => { if (Date.now() - last > QUIET_MS) ws?.close(); }, 30000);
  const open = () => {
    cb.onStatus('connecting');
    last = Date.now();
    ws = new WebSocket(URL);
    ws.onopen = () => {
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      ws.send('PASS SCHMOOPIIE'); // anonymous: any password, a "justinfan" nickname
      ws.send(`NICK justinfan${10000 + Math.floor(Math.random() * 80000)}`);
      ws.send(`JOIN #${channel}`);
    };
    ws.onmessage = (e) => {
      last = Date.now();
      for (const line of String(e.data).split('\r\n')) {
        if (!line) continue;
        if (line.startsWith('PING')) { ws.send(line.replace('PING', 'PONG')); continue; }
        const cmd = parseLine(line).command;
        if (cmd === '366') { retry = 0; cb.onStatus('connected'); } // end of the user list = joined
        else if (cmd === 'RECONNECT') ws.close();
        else if (cmd === 'NOTICE' && /suspended|does not exist|not found/i.test(line)) cb.onStatus('error', 'not_found');
        try { handle(line, channel, cb); } catch (err) { console.warn('Twitch chat:', err.message); }
      }
    };
    ws.onerror = () => cb.onStatus('error', 'network');
    ws.onclose = () => { if (!stopped) timer = setTimeout(open, Math.min(30000, 2000 * 2 ** retry++)); };
  };
  open();
  return { stop() { stopped = true; clearTimeout(timer); clearInterval(watchdog); ws?.close(); } };
}

module.exports = { connect, handle, parseLine, emoteParts, toBadges, cheerParts };
