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
//   /support/...    Jarchi's Support page: an install's tickets (see "Support tickets" below), screenshots in KV SHOTS.
//   /admin/...      Jarchi's admin app: counts, the installs, downloads, tickets (see "Admin API" below). Needs ADMIN_KEY.
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
    if (url.pathname.startsWith('/support/')) return support(req, url, env);
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
// { name, picture, live } or null), plus, from Jarchi 1.0.2 on (1.0.1 sends none: still taken),
// diag: { kick, kickReason, twitch, twitchReason, proxy, vpn } (kick / twitch: never | ok | failed, the reason network |
// denied | other when failed, else null; proxy: off | auto | manual; vpn: true / false / null), at most PING_BYTES;
// anything else is refused. Each install gets PING_MAX pings in
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
const PING_KEYS = ['id', 'version', 'installed', 'open', 'kick', 'twitch', 'privacy'];
const connectOk = (s, why) => ['never', 'ok', 'failed'].includes(s) && (s === 'failed' ? ['network', 'denied', 'other'].includes(why) : why === null);
const diagOk = (d) => exactly(d, ['kick', 'kickReason', 'twitch', 'twitchReason', 'proxy', 'vpn']) && connectOk(d.kick, d.kickReason)
  && connectOk(d.twitch, d.twitchReason) && ['off', 'auto', 'manual'].includes(d.proxy) && (d.vpn === null || bool(d.vpn));
const pingOk = (p) => (exactly(p, PING_KEYS) || (exactly(p, [...PING_KEYS, 'diag']) && diagOk(p.diag))) && typeof p.id === 'string' && UUID.test(p.id)
  && typeof p.version === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,4}(-[\w.]{1,20})?$/.test(p.version) && bool(p.installed) && bool(p.open)
  && channelOk(p.kick) && channelOk(p.twitch) && exactly(p.privacy, ['version', 'acceptedAt']) && Number.isInteger(p.privacy.version)
  && p.privacy.version >= 1 && p.privacy.version <= 1000
  && (p.privacy.acceptedAt === null || (typeof p.privacy.acceptedAt === 'string' && ISO.test(p.privacy.acceptedAt) && !Number.isNaN(Date.parse(p.privacy.acceptedAt))));
// New install: first_seen = last_seen = now, unless NEW_MAX are new since ?17 already. Known one: everything but
// first_seen, unless it's over its pings in this window. Either way nothing changes then: no row changed means 429.
// A ping without diag leaves its columns NULL.
const UPSERT = `INSERT INTO installs (id, first_seen, last_seen, version, installed, is_open, kick_name, kick_picture, kick_live,
  twitch_name, twitch_picture, twitch_live, privacy_version, privacy_accepted_at, window_start, window_pings,
  kick_connect, kick_reason, twitch_connect, twitch_reason, proxy_mode, vpn_found)
SELECT ?1, ?2, ?2, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?3, 1, ?19, ?20, ?21, ?22, ?23, ?24
WHERE EXISTS (SELECT 1 FROM installs WHERE id = ?1) OR (SELECT COUNT(*) FROM installs WHERE first_seen > ?17) < ?18
ON CONFLICT (id) DO UPDATE SET last_seen = excluded.last_seen, version = excluded.version, installed = excluded.installed,
  is_open = excluded.is_open, kick_name = excluded.kick_name, kick_picture = excluded.kick_picture, kick_live = excluded.kick_live,
  twitch_name = excluded.twitch_name, twitch_picture = excluded.twitch_picture, twitch_live = excluded.twitch_live,
  privacy_version = excluded.privacy_version, privacy_accepted_at = excluded.privacy_accepted_at,
  kick_connect = excluded.kick_connect, kick_reason = excluded.kick_reason, twitch_connect = excluded.twitch_connect,
  twitch_reason = excluded.twitch_reason, proxy_mode = excluded.proxy_mode, vpn_found = excluded.vpn_found,
  window_start = CASE WHEN ?3 - window_start >= ?15 THEN ?3 ELSE window_start END,
  window_pings = CASE WHEN ?3 - window_start >= ?15 THEN 1 ELSE window_pings + 1 END
WHERE ?3 - installs.window_start >= ?15 OR installs.window_pings < ?16`;

