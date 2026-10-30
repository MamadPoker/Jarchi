// Support tickets: the relay's /support and /admin/tickets (relay/worker.mjs) on SQLite + a Map standing in for D1 and
// KV, then the panel's /api/support through the real Jarchi server (core/support.js) to that same relay.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { d1, kv } = require('./relay-env');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarchi-support-'));
process.env.JARCHI_DATA_DIR = dataDir;
process.env.JARCHI_PORT = '3996';
process.env.KICK_RELAY_URL = 'https://relay.test';
const ctx = { waitUntil() {} };
const KEY = 'k'.repeat(96);
const picture = (format) => sharp({ create: { width: 4, height: 3, channels: 3, background: '#e33' } })[format]().toBuffer();
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const form = (fields, images = []) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  images.forEach((b, i) => f.append('image', new Blob([b]), `shot-${i}.png`));
  return f;
};

test('relay /support and /admin/tickets: tokens, forms, screenshots, unread, status, limits, delete', async (t) => {
  const { default: worker } = await import('../relay/worker.mjs');
  const { db, DB } = d1(), { map: shots, KV } = kv(), env = { DB, SHOTS: KV, ADMIN_KEY: KEY };
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-23T10:00:00.000Z') });
  const install = crypto.randomUUID(), me = { 'x-jarchi-install': install, authorization: `Bearer ${'a'.repeat(64)}` };
  const call = (p, { method = 'GET', headers = me, body, to = env } = {}) => worker.fetch(new Request(`https://relay.test${p}`, { method, headers, body }), to, ctx);
  const admin = (p, o = {}) => call(`/admin${p}`, { ...o, headers: { authorization: `Bearer ${KEY}`, 'cf-connecting-ip': '10.0.0.1', ...o.headers } });
  const ok = async (r) => {
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    return body;
  };
  const refused = async (r, status, error) => assert.deepEqual([r.status, await r.json()], [status, { error }]);
  const png = await picture('png'), webp = await picture('webp'), jpg = await picture('jpeg');
  const bug = { category: 'bug', subject: '  Alerts   stop ', message: 'Line 1\r\nLine 2 ' };

  // Who's asking: an install id and a 64-hex token, or nothing at all.
  for (const headers of [{}, { ...me, authorization: 'Bearer nope' }, { ...me, 'x-jarchi-install': 'x' }, { 'x-jarchi-install': install }]) {
    await refused(await call('/support/tickets', { headers }), 401, 'unauthorized');
  }
  // Only installs that have pinged (an accepted Privacy Policy) make tickets.
  await refused(await call('/support/tickets', { method: 'POST', body: form(bug) }), 403, 'unknown_install');
  const ping = { id: install, version: '1.0.0', installed: true, open: true, kick: { name: 'Mamad_Poker', picture: '', live: false }, twitch: null, privacy: { version: 1, acceptedAt: null } };
  assert.equal((await call('/ping', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ping) })).status, 200);

  // A new ticket: trimmed text, two screenshots in KV under the ticket's id, nothing about the install shown back.
  const made = await ok(await call('/support/tickets', { method: 'POST', body: form(bug, [png, webp]) }));
  const { id } = made, at = '2026-10-23T10:00:00.000Z';
  assert.match(id, /^[0-9A-F]{8}$/);
  assert.deepEqual({ ...made, messages: made.messages.map((m) => ({ ...m, images: m.images.length })) }, {
    id, category: 'bug', subject: 'Alerts stop', status: 'open', createdAt: at, updatedAt: at,
    messages: [{ author: 'user', text: 'Line 1\nLine 2', images: 2, at }],
  });
  const [pngName, webpName] = made.messages[0].images;
  assert.match(pngName, /^[0-9a-f]{32}\.png$/);
  assert.match(webpName, /^[0-9a-f]{32}\.webp$/);
  assert.deepEqual([...shots.keys()], [`${id}/${pngName}`, `${id}/${webpName}`]);
  let r = await call(`/support/tickets/${id}/images/${pngName}`);
  assert.deepEqual([r.status, r.headers.get('content-type'), r.headers.get('x-content-type-options')], [200, 'image/png', 'nosniff']);
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), png);
  assert.deepEqual(await ok(await call('/support/tickets')), [{ id, category: 'bug', subject: 'Alerts stop', status: 'open', createdAt: at, updatedAt: at, messages: 1, unread: false }]);
  const row = db.prepare('SELECT * FROM tickets').get();
  assert.deepEqual([row.install_id, row.kick_name, row.twitch_name, row.token_hash.length], [install, 'Mamad_Poker', null, 64], 'channels from its ping, the token only hashed');

  // Another token for this install: no ticket, nothing of the first one to see. Another install: the same.
  const other = { ...me, authorization: `Bearer ${'b'.repeat(64)}` }, stranger = { ...me, 'x-jarchi-install': crypto.randomUUID() };
  await refused(await call('/support/tickets', { method: 'POST', headers: other, body: form(bug) }), 401, 'unauthorized');
  for (const headers of [other, stranger]) {
    assert.deepEqual(await ok(await call('/support/tickets', { headers })), []);
    await refused(await call(`/support/tickets/${id}`, { headers }), 404, 'not_found');
    await refused(await call(`/support/tickets/${id}/images/${pngName}`, { headers }), 404, 'not_found');
    await refused(await call(`/support/tickets/${id}/messages`, { method: 'POST', headers, body: form({ message: 'hi' }) }), 404, 'not_found');
  }

  // Refused forms: nothing saved.
  const post = (fields, images) => call('/support/tickets', { method: 'POST', body: form(fields, images) });
  for (const bad of [{ ...bug, category: 'nope' }, { ...bug, subject: '   ' }, { ...bug, subject: 'x'.repeat(121) }, { ...bug, message: '' },
    { category: 'bug', subject: 'x' }, { ...bug, message: 'x'.repeat(5001) }, { ...bug, extra: '1' }]) await refused(await post(bad), 400, 'bad_request');
  await refused(await post(bug, [Buffer.from('GIF89a\x01\x00\x01\x00')]), 400, 'bad_image');
  await refused(await post(bug, [Buffer.from('not a picture at all')]), 400, 'bad_image');
  await refused(await post(bug, [Buffer.concat([png.subarray(0, 8), Buffer.alloc(2 * 1024 * 1024)])]), 413, 'image_too_large');
  await refused(await post(bug, [png, png, png, png]), 400, 'too_many_images');
  await refused(await post({ ...bug, message: 'x'.repeat(7e6) }), 413, 'too_large');
  await refused(await call('/support/tickets', { method: 'POST', headers: { ...me, 'content-type': 'application/json' }, body: JSON.stringify(bug) }), 415, 'bad_request');
  await refused(await call(`/support/tickets/${id}`, { method: 'DELETE' }), 405, 'method');
  await refused(await call('/support/tickets/nope'), 404, 'not_found');
  assert.deepEqual([db.prepare('SELECT COUNT(*) AS n FROM tickets').get().n, shots.size], [1, 2]);

  // The admin: the key first, then every ticket with whose it is; unread until opened.
  assert.equal((await call('/admin/tickets', { headers: { 'cf-connecting-ip': '10.0.0.2' } })).status, 401);
  let list = await ok(await admin('/tickets'));
  assert.deepEqual(list, { unread: 1, tickets: [{ id, category: 'bug', subject: 'Alerts stop', status: 'open', createdAt: at, updatedAt: at,
    installId: install, kick: 'Mamad_Poker', twitch: null, hiddenByUser: false, hiddenByUserAt: null, messages: 1, unread: true, lastAuthor: 'user', lastMessageAt: at }] });
  assert.equal((await ok(await admin('/tickets?category=bug&status=open'))).tickets.length, 1);
  assert.deepEqual(await ok(await admin('/tickets?status=closed')), { unread: 1, tickets: [] }, 'unread counts every ticket');
  for (const q of ['status=nope', 'category=Bug']) await refused(await admin(`/tickets?${q}`), 400, 'bad_request');
  const seen = await ok(await admin(`/tickets/${id}`));
  assert.deepEqual([seen.installId, seen.messages.length, seen.messages[0].images], [install, 1, [pngName, webpName]]);
  assert.deepEqual(Buffer.from(await (await admin(`/tickets/${id}/images/${webpName}`)).arrayBuffer()), webp);
  assert.equal((await ok(await admin('/tickets'))).unread, 0, 'opened');

  // The admin's reply: unread for the install until it opens the ticket.
  t.mock.timers.tick(60e3);
  const replied = await ok(await admin(`/tickets/${id}/messages`, { method: 'POST', body: form({ message: 'Thanks! Fixed in 1.0.1.' }) }));
  assert.deepEqual(replied.messages.at(-1), { author: 'admin', text: 'Thanks! Fixed in 1.0.1.', images: [], at: '2026-10-23T10:01:00.000Z' });
  assert.deepEqual((await ok(await call('/support/tickets')))[0], { id, category: 'bug', subject: 'Alerts stop', status: 'open', createdAt: at,
    updatedAt: '2026-10-23T10:01:00.000Z', messages: 2, unread: true });
  assert.equal((await ok(await call(`/support/tickets/${id}`))).messages.length, 2);
  assert.equal((await ok(await call('/support/tickets')))[0].unread, false, 'opened');
  assert.equal((await ok(await admin('/tickets'))).unread, 0, "the admin's own reply isn't unread for the admin");
  const last = async () => { const x = (await ok(await admin('/tickets'))).tickets[0]; return [x.lastAuthor, x.lastMessageAt]; };
  assert.deepEqual(await last(), ['admin', '2026-10-23T10:01:00.000Z'], 'who wrote last, without opening it');

  // The install answers with a screenshot only (JPG); empty is refused. The admin sees it unread.
  t.mock.timers.tick(60e3);
  const answered = await ok(await call(`/support/tickets/${id}/messages`, { method: 'POST', body: form({}, [jpg]) }));
  assert.deepEqual([answered.messages.length, answered.messages[2].text, answered.messages[2].images.length], [3, '', 1]);
  assert.match(answered.messages[2].images[0], /\.jpg$/);
  await refused(await call(`/support/tickets/${id}/messages`, { method: 'POST', body: form({ message: '  ' }) }), 400, 'bad_request');
  await refused(await call(`/support/tickets/${id}/messages`, { method: 'POST', body: form({ message: 'x', subject: 'y' }) }), 400, 'bad_request');
  assert.equal((await ok(await admin('/tickets'))).unread, 1);
  assert.deepEqual(await last(), ['user', '2026-10-23T10:02:00.000Z']);

  // Status: the admin's only; a closed ticket takes no more messages from the install.
  assert.equal((await ok(await admin(`/tickets/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"status":"progress"}' }))).status, 'progress');
  for (const body of ['{"status":"done"}', '{"status":"closed","x":1}', 'nope']) await refused(await admin(`/tickets/${id}`, { method: 'PATCH', body }), 400, 'bad_request');
  await refused(await call(`/support/tickets/${id}`, { method: 'PATCH', body: '{"status":"closed"}' }), 400, 'bad_request');
  await refused(await call(`/support/tickets/${id}`, { method: 'PATCH', body: '{"hidden":true}' }), 409, 'not_closed');
  t.mock.timers.tick(60e3);
  assert.equal((await ok(await admin(`/tickets/${id}`, { method: 'PATCH', body: '{"status":"closed"}' }))).status, 'closed');
  assert.deepEqual((await ok(await call('/support/tickets'))).map((x) => [x.status, x.updatedAt]), [['closed', '2026-10-23T10:03:00.000Z']]);
  await refused(await call(`/support/tickets/${id}/messages`, { method: 'POST', body: form({ message: 'Still broken' }) }), 409, 'closed');
  assert.equal((await ok(await admin(`/tickets/${id}/messages`, { method: 'POST', body: form({ message: 'Reopen if needed.' }) }))).messages.length, 4, 'the admin still can');

  // Off the install's list once closed: nothing deleted, the admin still sees it; reopened, it's back on the list.
  for (const body of ['{"hidden":false}', '{"hidden":true,"x":1}', 'nope']) await refused(await call(`/support/tickets/${id}`, { method: 'PATCH', body }), 400, 'bad_request');
  for (const headers of [other, stranger]) await refused(await call(`/support/tickets/${id}`, { method: 'PATCH', headers, body: '{"hidden":true}' }), 404, 'not_found');
  assert.deepEqual(await ok(await call(`/support/tickets/${id}`, { method: 'PATCH', body: '{"hidden":true}' })), { hidden: id });
  assert.deepEqual(await ok(await call('/support/tickets')), []);
  const hidden = (await ok(await admin('/tickets'))).tickets[0];
  assert.deepEqual([hidden.id, hidden.status, hidden.hiddenByUser, hidden.hiddenByUserAt], [id, 'closed', true, '2026-10-23T10:03:00.000Z']);
  assert.deepEqual([(await ok(await admin(`/tickets/${id}`))).messages.length, shots.size], [4, 3], 'messages and screenshots kept');
  t.mock.timers.tick(60e3);
  assert.equal((await ok(await call(`/support/tickets/${id}`, { method: 'PATCH', body: '{"hidden":true}' }))).hidden, id, 'again: ok');
  assert.equal((await ok(await admin('/tickets'))).tickets[0].hiddenByUserAt, '2026-10-23T10:03:00.000Z', 'the first time kept');
  assert.equal((await ok(await admin(`/tickets/${id}`, { method: 'PATCH', body: '{"status":"open"}' }))).hiddenByUser, false);
  assert.deepEqual((await ok(await call('/support/tickets'))).map((x) => [x.id, x.status]), [[id, 'open']]);

  // Limits: 5 new tickets an install a day, 30 messages (new tickets' too) an hour.
  for (let i = 0; i < 4; i++) await ok(await post({ ...bug, category: 'question' }));
  await refused(await post(bug), 429, 'ticket_limit');
  t.mock.timers.tick(24 * 3600e3 - 4 * 60e3 - 1); // just before 10:00 the next day, when the first ticket is a day old
  await refused(await post(bug), 429, 'ticket_limit');
  t.mock.timers.tick(1);
  const open = await ok(await post({ ...bug, category: 'suggestion' }));
  for (let i = 1; i < 30; i++) await ok(await call(`/support/tickets/${open.id}/messages`, { method: 'POST', body: form({ message: `#${i}` }) }));
  await refused(await call(`/support/tickets/${open.id}/messages`, { method: 'POST', body: form({ message: 'one more' }) }), 429, 'message_limit');
  assert.equal((await ok(await admin(`/tickets/${open.id}/messages`, { method: 'POST', body: form({ message: 'ok' }) }))).messages.length, 31, "the admin's don't count");
  t.mock.timers.tick(3600e3);
  await ok(await call(`/support/tickets/${open.id}/messages`, { method: 'POST', body: form({ message: 'an hour later' }) }));
  assert.equal((await ok(await admin('/tickets?category=question'))).tickets.length, 4);

  // KV refusing a screenshot (full for today): nothing saved, a clear error.
  const full = { ...env, SHOTS: { ...KV, put: async () => { throw new Error('KV put() limit exceeded for the day.'); } } };
  const before = db.prepare('SELECT COUNT(*) AS n FROM ticket_messages').get().n;
  await refused(await call(`/support/tickets/${open.id}/messages`, { method: 'POST', body: form({ message: 'pic' }, [png]), to: full }), 503, 'storage');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ticket_messages').get().n, before);

  // Delete: the ticket, its messages and its screenshots; nothing without the key, nothing of another ticket.
  for (const key of [{}, { authorization: 'Bearer nope' }]) {
    assert.equal((await call(`/admin/tickets/${id}`, { method: 'DELETE', headers: { ...key, 'cf-connecting-ip': '10.0.0.3' } })).status, 401);
  }
  assert.equal((await ok(await admin(`/tickets/${id}`))).id, id, 'still there');
  await ok(await admin(`/tickets/${open.id}/messages`, { method: 'POST', body: form({ message: 'pic' }, [png]) }));
  const others = () => [db.prepare('SELECT COUNT(*) AS n FROM tickets').get().n, db.prepare('SELECT COUNT(*) AS n FROM ticket_messages WHERE ticket_id != ?').get(id).n, [...shots.keys()].filter((k) => !k.startsWith(id))];
  const kept = others();
  assert.deepEqual(await ok(await admin(`/tickets/${id}`, { method: 'DELETE' })), { deleted: id });
  assert.deepEqual([...shots.keys()].filter((k) => k.startsWith(id)), []);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ticket_messages WHERE ticket_id = ?').get(id).n, 0);
  assert.deepEqual(others(), [kept[0] - 1, kept[1], kept[2]], "the other tickets' rows and screenshots kept");
  assert.equal(kept[2].length, 1);
  await refused(await call(`/support/tickets/${id}`), 404, 'not_found');
  await refused(await admin(`/tickets/${id}`, { method: 'DELETE' }), 404, 'not_found');
  await refused(await admin('/tickets', { method: 'POST', body: form(bug) }), 405, 'method');
  assert.equal((await ok(await call('/support/tickets'))).length, 5);
  assert.ok((await ok(await call('/support/tickets'))).every((x) => ISO.test(x.createdAt)));
});

test('panel /api/support through Jarchi: Privacy Policy first, the token never shown, offline, retry after a ping', async (t) => {
  const { default: worker } = await import('../relay/worker.mjs');
  const { db, DB } = d1(), { KV } = kv(), env = { DB, SHOTS: KV, ADMIN_KEY: KEY };
  const real = globalThis.fetch, asked = [];
  let down = false, last; // last: the relay's latest answer, still coming
  globalThis.fetch = async (url, init) => {
    const u = new URL(url);
    if (u.host !== 'relay.test') return real(url, init);
    asked.push({ path: u.pathname, headers: init.headers });
    if (down) throw new TypeError('fetch failed');
    return (last = worker.fetch(new Request(url, init), env, ctx));
  };
  const { server, io } = require('../server');
  const settings = require('../core/settings');
  t.after(() => {
    io.close();
    server.closeAllConnections();
  });
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  const call = async (method, p, body) => {
    const r = await real(`http://127.0.0.1:3996/api${p}`, { method, headers: { 'x-jarchi': '1', ...(typeof body === 'string' && { 'content-type': 'application/json' }) }, body });
    return { status: r.status, type: r.headers.get('content-type'), body: r.headers.get('content-type')?.startsWith('application/json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
  const support = () => asked.filter((a) => a.path.startsWith('/support'));

  // Nothing before the Privacy Policy is accepted.
  assert.deepEqual(await call('GET', '/support/tickets'), { status: 403, type: 'application/json; charset=utf-8', body: { error: 'support_privacy' } });
  assert.equal(asked.length, 0);
  await call('PATCH', '/settings', '{"privacyAccepted":1}');
  // No ticket yet: the list is empty without asking the relay, and there's no token.
  assert.deepEqual((await call('GET', '/support/tickets')).body, []);
  assert.deepEqual([support().length, settings.supportToken()], [0, null]);

  // A ticket from the panel's form, screenshot and all; the relay gets this install's id and token, the panel neither.
  const png = await picture('png');
  await last; // the ping from accepting it
  db.exec('DELETE FROM installs'); // as if its ping never got there: Jarchi pings, then tries again
  const made = await call('POST', '/support/tickets', form({ category: 'question', subject: 'Goals?', message: 'How do goals sync?' }, [png]));
  assert.equal(made.status, 200, JSON.stringify(made.body));
  assert.deepEqual([made.body.subject, made.body.messages[0].images.length], ['Goals?', 1]);
  const token = settings.supportToken();
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.deepEqual(support().map((a) => [a.path, a.headers['x-jarchi-install'], a.headers.authorization]), [
    ['/support/tickets', settings.installId(), `Bearer ${token}`], ['/support/tickets', settings.installId(), `Bearer ${token}`]]);
  assert.ok(asked.some((a) => a.path === '/ping'), 'the ping in between');
  const settingsShown = JSON.stringify((await call('GET', '/settings')).body);
  assert.ok(!settingsShown.includes(token) && !settingsShown.includes('supportToken'), 'never in the panel');

  // The list, the ticket, its screenshot (as a PNG, by its bytes), a message.
  const { id } = made.body, name = made.body.messages[0].images[0];
  assert.deepEqual((await call('GET', '/support/tickets')).body.map((x) => x.id), [id]);
  assert.equal((await call('GET', `/support/tickets/${id}`)).body.messages[0].text, 'How do goals sync?');
  const shot = await call('GET', `/support/tickets/${id}/images/${name}`);
  assert.deepEqual([shot.status, shot.type, shot.body], [200, 'image/png', png]);
  assert.equal((await call('POST', `/support/tickets/${id}/messages`, form({ message: 'Thanks' }))).body.messages.length, 2);
  assert.deepEqual((await call('PATCH', `/support/tickets/${id}`, '{"hidden":true}')).body, { error: 'support_not_closed' });

  // The relay's errors in the panel's words; addresses that aren't the relay's tickets never go there.
  await call('PATCH', '/settings', '{"privacyAccepted":1}'); // (no change)
  db.prepare("UPDATE tickets SET status = 'closed'").run();
  assert.deepEqual((await call('POST', `/support/tickets/${id}/messages`, form({ message: 'x' }))).body, { error: 'support_closed' });
  assert.deepEqual((await call('POST', '/support/tickets', form({ category: 'bug', subject: 's', message: 'm' }, [Buffer.from('nope')]))).body, { error: 'support_bad_image' });
  const n = support().length;
  for (const p of ['/support/tickets/abcdef12', `/support/tickets/${id}/x`, '/support/admin', `/support/tickets/${id}/images/..%2F..%2Fadmin`]) {
    assert.deepEqual((await call('GET', p)).body, { error: 'support_not_found' }, p);
  }
  assert.equal(support().length, n);

  // The relay can't be reached.
  down = true;
  assert.deepEqual(await call('GET', '/support/tickets'), { status: 502, type: 'application/json; charset=utf-8', body: { error: 'support_offline' } });
  down = false;

  // Reset everything: still this install's tickets.
  await call('POST', '/reset');
  assert.equal(settings.supportToken(), token);
  await call('PATCH', '/settings', '{"privacyAccepted":1}');
  assert.deepEqual((await call('GET', '/support/tickets')).body.map((x) => x.id), [id]);

  // A closed ticket off the list (the panel's trash button).
  assert.deepEqual((await call('PATCH', `/support/tickets/${id}`, '{"hidden":true}')).body, { hidden: id });
  assert.deepEqual((await call('GET', '/support/tickets')).body, []);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tickets').get().n, 1, 'still on the relay');
});
