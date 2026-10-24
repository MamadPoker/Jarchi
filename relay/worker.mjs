// Jarchi's Kick relay, a Cloudflare Worker (free plan). Kick's login needs the Kick app's secret, which can't ship
// inside Jarchi, and Kick sends a channel's events (follows) only as webhooks to one public address. This holds the
// secret and that address, so each streamer's Jarchi needs neither:
//   GET  /login     Jarchi's Connect Kick opens this: on to Kick's login page with this app's Client ID
//   GET  /callback  Kick comes back here; on to the Jarchi that asked (127.0.0.1:<port>, the port is in `state`)
//   POST /token     Jarchi's code (with its PKCE verifier) or refresh token -> Kick's tokens, the secret added here
//   POST /webhook   Kick's events: the signature is checked, then each goes to its channel's Room
//   GET  /ws        Jarchi's WebSocket: the Kick token it sends says whose channel it is, and it joins that Room
// Nothing of that is stored: an event goes to the sockets open right now, or nowhere. Kick tokens (and codes) only pass
// through: never stored (no Room storage, no D1, no KV), never logged (nothing here writes to the console; Workers
// Logs are off in wrangler.toml), never cached (no-store), and a Room never sees one.
//   POST /ping      Jarchi's usage ping (core/stats.js, only once its Privacy Policy is accepted): one row per install
//                   in the D1 database DB (schema.sql). No IP address or anything else about the request is kept.
//   /admin/...      Jarchi's admin app: counts, the installs, downloads (see "Admin API" below). Needs ADMIN_KEY.
// Every request is counted per day (UTC) in DB, so the admin app can show it against Cloudflare's free limit.
// Settings (secrets): KICK_CLIENT_ID, KICK_CLIENT_SECRET, ADMIN_KEY. Deploy: see README.md here.
const KICK_ID = 'https://id.kick.com';
const KICK_API = 'https://api.kick.com/public/v1';
const SCOPES = 'user:read events:subscribe';
const STALE_MS = 10 * 60 * 1000; // an older event (Kick trying again much later) is dropped: a late alert is no alert

const text = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
const room = (env, userId) => env.ROOMS.get(env.ROOMS.idFromName(String(userId)));
const STATE = /^(\d{2,5})\.[\w-]{16,128}$/; // "<Jarchi's port>.<random>"

// ponytail: one D1 row written per request, sharing D1's free 100,000 writes a day with the pings; move the count to a
// Durable Object if D1 writes get close.
const COUNT = 'INSERT INTO requests (day, count) VALUES (?1, 1) ON CONFLICT (day) DO UPDATE SET count = count + 1';

