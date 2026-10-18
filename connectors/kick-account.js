// The streamer's own Kick account, for what Kick's public chat socket doesn't tell: follows (the Follow alert). Kick's
// login needs its app's secret and Kick sends follows only to a public address (webhooks), so both go through Jarchi's
// Kick relay (relay/, a Cloudflare Worker): Connect opens Kick's login through it, it comes back to /api/kick/callback
// here, codes and refreshes are swapped for tokens there. Jarchi subscribes its own channel to follows with that login
// and keeps a WebSocket open to the relay, which hands it the channel's events (no public address here; the relay
// keeps nothing). Tokens stay in data/kick.json (never sent to the panel). Not connected: nothing here runs.
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { DATA_DIR, PORT } = require('../core/config');
const store = require('../core/store');
const { emitEvent, setConnected, logIncoming } = require('../core/events');

const FILE = path.join(DATA_DIR, 'kick.json');
// Jarchi's own relay; KICK_RELAY_URL in .env sets another (your own deploy of relay/).
const JARCHI_RELAY = 'https://jarchi-kick.thejarchi.workers.dev';
const RELAY = (process.env.KICK_RELAY_URL || JARCHI_RELAY).replace(/\/+$/, '');
const API = 'https://api.kick.com/public/v1';
const EVENTS = [{ name: 'channel.followed', version: 1 }];
const LOGIN_MS = 10 * 60 * 1000; // the Kick login page waits this long for the streamer
const QUIET_MS = 90 * 1000; // we ping every 30 s; no pong for this long means the socket is dead

const account = new EventEmitter(); // 'status'
let saved = store.load(FILE); // { access, refresh, expires, userId, login }
// state: off | waiting (Kick's login page is open) | connecting | connected.
// error: why it's off or reconnecting (expired | denied | timeout | network | relay), '' when fine.
let st = { state: saved.refresh && RELAY ? 'connecting' : 'off', error: '', uri: '' };
const status = () => ({ ...st, login: saved.refresh ? saved.login ?? '' : '' });
function set(next) {
  st = { ...st, uri: '', ...next };
  account.emit('status', status());
}
const fail = (code) => Object.assign(new Error(code), { code });
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
function keep(fields) {
  saved = { ...saved, ...fields };
  store.save(FILE, saved);
}
const keepTokens = (j) => keep({ access: j.access_token, refresh: j.refresh_token, expires: Date.now() + (Number(j.expires_in) || 3600) * 1000 });

// Every run (a login, a connection) carries the run number it started with; stop() moves on, so whatever is still
// under way from before ends quietly.
let run = 0, ws = null, retry = 0, timer = null, pending = null; // pending: the login waiting for Kick { state, verifier, my }
function stop() {
  run++;
  clearTimeout(timer);
  const s = ws;
  ws = null;
  s?.close();
}

// ---------- Login: Kick's page (OAuth with PKCE), through the relay ----------
async function login() {
  if (st.state !== 'off') return status();
  if (!RELAY) {
    set({ error: 'relay' });
    return status();
  }
  stop();
  const my = run, random = (n) => crypto.randomBytes(n).toString('base64url');
  pending = { state: `${PORT}.${random(24)}`, verifier: random(48), my };
  const challenge = crypto.createHash('sha256').update(pending.verifier).digest('base64url');
  timer = setTimeout(() => my === run && set({ state: 'off', error: 'timeout' }), LOGIN_MS);
  set({ state: 'waiting', error: '', uri: `${RELAY}/login?${new URLSearchParams({ state: pending.state, challenge })}` });
  return status();
}

// Kick (by way of the relay) sends the browser back here: ?code&state, or ?error when the streamer said no. A state
// that isn't the login waiting now (an old tab, another login, a forged link) changes nothing.
async function callback({ code, state }) {
  const p = pending;
  if (!p || p.my !== run || typeof state !== 'string' || state !== p.state) return;
  pending = null;
  clearTimeout(timer);
  if (!code) return set({ state: 'off', error: 'denied' });
  set({ state: 'connecting', error: '' });
  try {
    const res = await post(`${RELAY}/token`, { code: String(code), code_verifier: p.verifier });
    if (p.my !== run) return;
    if (!res.ok) return set({ state: 'off', error: res.status >= 500 ? 'network' : 'denied' });
    keepTokens(await res.json());
  } catch {
    return p.my === run && set({ state: 'off', error: 'network' });
  }
  if (p.my === run) start();
}

// Logged out (Disconnect, or Kick no longer takes the login): the tokens go.
function forget(error = '') {
  stop();
  pending = null;
  saved = {};
  store.save(FILE, saved);
  setConnected('kick', false);
  set({ state: 'off', error });
}

