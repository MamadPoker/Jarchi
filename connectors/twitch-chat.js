// Twitch chat, read anonymously (no login) over Twitch's IRC-on-WebSocket: messages, sub notices,
// deleted messages and bans/timeouts. Reconnects by itself.
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

// One IRC line -> callbacks (onMessage / onClear / onRoom). Exported for tests.
function handle(line, channel, cb) {
  const { tags: t, prefix, command, trailing } = parseLine(line);
  const user = () => {
    const login = prefix.split('!')[0] || t.login || '';
    return { id: t['user-id'], login, name: t['display-name'] || login, color: t.color || null, badges: toBadges(t.badges, t['badge-info']) };
  };
  // Alert events (subs, gifts, raids, bits) go to the event log (data/logs/events.log) as they came; chat messages don't.
  if (command === 'USERNOTICE' && (SUB_NOTICES.has(t['msg-id']) || t['msg-id'] === 'raid')) logIncoming('twitch', t['msg-id'], line);
  if (command === 'PRIVMSG' && t.bits) logIncoming('twitch', 'bits', line);
  if (command === 'PRIVMSG') {
    let text = trailing ?? '';
    const action = text.startsWith('\u0001ACTION ') && text.endsWith('\u0001');
    if (action) text = text.slice(8, -1);
    cb.onMessage({ platform: 'twitch', id: t.id, channel, time: Number(t['tmi-sent-ts']) || Date.now(), text, action, first: t['first-msg'] === '1', user: user(), parts: emoteParts(text, t.emotes) });
  } else if (command === 'USERNOTICE' && SUB_NOTICES.has(t['msg-id'])) {
    const text = trailing ?? '';
    cb.onMessage({ platform: 'twitch', id: t.id, channel, kind: 'sub', system: t['system-msg'] || '', time: Number(t['tmi-sent-ts']) || Date.now(), text, user: user(), parts: emoteParts(text, t.emotes) });
  } else if (command === 'CLEARMSG') {
    cb.onClear({ platform: 'twitch', messageId: t['target-msg-id'] });
  } else if (command === 'CLEARCHAT') {
    cb.onClear(trailing ? { platform: 'twitch', userId: t['target-user-id'] } : { platform: 'twitch' }); // ban/timeout, or /clear
  } else if (command === 'ROOMSTATE' && t['room-id']) {
    cb.onChannel({ userId: t['room-id'] });
  }
}

// cb: { onStatus(state, detail), onMessage(msg), onClear(clear), onChannel({ userId }) }. Returns { stop() }.
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

module.exports = { connect, handle, parseLine, emoteParts, toBadges };
