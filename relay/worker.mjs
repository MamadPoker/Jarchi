// Jarchi's Kick relay, a Cloudflare Worker (free plan). Kick's login needs the Kick app's secret, which can't ship
// inside Jarchi, and Kick sends a channel's events (follows) only as webhooks to one public address. This holds the
// secret and that address, so each streamer's Jarchi needs neither:
//   GET  /login     Jarchi's Connect Kick opens this: on to Kick's login page with this app's Client ID
//   GET  /callback  Kick comes back here; on to the Jarchi that asked (127.0.0.1:<port>, the port is in `state`)
//   POST /token     Jarchi's code (with its PKCE verifier) or refresh token -> Kick's tokens, the secret added here
//   POST /webhook   Kick's events: the signature is checked, then each goes to its channel's Room
//   GET  /ws        Jarchi's WebSocket: the Kick token it sends says whose channel it is, and it joins that Room
// Nothing of that is stored: an event goes to the sockets open right now, or nowhere.
//   POST /ping      Jarchi's usage ping (core/stats.js, only once its Privacy Policy is accepted): one row per install
//                   in the D1 database DB (schema.sql). No IP address or anything else about the request is kept.
// Settings (secrets): KICK_CLIENT_ID, KICK_CLIENT_SECRET. Deploy: see README.md here.
const KICK_ID = 'https://id.kick.com';
const KICK_API = 'https://api.kick.com/public/v1';
const SCOPES = 'user:read events:subscribe';
const STALE_MS = 10 * 60 * 1000; // an older event (Kick trying again much later) is dropped: a late alert is no alert

const text = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
const room = (env, userId) => env.ROOMS.get(env.ROOMS.idFromName(String(userId)));
const STATE = /^(\d{2,5})\.[\w-]{16,128}$/; // "<Jarchi's port>.<random>"

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    switch (url.pathname) {
      case '/': return text('Jarchi Kick relay: running.');
      case '/login': return login(url, env);
      case '/callback': return callback(url);
      case '/token': return req.method === 'POST' ? token(req, url, env) : text('POST only', 405);
      case '/webhook': return req.method === 'POST' ? webhook(req, env) : text('POST only', 405);
      case '/ws': return socket(req, env);
      case '/ping': return req.method === 'POST' ? ping(req, env) : text('POST only', 405);
    }
    return text('Not found', 404);
  },
};

function login(url, env) {
  const state = url.searchParams.get('state') ?? '', challenge = url.searchParams.get('challenge') ?? '';
  if (!STATE.test(state) || !/^[\w-]{43}$/.test(challenge)) return text('Bad request', 400);
  return Response.redirect(`${KICK_ID}/oauth/authorize?${new URLSearchParams({
    response_type: 'code', client_id: env.KICK_CLIENT_ID, redirect_uri: `${url.origin}/callback`, scope: SCOPES,
    code_challenge: challenge, code_challenge_method: 'S256', state,
  })}`, 302);
}

// Only ever back to this PC (127.0.0.1), so this is no open redirect. Jarchi checks the state itself.
function callback(url) {
  const port = Number(STATE.exec(url.searchParams.get('state') ?? '')?.[1]);
  if (!(port >= 1 && port <= 65535)) return text('Bad request', 400);
  return Response.redirect(`http://127.0.0.1:${port}/api/kick/callback${url.search}`, 302);
}

