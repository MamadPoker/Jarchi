// The Kick account (connectors/kick-account.js) against a fake Kick and a fake Kick relay (fetch and WebSocket
// replaced, no network): the login through the relay (PKCE, state), tokens kept and refreshed, the follows
// subscription, the relay's socket, follows as alerts, a dropped socket, Disconnect, a refused and a canceled login.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarchi-kick-'));
process.env.JARCHI_DATA_DIR = dataDir;
process.env.KICK_RELAY_URL = 'https://relay.test/';
const file = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'kick.json'), 'utf8'));

// Fake relay + Kick. Access token A1 is refused by Kick's API (401), so the first call refreshes it.
const calls = [];
let issued = 0, challenge = '';
const subs = [];
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  const body = init.body ? JSON.parse(init.body) : null;
  const auth = init.headers?.authorization;
  calls.push({ host: u.host, path: u.pathname, query: u.search, method: init.method ?? 'GET', body, auth });
  const json = (status, j) => new Response(JSON.stringify(j), { status });
  if (u.host === 'api.kick.com' && auth === 'Bearer A1') return json(401, { message: 'Unauthorized' });
  switch (`${init.method ?? 'GET'} ${u.host}${u.pathname}`) {
    case 'POST relay.test/token':
      if (body.code && crypto.createHash('sha256').update(body.code_verifier).digest('base64url') !== challenge) return json(400, { error: 'Invalid request' });
      if (body.refresh_token && body.refresh_token !== `R${issued}`) return json(400, { error: 'Invalid request' });
      issued++;
      return json(200, { access_token: `A${issued}`, refresh_token: `R${issued}`, expires_in: 7200, scope: 'user:read events:subscribe', token_type: 'Bearer' });
    case 'GET api.kick.com/public/v1/users': return json(200, { data: [{ user_id: 42, name: 'mamad', email: '', profile_picture: '' }], message: 'OK' });
    case 'GET api.kick.com/public/v1/events/subscriptions': return json(200, { data: subs, message: 'OK' });
    case 'POST api.kick.com/public/v1/events/subscriptions':
      for (const e of body.events) subs.push({ id: `s${subs.length + 1}`, event: e.name, version: e.version, broadcaster_user_id: 42, method: 'webhook' });
      return json(200, { data: body.events.map((e, i) => ({ ...e, subscription_id: `s${i + 1}`, error: '' })), message: 'OK' });
    case 'DELETE api.kick.com/public/v1/events/subscriptions': return new Response(null, { status: 204 });
    case 'POST id.kick.com/oauth/revoke': return new Response('OK', { status: 200 });
  }
  return json(404, {});
};
const sockets = [];
globalThis.WebSocket = class {
  static OPEN = 1;
  constructor(url, opts) { Object.assign(this, { url, opts, readyState: 0, sent: [] }); sockets.push(this); }
  open() { this.readyState = 1; this.onopen?.(); }
  send(m) { this.sent.push(m); }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    setImmediate(() => this.onclose?.());
  }
  say(m) { this.onmessage({ data: typeof m === 'string' ? m : JSON.stringify(m) }); }
};

const account = require('../connectors/kick-account');
const { PORT } = require('../core/config');
const { bus, connectedPlatforms } = require('../core/events');

