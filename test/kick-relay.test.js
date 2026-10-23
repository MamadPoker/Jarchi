// Jarchi's Kick relay (relay/worker.mjs, a Cloudflare Worker) run in Node with a fake Kick and fake Rooms: the login
// and callback redirects, the token swap (the secret added there), Kick's signature on webhooks, and whose Room a
// socket joins.
const test = require('node:test');
const assert = require('node:assert/strict');

test('Kick relay: redirects, tokens, signed webhooks, sockets, rooms', async () => {
  const { default: worker, Room } = await import('../relay/worker.mjs');

  // Kick's signing key (made here) and its public key as Kick serves it.
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const spki = Buffer.from(await crypto.subtle.exportKey('spki', pair.publicKey)).toString('base64');
  const pem = `-----BEGIN PUBLIC KEY-----\n${spki.match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----\n`;
  const sign = async (s) => Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(s))).toString('base64');

  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ path: u.pathname, init });
    if (u.pathname === '/public/v1/public-key') return Response.json({ data: { public_key: pem }, message: 'OK' });
    if (u.pathname === '/public/v1/users') return init.headers.authorization === 'Bearer good' ? Response.json({ data: [{ user_id: 42, name: 'mamad' }] }) : Response.json({}, { status: 401 });
    if (u.pathname === '/oauth/token') return Response.json({ access_token: 'A', refresh_token: 'R', expires_in: 7200 });
    return new Response(null, { status: 404 });
  };
  const rooms = [];
  const env = {
    KICK_CLIENT_ID: 'cid', KICK_CLIENT_SECRET: 'shh',
    ROOMS: { idFromName: (n) => `id:${n}`, get: (id) => ({ fetch: async (req, init) => { rooms.push({ id, req, init }); return new Response('ok'); } }) },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) }, // the request count (test/stats.test.js checks it)
  };
  const go = (p, init) => worker.fetch(new Request(`https://relay.test${p}`, init), env, { waitUntil() {} });
  const STATE = '3000.abcdefghijklmnopqrstuvwx', CHALLENGE = 'x'.repeat(43);

  // /login -> Kick's login page with this app, the relay's own callback and PKCE.
  let r = await go(`/login?state=${STATE}&challenge=${CHALLENGE}`);
  const kick = new URL(r.headers.get('location'));
  assert.equal(r.status, 302);
  assert.equal(`${kick.origin}${kick.pathname}`, 'https://id.kick.com/oauth/authorize');
  assert.deepEqual(Object.fromEntries(kick.searchParams), { response_type: 'code', client_id: 'cid', redirect_uri: 'https://relay.test/callback', scope: 'user:read events:subscribe', code_challenge: CHALLENGE, code_challenge_method: 'S256', state: STATE });
  assert.equal((await go(`/login?state=nope&challenge=${CHALLENGE}`)).status, 400);

  // /callback -> back to this PC only, the port taken from the state.
  r = await go(`/callback?code=C&state=${STATE}`);
  assert.equal(r.headers.get('location'), `http://127.0.0.1:3000/api/kick/callback?code=C&state=${STATE}`);
  assert.equal((await go('/callback?code=C&state=evil.com/x.abcdefghijklmnopqrstuvwx')).status, 400);
  assert.equal((await go('/callback?code=C&state=99999.abcdefghijklmnopqrstuvwx')).status, 400);

  // /token: the code (with the relay's redirect address) or a refresh token, plus the app's id and secret.
  r = await go('/token', { method: 'POST', body: JSON.stringify({ code: 'C', code_verifier: 'V' }) });
  assert.deepEqual(await r.json(), { access_token: 'A', refresh_token: 'R', expires_in: 7200 });
  assert.deepEqual(Object.fromEntries(calls.at(-1).init.body), { grant_type: 'authorization_code', code: 'C', code_verifier: 'V', redirect_uri: 'https://relay.test/callback', client_id: 'cid', client_secret: 'shh' });
  await go('/token', { method: 'POST', body: JSON.stringify({ refresh_token: 'R' }) });
  assert.deepEqual(Object.fromEntries(calls.at(-1).init.body), { grant_type: 'refresh_token', refresh_token: 'R', client_id: 'cid', client_secret: 'shh' });

  // /webhook: signed by Kick -> that channel's Room gets it; a wrong signature or body -> refused; an old one -> dropped.
  const hook = async (body, { time = new Date().toISOString(), sig } = {}) => go('/webhook', { method: 'POST', body, headers: {
    'kick-event-message-id': '01MSG', 'kick-event-message-timestamp': time, 'kick-event-type': 'channel.followed', 'kick-event-version': '1',
    'kick-event-signature': sig ?? await sign(`01MSG.${time}.${body}`),
  } });
  const body = JSON.stringify({ broadcaster: { user_id: 42 }, follower: { user_id: 7, username: 'Ava' } });
  r = await hook(body);
  assert.equal(r.status, 200);
  assert.equal(rooms.length, 1);
  assert.equal(rooms[0].id, 'id:42');
  assert.deepEqual(JSON.parse(rooms[0].init.body), { type: 'channel.followed', version: '1', id: '01MSG', data: JSON.parse(body) });
  assert.equal((await hook(body.replace('Ava', 'Eve'), { sig: await sign(`01MSG.${new Date().toISOString()}.${body}`) })).status, 403);
  assert.equal((await hook(body, { sig: 'not base64!' })).status, 403);
  const old = new Date(Date.now() - 3600000).toISOString();
  assert.equal((await hook(body, { time: old })).status, 200);
  assert.equal(rooms.length, 1, 'an hour late: not passed on');
  assert.equal(calls.filter((c) => c.path === '/public/v1/public-key').length, 1, 'fetched once: a signature that fails asks again at most once a minute');

  // /ws: Kick says whose token it is -> that channel's Room; no token / a bad one -> refused.
  const ws = (auth) => go('/ws', { headers: { upgrade: 'websocket', ...(auth && { authorization: auth }) } });
  assert.equal((await ws('Bearer good')).status, 200);
  assert.equal(rooms.at(-1).id, 'id:42');
  assert.equal((await ws('Bearer bad')).status, 401);
  assert.equal((await ws()).status, 401);
  assert.equal((await go('/ws')).status, 426);

  // A Room hands each event to every socket open for the channel (one closing just then doesn't stop the others).
  globalThis.WebSocketRequestResponsePair = class { constructor(a, b) { Object.assign(this, { a, b }); } };
  const got = [], sockets = [{ send: () => { throw new Error('closing'); } }, { send: (m) => got.push(m) }];
  let auto;
  const room = new Room({ setWebSocketAutoResponse: (p) => (auto = p), getWebSockets: () => sockets });
  assert.deepEqual([auto.a, auto.b], ['ping', 'pong']);
  await room.fetch(new Request('https://room/event', { method: 'POST', body: '{"type":"channel.followed"}' }));
  assert.deepEqual(got, ['{"type":"channel.followed"}']);
});
