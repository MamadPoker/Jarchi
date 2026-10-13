// Kick chat, read without a login over Kick's public Pusher socket: messages, sub notices, deleted messages and bans,
// plus the events that become alerts (subs, resubs, gifted subs, Kicks, hosts; see handle()).
// Finding a channel's chatroom by name uses Kick's website API (kick.com/api/v2/channels/<name>). It's unofficial and
// only answers HTTP/2: Kick's firewall blocks HTTP/1.1 clients such as Node's fetch, so this uses node:http2.
const http2 = require('node:http2');
const net = require('../core/net');
const strings = require('../i18n/en.json');

const PUSHER = 'wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.4.0&flash=false';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const EMOTE = /\[emote:(\d+):([^\]]*)\]/g;
const ROLE = { broadcaster: 'broadcaster', moderator: 'moderator', vip: 'vip', subscriber: 'subscriber' };
// Kick's own badge icons (see assets/kick-badges/README.md). Sub gifter: the highest tier up to the gift count, like kick.com.
const BADGES = '/assets/kick-badges';
const ICONS = new Set(['broadcaster', 'moderator', 'vip', 'og', 'founder', 'subscriber', 'verified', 'staff', 'bot', 'sidekick', 'trainwreckstv']);
const GIFT_TIERS = [1, 5, 10, 25, 50, ...Array.from({ length: 18 }, (_, i) => 100 + 50 * i), 1000, 2000, 3000, 4000, 5000].reverse();
const QUIET_MS = 150 * 1000; // we ping every minute; silence longer than this means the socket is dead

const fill = (tpl, v) => tpl.replace(/\{(\w+)\}/g, (m, k) => v[k] ?? m);