// The body's bytes, or null past max bytes (read no further).
async function capped(req, max) {
  if (Number(req.headers.get('content-length')) > max) return null;
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader(), parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if ((size += value.length) > max) {
      reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  parts.reduce((at, p) => (out.set(p, at), at + p.length), 0);
  return out;
}

async function ping(req, env) {
  if (!/^application\/json\b/i.test(req.headers.get('content-type') ?? '')) return text('JSON only', 415);
  const body = await capped(req, PING_BYTES);
  if (body === null) return text('Too large', 413);
  let p;
  try { p = JSON.parse(new TextDecoder().decode(body)); } catch { return text('Bad request', 400); }
  if (!pingOk(p)) return text('Bad request', 400);
  const now = Date.now(), bit = (v) => (v === null || v === undefined ? null : Number(v)), d = p.diag;
  const { meta } = await env.DB.prepare(UPSERT).bind(p.id, new Date(now).toISOString(), now, p.version, bit(p.installed), bit(p.open),
    p.kick?.name ?? null, p.kick?.picture ?? null, bit(p.kick?.live), p.twitch?.name ?? null, p.twitch?.picture ?? null, bit(p.twitch?.live),
    p.privacy.version, p.privacy.acceptedAt, PING_WINDOW_MS, PING_MAX, new Date(now - NEW_WINDOW_MS).toISOString(), NEW_MAX,
    d?.kick ?? null, d?.kickReason ?? null, d?.twitch ?? null, d?.twitchReason ?? null, d?.proxy ?? null, bit(d?.vpn)).run();
  return meta.changes ? text('ok') : text('Too many pings', 429);
}

// ---------- Admin API ----------
// For Jarchi's admin app. Every /admin address needs "Authorization: Bearer <ADMIN_KEY>". A source (its address, kept
// only as a hash keyed with ADMIN_KEY) with FAIL_MAX wrong tries in FAIL_MS is refused for FAIL_MS, right key or not.
//   GET    /admin/stats          installs (all, installed app, dev runs, installed app new in 7 days), online now, active
//                                today (?tz= minutes east of UTC, Tehran 210; default UTC) and in 7 days, live now,
//                                installs per version, the relay's requests per day (UTC)
//   GET    /admin/installs       the installs, newest first; ?q= part of a Kick/Twitch channel name, ?limit= 1-200
//                                (50), ?offset=
//   GET    /admin/downloads      download counts per release and file, from GitHub (REPOS), cached RELEASES_MS
//   DELETE /admin/installs/<id>  one install's row (a data-deletion request)
//   GET    /admin/tickets        every support ticket, last changed first (?status=, ?category=), each with unread (a
//                                message from the install the admin hasn't opened), and unread: how many tickets have one
//   GET    /admin/tickets/<id>   one, with its messages (opening it marks them read); its screenshots at
//                                /admin/tickets/<id>/images/<name>
//   POST   /admin/tickets/<id>/messages  a reply (a form, like the install's messages below)
//   PATCH  /admin/tickets/<id>   { status: open | progress | closed }
//   DELETE /admin/tickets/<id>   it, its messages and its screenshots
// "Online" = open and seen in ONLINE_MS (Jarchi pings every 5 minutes); "live" = online and live on Kick or Twitch.
const FAIL_MAX = 10, FAIL_MS = 60 * 60 * 1000;
const ONLINE_MS = 10 * 60 * 1000, DAY_MS = 24 * 60 * 60 * 1000, RELEASES_MS = 10 * 60 * 1000;
const FREE_REQUESTS = 100000; // Cloudflare's free plan, a day (UTC)
const REPOS = ['MamadPoker/Jarchi', 'MamadPoker/Jarchi-releases']; // v1.0.2 on; v1.0.2 and before
// Only the installer is a download: latest.yml and the .blockmap are fetched by Jarchi's own update check.
const INSTALLER = 'Jarchi-Setup.exe';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const iso = (ms) => new Date(ms).toISOString();
const sha256 = async (s) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

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
  const source = hex(await sha256(`${env.ADMIN_KEY}\n${req.headers.get('cf-connecting-ip') ?? ''}`));
  const seen = await env.DB.prepare('SELECT blocked_until FROM admin_fails WHERE source = ?1').bind(source).first();
  if (seen?.blocked_until > now) return text('Too many wrong keys, try again later', 429);
  const given = /^Bearer (.+)$/.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!env.ADMIN_KEY || !given || !(await sameKey(given, env.ADMIN_KEY))) {
    await env.DB.prepare(FAIL).bind(source, now, FAIL_MS, FAIL_MAX).run();
    return text('Unauthorized', 401);
  }
  if (url.pathname.startsWith('/admin/tickets')) return tickets(req, url, env, null);
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
  COUNT(*) FILTER (WHERE installed = 1) AS installsInstalled,
  COUNT(*) FILTER (WHERE installed = 0) AS installsDev,
  COUNT(*) FILTER (WHERE installed = 1 AND first_seen > ?3) AS installsNew7Days,
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

