// The Twitch account (connectors/twitch-account.js) against a fake Twitch (fetch and WebSocket replaced, no network):
// the login with a code, tokens kept and refreshed once, EventSub follows and goals, Twitch's reconnect, a dropped
// socket, and Disconnect.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarchi-twitch-'));
process.env.JARCHI_DATA_DIR = dataDir;
const file = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'twitch.json'), 'utf8'));

// Fake Twitch. Access token A1 is refused by the Helix API (401), so the first subscriptions refresh it; a refresh token
// works once, like a Public app's.
const calls = [];
let pending = 1, issued = 0;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  const body = init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : init.body ? JSON.parse(init.body) : null;
  const auth = init.headers?.authorization;
  calls.push({ path: u.pathname, body, auth });
  const json = (status, j) => new Response(JSON.stringify(j), { status });
  if (u.pathname.startsWith('/helix/') && auth === 'Bearer A1') return json(401, { message: 'Invalid OAuth token' });
  switch (u.pathname) {
    case '/oauth2/device': return json(200, { device_code: 'DEV', user_code: 'ABCD-EFGH', verification_uri: 'https://www.twitch.tv/activate?public=true&device-code=ABCDEFGH', expires_in: 1800, interval: 0.01 });
    case '/oauth2/token':
      if (body.grant_type.endsWith('device_code') && pending-- > 0) return json(400, { status: 400, message: 'authorization_pending' });
      if (body.grant_type === 'refresh_token' && body.refresh_token !== `R${issued}`) return json(400, { status: 400, message: 'Invalid refresh token' });
      issued++;
      return json(200, { access_token: `A${issued}`, refresh_token: `R${issued}`, expires_in: 14400, scope: [], token_type: 'bearer' });
    case '/oauth2/validate': return json(200, { client_id: 'abc123', login: 'mamad', user_id: '42', scopes: [], expires_in: 14000 });
    case '/helix/eventsub/subscriptions': return json(202, { data: [{ id: 'sub', status: 'enabled' }] });
    case '/helix/goals': return json(200, { data: [{ id: 'g1', type: 'follow', description: '', current_amount: 5, target_amount: 10 }] });
    case '/oauth2/revoke': return new Response(null, { status: 200 });
  }
  return json(404, {});
};
const sockets = [];
globalThis.WebSocket = class {
  constructor(url) { this.url = url; sockets.push(this); }
  close() {
    if (this.closed) return;
    this.closed = true;
    setImmediate(() => this.onclose?.());
  }
  say(type, payload) { this.onmessage({ data: JSON.stringify({ metadata: { message_type: type }, payload }) }); }
};

const account = require('../connectors/twitch-account');
const { bus, connectedPlatforms } = require('../core/events');

