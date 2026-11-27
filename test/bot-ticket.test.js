// The relay's POST /bot/ticket (relay/worker.mjs "Bot tickets") on SQLite standing in for D1, with a fake Kick: a ticket
// only for an install that has pinged, always for the Kick token's own channel, signed the way the bot checks it
// (Jarchi-Bot's api.test.js makes its tickets the same way), and limited per install and per Kick user.
const test = require('node:test');
const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const { d1 } = require('./relay-env');

const ctx = { waitUntil() {} };
const ping = (id) => ({ id, version: '1.0.12', installed: true, open: true, kick: null, twitch: null, privacy: { version: 1, acceptedAt: null } });

test("relay bot tickets: pinged installs only, the token owner's channel, signed, limited", async (t) => {
  const { default: worker } = await import('../relay/worker.mjs');
  const pair = nodeCrypto.generateKeyPairSync('ed25519');
  const { db, DB } = d1(),
    env = { DB, BOT_TICKET_KEY: JSON.stringify(pair.privateKey.export({ format: 'jwk' })) };
  const asked = [];
  const realFetch = globalThis.fetch,
    realNow = Date.now;
  t.after(() => {
    globalThis.fetch = realFetch;
    Date.now = realNow;
  });
  globalThis.fetch = async (url, init = {}) => {
    asked.push({ url: String(url), auth: init.headers.authorization });
    const users = { 'Bearer good': { user_id: 42, name: 'MamadPoker' }, 'Bearer other': { user_id: 7, name: 'Other' } };
    const me = users[init.headers.authorization];
    return me ? Response.json({ data: [me], message: 'OK' }) : Response.json({ message: 'Unauthorized' }, { status: 401 });
  };
  const call = (headers, { method = 'POST', body, e = env } = {}) =>
    worker.fetch(new Request('https://relay.test/bot/ticket', { method, headers, body }), e, ctx);
  const [x, y, never] = ['1', '2', '3'].map((n) => `${n.repeat(8)}-1111-4111-8111-111111111111`);
  for (const id of [x, y])
    assert.equal(
      (
        await worker.fetch(
          new Request('https://relay.test/ping', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ping(id)) }),
          env,
          ctx,
        )
      ).status,
      200,
    );
  const as = (install, token) => call({ 'x-jarchi-install': install, ...(token ? { authorization: `Bearer ${token}` } : {}) });
  const error = async (r, status) => {
    assert.equal(r.status, status);
    return (await r.json()).error;
  };

  assert.equal(await error(await call({ 'x-jarchi-install': x, authorization: 'Bearer good' }, { e: { DB } }), 503), 'not_ready', 'no key set yet');
  assert.equal(await error(await call({}, { method: 'GET' }), 405), 'method');
  assert.equal(await error(await as('not-an-install', 'good'), 400), 'bad_request');
  assert.equal(await error(await as(never, 'good'), 403), 'unknown_install', 'an install that never pinged');
  assert.equal(asked.length, 0, 'Kick is asked only for a known install');

  // x's tries 1 and 2: no token (Kick isn't asked), a token Kick refuses.
  assert.equal(await error(await as(x), 401), 'unauthorized');
  assert.equal(asked.length, 0);
  assert.equal(await error(await as(x, 'bad'), 401), 'unauthorized');

  // Tries 3 to 7: tickets for the token's own channel, whatever the body says.
  const r = await call({ 'x-jarchi-install': x, authorization: 'Bearer good' }, { body: JSON.stringify({ sub: '7', name: 'Other' }) });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const { ticket } = await r.json();
  const [tag, payload, signature, ...rest] = ticket.split('.');
  assert.equal(tag, 'jt1');
  assert.equal(rest.length, 0);
  assert.ok(/^[\w-]+$/.test(payload) && /^[\w-]+$/.test(signature), 'base64url without =');
  assert.ok(nodeCrypto.verify(null, Buffer.from(`jt1.${payload}`), pair.publicKey, Buffer.from(signature, 'base64url')), 'signed with the key');
  const p = JSON.parse(Buffer.from(payload, 'base64url').toString());
  assert.deepEqual(Object.keys(p), ['aud', 'sub', 'name', 'install', 'iat', 'exp']);
  assert.equal(p.aud, 'bot.jarchi.app');
  assert.equal(p.sub, '42');
  assert.equal(p.name, 'MamadPoker');
  assert.equal(p.install, x);
  assert.ok(Math.abs(p.iat - Date.now()) < 5000);
  assert.equal(p.exp - p.iat, 5 * 60 * 1000);
  assert.deepEqual(asked.at(-1), { url: 'https://api.kick.com/public/v1/users', auth: 'Bearer good' });
  const other = nodeCrypto.generateKeyPairSync('ed25519').publicKey;
  assert.ok(!nodeCrypto.verify(null, Buffer.from(`jt1.${payload}`), other, Buffer.from(signature, 'base64url')));
  for (let i = 0; i < 4; i++) assert.equal((await as(x, 'good')).status, 200);

  // 5 tickets an hour per Kick user, from any install; 10 tries an hour per install.
  assert.equal(await error(await as(x, 'good'), 429), 'rate', "a Kick user's sixth ticket");
  assert.equal(await error(await as(y, 'good'), 429), 'rate', 'the same Kick user from another install');
  assert.equal((await as(y, 'other')).status, 200, 'another Kick user from that install');
  for (let i = 0; i < 2; i++) assert.equal((await as(x, 'other')).status, 200);
  const before = asked.length;
  assert.equal(await error(await as(x, 'other'), 429), 'rate', "the install's eleventh try");
  assert.equal(asked.length, before, "Kick isn't asked once the install is over its limit");

  // Nothing kept but the counts, and those only for an hour.
  const rows = () =>
    db
      .prepare('SELECT who FROM bot_ticket_tries ORDER BY who')
      .all()
      .map((row) => row.who);
  assert.deepEqual(rows(), [`install:${x}`, `install:${y}`, 'user:42', 'user:7']);
  const later = realNow() + 60 * 60 * 1000 + 1000;
  Date.now = () => later;
  assert.equal((await as(x, 'good')).status, 200, 'an hour later');
  assert.deepEqual(rows(), [`install:${x}`, 'user:42']);
});