async function token(req, url, env) {
  const b = await req.json().catch(() => ({}));
  const grant = b.refresh_token
    ? { grant_type: 'refresh_token', refresh_token: String(b.refresh_token) }
    : { grant_type: 'authorization_code', code: String(b.code ?? ''), code_verifier: String(b.code_verifier ?? ''), redirect_uri: `${url.origin}/callback` };
  const r = await fetch(`${KICK_ID}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...grant, client_id: env.KICK_CLIENT_ID, client_secret: env.KICK_CLIENT_SECRET }),
  });
  return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json' } });
}

// Kick's public key (it can change: fetched again when a signature doesn't match, at most once a minute).
let key = { at: 0, value: null };
async function publicKey(again) {
  if (key.value && Date.now() - key.at < (again ? 60000 : 3600000)) return key.value;
  const body = await (await fetch(`${KICK_API}/public-key`)).text();
  let pem = body;
  try { pem = JSON.parse(body).data.public_key; } catch {}
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, '')), (c) => c.charCodeAt(0));
  key = { at: Date.now(), value: await crypto.subtle.importKey('spki', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']) };
  return key.value;
}

// Kick signs "<message id>.<timestamp>.<raw body>" (RSA, SHA-256), base64 in Kick-Event-Signature.
async function signed(h, body) {
  const id = h.get('kick-event-message-id'), time = h.get('kick-event-message-timestamp'), sig = h.get('kick-event-signature');
  if (!id || !time || !sig) return false;
  let bytes;
  try { bytes = Uint8Array.from(atob(sig), (c) => c.charCodeAt(0)); } catch { return false; }
  const data = new TextEncoder().encode(`${id}.${time}.${body}`);
  for (const again of [false, true]) if (await crypto.subtle.verify('RSASSA-PKCS1-v1_5', await publicKey(again), bytes, data)) return true;
  return false;
}

async function webhook(req, env) {
  const body = await req.text(), h = req.headers;
  if (!(await signed(h, body))) return text('Bad signature', 403);
  if (Math.abs(Date.now() - Date.parse(h.get('kick-event-message-timestamp'))) > STALE_MS) return text('ok'); // not again either
  let data;
  try { data = JSON.parse(body); } catch { return text('ok'); }
  const channel = data?.broadcaster?.user_id;
  if (channel) {
    await room(env, channel).fetch('https://room/event', { method: 'POST', body: JSON.stringify({
      type: h.get('kick-event-type'), version: h.get('kick-event-version'), id: h.get('kick-event-message-id'), data,
    }) });
  }
  return text('ok');
}

// Whose channel: Kick's answer for the token Jarchi sends (Authorization header), so a Jarchi gets its own channel only.
async function socket(req, env) {
  if (req.headers.get('upgrade') !== 'websocket') return text('WebSocket only', 426);
  const r = await fetch(`${KICK_API}/users`, { headers: { authorization: req.headers.get('authorization') ?? '' } });
  const me = r.ok && (await r.json().catch(() => null))?.data?.[0]?.user_id;
  if (!me) return text('Unauthorized', 401);
  return room(env, me).fetch(req);
}

// ---------- Usage pings ----------
// A ping is exactly { id, version, installed, open, kick, twitch, privacy: { version, acceptedAt } } (kick / twitch:
// { name, picture, live } or null), at most PING_BYTES; anything else is refused. Each install gets PING_MAX pings in
// PING_WINDOW_MS (Jarchi sends one every 5 minutes, plus start and quit), and at most NEW_MAX installs are new in the
// last NEW_WINDOW_MS, so made-up ids can't flood the database. Times are ISO 8601 in UTC.
const PING_BYTES = 2048, PING_MAX = 10, PING_WINDOW_MS = 10 * 60 * 1000;
const NEW_MAX = 100, NEW_WINDOW_MS = 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const exactly = (o, keys) => !!o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k));
const bool = (v) => typeof v === 'boolean';
const channelOk = (c) => c === null || (exactly(c, ['name', 'picture', 'live']) && typeof c.name === 'string' && /^[^\p{C}]{1,50}$/u.test(c.name)
  && typeof c.picture === 'string' && (c.picture === '' || /^https:\/\/\S{1,490}$/.test(c.picture)) && (c.live === null || bool(c.live)));
const pingOk = (p) => exactly(p, ['id', 'version', 'installed', 'open', 'kick', 'twitch', 'privacy']) && typeof p.id === 'string' && UUID.test(p.id)
  && typeof p.version === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,4}(-[\w.]{1,20})?$/.test(p.version) && bool(p.installed) && bool(p.open)
  && channelOk(p.kick) && channelOk(p.twitch) && exactly(p.privacy, ['version', 'acceptedAt']) && Number.isInteger(p.privacy.version)
  && p.privacy.version >= 1 && p.privacy.version <= 1000
  && (p.privacy.acceptedAt === null || (typeof p.privacy.acceptedAt === 'string' && ISO.test(p.privacy.acceptedAt) && !Number.isNaN(Date.parse(p.privacy.acceptedAt))));
// New install: first_seen = last_seen = now, unless NEW_MAX are new since ?17 already. Known one: everything but
// first_seen, unless it's over its pings in this window. Either way nothing changes then: no row changed means 429.
const UPSERT = `INSERT INTO installs (id, first_seen, last_seen, version, installed, is_open, kick_name, kick_picture, kick_live,
  twitch_name, twitch_picture, twitch_live, privacy_version, privacy_accepted_at, window_start, window_pings)
SELECT ?1, ?2, ?2, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?3, 1
WHERE EXISTS (SELECT 1 FROM installs WHERE id = ?1) OR (SELECT COUNT(*) FROM installs WHERE first_seen > ?17) < ?18
ON CONFLICT (id) DO UPDATE SET last_seen = excluded.last_seen, version = excluded.version, installed = excluded.installed,
  is_open = excluded.is_open, kick_name = excluded.kick_name, kick_picture = excluded.kick_picture, kick_live = excluded.kick_live,
  twitch_name = excluded.twitch_name, twitch_picture = excluded.twitch_picture, twitch_live = excluded.twitch_live,
  privacy_version = excluded.privacy_version, privacy_accepted_at = excluded.privacy_accepted_at,
  window_start = CASE WHEN ?3 - window_start >= ?15 THEN ?3 ELSE window_start END,
  window_pings = CASE WHEN ?3 - window_start >= ?15 THEN 1 ELSE window_pings + 1 END
WHERE ?3 - installs.window_start >= ?15 OR installs.window_pings < ?16`;

// The body as text, or null past max bytes (read no further).
async function capped(stream, max) {
  if (!stream) return '';
  const reader = stream.getReader(), dec = new TextDecoder();
  let size = 0, out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out + dec.decode();
    if ((size += value.length) > max) {
      reader.cancel().catch(() => {});
      return null;
    }
    out += dec.decode(value, { stream: true });
  }
}

async function ping(req, env) {
  if (!/^application\/json\b/i.test(req.headers.get('content-type') ?? '')) return text('JSON only', 415);
  if (Number(req.headers.get('content-length')) > PING_BYTES) return text('Too large', 413);
  const body = await capped(req.body, PING_BYTES);
  if (body === null) return text('Too large', 413);
  let p;
  try { p = JSON.parse(body); } catch { return text('Bad request', 400); }
  if (!pingOk(p)) return text('Bad request', 400);
  const now = Date.now(), bit = (v) => (v === null || v === undefined ? null : Number(v));
  const { meta } = await env.DB.prepare(UPSERT).bind(p.id, new Date(now).toISOString(), now, p.version, bit(p.installed), bit(p.open),
    p.kick?.name ?? null, p.kick?.picture ?? null, bit(p.kick?.live), p.twitch?.name ?? null, p.twitch?.picture ?? null, bit(p.twitch?.live),
    p.privacy.version, p.privacy.acceptedAt, PING_WINDOW_MS, PING_MAX, new Date(now - NEW_WINDOW_MS).toISOString(), NEW_MAX).run();
  return meta.changes ? text('ok') : text('Too many pings', 429);
}

// One channel: the Jarchi sockets open for it (usually one), handed each of its events. Hibernates between them; the
// keepalive ("ping" -> "pong") is answered without waking it.
export class Room {
  constructor(ctx) {
    this.ctx = ctx;
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(req) {
    if (req.headers.get('upgrade') === 'websocket') {
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }
    const event = await req.text();
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(event); } catch {} // one closing just now
    }
    return text('ok');
  }

  webSocketMessage() {} // Jarchi sends nothing else

  webSocketClose(ws) {
    try { ws.close(); } catch {}
  }
}