// Shaped like a ping: { id, version, installed, open, kick, twitch, privacy, diag } (diag null: its last ping had none)
// plus online, live, firstSeen, lastSeen.
const channel = (name, picture, live) => (name === null ? null : { name, picture, live: live === null ? null : live === 1 });
const diag = (r) => (r.kick_connect === null ? null : { kick: r.kick_connect, kickReason: r.kick_reason, twitch: r.twitch_connect,
  twitchReason: r.twitch_reason, proxy: r.proxy_mode, vpn: r.vpn_found === null ? null : r.vpn_found === 1 });
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
      firstSeen: r.first_seen, lastSeen: r.last_seen, privacy: { version: r.privacy_version, acceptedAt: r.privacy_accepted_at }, diag: diag(r),
    };
  }) });
}

// One repo's releases; downloads: the installer's.
async function github(repo) {
  const r = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100`,
    { headers: { accept: 'application/vnd.github+json', 'user-agent': 'jarchi-relay' } }).catch(() => null);
  const list = r?.ok ? await r.json().catch(() => null) : null;
  if (!Array.isArray(list)) throw new Error(`GitHub (${repo}): ${r ? r.status : 'unreachable'}`);
  return list.map((rel) => ({
    repo, tag: rel.tag_name, name: rel.name, publishedAt: rel.published_at, prerelease: rel.prerelease,
    downloads: rel.assets.filter((a) => a.name === INSTALLER).reduce((n, a) => n + a.download_count, 0),
    files: rel.assets.map((a) => ({ name: a.name, size: a.size, downloads: a.download_count })),
  }));
}

// Every repo's answer, kept in this isolate (like Kick's public key); when one fails, the last full one is served again
// (never a part: its sum would be short).
let releases = { at: 0, value: null };
async function downloads() {
  if (Date.now() - releases.at >= RELEASES_MS) {
    try {
      releases = { at: Date.now(), value: (await Promise.all(REPOS.map(github))).flat() };
    } catch (e) {
      if (!releases.value) return text(e.message, 502);
    }
  }
  return json({ fetchedAt: iso(releases.at), downloads: releases.value.reduce((n, rel) => n + rel.downloads, 0), releases: releases.value });
}

async function remove(env, id) {
  const { meta } = await env.DB.prepare('DELETE FROM installs WHERE id = ?1').bind(id).run();
  return meta.changes ? json({ deleted: id }) : text('Not found', 404);
}

// ---------- Support tickets ----------
// Jarchi's Support page (core/support.js, once its Privacy Policy is accepted). An install says who it is with
// "X-Jarchi-Install: <its install id>" and "Authorization: Bearer <its ticket token>" (64 hex digits, random, made by
// that Jarchi for its first ticket and never shown). A ticket is read only with the token it was made with, and an
// install keeps the token of its first ticket (another one makes no ticket). Only installs that have pinged make
// tickets, so made-up ids meet the new-install cap first; a ticket keeps the Kick / Twitch channels of that last ping.
//   GET  /support/tickets                     my tickets, last changed first, each with unread (an admin reply not opened yet)
//   POST /support/tickets                     a new one: a form with category, subject, message and up to 3 "image"
//   GET  /support/tickets/<id>                one, with its messages (opening it marks the admin's replies read)
//   POST /support/tickets/<id>/messages       a message (form: message and/or images), not on a closed ticket
//   PATCH /support/tickets/<id>               { hidden: true }: off my list, a closed ticket only (nothing deleted: the
//                                             admin still sees it; reopening it puts it back on the list)
//   GET  /support/tickets/<id>/images/<name>  one of its screenshots
// At most TICKETS_MAX new tickets an install in a day and MESSAGES_MAX messages (a new ticket's too) in an hour.
// Screenshots: up to SHOTS_MAX a message, each a PNG, JPG or WebP by its bytes (whatever its name says), at most
// SHOT_BYTES, in KV SHOTS as "<ticket id>/<name>". Times are ISO 8601 in UTC. Errors are JSON { error }: unauthorized,
// unknown_install, not_found, method, bad_request, too_large, bad_image, image_too_large, too_many_images, closed,
// not_closed, ticket_limit, message_limit, storage (KV refused it).
// ponytail: KV's free plan takes 1,000 writes a day (one per screenshot) and 1 GB in all; past that its puts fail
// ("storage") until the next day / until old tickets are deleted in the admin app.
const CATEGORIES = ['bug', 'suggestion', 'question', 'data'], STATUSES = ['open', 'progress', 'closed'];
const TICKETS_MAX = 5, MESSAGES_MAX = 30, HOUR_MS = 60 * 60 * 1000;
const SUBJECT_MAX = 120, TEXT_MAX = 5000, SHOTS_MAX = 3, SHOT_BYTES = 2 * 1024 * 1024;
const FORM_BYTES = SHOTS_MAX * SHOT_BYTES + 64 * 1024; // the screenshots, the text and the form's own lines
const TICKET_PATH = /^\/(?:support|admin)\/tickets(?:\/([0-9A-F]{8})(?:\/(messages)|\/images\/([0-9a-f]{32}\.(?:png|jpg|webp)))?)?$/;
const SHOT_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
const MAGIC = { // each type's first bytes (null: any)
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  jpg: [0xff, 0xd8, 0xff],
  webp: [0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50],
};
const shotType = (b) => Object.keys(MAGIC).find((t) => b.length > MAGIC[t].length && MAGIC[t].every((x, i) => x === null || b[i] === x));
const fail = (error, status = 400) => json({ error }, status);
const random = (bytes) => hex(crypto.getRandomValues(new Uint8Array(bytes)));

async function support(req, url, env) {
  const install = req.headers.get('x-jarchi-install') ?? '', token = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!UUID.test(install) || !token) return fail('unauthorized', 401);
  return tickets(req, url, env, { install, token: hex(await sha256(token)) });
}

// Both sides' addresses. me: the asking install { install, token (its SHA-256) }, or null: the admin.
async function tickets(req, url, env, me) {
  const m = TICKET_PATH.exec(url.pathname), side = me ? 'user' : 'admin', method = req.method;
  if (!m) return fail('not_found', 404);
  const [, id, messages, shot] = m;
  if (!id) {
    if (method === 'GET') return me ? mine(env, me) : all(url, env);
    return method === 'POST' && me ? create(req, env, me) : fail('method', 405);
  }
  const t = await env.DB.prepare(`SELECT * FROM tickets WHERE id = ?1${me ? ' AND install_id = ?2 AND token_hash = ?3' : ''}`)
    .bind(...(me ? [id, me.install, me.token] : [id])).first();
  if (!t) return fail('not_found', 404);
  if (messages) return method === 'POST' ? reply(req, env, t, side) : fail('method', 405);
  if (shot) return method === 'GET' ? image(env, id, shot) : fail('method', 405);
  if (method === 'GET') return thread(env, id, side);
  if (method === 'PATCH') return me ? hide(req, env, t) : setStatus(req, env, id);
  if (!me && method === 'DELETE') return deleteTicket(env, id);
  return fail('method', 405);
}

// A ticket as a side sees it (the admin also sees whose it is). A list row also has its messages' count and unread: a
// message from the other side newer than this side last opened it.
const UNREAD = (side) => `EXISTS (SELECT 1 FROM ticket_messages m WHERE m.ticket_id = t.id AND m.author != '${side}' AND m.created_at > COALESCE(t.${side}_read_at, ''))`;
const TICKET_LIST = (side) => `SELECT t.*, (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id) AS messages, ${UNREAD(side)} AS unread FROM tickets t`;
const ticketOf = (r, side) => ({
  id: r.id, category: r.category, subject: r.subject, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at,
  ...(side === 'admin' && { installId: r.install_id, kick: r.kick_name, twitch: r.twitch_name, hiddenByUser: !!r.hidden_by_user_at, hiddenByUserAt: r.hidden_by_user_at }),
  ...('unread' in r && { messages: r.messages, unread: r.unread === 1 }),
});

async function mine(env, me) {
  const { results } = await env.DB.prepare(`${TICKET_LIST('user')} WHERE t.install_id = ?1 AND t.token_hash = ?2 AND t.hidden_by_user_at IS NULL ORDER BY t.updated_at DESC, t.id`)
    .bind(me.install, me.token).all();
  return json(results.map((r) => ticketOf(r, 'user')));
}

// ponytail: every ticket in one answer; page it (?limit, ?offset like /admin/installs) if there are ever thousands.
async function all(url, env) {
  const status = url.searchParams.get('status') || null, category = url.searchParams.get('category') || null;
  if ((status && !STATUSES.includes(status)) || (category && !CATEGORIES.includes(category))) return fail('bad_request');
  const [{ results }, unread] = await Promise.all([
    env.DB.prepare(`${TICKET_LIST('admin')} WHERE (?1 IS NULL OR t.status = ?1) AND (?2 IS NULL OR t.category = ?2) ORDER BY t.updated_at DESC, t.id`).bind(status, category).all(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM tickets t WHERE ${UNREAD('admin')}`).first(),
  ]);
  return json({ unread: unread.n, tickets: results.map((r) => ticketOf(r, 'admin')) });
}