// Disconnect (also cancels a login that waits for Kick). Kick stops sending this channel's follows to the relay, and
// the login is revoked, best effort.
async function disconnect() {
  const { access, userId } = saved;
  if (access && userId) {
    try {
      const { data } = await authed(`${API}/events/subscriptions?broadcaster_user_id=${userId}`);
      const ids = data.filter((s) => EVENTS.some((e) => e.name === s.event)).map((s) => ['id', s.id]);
      if (ids.length) await authed(`${API}/events/subscriptions?${new URLSearchParams(ids)}`, { method: 'DELETE' });
    } catch {}
  }
  forget();
  if (access) await fetch(`https://id.kick.com/oauth/revoke?${new URLSearchParams({ token: access, token_hint_type: 'access_token' })}`, { method: 'POST', signal: AbortSignal.timeout(10000) }).catch(() => {});
  return status();
}

// ---------- Tokens: refreshed (through the relay) before they run out and when Kick says 401 ----------
let refreshing = null;
const refresh = () => (refreshing ??= (async () => {
  try {
    const res = await post(`${RELAY}/token`, { refresh_token: saved.refresh });
    if (res.status === 400 || res.status === 401) {
      forget('expired');
      throw fail('expired');
    }
    if (!res.ok) throw fail('network');
    keepTokens(await res.json());
  } finally {
    refreshing = null;
  }
})());

async function authed(url, init = {}, again = true) {
  if (Date.now() > saved.expires - 60000) await refresh();
  const res = await fetch(url, { ...init, headers: { authorization: `Bearer ${saved.access}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(10000) });
  if (res.status === 401 && again) {
    await refresh();
    return authed(url, init, false);
  }
  const body = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`Kick ${new URL(url).pathname} ${res.status} ${body.slice(0, 200)}`);
  return body ? JSON.parse(body) : null;
}

// The channel's follows go to the relay: subscribed once (Kick keeps it), again only if Kick dropped it.
async function subscribe() {
  const { data } = await authed(`${API}/events/subscriptions?broadcaster_user_id=${saved.userId}`);
  const missing = EVENTS.filter((e) => !data.some((s) => s.event === e.name && s.version === e.version));
  if (!missing.length) return;
  const res = await authed(`${API}/events/subscriptions`, { method: 'POST', body: JSON.stringify({ events: missing, method: 'webhook' }) });
  res?.data?.forEach((r) => r.error && console.warn(`Kick ${r.name}:`, r.error));
}

// ---------- The relay's WebSocket ----------
// Connect (at start, after the login, after the proxy setting changed); whatever ran before stops.
async function start() {
  if (!saved.refresh || !RELAY) return;
  stop();
  const my = run;
  set({ state: 'connecting', error: st.error === 'network' ? 'network' : '' });
  try {
    const me = (await authed(`${API}/users`)).data[0]; // whose channel this is
    keep({ userId: me.user_id, login: me.name });
    await subscribe();
  } catch (err) {
    if (my === run && err.code !== 'expired') later(my);
    return;
  }
  if (my === run) open(my);
}

// Lost: try again in 2 s, 4 s, ... up to a minute.
function later(my) {
  setConnected('kick', false);
  set({ state: 'connecting', error: 'network' });
  timer = setTimeout(() => my === run && start(), Math.min(60000, 2000 * 2 ** retry++));
}

function open(my) {
  // The relay asks Kick whose token this is, so it hands this socket this channel's events only.
  const s = new WebSocket(`${RELAY.replace(/^http/, 'ws')}/ws`, { headers: { authorization: `Bearer ${saved.access}` } });
  let quiet;
  const watch = () => {
    clearTimeout(quiet);
    quiet = setTimeout(() => s.close(), QUIET_MS);
  };
  s.onopen = () => {
    if (my !== run) return s.close();
    ws = s;
    retry = 0;
    watch();
    setConnected('kick', true);
    set({ state: 'connected', error: '' });
  };
  s.onmessage = (e) => {
    if (my !== run) return s.close();
    watch();
    let m;
    try { m = JSON.parse(e.data); } catch { return; } // "pong"
    handle(m.type, m.data);
  };
  s.onclose = () => {
    clearTimeout(quiet);
    if (my !== run || (ws && ws !== s)) return; // stopped, or not the socket in use
    ws = null;
    later(my);
  };
}

// One event from Kick. A follow alerts once per viewer in 6 hours (core/events key), so follow / unfollow spam alerts once.
function handle(type, d) {
  if (type !== 'channel.followed' || String(d?.broadcaster?.user_id) !== String(saved.userId)) return;
  logIncoming('kick', type, d);
  emitEvent({ platform: 'kick', type: 'follow', user: d.follower?.username, key: `kick:follow:${d.follower?.user_id}` });
}

setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send('ping'), 30000).unref();
// Every hour: the login still works (one Kick no longer takes ends it: refresh() -> forget()), and still subscribed.
setInterval(() => st.state === 'connected' && subscribe().catch(() => {}), 3600000).unref();

module.exports = { status, login, callback, disconnect, start, handle, events: account };
