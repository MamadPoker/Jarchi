// Team messages: the relay's /admin/messages and /messages (relay/worker.mjs) on SQLite standing in for D1 (schema.sql +
// migrations). Who gets what (all, a version, dev runs, one install; never another's), plain text only, seen / closed
// counts, deactivate, expiry, delete, and an install's data deletion taking its views along. Then Jarchi's side
// (core/messages.js) through the real server to that relay: only after the Privacy Policy, only to the panel's socket
// (never a widget's), seen, closed for good (offline too).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { d1 } = require('./relay-env');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarchi-messages-'));
process.env.JARCHI_DATA_DIR = dataDir;
process.env.JARCHI_PORT = '3995';
process.env.KICK_RELAY_URL = 'https://relay.test';
const KEY = 'k'.repeat(96);
const ctx = { waitUntil() {} };

test('relay team messages: targets, plain text, seen / closed, deactivate, expiry, delete', async (t) => {
  const { default: worker } = await import('../relay/worker.mjs');
  const { db, DB } = d1(), env = { DB, ADMIN_KEY: KEY };
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-07T10:00:00.000Z') });
  const call = (p, { method = 'GET', headers = {}, body } = {}) => worker.fetch(new Request(`https://relay.test${p}`, {
    method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
  }), env, ctx);
  const admin = (p, o = {}) => call(`/admin/messages${p}`, { ...o, headers: { authorization: `Bearer ${KEY}`, 'cf-connecting-ip': '10.0.0.1' } });
  const ok = async (r) => {
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    return body;
  };
  const refused = async (r, status, error) => assert.deepEqual([r.status, await r.json()], [status, { error }]);
  const views = () => db.prepare('SELECT message_id, install_id, closed_at IS NOT NULL AS closed FROM team_message_views ORDER BY message_id, install_id').all()
    .map((v) => ({ ...v }));

  // Three installs: x the installed 1.0.4, y a 1.0.3 dev run, both pinged; z never pinged (no accepted Privacy Policy).
  const [x, y, z] = ['1', '2', '3'].map((n) => `${n.repeat(8)}-1111-4111-8111-111111111111`);
  for (const [id, version, installed] of [[x, '1.0.4', true], [y, '1.0.3', false]]) {
    const ping = { id, version, installed, open: true, kick: null, twitch: null, privacy: { version: 1, acceptedAt: null } };
    assert.equal((await call('/ping', { method: 'POST', body: ping })).status, 200);
  }
  const as = (install, version, installed) => (p = '', method = 'GET') =>
    call(`/messages${p}?version=${version}&installed=${installed}`, { method, headers: { 'x-jarchi-install': install } });
  const X = as(x, '1.0.4', 1), Y = as(y, '1.0.3', 0), Z = as(z, '1.0.4', 1);
  const ids = async (who) => (await ok(await who())).map((m) => m.id);

  // Admin only.
  assert.equal((await call('/admin/messages')).status, 401);
  assert.equal((await call('/admin/messages', { headers: { authorization: 'Bearer nope' } })).status, 401);

  // A message: plain text trimmed (titles on one line, body line ends \n), Persian's ZWNJ kept.
  const fa = 'نسخه‌ی تازه';
  const msg = (target, more = {}) => ({ title: { en: ' New   version ', fa }, body: { en: 'Line 1\r\nLine 2 ', fa }, style: 'update', target, ...more });
  const link = { label: { en: 'Download', fa: 'دانلود' }, url: 'https://github.com/MamadPoker/Jarchi/releases' };
  const all = await ok(await admin('', { method: 'POST', body: msg('all', { link }) }));
  assert.deepEqual(all, {
    id: 1, title: { en: 'New version', fa }, body: { en: 'Line 1\nLine 2', fa }, link, style: 'update',
    createdAt: '2026-11-07T10:00:00.000Z', expiresAt: null, target: 'all', active: true, seenBy: 0, closedBy: 0,
  });

  // Refused: HTML or control characters anywhere, missing or extra fields, bad style / target / link / expiry.
  const bad = [
    msg('all', { title: { en: '<b>Hi</b>', fa } }), msg('all', { body: { en: 'a > b', fa } }), msg('all', { body: { en: 'a\u0007', fa } }),
    msg('all', { link: { ...link, label: { en: '<img>', fa: 'x' } } }), msg('all', { title: { en: 'Hi' } }), msg('all', { title: { en: ' ', fa } }),
    msg('all', { body: { en: 'x'.repeat(2001), fa } }), msg('all', { style: 'danger' }), msg('everyone'), msg({ version: '1.0' }),
    msg({ install: 'nope' }), msg({ version: ['1.0.4'] }), msg('all', { link: { ...link, url: 'http://example.com' } }),
    msg('all', { link: { ...link, url: 'javascript:alert(1)' } }), msg('all', { link: { url: link.url } }), msg('all', { expiresAt: 'tomorrow' }),
    msg('all', { html: '<b>' }), [], null,
  ];
  for (const body of bad) await refused(await admin('', { method: 'POST', body }), 400, 'bad_request');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM team_messages').get().n, 1, 'nothing refused was stored');

  // One for each target, an expiring one, and one already expired.
  const make = async (target, more) => (await ok(await admin('', { method: 'POST', body: msg(target, more) }))).id;
  const v104 = await make({ version: '1.0.4' }), dev = await make('dev'), forX = await make({ install: x }), forY = await make({ install: y });
  const soon = await make('all', { expiresAt: '2026-11-07T11:00:00.000Z' }), gone = await make('all', { expiresAt: '2026-11-07T09:00:00.000Z' });

  // Each install gets only its own, newest first; one that never pinged gets none.
  assert.deepEqual(await ids(X), [soon, forX, v104, all.id]);
  assert.deepEqual(await ids(Y), [soon, forY, dev, all.id]);
  assert.deepEqual(await ids(Z), []);
  const [first] = await ok(await X());
  assert.deepEqual(first, { id: soon, title: all.title, body: all.body, link: null, style: 'update', createdAt: all.createdAt,
    expiresAt: '2026-11-07T11:00:00.000Z', seen: false }, 'no target, active or counts for the install');

  // Who's asking must be clear.
  for (const p of ['?version=1.0.4', '?version=1.0&installed=1', '?version=1.0.4&installed=2']) {
    await refused(await call(`/messages${p}`, { headers: { 'x-jarchi-install': x } }), 400, 'bad_request');
  }
  await refused(await call('/messages?version=1.0.4&installed=1', { headers: { 'x-jarchi-install': 'nope' } }), 400, 'bad_request');
  await refused(await X('', 'POST'), 405, 'method');
  await refused(await X(`/${forX}/seen`, 'GET'), 405, 'method');
  await refused(await X(`/${forX}/read`, 'POST'), 404, 'not_found');

  // Seen / closed: only messages meant for the install, nothing written for the others.
  assert.deepEqual(await ok(await X(`/${forX}/seen`, 'POST')), { seen: forX });
  assert.deepEqual(await ok(await X(`/${forX}/seen`, 'POST')), { seen: forX }, 'again: still once');
  for (const id of [forY, dev, gone, 999]) await refused(await X(`/${id}/seen`, 'POST'), 404, 'not_found');
  await refused(await Z(`/${all.id}/closed`, 'POST'), 404, 'not_found');
  assert.deepEqual((await ok(await X())).map((m) => m.seen), [false, true, false, false]);
  assert.deepEqual(await ok(await X(`/${all.id}/closed`, 'POST')), { closed: all.id });
  const closedAt = db.prepare('SELECT closed_at FROM team_message_views WHERE message_id = ?').get(all.id).closed_at;
  t.mock.timers.tick(60000);
  await ok(await X(`/${all.id}/closed`, 'POST'));
  assert.equal(db.prepare('SELECT closed_at FROM team_message_views WHERE message_id = ?').get(all.id).closed_at, closedAt, 'the first close kept');
  assert.deepEqual(await ids(X), [soon, forX, v104], 'closed: off its list');
  assert.deepEqual(await ids(Y), [soon, forY, dev, all.id], 'still on the others');
  await ok(await Y(`/${all.id}/seen`, 'POST'));
  assert.deepEqual(views(), [{ message_id: all.id, install_id: x, closed: 1 }, { message_id: all.id, install_id: y, closed: 0 }, { message_id: forX, install_id: x, closed: 0 }]);

  // The admin's list: newest first, how many installs saw / closed each.
  const list = await ok(await admin(''));
  assert.deepEqual(list.map((m) => [m.id, m.target, m.seenBy, m.closedBy]), [
    [gone, 'all', 0, 0], [soon, 'all', 0, 0], [forY, { install: y }, 0, 0], [forX, { install: x }, 1, 0], [dev, 'dev', 0, 0],
    [v104, { version: '1.0.4' }, 0, 0], [all.id, 'all', 2, 1],
  ]);

  // Deactivate (and back), expiry.
  for (const body of [{ active: 'no' }, { active: false, x: 1 }, null]) await refused(await admin(`/${v104}`, { method: 'PATCH', body }), 400, 'bad_request');
  await refused(await admin('/999', { method: 'PATCH', body: { active: false } }), 404, 'not_found');
  assert.equal((await ok(await admin(`/${v104}`, { method: 'PATCH', body: { active: false } }))).active, false);
  assert.deepEqual(await ids(X), [soon, forX]);
  await refused(await X(`/${v104}/seen`, 'POST'), 404, 'not_found');
  assert.equal((await ok(await admin(`/${v104}`, { method: 'PATCH', body: { active: true } }))).active, true);
  assert.deepEqual(await ids(X), [soon, forX, v104]);
  t.mock.timers.tick(60 * 60 * 1000);
  assert.deepEqual(await ids(X), [forX, v104], 'expired');
  await refused(await admin('', { method: 'PUT' }), 405, 'method');
  await refused(await admin('/abc'), 404, 'not_found');

  // Delete: the message and its views. An install's data deletion takes its views too.
  assert.deepEqual(await ok(await admin(`/${all.id}`, { method: 'DELETE' })), { deleted: all.id });
  await refused(await admin(`/${all.id}`, { method: 'DELETE' }), 404, 'not_found');
  assert.deepEqual(views(), [{ message_id: forX, install_id: x, closed: 0 }]);
  assert.equal((await call(`/admin/installs/${x}`, { method: 'DELETE', headers: { authorization: `Bearer ${KEY}` } })).status, 200);
  assert.deepEqual(views(), []);
  assert.deepEqual(await ids(X), [], 'gone with its row');
});