// An install's counts for its limits. known: it has pinged; taken: its tickets have another token.
const LIMITS = `SELECT EXISTS (SELECT 1 FROM installs WHERE id = ?1) AS known,
  EXISTS (SELECT 1 FROM tickets WHERE install_id = ?1 AND token_hash != ?2) AS taken,
  (SELECT COUNT(*) FROM tickets WHERE install_id = ?1 AND created_at > ?3) AS tickets,
  (SELECT COUNT(*) FROM ticket_messages m JOIN tickets t ON t.id = m.ticket_id WHERE t.install_id = ?1 AND m.author = 'user' AND m.created_at > ?4) AS messages`;
const limits = (env, install, token, now) => env.DB.prepare(LIMITS).bind(install, token, iso(now - DAY_MS), iso(now - HOUR_MS)).first();
// A new ticket, with the install's channels from its last ping.
const NEW_TICKET = `INSERT INTO tickets (id, install_id, token_hash, kick_name, twitch_name, category, subject, status, created_at, updated_at)
SELECT ?1, id, ?3, kick_name, twitch_name, ?4, ?5, 'open', ?6, ?6 FROM installs WHERE id = ?2`;
const NEW_MESSAGE = 'INSERT INTO ticket_messages (ticket_id, author, body, images, created_at) VALUES (?1, ?2, ?3, ?4, ?5)';

