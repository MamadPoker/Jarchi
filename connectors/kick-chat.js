// Kick chat, read without a login over Kick's public Pusher socket: messages, sub notices, deleted messages and bans.
// Finding a channel's chatroom by name uses Kick's website API (kick.com/api/v2/channels/<name>). It's unofficial and
// only answers HTTP/2: Kick's firewall blocks HTTP/1.1 clients such as Node's fetch, so this uses node:http2.
const http2 = require('node:http2');
const strings = require('../i18n/en.json');

const PUSHER = 'wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.4.0&flash=false';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const EMOTE = /\[emote:(\d+):([^\]]*)\]/g;
const ROLE = { broadcaster: 'broadcaster', moderator: 'moderator', vip: 'vip', subscriber: 'subscriber' };
const QUIET_MS = 150 * 1000; // we ping every minute; silence longer than this means the socket is dead

const fill = (tpl, v) => tpl.replace(/\{(\w+)\}/g, (m, k) => v[k] ?? m);

// GET a kick.com API path over HTTP/2 -> { status, json }.
function kickGet(path) {
  return new Promise((resolve, reject) => {
    const client = http2.connect('https://kick.com');
    const finish = (fn, v) => { client.close(); fn(v); };
    client.on('error', (e) => finish(reject, e));
    client.setTimeout(10000, () => finish(reject, new Error('timeout')));
    const req = client.request({ ':path': path, 'user-agent': UA, accept: 'application/json' });
    let status = 0, body = '';
    req.setEncoding('utf8');
    req.on('response', (h) => (status = h[':status']));
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      let json = null;
      try { json = JSON.parse(body); } catch {}
      finish(resolve, { status, json });
    });
    req.on('error', (e) => finish(reject, e));
  });
}

// Channel name -> what chat needs: chatroom id, the user id (for 7TV), the channel's own subscriber badges.
async function channelInfo(slug) {
  const { status, json } = await kickGet(`/api/v2/channels/${encodeURIComponent(slug)}`);
  if (status === 404) throw Object.assign(new Error('Kick channel not found'), { detail: 'not_found' });
  if (status !== 200 || !json?.chatroom?.id) throw Object.assign(new Error(`Kick API ${status}`), { detail: status === 403 ? 'blocked' : 'network' });
  return {
    chatroomId: json.chatroom.id,
    userId: json.user_id,
    subBadges: (json.subscriber_badges ?? []).map((b) => ({ months: b.months, src: b.badge_image?.src })).filter((b) => b.src).sort((a, b) => b.months - a.months),
  };
}

// A viewer's profile picture (one website API call; callers cache and rate-limit).
async function avatar(slug) {
  const { status, json } = await kickGet(`/api/v2/channels/${encodeURIComponent(slug)}`);
  return status === 200 ? json?.user?.profile_pic ?? null : null;
}

// "hi [emote:37226:KEKW]" -> text and emote parts.
function kickParts(content) {
  const parts = [];
  let i = 0;
  for (const m of content.matchAll(EMOTE)) {
    if (m.index > i) parts.push({ t: 'text', v: content.slice(i, m.index) });
    const src = `https://files.kick.com/emotes/${m[1]}/fullsize`;
    parts.push({ t: 'emote', name: m[2], src, still: src, provider: 'kick' });
    i = m.index + m[0].length;
  }
  if (i < content.length) parts.push({ t: 'text', v: content.slice(i) });
  return parts;
}

// Role badges (no public image except the channel's sub badges: those show as text tags) + Kick's image badges (badges_v2).
function kickBadges(identity, subBadges) {
  const out = [];
  for (const b of identity?.badges ?? []) {
    const img = b.type === 'subscriber' ? subBadges.find((s) => (b.count ?? 0) >= s.months)?.src ?? null : null;
    out.push({ type: ROLE[b.type] ?? 'other', name: b.type, img, title: b.text || b.type });
  }
  for (const b of identity?.badges_v2 ?? []) if (b.image_url) out.push({ type: 'other', name: b.name, img: b.image_url, title: b.name });
  return out;
}

// One Pusher event -> callbacks. Exported for tests.
function handle(event, raw, channel, info, cb) {
  const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const name = (n) => ({ name: n, login: n });
  switch (event) {
    case 'App\\Events\\ChatMessageEvent': {
      const s = d.sender ?? {};
      cb.onMessage({
        platform: 'kick', id: d.id, channel, time: Date.parse(d.created_at) || Date.now(),
        text: (d.content ?? '').replace(EMOTE, '$2'),
        user: { id: s.id, login: s.slug, name: s.username, color: s.identity?.color, badges: kickBadges(s.identity, info.subBadges) },
        parts: kickParts(d.content ?? ''),
      });
      return;
    }
    case 'App\\Events\\MessageDeletedEvent': return cb.onClear({ platform: 'kick', messageId: d.message?.id });
    case 'App\\Events\\UserBannedEvent': return cb.onClear({ platform: 'kick', userId: d.user?.id });
    case 'App\\Events\\ChatroomClearEvent': return cb.onClear({ platform: 'kick' });
    case 'App\\Events\\SubscriptionEvent':
      return cb.onMessage({ platform: 'kick', channel, kind: 'sub', user: name(d.username), system: fill(strings.chatText.kickSub, { user: d.username, months: d.months ?? 1 }), text: '', parts: [] });
    case 'App\\Events\\GiftedSubscriptionsEvent':
      return cb.onMessage({ platform: 'kick', channel, kind: 'sub', user: name(d.gifter_username), system: fill(strings.chatText.kickGift, { user: d.gifter_username, count: d.gifted_usernames?.length ?? 1 }), text: '', parts: [] });
  }
}

// cb: { onStatus(state, detail), onMessage(msg), onClear(clear), onChannel({ userId, subBadges }) }. Returns { stop() }.
function connect(slug, cb) {
  let ws, timer, info, last = Date.now(), retry = 0, stopped = false;
  const again = (ms) => { if (!stopped) timer = setTimeout(open, ms); };
  const keepAlive = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ event: 'pusher:ping', data: {} }));
    if (Date.now() - last > QUIET_MS) ws?.close();
  }, 60000);
  async function open() {
    cb.onStatus('connecting');
    try {
      info ??= await channelInfo(slug);
    } catch (err) {
      cb.onStatus('error', err.detail ?? 'network');
      return again(err.detail === 'not_found' ? 60000 : 15000);
    }
    if (stopped) return;
    cb.onChannel({ userId: info.userId, subBadges: info.subBadges });
    last = Date.now();
    ws = new WebSocket(PUSHER);
    ws.onmessage = (e) => {
      last = Date.now();
      const msg = JSON.parse(e.data);
      if (msg.event === 'pusher:connection_established') {
        ws.send(JSON.stringify({ event: 'pusher:subscribe', data: { auth: '', channel: `chatrooms.${info.chatroomId}.v2` } }));
      } else if (msg.event === 'pusher_internal:subscription_succeeded') {
        retry = 0;
        cb.onStatus('connected');
      } else if (msg.event === 'pusher:ping') {
        ws.send(JSON.stringify({ event: 'pusher:pong', data: {} }));
      } else {
        try { handle(msg.event, msg.data, slug, info, cb); } catch (err) { console.warn('Kick chat:', err.message); }
      }
    };
    ws.onerror = () => cb.onStatus('error', 'network');
    ws.onclose = () => again(Math.min(30000, 2000 * 2 ** retry++));
  }
  open();
  return { stop() { stopped = true; clearTimeout(timer); clearInterval(keepAlive); ws?.close(); } };
}

module.exports = { connect, handle, kickParts, kickBadges, avatar };
