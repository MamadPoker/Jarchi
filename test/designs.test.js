// Exclusive chat designs: the relay's /designs and /admin/codes (relay/worker.mjs) on SQLite standing in for D1 (schema.sql +
// migrations): a code for one design, shown once and kept only as its hash; redeemed by one install for good (the same
// code elsewhere fails), only by installs that have pinged, tries limited per install. Then Jarchi's side
// (core/designs.js) through the real server to that relay: only after the Privacy Policy, the design kept on disk and a
// chat style (with its CSS for the widget), and a design whose CSS could load or run anything is never taken.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { d1 } = require('./relay-env');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarchi-designs-'));
process.env.JARCHI_DATA_DIR = dataDir;
process.env.JARCHI_PORT = '3994';
process.env.KICK_RELAY_URL = 'https://relay.test';
process.env.JARCHI_PAY_URL = 'http://127.0.0.1:9'; // nothing there: the server's crypto checks reach no real Jarchi Pay
const KEY = 'k'.repeat(96);
const ctx = { waitUntil() {} };
const LOOK = { font: 'Manrope', namePos: 'above', bubbles: true, radius: 11, enterAnim: 'float' };
const CSS = '.style-x-test .msg::after { content: "✦"; }\n.style-x-test .body { background: var(--bg); }';
// A design as it's added on the relay (wrangler d1 execute, relay/README.md).
const addDesign = (db, id, data = { look: LOOK, css: CSS }) =>
  db
    .prepare('INSERT INTO designs (id, name_en, name_fa, data, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, 'Test', 'آزمایشی', JSON.stringify(data), '2026-11-11T10:00:00.000Z');
const relay =
  (worker, env) =>
  (p, { method = 'GET', headers = {}, body } = {}) =>
    worker.fetch(
      new Request(`https://relay.test${p}`, {
        method,
        headers: { 'content-type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
      ctx,
    );
const ping = (id) => ({ id, version: '1.0.7', installed: true, open: true, kick: null, twitch: null, privacy: { version: 1, acceptedAt: null } });

test('relay designs: a code shown once, one install for good, pinged installs only, tries limited', async () => {
  const { default: worker } = await import('../relay/worker.mjs');
  const { db, DB } = d1(),
    call = relay(worker, { DB, ADMIN_KEY: KEY });
  const adminAt = (p, o = {}) => call(p, { ...o, headers: { authorization: `Bearer ${KEY}`, 'cf-connecting-ip': '10.0.0.1' } });
  const admin = (o = {}) => adminAt('/admin/codes', o);
  const body = async (r, status = 200) => {
    const b = await r.json();
    assert.equal(r.status, status, JSON.stringify(b));
    return b;
  };
  addDesign(db, 'x-test');
  const [x, y, z] = ['1', '2', '3'].map((n) => `${n.repeat(8)}-1111-4111-8111-111111111111`);
  for (const id of [x, y]) assert.equal((await call('/ping', { method: 'POST', body: ping(id) })).status, 200);
  const as =
    (install) =>
    (p = '', o = {}) =>
      call(`/designs${p}`, { ...o, headers: { 'x-jarchi-install': install } });
  const X = as(x),
    Y = as(y),
    Z = as(z);
  const redeem = (who, code) => who('/redeem', { method: 'POST', body: { code } });

  // Codes: admin only; for a design that's there; the code itself once, its hash kept.
  assert.equal((await call('/admin/codes')).status, 401);
  for (const b of [{ design: 'x-nope' }, { design: 'x-test', note: 'a'.repeat(81) }, { design: 'x-test', extra: 1 }, { design: 'x-test', note: '<b>' }]) {
    assert.deepEqual(await body(await admin({ method: 'POST', body: b }), 400), { error: 'bad_request' });
  }
  const made = await body(await admin({ method: 'POST', body: { design: 'x-test', note: 'For Ali' } }));
  assert.match(made.code, /^[A-HJ-KMNP-Z2-9]{4}-[A-HJ-KMNP-Z2-9]{4}$/);
  assert.deepEqual(
    { ...made, code: undefined, createdAt: undefined },
    { code: undefined, id: made.id, design: 'x-test', note: 'For Ali', createdAt: undefined, install: null, redeemedAt: null, revokedAt: null },
  );
  const stored = db.prepare('SELECT * FROM design_codes').all();
  assert.equal(stored.length, 1);
  assert.ok(!JSON.stringify(stored).includes(made.code.replace('-', '')), 'only its hash is kept');
  const list = await body(await admin());
  assert.deepEqual(
    list.map((c) => [c.id, c.note, c.install, 'code' in c]),
    [[made.id, 'For Ali', null, false]],
  );

  // Redeem: a pinged install only; - spaces and case don't matter; asked again by the same install: still fine.
  assert.deepEqual(await body(await redeem(Z, made.code), 403), { error: 'unknown_install' });
  assert.deepEqual(await body(await redeem(X, 'ABCD-EFGH'), 404), { error: 'bad_code' });
  const lower = made.code.toLowerCase().replace('-', ' ');
  assert.deepEqual(await body(await redeem(X, lower)), { id: 'x-test', name: { en: 'Test', fa: 'آزمایشی' } });
  assert.deepEqual(await body(await redeem(X, made.code)), { id: 'x-test', name: { en: 'Test', fa: 'آزمایشی' } });
  assert.deepEqual(await body(await redeem(Y, made.code), 404), { error: 'bad_code' }, 'another install: never');
  const [row] = await body(await admin());
  assert.equal(row.install, x);
  assert.ok(row.redeemedAt);

  // Mine only: the list and the whole design.
  assert.deepEqual(await body(await X()), [{ id: 'x-test', name: { en: 'Test', fa: 'آزمایشی' } }]);
  assert.deepEqual(await body(await Y()), []);
  assert.deepEqual(await body(await X('/x-test')), { id: 'x-test', name: { en: 'Test', fa: 'آزمایشی' }, look: LOOK, css: CSS });
  assert.deepEqual(await body(await Y('/x-test'), 404), { error: 'not_found' });
  assert.deepEqual(await body(await call('/designs'), 400), { error: 'bad_request' });
  assert.deepEqual(await body(await X('/redeem'), 405), { error: 'method' });

  // Tries: REDEEM_MAX an hour per install, right or wrong (Y has had 1).
  for (let i = 0; i < 9; i++) assert.equal((await redeem(Y, 'ABCD-EFGH')).status, 404);
  assert.deepEqual(await body(await redeem(Y, made.code), 429), { error: 'rate' });
  assert.equal((await redeem(X, made.code)).status, 200, 'another install has its own tries');

  // Revoke: never redeemed again, like a wrong code; the install that has it keeps its design; the first time kept.
  const fresh = await body(await admin({ method: 'POST', body: { design: 'x-test' } }));
  const revoke = (id) => adminAt(`/admin/codes/${id}`, { method: 'DELETE' });
  const gone = await body(await revoke(fresh.id));
  const { code: _shown, ...listed } = fresh;
  assert.deepEqual({ ...gone, revokedAt: null }, listed);
  assert.ok(gone.revokedAt);
  assert.deepEqual(await body(await redeem(X, fresh.code), 404), { error: 'bad_code' });
  const had = await body(await revoke(made.id));
  assert.deepEqual([had.install, !!had.redeemedAt, !!had.revokedAt], [x, true, true]);
  assert.deepEqual(await body(await redeem(X, made.code), 404), { error: 'bad_code' }, 'revoked: not even for its own install');
  assert.deepEqual(await body(await X()), [{ id: 'x-test', name: { en: 'Test', fa: 'آزمایشی' } }], 'kept by the install that has it');
  assert.equal((await X('/x-test')).status, 200);
  assert.equal((await body(await revoke(fresh.id))).revokedAt, gone.revokedAt, 'revoked again: the first time kept');
  assert.deepEqual(
    (await body(await admin())).map((c) => [c.id, !!c.revokedAt]),
    [
      [fresh.id, true],
      [made.id, true],
    ],
  );
  assert.deepEqual(await body(await revoke('0'.repeat(12)), 404), { error: 'not_found' });
  assert.deepEqual(await body(await revoke('NOT-AN-ID'), 404), { error: 'not_found' });
  assert.deepEqual(await body(await adminAt(`/admin/codes/${made.id}`), 405), { error: 'method' });
  assert.equal((await call(`/admin/codes/${made.id}`, { method: 'DELETE' })).status, 401);

  // Designs for the admin: id, names, createdAt; never the look or CSS.
  assert.deepEqual(await body(await adminAt('/admin/designs')), [{ id: 'x-test', name: { en: 'Test', fa: 'آزمایشی' }, createdAt: '2026-11-11T10:00:00.000Z' }]);
  assert.deepEqual(await body(await adminAt('/admin/designs', { method: 'POST', body: {} }), 405), { error: 'method' });
  assert.equal((await call('/admin/designs')).status, 401);
});

test('Jarchi: a code unlocks a design, kept and a chat style; unsafe CSS never taken', async (t) => {
  const { default: worker } = await import('../relay/worker.mjs');
  const { db, DB } = d1(),
    env = { DB, ADMIN_KEY: KEY },
    call = relay(worker, env);
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => (new URL(url).host === 'relay.test' ? worker.fetch(new Request(url, init), env, ctx) : real(url, init));
  const { server, io } = require('../server');
  const designs = require('../core/designs');
  t.after(() => {
    io.close();
    server.closeAllConnections();
  });
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  const api = async (method, p, b) => {
    const r = await real(`http://127.0.0.1:3994${p}`, {
      method,
      headers: { 'x-jarchi': '1', 'content-type': 'application/json' },
      body: b && JSON.stringify(b),
    });
    return [r.status, r.headers.get('content-type'), (r.headers.get('content-type') ?? '').includes('json') ? await r.json() : await r.text()];
  };
  addDesign(db, 'x-test');
  const code = async (design) =>
    (await (await call('/admin/codes', { method: 'POST', headers: { authorization: `Bearer ${KEY}` }, body: { design } })).json()).code;
  const first = await code('x-test');

  // Before the Privacy Policy: nothing goes to the relay.
  assert.deepEqual((await api('POST', '/api/designs/redeem', { code: first }))[2], { error: 'designs_privacy' });
  await api('PATCH', '/api/settings', { privacyAccepted: 1 });
  const until = async (ok) => {
    for (let i = 0; i < 300 && !(await ok()); i++) await new Promise((r) => setTimeout(r, 10));
  };
  await until(async () => !!db.prepare('SELECT 1 FROM installs').get()); // the first ping: the relay knows this install

  assert.deepEqual((await api('POST', '/api/designs/redeem', { code: 'ABCD-EFGH' }))[2], { error: 'designs_bad_code' });
  assert.deepEqual(await api('POST', '/api/designs/redeem', { code: first }), [
    200,
    'application/json; charset=utf-8',
    { id: 'x-test', name: { en: 'Test', fa: 'آزمایشی' } },
  ]);
  const kept = JSON.parse(fs.readFileSync(path.join(dataDir, 'designs', 'x-test.json'), 'utf8'));
  assert.deepEqual(kept, { id: 'x-test', name: { en: 'Test', fa: 'آزمایشی' }, look: LOOK, css: CSS });

  // A chat style now: its look, its name for the panel, its CSS for the widget; the chat can use it.
  const [, , styles] = await api('GET', '/api/chat/styles');
  assert.deepEqual(
    [styles.styles['x-test'].namePos, styles.styles['x-test'].enterAnim, styles.exclusive],
    ['above', 'float', { 'x-test': { en: 'Test', fa: 'آزمایشی' } }],
  );
  assert.ok(styles.fonts.includes('Manrope'));
  assert.deepEqual(await api('GET', '/widgets/chat/designs/x-test.css'), [200, 'text/css; charset=utf-8', CSS]);
  assert.equal((await api('GET', '/widgets/chat/designs/x-nope.css'))[0], 404);
  assert.equal((await api('PATCH', '/api/settings', { chat: { style: 'x-test' } }))[2].chat.style, 'x-test');

  // CSS that could load or run anything, and looks with what isn't a design's, are never taken.
  for (const bad of [
    '@import "https://x.test/a.css";',
    '.a { background: url(https://x.test/a.png); }',
    '.a { background: url("/assets/../x"); }',
    '.a { content: "\\75 rl(x)"; }',
    '.a { background: image-set("https://x.test/a.png" 1x); }',
    '</style><script>',
    '.a { behavior: url(x.htc); }',
  ]) {
    assert.equal(designs.cssOk(bad), false, bad);
  }
  for (const good of [
    CSS,
    '@font-face { font-family: X; src: url("/assets/fonts/inter/Inter-Variable.ttf"); }',
    '.a { background: url(data:image/png;base64,iVBORw0KGgo=); }',
  ]) {
    assert.equal(designs.cssOk(good), true, good);
  }
  for (const [id, data] of [
    ['x-css', { look: LOOK, css: '@import url(https://x.test/a.css);' }],
    ['x-look', { look: { fontSize: 99 }, css: CSS }],
  ]) {
    addDesign(db, id, data);
    assert.deepEqual((await api('POST', '/api/designs/redeem', { code: await code(id) }))[2], { error: 'designs_failed' }, id);
    assert.ok(!fs.existsSync(path.join(dataDir, 'designs', `${id}.json`)));
  }
  assert.deepEqual(Object.keys((await api('GET', '/api/chat/styles'))[2].exclusive), ['x-test']);
});