export default {
  async fetch(req, env, ctx) {
    ctx.waitUntil(env.DB.prepare(COUNT).bind(new Date().toISOString().slice(0, 10)).run().catch(() => {}));
    const url = new URL(req.url);
    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) return admin(req, url, env);
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
  return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
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
  const headers = new Headers(req.headers);
  headers.delete('authorization'); // the Room needs only the upgrade, not the token
  return room(env, me).fetch(new Request(req, { headers }));
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

// ---------- Admin API ----------
// For Jarchi's admin app. Every /admin address needs "Authorization: Bearer <ADMIN_KEY>". A source (its address, kept
// only as a hash keyed with ADMIN_KEY) with FAIL_MAX wrong tries in FAIL_MS is refused for FAIL_MS, right key or not.
//   GET    /admin/stats          installs, online now, active today (?tz= minutes east of UTC, Tehran 210; default UTC)
//                                and in 7 days, live now, installs per version, the relay's requests per day (UTC)
//   GET    /admin/installs       the installs, newest first; ?q= part of a Kick/Twitch channel name, ?limit= 1-200
//                                (50), ?offset=
//   GET    /admin/downloads      download counts per release and file, from GitHub (Jarchi-releases), cached RELEASES_MS
//   DELETE /admin/installs/<id>  one install's row (a data-deletion request)
// "Online" = open and seen in ONLINE_MS (Jarchi pings every 5 minutes); "live" = online and live on Kick or Twitch.
const FAIL_MAX = 10, FAIL_MS = 60 * 60 * 1000;
const ONLINE_MS = 10 * 60 * 1000, DAY_MS = 24 * 60 * 60 * 1000, RELEASES_MS = 10 * 60 * 1000;
const FREE_REQUESTS = 100000; // Cloudflare's free plan, a day (UTC)
const RELEASES = 'https://api.github.com/repos/MamadPoker/Jarchi-releases/releases?per_page=100';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const iso = (ms) => new Date(ms).toISOString();
const sha256 = async (s) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

// Both hashed (same length) and every byte compared, so the time taken says nothing about the key.
async function sameKey(a, b) {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// A wrong try, counted in the source's window (a new one once FAIL_MS has passed); the FAIL_MAX-th blocks it for FAIL_MS.
// (Every right-hand side reads the row as it was.)
const FAIL = `INSERT INTO admin_fails (source, window_start, fails, blocked_until) VALUES (?1, ?2, 1, 0)
ON CONFLICT (source) DO UPDATE SET
  blocked_until = CASE WHEN ?2 - window_start < ?3 AND fails + 1 >= ?4 THEN ?2 + ?3 ELSE blocked_until END,
  window_start = CASE WHEN ?2 - window_start >= ?3 THEN ?2 ELSE window_start END,
  fails = CASE WHEN ?2 - window_start >= ?3 THEN 1 ELSE fails + 1 END`;

async function admin(req, url, env) {
  const now = Date.now();
  const source = [...await sha256(`${env.ADMIN_KEY}\n${req.headers.get('cf-connecting-ip') ?? ''}`)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const seen = await env.DB.prepare('SELECT blocked_until FROM admin_fails WHERE source = ?1').bind(source).first();
  if (seen?.blocked_until > now) return text('Too many wrong keys, try again later', 429);
  const given = /^Bearer (.+)$/.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!env.ADMIN_KEY || !given || !(await sameKey(given, env.ADMIN_KEY))) {
    await env.DB.prepare(FAIL).bind(source, now, FAIL_MS, FAIL_MAX).run();
    return text('Unauthorized', 401);
  }
  const get = req.method === 'GET';
  switch (url.pathname) {
    case '/admin/stats': return get ? stats(url, env, now) : text('GET only', 405);
    case '/admin/installs': return get ? installs(url, env, now) : text('GET only', 405);
    case '/admin/downloads': return get ? downloads() : text('GET only', 405);
  }
  const one = /^\/admin\/installs\/([^/]+)$/.exec(url.pathname)?.[1];
  if (one) return req.method === 'DELETE' ? remove(env, one) : text('DELETE only', 405);
  return text('Not found', 404);
}

const COUNTS = `SELECT COUNT(*) AS installs,
  COUNT(*) FILTER (WHERE is_open = 1 AND last_seen > ?1) AS online,
  COUNT(*) FILTER (WHERE last_seen >= ?2) AS activeToday,
  COUNT(*) FILTER (WHERE last_seen > ?3) AS active7Days,
  COUNT(*) FILTER (WHERE is_open = 1 AND last_seen > ?1 AND (kick_live = 1 OR twitch_live = 1)) AS live
FROM installs`;

async function stats(url, env, now) {
  const tz = Number(url.searchParams.get('tz') ?? 0);
  if (!Number.isInteger(tz) || Math.abs(tz) > 14 * 60) return text('Bad tz', 400);
  const today = Math.floor((now + tz * 60000) / DAY_MS) * DAY_MS - tz * 60000; // midnight there
  const [counts, versions, days] = await Promise.all([
    env.DB.prepare(COUNTS).bind(iso(now - ONLINE_MS), iso(today), iso(now - 7 * DAY_MS)).first(),
    env.DB.prepare('SELECT version, COUNT(*) AS installs FROM installs GROUP BY version ORDER BY installs DESC, version DESC').all(),
    env.DB.prepare('SELECT day, count FROM requests ORDER BY day DESC LIMIT 30').all(),
  ]);
  return json({ ...counts, versions: versions.results, requests: { limit: FREE_REQUESTS, days: days.results } });
}

// Shaped like a ping: { id, version, installed, open, kick, twitch, privacy } plus online, live, firstSeen, lastSeen.
const channel = (name, picture, live) => (name === null ? null : { name, picture, live: live === null ? null : live === 1 });
const LIST = `SELECT * FROM installs WHERE ?1 = '' OR kick_name LIKE ?2 ESCAPE '\\' OR twitch_name LIKE ?2 ESCAPE '\\'`;

async function installs(url, env, now) {
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 50), like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  const limit = Math.min(200, Math.max(1, Number.parseInt(url.searchParams.get('limit'), 10) || 50));
  const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset'), 10) || 0);
  const [total, rows] = await Promise.all([
    env.DB.prepare(LIST.replace('*', 'COUNT(*) AS n')).bind(q, like).first(),
    env.DB.prepare(`${LIST} ORDER BY first_seen DESC, id LIMIT ?3 OFFSET ?4`).bind(q, like, limit, offset).all(),
  ]);
  const since = iso(now - ONLINE_MS);
  return json({ total: total.n, limit, offset, installs: rows.results.map((r) => {
    const online = r.is_open === 1 && r.last_seen > since;
    return {
      id: r.id, version: r.version, installed: r.installed === 1, open: r.is_open === 1, online,
      live: online && (r.kick_live === 1 || r.twitch_live === 1),
      kick: channel(r.kick_name, r.kick_picture, r.kick_live), twitch: channel(r.twitch_name, r.twitch_picture, r.twitch_live),
      firstSeen: r.first_seen, lastSeen: r.last_seen, privacy: { version: r.privacy_version, acceptedAt: r.privacy_accepted_at },
    };
  }) });
}

// GitHub's answer, kept in this isolate (like Kick's public key); when GitHub fails, the last one is served again.
let releases = { at: 0, value: null };
async function downloads() {
  if (Date.now() - releases.at >= RELEASES_MS) {
    const r = await fetch(RELEASES, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'jarchi-relay' } }).catch(() => null);
    const list = r?.ok ? await r.json().catch(() => null) : null;
    if (Array.isArray(list)) {
      releases = { at: Date.now(), value: list.map((rel) => ({
        tag: rel.tag_name, name: rel.name, publishedAt: rel.published_at, prerelease: rel.prerelease,
        downloads: rel.assets.reduce((n, a) => n + a.download_count, 0),
        files: rel.assets.map((a) => ({ name: a.name, size: a.size, downloads: a.download_count })),
      })) };
    } else if (!releases.value) return text(`GitHub: ${r ? r.status : 'unreachable'}`, 502);
  }
  return json({ fetchedAt: iso(releases.at), downloads: releases.value.reduce((n, rel) => n + rel.downloads, 0), releases: releases.value });
}

async function remove(env, id) {
  const { meta } = await env.DB.prepare('DELETE FROM installs WHERE id = ?1').bind(id).run();
  return meta.changes ? json({ deleted: id }) : text('Not found', 404);
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