async function create(req, env, me) {
  const now = Date.now(), l = await limits(env, me.install, me.token, now);
  if (!l.known) return fail('unknown_install', 403);
  if (l.taken) return fail('unauthorized', 401);
  if (l.tickets >= TICKETS_MAX) return fail('ticket_limit', 429);
  if (l.messages >= MESSAGES_MAX) return fail('message_limit', 429);
  const f = await form(req, ['category', 'subject', 'message']);
  if (f instanceof Response) return f;
  const subject = (f.subject ?? '').replace(/\s+/g, ' ');
  if (!CATEGORIES.includes(f.category) || !subject || subject.length > SUBJECT_MAX || !f.message || f.message.length > TEXT_MAX) return fail('bad_request');
  const id = random(4).toUpperCase();
  const first = env.DB.prepare(NEW_TICKET).bind(id, me.install, me.token, f.category, subject, iso(now));
  return (await save(env, id, 'user', f.message, f.shots, [first])) ?? thread(env, id, 'user');
}

async function reply(req, env, t, side) {
  if (side === 'user') {
    if (t.status === 'closed') return fail('closed', 409);
    if ((await limits(env, t.install_id, t.token_hash, Date.now())).messages >= MESSAGES_MAX) return fail('message_limit', 429);
  }
  const f = await form(req, ['message']);
  if (f instanceof Response) return f;
  const body = f.message ?? '';
  if (body.length > TEXT_MAX || (!body && !f.shots.length)) return fail('bad_request');
  return (await save(env, t.id, side, body, f.shots)) ?? thread(env, t.id, side);
}

// A form from either side: the text fields named (each once; trimmed, line ends \n) and the screenshots ("image");
// anything else is refused. -> { <field>: text, shots: [{ bytes, ext }] }, or the error's Response.
async function form(req, names) {
  const type = req.headers.get('content-type') ?? '';
  if (!/^multipart\/form-data\s*;/i.test(type)) return fail('bad_request', 415);
  const body = await capped(req, FORM_BYTES);
  if (body === null) return fail('too_large', 413);
  let data;
  try { data = await new Response(body, { headers: { 'content-type': type } }).formData(); } catch { return fail('bad_request'); }
  const f = { shots: [] };
  for (const [k, v] of data) {
    if (k === 'image' && typeof v !== 'string') {
      const bytes = new Uint8Array(await v.arrayBuffer()), ext = shotType(bytes);
      if (bytes.length > SHOT_BYTES) return fail('image_too_large', 413);
      if (!ext) return fail('bad_image');
      f.shots.push({ bytes, ext });
    } else if (names.includes(k) && typeof v === 'string' && !(k in f)) f[k] = v.replace(/\r\n?/g, '\n').trim();
    else return fail('bad_request');
  }
  return f.shots.length > SHOTS_MAX ? fail('too_many_images') : f;
}