// GET a kick.com API path over HTTP/2 (through the proxy setting) -> { status, json }.
async function kickGet(path) {
  const sock = await net.secure('kick.com', 443, ['h2']);
  return new Promise((resolve, reject) => {
    const client = http2.connect('https://kick.com', { createConnection: () => sock });
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
    channelId: json.id, // Kicks arrive on the channel's own socket channel
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

// A Kick badge's image: the channel's own sub badge for the viewer's months (else Kick's default), Kick's icon for the
// other types, null (a text tag) for a type Kick added after these icons were taken.
function badgeImage(b, subBadges) {
  if (b.type === 'subscriber') return subBadges.find((s) => (b.count || 1) >= s.months)?.src ?? `${BADGES}/subscriber.svg`;
  if (b.type === 'sub_gifter') return `${BADGES}/sub_gifter-${GIFT_TIERS.find((n) => (b.count || 1) >= n)}.svg`;
  return ICONS.has(b.type) ? `${BADGES}/${b.type}.svg` : null;
}

// Badges (identity.badges) + Kick's image badges (badges_v2).
function kickBadges(identity, subBadges) {
  const out = [];
  for (const b of identity?.badges ?? []) out.push({ type: ROLE[b.type] ?? 'other', name: b.type, img: badgeImage(b, subBadges), title: b.text || b.type });
  for (const b of identity?.badges_v2 ?? []) if (b.image_url) out.push({ type: 'other', name: b.name, img: b.image_url, title: b.name });
  return out;
}

// What just happened, so one sub is never two alerts: 'sub:<login>' (a sub announced in chat), 'to:<login>' (was
// gifted a sub: their "subscribed" is part of that gift), 'from:<login>' (gifted subs) -> when.
const RECENT_MS = 60 * 1000; // the channel socket's "subscribed" for a gifter came 8-19 s after the gift
const HOLD_MS = 10 * 1000; // a channel-socket-only sub waits this long for the chat socket's copy (that one comes within ms)
const GIFT_WAIT_MS = 3 * 1000; // a sub announced in chat waits this long: a gift's own event can come just after its viewers' "subscribed"
const recent = new Map();
const mark = (k) => {
  recent.set(k, Date.now());
  if (recent.size > 2000) recent.delete(recent.keys().next().value);
};
const isRecent = (k) => Date.now() - (recent.get(k) ?? 0) < RECENT_MS;

// How many months a viewer has been subscribed to a channel (Kick's website API), or null.
async function subMonths(slug, user) {
  const { status, json } = await kickGet(`/api/v2/channels/${encodeURIComponent(slug)}/users/${encodeURIComponent(user)}`);
  return status === 200 ? Number(json?.subscribed_for) || null : null;
}

// One Pusher event -> callbacks. Exported for tests.
// Alerts (cb.onAlert), each with a key naming that one real event, so a repeat is dropped (core/events):
//   SubscriptionEvent (chatrooms.<id>.v2)          sub (1 month) or resub; key: viewer + month count. After GIFT_WAIT_MS,
//                                                  and none if a gift named the viewer (Kick sends it for gifted subs too)
//   ChannelSubscriptionEvent (channel_<id>)        Kick sends every sub here too, and automatic renewals ONLY here, without
//                                                  the months: if the chat socket didn't announce it (and it's no gift),
//                                                  the months are looked up and it's a resub (same key as above)
//   ChatMessageEvent type "celebration"            resub: a viewer shares their renewal in chat, with their message (same key)
//   GiftedSubscriptionsEvent (chatroom_<id>)       gifted subs: ONE alert per purchase (Kick's correlation_id; a big gift
//                                                  can come in chunks), amount = gifted_total
//   KicksGifted (channel_<id>)                     Kicks, keyed by Kick's gift transaction id
//   StreamHostEvent (.v2)                          raid (Kick calls it a host), amount = viewers
function handle(event, raw, channel, info, cb) {
  const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const name = (n) => ({ name: n, login: n });
  const login = (n) => String(n ?? '').toLowerCase();
  const sub = (user, months, message = '') => {
    mark(`sub:${login(user)}`);
    if (isRecent(`to:${login(user)}`)) return;
    cb.onAlert?.({ type: months > 1 ? 'resub' : 'sub', user, months, message, key: `kick:sub:${login(user)}:${months}` });
  };
  switch (event) {
    case 'App\\Events\\ChatMessageEvent': {
      const s = d.sender ?? {};
      cb.onMessage({
        platform: 'kick', id: d.id, channel, time: Date.parse(d.created_at) || Date.now(),
        text: (d.content ?? '').replace(EMOTE, '$2'),
        user: { id: s.id, login: s.slug, name: s.username, color: s.identity?.color, badges: kickBadges(s.identity, info.subBadges) },
        parts: kickParts(d.content ?? ''),
      });
      const c = d.metadata?.celebration;
      if (d.type === 'celebration' && c?.type === 'subscription_renewed') sub(s.username, Number(c.total_months) || 2, (d.content ?? '').replace(EMOTE, '$2'));
      return;
    }
    case 'App\\Events\\MessageDeletedEvent': return cb.onClear({ platform: 'kick', messageId: d.message?.id });
    case 'App\\Events\\UserBannedEvent': return cb.onClear({ platform: 'kick', userId: d.user?.id });
    case 'App\\Events\\ChatroomClearEvent': return cb.onClear({ platform: 'kick' });
    case 'App\\Events\\SubscriptionEvent': {
      const months = Number(d.months) || 1;
      cb.onMessage({ platform: 'kick', channel, kind: 'sub', user: name(d.username), system: fill(strings.chatText.kickSub, { user: d.username, months }), text: '', parts: [] });
      return setTimeout(() => sub(d.username, months), GIFT_WAIT_MS);
    }
    case 'App\\Events\\ChannelSubscriptionEvent': {
      if ((d.user_ids?.length ?? 1) > 1) return; // several viewers at once: a gift
      const who = login(d.username);
      setTimeout(async () => {
        if (['sub', 'to', 'from'].some((k) => isRecent(`${k}:${who}`))) return;
        const months = await module.exports.subMonths(channel, d.username).catch(() => null);
        sub(d.username, months ?? 1);
      }, HOLD_MS);
      return;
    }
    case 'GiftedSubscriptionsEvent':
    case 'App\\Events\\GiftedSubscriptionsEvent': {
      const to = d.gifted_usernames ?? [];
      const count = Number(d.gifted_total) || to.length || 1;
      const key = `kick:gift:${d.correlation_id ?? `${login(d.gifter_username)}:${d.gifter_total ?? to.map(login).sort().join(',')}`}`;
      for (const u of to) mark(`to:${login(u)}`);
      mark(`from:${login(d.gifter_username)}`);
      if (!isRecent(key)) { // the chat line once per gift, not per chunk
        mark(key);
        cb.onMessage({ platform: 'kick', channel, kind: 'sub', user: name(d.gifter_username), system: fill(strings.chatText.kickGift, { user: d.gifter_username, count }), text: '', parts: [] });
      }
      return cb.onAlert?.({ type: 'gift_sub', user: d.gifter_username, amount: count, key });
    }
    case 'KicksGifted':
      return cb.onAlert?.({ type: 'kicks', user: d.sender?.username, amount: Number(d.gift?.amount) || 0, message: d.message ?? '', key: d.gift_transaction_id && `kick:kicks:${d.gift_transaction_id}` });
    case 'App\\Events\\StreamHostEvent':
      return cb.onAlert?.({ type: 'raid', user: d.host_username, amount: Number(d.number_viewers) || 0, message: d.optional_message ?? '', key: `kick:host:${login(d.host_username)}:${d.number_viewers}` });
  }
}

// cb: { onStatus(state, detail), onMessage(msg), onClear(clear), onChannel({ userId, subBadges }), onAlert(alert) }. Returns { stop() }.
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
        for (const channel of [`chatrooms.${info.chatroomId}.v2`, `chatroom_${info.chatroomId}`, `channel_${info.channelId}`]) ws.send(JSON.stringify({ event: 'pusher:subscribe', data: { auth: '', channel } }));
      } else if (msg.event === 'pusher_internal:subscription_succeeded') {
        if (!msg.channel?.endsWith('.v2')) return; // the chat itself is what "connected" means
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

module.exports = { connect, handle, kickParts, kickBadges, avatar, kickGet, subMonths, PUSHER, HOLD_MS };
