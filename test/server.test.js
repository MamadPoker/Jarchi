// Smoke test: boots the real server on a temp data dir and exercises settings, uploads, reset and the event bus.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarchi-'));
process.env.JARCHI_DATA_DIR = dataDir;
process.env.JARCHI_PORT = '3999';
const { server, io } = require('../server');
const { bus } = require('../core/events');

const base = 'http://127.0.0.1:3999';
const call = (method, url, body, headers = {}) => fetch(base + url, {
  method,
  headers: { 'x-jarchi': '1', ...(body && !Buffer.isBuffer(body) && { 'content-type': 'application/json' }), ...headers },
  body: Buffer.isBuffer(body) ? body : body && JSON.stringify(body),
});
const upload = (type, kind, buf) => call('POST', `/api/upload/${type}/${kind}`, buf, { 'content-type': 'application/octet-stream', 'x-filename': 'party.gif' });

test('settings, uploads, reset, events', async (t) => {
  t.after(() => io.close());
  if (!server.listening) await new Promise((r) => server.once('listening', r));

  let s = await (await call('GET', '/api/settings')).json();
  assert.equal(s.theme, 'neon');
  assert.equal(s.alerts.kicks.minAmount, 0);
  assert.ok(!('minAmount' in s.alerts.follow));

  let r = await call('PATCH', '/api/settings', { theme: 'fun', alerts: { follow: { volume: 0.3 } } });
  s = await r.json();
  assert.equal(s.theme, 'fun');
  assert.equal(s.alerts.follow.volume, 0.3);

  assert.equal((await call('PATCH', '/api/settings', { alerts: { follow: { volume: 5 } } })).status, 400);
  assert.equal((await call('PATCH', '/api/settings', { alerts: { follow: { minAmount: 5 } } })).status, 400);
  assert.equal((await fetch(base + '/api/reset', { method: 'POST' })).status, 403, 'missing x-jarchi header must be rejected');

  r = await upload('follow', 'image', Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1'));
  assert.equal(r.status, 200);
  const file = (await r.json()).alerts.follow.image.file;
  assert.ok(fs.existsSync(path.join(dataDir, 'uploads', file)));
  assert.equal((await fetch(`${base}/uploads/${file}`)).status, 200);

  assert.equal((await upload('follow', 'image', Buffer.from('<html>not an image</html>'))).status, 400);
  assert.equal((await upload('follow', 'sound', Buffer.from('GIF89a', 'latin1'))).status, 400, 'gif is not a sound');
  assert.equal((await upload('follow', 'image', Buffer.alloc(21 * 1024 * 1024))).status, 413);

  s = await (await call('POST', '/api/reset/follow')).json();
  assert.equal(s.alerts.follow.image, null);
  assert.equal(s.alerts.follow.volume, 0.7);
  assert.equal(s.theme, 'fun', 'per-type reset keeps the theme');
  assert.ok(!fs.existsSync(path.join(dataDir, 'uploads', file)));

  s = await (await call('POST', '/api/reset')).json();
  assert.equal(s.theme, 'neon');

  const got = new Promise((r) => bus.once('event', r));
  assert.equal((await call('POST', '/api/test/kicks', { platform: 'kick' })).status, 200);
  const ev = await got;
  assert.deepEqual([ev.platform, ev.type, ev.amount, ev.test], ['kick', 'kicks', 100, true]);
});