const waitFor = async (ok, what) => {
  for (let t = Date.now(); Date.now() - t < 8000;) {
    if (ok()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out: ${what}`);
};
const posted = () => calls.filter((c) => c.method === 'POST' && c.path === '/public/v1/events/subscriptions');
const follow = (id, name, channel = 42) => ({ type: 'channel.followed', data: { broadcaster: { user_id: channel, username: 'mamad' }, follower: { user_id: id, username: name } } });

test('Kick account: login through the relay, follows subscribed, follow alerts, reconnect, disconnect', async () => {
  assert.equal(account.status().state, 'off');

  // Connect: Kick's login page through the relay, with this Jarchi's port in the state and a PKCE challenge.
  const waiting = await account.login();
  const login = new URL(waiting.uri);
  challenge = login.searchParams.get('challenge');
  const state = login.searchParams.get('state');
  assert.equal(waiting.state, 'waiting');
  assert.equal(`${login.origin}${login.pathname}`, 'https://relay.test/login');
  assert.match(state, new RegExp(`^${PORT}\\.[\\w-]{32}$`));
  assert.match(challenge, /^[\w-]{43}$/);

  // Not this login's state (an old tab, a forged link): nothing happens.
  await account.callback({ code: 'C', state: `${PORT}.someoneelse` });
  assert.equal(account.status().state, 'waiting');
  assert.equal(calls.length, 0);

  // Kick's code -> the relay swaps it (with the verifier) -> who this is (A1 refused: refreshed) -> subscribed -> socket.
  await account.callback({ code: 'C', state });
  assert.equal(calls[0].body.code, 'C');
  await waitFor(() => sockets.length === 1, 'socket');
  assert.equal(sockets[0].url, 'wss://relay.test/ws');
  assert.equal(sockets[0].opts.headers.authorization, 'Bearer A2');
  assert.deepEqual([file().refresh, file().userId, file().login], ['R2', 42, 'mamad']);
  assert.deepEqual(posted().map((c) => c.body), [{ events: ['channel.followed', 'channel.subscription.new', 'channel.subscription.renewal', 'channel.subscription.gifts']
    .map((name) => ({ name, version: 1 })), method: 'webhook' }]);
  assert.ok(!/A2|R2/.test(JSON.stringify(account.status())), 'tokens never reach the panel');
  sockets[0].open();
  assert.deepEqual([account.status().state, account.status().login, connectedPlatforms()], ['connected', 'mamad', ['kick']]);

  // A follow is a Kick Follow alert, once per viewer; another channel's event (never sent here) is ignored.
  const events = [];
  bus.on('event', (e) => events.push(e));
  sockets[0].say(follow(7, 'Ava'));
  sockets[0].say(follow(7, 'Ava'));
  sockets[0].say(follow(8, 'Leo', 99));
  sockets[0].say('pong');
  assert.deepEqual(events.map((e) => [e.platform, e.type, e.user]), [['kick', 'follow', 'Ava']]);
  // A sub through the relay: a Kick Sub alert, a moment later (kick-chat official(), shared with the chat socket's).
  sockets[0].say({ type: 'channel.subscription.new', data: { broadcaster: { user_id: 42 }, subscriber: { user_id: 5, username: 'Sam' }, duration: 1 } });
  await waitFor(() => events.length === 2, 'sub alert');
  assert.deepEqual([events[1].type, events[1].user, events[1].months], ['sub', 'Sam', 1]);

  // Dropped: connecting again by itself (2 s later); Kick still has the subscription, so it isn't made again.
  sockets[0].close();
  await waitFor(() => account.status().state === 'connecting' && account.status().error === 'network', 'reconnecting');
  assert.deepEqual(connectedPlatforms(), []);
  await waitFor(() => sockets.length === 2, 'new socket');
  sockets[1].open();
  assert.equal(account.status().state, 'connected');
  assert.equal(posted().length, 1);
  sockets[1].say(follow(9, 'Mia'));
  assert.equal(events.at(-1).user, 'Mia');

  // Disconnect: the subscription goes, Kick is told, the tokens go.
  const off = await account.disconnect();
  assert.deepEqual([off.state, off.login], ['off', '']);
  assert.deepEqual(file(), {});
  const del = calls.find((c) => c.method === 'DELETE');
  assert.equal(del.query, '?id=s1&id=s2&id=s3&id=s4');
  assert.equal(calls.at(-1).path, '/oauth/revoke');
  assert.match(calls.at(-1).query, /token=A2/);
  assert.ok(sockets[1].closed);
  assert.deepEqual(connectedPlatforms(), []);

  // Refused on Kick's page: back without a code.
  const again = new URL((await account.login()).uri).searchParams.get('state');
  await account.callback({ error: 'access_denied', state: again });
  assert.deepEqual([account.status().state, account.status().error], ['off', 'denied']);

  // Canceled while Kick's page is open: coming back later changes nothing.
  const late = new URL((await account.login()).uri).searchParams.get('state');
  await account.disconnect();
  const before = calls.length;
  await account.callback({ code: 'C', state: late });
  assert.deepEqual([account.status().state, calls.length], ['off', before]);
});
