// The streamer's own Twitch account, for what anonymous chat can't see: follows (the Follow alert) and the channel's
// goals (Home's Twitch tab, "Sync from Twitch"). Login: Twitch's Device Code Flow with the Client ID of a "Public" Twitch
// app (no secret, no redirect page): Twitch gives a short code, the streamer approves it at twitch.tv/activate.
// Tokens stay in data/twitch.json (never sent to the panel) and are refreshed by themselves. Events come over EventSub's
// WebSocket, so Jarchi needs no public address. Not connected: nothing here runs.
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { DATA_DIR } = require('../core/config');
const store = require('../core/store');
const { emitEvent, setConnected, logIncoming } = require('../core/events');
const net = require('../core/net');

const FILE = path.join(DATA_DIR, 'twitch.json');
const SECRET = ['access', 'refresh']; // sealed in the file (core/secrets.js)
const ID = 'https://id.twitch.tv/oauth2';
const HELIX = 'https://api.twitch.tv/helix';
const EVENTSUB = 'wss://eventsub.wss.twitch.tv/ws';
// Follows and goals now; subs and bits are asked for already, so a later step needs no new login.
const SCOPES = 'moderator:read:followers channel:read:goals channel:read:subscriptions bits:read';
// Jarchi's own Twitch app (Public: its Client ID is no secret), so nobody has to make one. Another one only by hand:
// "clientId" in data/twitch.json, while disconnected (a login belongs to the app it was made with). Not in the panel.
const CLIENT_ID = '6z5ycye2mjhj10jk1jkwkelft0l7p3';
const SUBS = [['channel.follow', '2'], ['channel.goal.begin', '1'], ['channel.goal.progress', '1'], ['channel.goal.end', '1']];

const account = new EventEmitter(); // 'status'
let saved = store.load(FILE, SECRET); // { clientId (own app, else none), access, refresh, expires, userId, login }
const clientId = () => saved.clientId || CLIENT_ID;
// state: off | waiting (Twitch's code is on screen) | connecting | connected.
// error: why it's off or reconnecting (expired | denied | timeout | client | network), '' when fine.
let st = { state: saved.refresh ? 'connecting' : 'off', error: '', code: '', uri: '' };
const goals = new Map(); // Twitch goal id -> { id, type, description, current, target }
// name / picture: the account's display name and picture, for the profile chip (Edit profile).
const status = () => ({
  ...st, login: saved.refresh ? saved.login ?? '' : '', goals: [...goals.values()],
  name: saved.refresh ? saved.name || saved.login || '' : '', picture: saved.refresh ? saved.picture ?? '' : '',
});
function set(next) {
  st = { ...st, code: '', uri: '', ...next };
  account.emit('status', status());
}
const fail = (code) => Object.assign(new Error(code), { code });
const form = (url, fields) => fetch(url, { method: 'POST', body: new URLSearchParams(fields), signal: AbortSignal.timeout(10000) });
function keep(fields) {
  saved = { ...saved, ...fields };
  store.save(FILE, saved, SECRET);
}
const keepTokens = (j) => keep({ access: j.access_token, refresh: j.refresh_token, expires: Date.now() + j.expires_in * 1000 });

// Every run (a login, a connection) carries the run number it started with; stop() moves on, so whatever is still
// under way from before ends quietly.
let run = 0, ws = null, retry = 0, timer = null;
function stop() {
  run++;
  clearTimeout(timer);
  const s = ws;
  ws = null;
  s?.close();
}