// A message: its screenshots into KV first ("<ticket>/<random>.<ext>"), so a message never names one that isn't there,
// then `first` (a new ticket's row) and the message together. Nothing is kept when either fails. -> null, or the
// error's Response.
async function save(env, id, author, body, shots, first = []) {
  const names = shots.map((s) => `${random(16)}.${s.ext}`), at = iso(Date.now());
  try {
    await Promise.all(shots.map((s, i) => env.SHOTS.put(`${id}/${names[i]}`, s.bytes)));
  } catch {
    await dropShots(env, id, names);
    return fail('storage', 503);
  }
  await env.DB.batch([...first, env.DB.prepare(NEW_MESSAGE).bind(id, author, body, JSON.stringify(names), at),
    env.DB.prepare('UPDATE tickets SET updated_at = ?2 WHERE id = ?1').bind(id, at)]).catch(async (err) => {
    await dropShots(env, id, names);
    throw err;
  });
  return null;
}
const dropShots = (env, id, names) => Promise.all(names.map((n) => env.SHOTS.delete(`${id}/${n}`).catch(() => {})));

// One ticket and its messages (oldest first), for one side; opening it marks the other side's messages read.
async function thread(env, id, side) {
  await env.DB.prepare(`UPDATE tickets SET ${side}_read_at = ?2 WHERE id = ?1`).bind(id, iso(Date.now())).run();
  const [t, { results }] = await Promise.all([
    env.DB.prepare('SELECT * FROM tickets WHERE id = ?1').bind(id).first(),
    env.DB.prepare('SELECT author, body, images, created_at FROM ticket_messages WHERE ticket_id = ?1 ORDER BY id').bind(id).all(),
  ]);
  return json({ ...ticketOf(t, side), messages: results.map((m) => ({ author: m.author, text: m.body, images: JSON.parse(m.images), at: m.created_at })) });
}

async function image(env, id, name) {
  const body = await env.SHOTS.get(`${id}/${name}`, 'arrayBuffer');
  if (!body) return fail('not_found', 404);
  return new Response(body, { headers: {
    'content-type': SHOT_TYPES[name.split('.')[1]], 'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=31536000, immutable',
  } });
}

async function setStatus(req, env, id) {
  const b = await req.json().catch(() => null);
  if (!exactly(b, ['status']) || !STATUSES.includes(b.status)) return fail('bad_request');
  // Hidden only while closed: reopened, it's back on the install's list.
  await env.DB.prepare("UPDATE tickets SET status = ?2, updated_at = ?3, hidden_by_user_at = CASE WHEN ?2 = 'closed' THEN hidden_by_user_at END WHERE id = ?1")
    .bind(id, b.status, iso(Date.now())).run();
  return thread(env, id, 'admin');
}

// The install takes a closed ticket off its list (first time kept). Nothing is deleted: the admin still sees it.
async function hide(req, env, t) {
  const b = await req.json().catch(() => null);
  if (!exactly(b, ['hidden']) || b.hidden !== true) return fail('bad_request');
  if (t.status !== 'closed') return fail('not_closed', 409);
  await env.DB.prepare('UPDATE tickets SET hidden_by_user_at = COALESCE(hidden_by_user_at, ?2) WHERE id = ?1').bind(t.id, iso(Date.now())).run();
  return json({ hidden: t.id });
}

async function deleteTicket(env, id) {
  const { results } = await env.DB.prepare('SELECT images FROM ticket_messages WHERE ticket_id = ?1').bind(id).all();
  await dropShots(env, id, results.flatMap((m) => JSON.parse(m.images)));
  await env.DB.batch([env.DB.prepare('DELETE FROM ticket_messages WHERE ticket_id = ?1').bind(id), env.DB.prepare('DELETE FROM tickets WHERE id = ?1').bind(id)]);
  return json({ deleted: id });
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
