// Team messages: the relay's /admin/messages and /messages (relay/worker.mjs) on SQLite standing in for D1 (schema.sql +
// migrations). Who gets what (all, a version, dev runs, one install; never another's), plain text only, seen / closed
// counts, deactivate, expiry, delete, and an install's data deletion taking its views along.
const test = require('node:test');
const assert = require('node:assert/strict');
const { d1 } = require('./relay-env');

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