const waitFor = async (ok, what) => {
  for (let t = Date.now(); Date.now() - t < 8000;) {
    if (ok()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out: ${what}`);
};
const subscriptions = () => calls.filter((c) => c.path === '/helix/eventsub/subscriptions' && c.auth !== 'Bearer A1');
const notify = (s, type, event) => s.say('notification', { subscription: { type }, event });

test('Twitch account: code login, refresh, follows, goals, reconnect, disconnect', async () => {
  // Nothing saved: off, and no login without a Client ID.
  assert.equal(account.status().state, 'off');
  await assert.rejects(account.login());
  assert.throws(() => account.setClientId('not an id!'));
  account.setClientId(' abc123 ');
  assert.equal(file().clientId, 'abc123');

  // Connect: Twitch's code on screen, asked again while "pending", then tokens -> who this is -> the socket.
  const waiting = await account.login();
  assert.deepEqual([waiting.state, waiting.code, waiting.uri], ['waiting', 'ABCD-EFGH', 'https://www.twitch.tv/activate?public=true&device-code=ABCDEFGH']);
  assert.throws(() => account.setClientId('other'), 'not while logging in');
  await waitFor(() => sockets.length === 1, 'socket');
  assert.equal(sockets[0].url, 'wss://eventsub.wss.twitch.tv/ws');
  assert.deepEqual([file().refresh, file().userId, file().login], ['R1', '42', 'mamad']);
  assert.ok(!/A1|R1/.test(JSON.stringify(account.status())), 'tokens never reach the panel');

  // Welcome: four subscriptions on this session. A1 is refused, so it's refreshed once for all of them.
  sockets[0].say('session_welcome', { session: { id: 'S1', keepalive_timeout_seconds: 10 } });
  await waitFor(() => account.status().state === 'connected', 'connected');
  const subs = subscriptions();
  assert.deepEqual(subs.map((c) => c.body.type).sort(), ['channel.follow', 'channel.goal.begin', 'channel.goal.end', 'channel.goal.progress']);
  assert.ok(subs.every((c) => c.body.transport.session_id === 'S1' && c.body.condition.broadcaster_user_id === '42'));
  assert.equal(subs.find((c) => c.body.type === 'channel.follow').body.condition.moderator_user_id, '42');
  assert.equal(calls.filter((c) => c.body?.grant_type === 'refresh_token').length, 1, 'one refresh at a time');
  assert.equal(file().refresh, 'R2');
  assert.deepEqual(account.status().goals, [{ id: 'g1', type: 'follow', description: '', current: 5, target: 10 }]);
  assert.deepEqual([account.status().login, connectedPlatforms()], ['mamad', ['twitch']]);

  // A follow is a Twitch Follow alert, once per viewer (follow / unfollow spam alerts once).
  const events = [];
  bus.on('event', (e) => events.push(e));
  const follow = { user_id: '7', user_login: 'ava', user_name: 'Ava', broadcaster_user_id: '42', followed_at: '2026-10-18T12:00:00Z' };
  notify(sockets[0], 'channel.follow', follow);
  notify(sockets[0], 'channel.follow', follow);
  assert.deepEqual(events.map((e) => [e.platform, e.type, e.user]), [['twitch', 'follow', 'Ava']]);

  // Goals follow Twitch: progress, a new one, an ended one.
  notify(sockets[0], 'channel.goal.progress', { id: 'g1', type: 'follow', description: '', current_amount: 6, target_amount: 10 });
  notify(sockets[0], 'channel.goal.begin', { id: 'g2', type: 'new_subscription_count', description: 'Road to 50', current_amount: 0, target_amount: 50 });
  assert.deepEqual(account.status().goals.map((g) => [g.id, g.current]), [['g1', 6], ['g2', 0]]);
  notify(sockets[0], 'channel.goal.end', { id: 'g1', type: 'follow', is_achieved: false, current_amount: 6, target_amount: 10 });
  assert.deepEqual(account.status().goals.map((g) => g.description), ['Road to 50']);

  // Twitch's reconnect: a second socket; the first goes once that one says welcome. Nothing is subscribed again.
  sockets[0].say('session_reconnect', { session: { id: 'S1', reconnect_url: 'wss://eventsub.wss.twitch.tv/ws?reconnect' } });
  assert.equal(sockets[1].url, 'wss://eventsub.wss.twitch.tv/ws?reconnect');
  assert.ok(!sockets[0].closed, 'keeps delivering until the new one is welcomed');
  sockets[1].say('session_welcome', { session: { id: 'S1', keepalive_timeout_seconds: 10 } });
  await new Promise((r) => setImmediate(r));
  assert.ok(sockets[0].closed);
  assert.equal(account.status().state, 'connected');
  assert.equal(subscriptions().length, 4);
  notify(sockets[1], 'channel.follow', { ...follow, user_id: '8', user_name: 'Leo' });
  assert.equal(events.at(-1).user, 'Leo');

  // Dropped: connecting again by itself (2 s later), with new subscriptions on the new session.
  sockets[1].close();
  await waitFor(() => account.status().state === 'connecting' && account.status().error === 'network', 'reconnecting');
  await waitFor(() => sockets.length === 3, 'new socket');
  sockets[2].say('session_welcome', { session: { id: 'S3', keepalive_timeout_seconds: 10 } });
  await waitFor(() => account.status().state === 'connected', 'connected again');
  assert.ok(subscriptions().slice(4).every((c) => c.body.transport.session_id === 'S3'));

  // Disconnect: Twitch is told, the tokens go, the Client ID stays.
  const off = await account.disconnect();
  assert.deepEqual([off.state, off.login, off.goals, off.clientId], ['off', '', [], 'abc123']);
  assert.deepEqual(file(), { clientId: 'abc123' });
  assert.equal(calls.at(-1).path, '/oauth2/revoke');
  assert.equal(calls.at(-1).body.token, 'A2');
  assert.ok(sockets[2].closed);
  assert.deepEqual(connectedPlatforms(), []);
});