test('Jarchi: team messages from the relay, to the panel only; seen, closed for good (offline too)', async (t) => {
  const { default: worker } = await import('../relay/worker.mjs');
  const { db, DB } = d1(), env = { DB, ADMIN_KEY: KEY };
  const real = globalThis.fetch, asked = [];
  let down = false;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    if (u.host !== 'relay.test') return real(url, init);
    asked.push({ at: `${init.method ?? 'GET'} ${u.pathname}${u.search}`, install: init.headers?.['x-jarchi-install'] });
    if (down) throw new TypeError('fetch failed');
    return worker.fetch(new Request(url, init), env, ctx);
  };
  const { server, io } = require('../server');
  const settings = require('../core/settings');
  const messages = require('../core/messages');
  const { version } = require('../package.json');
  t.after(() => {
    io.close();
    server.closeAllConnections();
  });
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  const call = async (p) => {
    const r = await real(`http://127.0.0.1:3995/api${p}`, { method: 'POST', headers: { 'x-jarchi': '1' } });
    return [r.status, await r.json()];
  };
  const until = async (ok, what) => {
    for (let i = 0; i < 300 && !ok(); i++) await new Promise((r) => setTimeout(r, 10));
    assert.ok(ok(), what);
  };
  const post = async (body) => (await (await worker.fetch(new Request('https://relay.test/admin/messages', {
    method: 'POST', headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), env, ctx)).json()).id;
  const msg = (target) => ({ title: { en: 'Hi', fa: 'سلام' }, body: { en: 'Text', fa: 'متن' }, style: 'info', target });
  const views = () => db.prepare('SELECT message_id AS id, closed_at IS NOT NULL AS closed FROM team_message_views ORDER BY id').all().map((v) => ({ ...v }));
  const ids = () => messages.list().map((m) => m.id);

  // The team's messages: this dev run (npm start / npm run app) gets all, its version's and dev runs'; never the others.
  const all = await post(msg('all')), dev = await post(msg('dev')), mine = await post(msg({ version }));
  await post(msg({ install: crypto.randomUUID() }));
  await post(msg({ version: '0.0.1' }));

  // Nothing asked before the Privacy Policy is accepted.
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual([asked.length, ids()], [0, []]);
  await real('http://127.0.0.1:3995/api/settings', { method: 'PATCH', headers: { 'x-jarchi': '1', 'content-type': 'application/json' }, body: '{"privacyAccepted":1}' });
  await until(() => ids().length === 3, 'loaded after the first ping');
  assert.deepEqual(ids(), [mine, dev, all]);
  assert.deepEqual(asked.map((a) => a.at), ['POST /ping', `GET /messages?version=${version}&installed=0`]);
  assert.equal(asked[1].install, settings.installId());

  // Only the panel's socket gets them: never a widget's (OBS).
  const got = { panel: [], widget: [] };
  const sio = (who, join) => {
    const ws = new WebSocket('ws://127.0.0.1:3995/socket.io/?EIO=4&transport=websocket');
    ws.onmessage = ({ data }) => {
      if (data.startsWith('0')) ws.send('40');
      else if (data.startsWith('40')) ws.send(join);
      else if (data.startsWith('42["teamMessages"')) got[who].push(JSON.parse(data.slice(2))[1].map((m) => [m.id, m.seen]));
    };
    return ws;
  };
  const sockets = [sio('panel', '42["panelJoin"]'), sio('widget', '42["widgetJoin","chat"]')];
  t.after(() => sockets.forEach((ws) => ws.close()));
  await until(() => got.panel.length === 1, 'the panel gets the list');
  assert.deepEqual(got.panel[0], [[mine, false], [dev, false], [all, false]]);

  // Shown on Home = seen, on the relay once.
  assert.deepEqual(await call(`/messages/${all}/seen`), [200, messages.list()]);
  await until(() => views().length === 1, 'seen on the relay');
  assert.deepEqual(views(), [{ id: all, closed: 0 }]);
  assert.deepEqual(got.panel.at(-1), [[mine, false], [dev, false], [all, true]]);
  for (const p of ['/messages/999/seen', `/messages/${all}/read`, `/messages/${all}/constructor`]) assert.deepEqual(await call(p), [404, { error: 'not_found' }], p);

  // Closed with the relay out of reach: gone here at once and kept on disk; the relay is told when it's back.
  down = true;
  assert.equal((await call(`/messages/${dev}/closed`))[0], 200);
  assert.deepEqual(ids(), [mine, all]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'messages.json'), 'utf8')), { closed: [dev] });
  await messages.load(); // offline: what it had stays
  assert.deepEqual(ids(), [mine, all]);
  down = false;
  await messages.load(); // the relay still sends it: not shown, and told it's closed
  assert.deepEqual(ids(), [mine, all]);
  await until(() => views().some((v) => v.id === dev && v.closed), 'closed on the relay');
  await messages.load();
  assert.deepEqual(ids(), [mine, all], 'the relay leaves it out now');
  assert.deepEqual(got.panel.at(-1), [[mine, false], [all, true]]);
  assert.deepEqual(got.widget, [], 'never to a widget');
});