// ---------- Login: Device Code Flow ----------
async function login() {
  if (st.state !== 'off') return status();
  stop();
  const my = run, client = clientId();
  let res;
  try {
    res = await form(`${ID}/device`, { client_id: client, scopes: SCOPES });
  } catch {
    set({ state: 'off', error: 'network' });
    return status();
  }
  if (!res.ok) { // an unknown Client ID
    set({ state: 'off', error: 'client' });
    return status();
  }
  const d = await res.json();
  const until = Date.now() + d.expires_in * 1000;
  const poll = async () => {
    if (my !== run) return;
    if (Date.now() > until) return set({ state: 'off', error: 'timeout' });
    let ok = false, j = { message: 'authorization_pending' };
    try {
      const r = await form(`${ID}/token`, { client_id: client, scopes: SCOPES, device_code: d.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
      [ok, j] = [r.ok, await r.json()];
    } catch {} // a network hiccup: ask again
    if (my !== run) return;
    if (ok) {
      keepTokens(j);
      return start();
    }
    if (/pending|slow_down/.test(j.message)) timer = setTimeout(poll, d.interval * 1000);
    else set({ state: 'off', error: /client/i.test(j.message) ? 'client' : 'denied' }); // denied, or not a Public app
  };
  timer = setTimeout(poll, d.interval * 1000);
  // Open Twitch: Twitch's page with the code already in it (its verification_uri, activate?public=true&device-code=...),
  // so nothing is typed. Anything but twitch.tv: its activate page; either way with the code, if it isn't there.
  const uri = new URL(/^https:\/\/(www\.)?twitch\.tv\//.test(d.verification_uri) ? d.verification_uri : 'https://www.twitch.tv/activate?public=true');
  if (!uri.searchParams.get('device-code')) uri.searchParams.set('device-code', d.user_code);
  set({ state: 'waiting', error: '', code: d.user_code, uri: uri.href });
  return status();
}

// Logged out (Disconnect, or Twitch no longer takes the login): the tokens go, the Client ID stays.
function forget(error = '') {
  stop();
  saved = { clientId: saved.clientId };
  store.save(FILE, saved, SECRET);
  goals.clear();
  setConnected('twitch', false);
  set({ state: 'off', error });
}

// Disconnect (also cancels a login that waits for its code). Twitch is told too, best effort.
async function disconnect() {
  const { access } = saved, client = clientId();
  forget();
  if (access) await form(`${ID}/revoke`, { client_id: client, token: access }).catch(() => {});
  return status();
}

// ---------- Tokens: refreshed before they run out (4 hours) and when Twitch says 401 ----------
// A Public app's refresh token works once, so one refresh at a time. Unused for 30 days, it's gone: connect again.
let refreshing = null;
const refresh = () => (refreshing ??= (async () => {
  try {
    const res = await form(`${ID}/token`, { client_id: clientId(), grant_type: 'refresh_token', refresh_token: saved.refresh });
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
  const res = await fetch(url, {
    ...init,
    headers: { 'client-id': clientId(), authorization: `${url.startsWith(ID) ? 'OAuth' : 'Bearer'} ${saved.access}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (res.status === 401 && again) {
    await refresh();
    return authed(url, init, false);
  }
  if (!res.ok) throw new Error(`Twitch ${new URL(url).pathname} ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return res.json();
}

// ---------- EventSub over WebSocket ----------
// Connect (at start, after the login, after the proxy setting changed); whatever ran before stops.
async function start() {
  if (!saved.refresh) return;
  stop();
  const my = run;
  set({ state: 'connecting', error: st.error === 'network' ? 'network' : '' });
  try {
    const me = await authed(`${ID}/validate`); // whose channel this is
    keep({ userId: me.user_id, login: me.login });
  } catch (err) {
    if (my === run && err.code !== 'expired') later(my);
    return;
  }
  if (my === run) open(EVENTSUB, my);
}

// Lost: try again in 2 s, 4 s, ... up to a minute.
function later(my) {
  setConnected('twitch', false);
  set({ state: 'connecting', error: 'network' });
  timer = setTimeout(() => my === run && start(), Math.min(60000, 2000 * 2 ** retry++));
}

// One socket. Twitch's "reconnect" opens a second one at the address it gives: the old one keeps delivering until the
// new one says welcome, and the subscriptions come along.
function open(url, my) {
  const s = new WebSocket(url);
  let keepalive = 10, quiet;
  const watch = () => { // nothing (not even a keepalive) for that long: the socket is dead
    clearTimeout(quiet);
    quiet = setTimeout(() => net.hangUp(s), (keepalive + 10) * 1000);
  };
  watch();
  s.onmessage = (e) => {
    if (my !== run) return s.close();
    watch();
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    const type = m.metadata?.message_type, session = m.payload?.session;
    if (type === 'session_welcome') {
      keepalive = session.keepalive_timeout_seconds || 10;
      watch();
      const old = ws;
      ws = s;
      if (old) old.close();
      else subscribe(session.id, my);
    } else if (type === 'session_reconnect') {
      open(session.reconnect_url, my);
    } else if (type === 'notification') {
      handle(m.payload.subscription.type, m.payload.event);
    } else if (type === 'revocation') {
      logIncoming('twitch', 'revocation', m.payload.subscription);
      if (m.payload.subscription.status !== 'version_removed') forget('expired'); // logged out on Twitch (Connections page)
    }
  };
  s.onclose = () => {
    clearTimeout(quiet);
    if (my !== run || (ws && ws !== s)) return; // stopped, or a socket that was replaced (or never took over)
    ws = null;
    later(my);
  };
}

// Within 10 s of the welcome: follows and goals on this socket, then the goals there are now.
async function subscribe(session, my) {
  const me = saved.userId;
  const done = await Promise.allSettled(SUBS.map(([type, version]) => authed(`${HELIX}/eventsub/subscriptions`, {
    method: 'POST',
    body: JSON.stringify({ type, version, transport: { method: 'websocket', session_id: session },
      condition: type === 'channel.follow' ? { broadcaster_user_id: me, moderator_user_id: me } : { broadcaster_user_id: me } }),
  })));
  if (my !== run) return;
  done.forEach((r, i) => r.status === 'rejected' && console.warn(`Twitch ${SUBS[i][0]}:`, r.reason.message));
  if (!done.some((r) => r.status === 'fulfilled')) return ws?.close(); // try again
  retry = 0;
  try {
    const { data } = await authed(`${HELIX}/goals?broadcaster_id=${me}`);
    if (my !== run) return;
    goals.clear();
    data.forEach(goal);
  } catch (err) {
    console.warn('Twitch goals:', err.message);
  }
  try {
    const u = (await authed(`${HELIX}/users?id=${me}`)).data[0];
    keep({ name: u.display_name, picture: u.profile_image_url });
  } catch (err) {
    console.warn('Twitch profile:', err.message);
  }
  if (my !== run) return;
  setConnected('twitch', true);
  set({ state: 'connected', error: '' });
}

// Twitch's API (GET /goals) calls a followers goal 'follower', its EventSub events 'follow': kept as 'follow'.
const goal = (g) => goals.set(g.id, { id: g.id, type: g.type === 'follower' ? 'follow' : g.type, description: String(g.description ?? '').slice(0, 40), current: Number(g.current_amount) || 0, target: Number(g.target_amount) || 0 });

// One EventSub event. A follow alerts once per viewer in 6 hours (core/events key), so follow / unfollow spam alerts once.
function handle(type, e) {
  if (type === 'channel.follow') {
    logIncoming('twitch', type, e);
    emitEvent({ platform: 'twitch', type: 'follow', user: e.user_name || e.user_login, key: `twitch:follow:${e.user_id}` });
    return;
  }
  if (type === 'channel.goal.end') goals.delete(e.id);
  else if (type === 'channel.goal.begin' || type === 'channel.goal.progress') goal(e);
  else return;
  account.emit('status', status());
}

// Twitch asks apps to check their token every hour; one it no longer takes ends the login (refresh() -> forget()).
setInterval(() => st.state === 'connected' && authed(`${ID}/validate`).catch(() => {}), 3600000).unref();

// Live now? Helix GET /streams lists the channel while it streams; null when Twitch doesn't say.
async function live() {
  if (!saved.refresh || !saved.userId) return null;
  try {
    return (await authed(`${HELIX}/streams?user_id=${saved.userId}`)).data.length > 0;
  } catch {
    return null;
  }
}

module.exports = { status, login, disconnect, start, handle, live, events: account };
