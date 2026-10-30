// Usage stats: Jarchi's ping (core/stats.js) with fake Kick, Twitch and relay (no network), and the relay's POST /ping
// (relay/worker.mjs) on a real SQLite with schema.sql standing in for D1. Nothing before the Privacy Policy is
// accepted; only the listed fields (connection diagnostics as codes); a relay that's down changes nothing;
// the relay's rows, refusals and rate limit.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { d1 } = require('./relay-env');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarchi-stats-'));
process.env.JARCHI_DATA_DIR = dataDir;
process.env.KICK_RELAY_URL = 'https://relay.test/';
const far = Date.now() + 3600e3;
fs.writeFileSync(path.join(dataDir, 'kick.json'), JSON.stringify({ access: 'KA', refresh: 'KR', expires: far, userId: 42, login: 'Mamad_Poker', picture: 'https://files.kick.com/images/user/42/p.webp' }));
fs.writeFileSync(path.join(dataDir, 'twitch.json'), JSON.stringify({ access: 'TA', refresh: 'TR', expires: far, userId: '7', login: 'mamadpoker', picture: 'https://static-cdn.jtvnw.net/jtv_user_pictures/p.png' }));

const calls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  calls.push({ at: `${u.host}${u.pathname}`, query: u.search, body: init.body });
  if (u.host === 'api.twitch.tv' && u.pathname === '/helix/streams') return Response.json({ data: [{ type: 'live' }] });
  if (u.host === 'relay.test') return new Response('ok');
  return new Response(null, { status: 404 });
};
const kickAsked = [];
require('../connectors/kick-chat').kickGet = async (p) => (kickAsked.push(p), { status: 200, json: { livestream: null } }); // offline
const settings = require('../core/settings');
const stats = require('../core/stats');
const pings = () => calls.filter((c) => c.at === 'relay.test/ping');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const ctx = { waitUntil() {} };

let sent, sentDiag; // pings Jarchi sent (the first, and one with failures in diag), for the relay test below
test('usage ping: only after the Privacy Policy, only its fields, silent when the relay is down', async () => {
  await stats.ping();
  assert.equal(calls.length, 0, 'nothing at all before it is accepted, not even Kick or Twitch asked');
  assert.ok(!('installId' in JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8') || '{}')), 'no install id made yet');

  const before = Date.now();
  settings.update({ privacyAccepted: 1 });
  await stats.ping();
  assert.equal(pings().length, 1);
  sent = JSON.parse(pings()[0].body);
  assert.deepEqual(Object.keys(sent), ['id', 'version', 'installed', 'open', 'kick', 'twitch', 'privacy', 'diag']);
  assert.match(sent.id, UUID);
  assert.deepEqual([sent.version, sent.installed, sent.open], [require('../package.json').version, false, true]);
  assert.deepEqual(sent.kick, { name: 'Mamad_Poker', picture: 'https://files.kick.com/images/user/42/p.webp', live: false });
  assert.deepEqual(sent.twitch, { name: 'mamadpoker', picture: 'https://static-cdn.jtvnw.net/jtv_user_pictures/p.png', live: true });
  assert.deepEqual(kickAsked, ['/api/v2/channels/mamad-poker']);
  assert.equal(sent.privacy.version, 1);
  assert.ok(Date.parse(sent.privacy.acceptedAt) >= before - 1000 && sent.privacy.acceptedAt.endsWith('Z'), 'when it was accepted, UTC');

  // The quit ping: open false, what Kick and Twitch said last (no new question to them), the same install.
  const n = calls.length;
  await stats.ping(false);
  assert.equal(calls.length, n + 1);
  const bye = JSON.parse(pings().at(-1).body);
  assert.deepEqual([bye.id, bye.open, bye.kick.live, bye.twitch.live], [sent.id, false, false, true]);

  // The relay can't be reached: nothing thrown, Jarchi goes on.
  const ok = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  await stats.ping();
  globalThis.fetch = ok;

  // Connection diagnostics (policy version 1 names them), codes only.
  const last = async () => (await stats.ping(), JSON.parse(pings().at(-1).body));
  assert.deepEqual(sent.diag, { kick: 'never', kickReason: null, twitch: 'never', twitchReason: null, proxy: 'auto', vpn: null });
  const kickSays = (state, error = '') => require('../connectors/kick-account').events.emit('status', { state, error, uri: 'https://relay.test/login?state=x' });
  const twitchSays = (state, error = '') => require('../connectors/twitch-account').events.emit('status', { state, error, code: 'ABCD' });
  kickSays('waiting');
  assert.equal(settings.connectState('kick'), 'other', 'Connect pressed: tried, no outcome yet');
  kickSays('off');
  assert.equal(settings.connectState('kick'), 'denied', 'cancelled while waiting');
  twitchSays('off', 'network');
  settings.update({ proxyMode: 'manual' });
  assert.deepEqual((await last()).diag, { kick: 'failed', kickReason: 'denied', twitch: 'failed', twitchReason: 'network', proxy: 'manual', vpn: null });
  kickSays('connecting');
  assert.equal(settings.connectState('kick'), 'denied', 'connecting says nothing yet');
  kickSays('connected');
  for (const [error, why] of [['timeout', 'network'], ['client', 'other'], ['expired', 'other'], ['denied', 'denied']]) {
    twitchSays('off', error);
    assert.equal(settings.connectState('twitch'), why, error);
  }
  twitchSays('connecting', 'network');
  settings.update({ proxyMode: 'auto', proxyFound: { app: 'v2rayN', type: 'socks5', host: '127.0.0.1', port: 10808 } });
  const withDiag = await last();
  assert.deepEqual(withDiag.diag, { kick: 'ok', kickReason: null, twitch: 'failed', twitchReason: 'network', proxy: 'auto', vpn: true });
  assert.doesNotMatch(JSON.stringify(withDiag.diag), /relay\.test|ABCD|127\.0\.0\.1|v2rayN/, 'no links, codes, addresses or app names');
  sentDiag = withDiag;
  kickSays('off');
  assert.equal(settings.connectState('kick'), 'ok', 'Disconnect keeps what Connect came to');

  // Reset everything: the same install and what Connect came to, but no pings until the policy is accepted again.
  settings.reset();
  assert.equal(settings.installId(), sent.id);
  assert.deepEqual([settings.connectState('kick'), settings.connectState('twitch')], ['ok', 'network']);
  const m = calls.length;
  await stats.ping();
  assert.equal(calls.length, m);
});

test('relay POST /ping: one row per install, UTC times, refusals, rate limit', async (t) => {
  const { default: worker } = await import('../relay/worker.mjs');
  const { db, DB } = d1();
  const post = (body, headers = { 'content-type': 'application/json' }) => worker.fetch(new Request('https://relay.test/ping', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }), { DB }, ctx);
  const row = (id) => db.prepare('SELECT * FROM installs WHERE id = ?').get(id);
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-23T09:00:00.000Z') });

  assert.equal((await post(sent)).status, 200, 'what Jarchi sends is taken');
  let r = row(sent.id);
  assert.deepEqual({ ...r }, {
    id: sent.id, first_seen: '2026-10-23T09:00:00.000Z', last_seen: '2026-10-23T09:00:00.000Z', version: sent.version, installed: 0, is_open: 1,
    kick_name: 'Mamad_Poker', kick_picture: sent.kick.picture, kick_live: 0, twitch_name: 'mamadpoker', twitch_picture: sent.twitch.picture, twitch_live: 1,
    privacy_version: 1, privacy_accepted_at: sent.privacy.acceptedAt, window_start: Date.parse('2026-10-23T09:00:00.000Z'), window_pings: 1,
    kick_connect: 'never', kick_reason: null, twitch_connect: 'never', twitch_reason: null, proxy_mode: 'auto', vpn_found: null,
  });

  // 5 minutes later, quitting, Kick no longer connected: first_seen stays.
  t.mock.timers.tick(5 * 60e3);
  assert.equal((await post({ ...sent, open: false, kick: null })).status, 200);
  r = row(sent.id);
  assert.deepEqual([r.first_seen, r.last_seen, r.is_open, r.kick_name, r.kick_live], ['2026-10-23T09:00:00.000Z', '2026-10-23T09:05:00.000Z', 0, null, null]);

  // diag's codes kept; a ping from Jarchi 1.0.1 (no diag at all) still taken, its columns NULL.
  assert.equal((await post(sentDiag)).status, 200);
  const diagOf = () => { const x = row(sent.id); return [x.kick_connect, x.kick_reason, x.twitch_connect, x.twitch_reason, x.proxy_mode, x.vpn_found]; };
  assert.deepEqual(diagOf(), ['ok', null, 'failed', 'network', 'auto', 1]);
  const legacy = { ...sent, version: '1.0.1' };
  delete legacy.diag;
  assert.equal((await post(legacy)).status, 200, 'a 1.0.1 ping is taken');
  assert.deepEqual([row(sent.id).version, ...diagOf()], ['1.0.1', null, null, null, null, null, null]);

  // Rate limit: 10 in 10 minutes per install, then refused until the window is over.
  for (let i = 4; i < 10; i++) assert.equal((await post(sent)).status, 200);
  assert.equal((await post(sent)).status, 429);
  assert.equal(row(sent.id).last_seen, '2026-10-23T09:05:00.000Z', 'a refused ping changes nothing');
  t.mock.timers.tick(5 * 60e3);
  assert.equal((await post(sent)).status, 200);
  const other = { ...sent, id: '0f8b7c1e-3a2d-4c5b-9e6f-1a2b3c4d5e6f' };
  assert.equal((await post(other)).status, 200, 'each install has its own limit');

  // At most 100 new installs an hour (made-up ids); known ones go on meanwhile.
  for (let i = 2; i < 100; i++) assert.equal((await post({ ...sent, id: crypto.randomUUID() })).status, 200);
  assert.equal((await post({ ...sent, id: crypto.randomUUID() })).status, 429);
  assert.equal((await post(other)).status, 200);
  t.mock.timers.tick(60 * 60e3);
  assert.equal((await post({ ...sent, id: crypto.randomUUID() })).status, 200);
  db.exec(`DELETE FROM installs WHERE id NOT IN ('${sent.id}', '${other.id}')`);

  // Refused: not JSON, too big, malformed, a field more or one missing, wrong types, GET.
  assert.equal((await post(sent, { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await post('{nope')).status, 400);
  assert.equal((await post({ ...sent, kick: { ...sent.kick, name: 'x'.repeat(3000) } })).status, 413);
  for (const bad of [{ ...sent, ip: '1.2.3.4' }, { ...sent, id: 'not-a-uuid' }, { ...sent, open: 'yes' }, { ...sent, version: '<b>1</b>' },
    { ...sent, kick: { ...sent.kick, chat: 'hi' } }, { ...sent, twitch: { ...sent.twitch, picture: 'javascript:alert(1)' } },
    { ...sent, privacy: { version: 1 } }, { ...sent, privacy: { ...sent.privacy, acceptedAt: 'yesterday' } }, [sent], null,
    Object.fromEntries(Object.entries(sent).filter(([k]) => k !== 'twitch')),
    ...[{ kick: 'broken' }, { kickReason: 'network' }, { twitchReason: 'timeout' }, { twitchReason: null }, { proxy: 'system' }, { vpn: 'yes' },
      { error: 'ECONNREFUSED' }].map((d) => ({ ...sentDiag, diag: { ...sentDiag.diag, ...d } })),
    { ...sentDiag, diag: null }, { ...sentDiag, diag: { ...sentDiag.diag, vpn: undefined } }]) {
    assert.equal((await post(bad)).status, 400, JSON.stringify(bad)?.slice(0, 80));
  }
  assert.equal((await worker.fetch(new Request('https://relay.test/ping'), { DB }, ctx)).status, 405);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM installs').get().n, 2);
});

test('relay /admin: key, lockout, stats, installs, downloads, delete, requests per day', async (t) => {
  const { default: worker } = await import('../relay/worker.mjs');
  const { db, DB } = d1();
  const KEY = 'k'.repeat(96), env = { DB, ADMIN_KEY: KEY }, made = {};
  const call = (p, { key = KEY, auth = key === null ? null : `Bearer ${key}`, method = 'GET', ip = '10.0.0.1', body, to = env } = {}) => {
    const day = new Date().toISOString().slice(0, 10);
    made[day] = (made[day] ?? 0) + 1;
    return worker.fetch(new Request(`https://relay.test${p}`, { method, body, headers: {
      'content-type': 'application/json', 'cf-connecting-ip': ip, ...(auth === null ? {} : { authorization: auth }),
    } }), to, ctx);
  };
  const get = async (p, o) => {
    const r = await call(p, o);
    assert.equal(r.status, 200, p);
    return r.json();
  };
  const at = (when) => t.mock.timers.setTime(Date.parse(when));
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-20T20:00:00.000Z') });

  // A: 3 days ago, then quit. B: 2 hours ago, still "open" but silent since. C (live on Kick) and D: just now.
  const ping = async (p) => assert.equal((await call('/ping', { method: 'POST', body: JSON.stringify(p) })).status, 200);
  const id = { A: crypto.randomUUID(), B: crypto.randomUUID(), C: crypto.randomUUID(), D: crypto.randomUUID() };
  const base = { version: '1.0.0', installed: true, open: true, kick: null, twitch: null, privacy: { version: 1, acceptedAt: null } };
  const C_DIAG = { kick: 'ok', kickReason: null, twitch: 'failed', twitchReason: 'denied', proxy: 'off', vpn: false };
  const A = { ...base, id: id.A, version: '0.9.0', kick: { name: 'Mamad_Poker', picture: '', live: false } };
  await ping(A);
  await ping({ ...A, open: false });
  at('2026-10-23T18:00:00.000Z');
  await ping({ ...base, id: id.B, twitch: { name: 'mamadpoker', picture: 'https://p.test/b.png', live: true } });
  at('2026-10-23T19:55:00.000Z');
  await ping({ ...base, id: id.C, kick: { name: 'MamadXPoker', picture: '', live: true }, twitch: { name: 'cTwitch', picture: '', live: false },
    privacy: { version: 2, acceptedAt: '2026-10-20T20:00:00.000Z' }, diag: C_DIAG });
  at('2026-10-23T19:56:00.000Z');
  await ping({ ...base, id: id.D, installed: false });
  at('2026-10-23T20:00:00.000Z');

  // No key, a wrong one, one character more or less, not "Bearer": refused.
  for (const key of [null, 'nope', `${KEY}k`, KEY.slice(1)]) assert.equal((await call('/admin/stats', { key })).status, 401);
  assert.equal((await call('/admin/stats', { auth: KEY })).status, 401);
  assert.equal((await call('/admin/nope', { key: 'nope' })).status, 401, 'unknown admin addresses say nothing either');

  const { requests, ...counts } = await get('/admin/stats');
  assert.deepEqual(counts, { installs: 4, installsInstalled: 3, installsDev: 1, installsNew7Days: 3, online: 2, activeToday: 3, active7Days: 4, live: 1,
    versions: [{ version: '1.0.0', installs: 3 }, { version: '0.9.0', installs: 1 }] });
  assert.equal(requests.limit, 100000);
  assert.equal((await get('/admin/stats?tz=300')).activeToday, 2, 'UTC+5: it is already the 24th there, B was yesterday');
  assert.equal((await get('/admin/stats?tz=-600')).activeToday, 3);
  for (const tz of ['x', '1.5', '900']) assert.equal((await call(`/admin/stats?tz=${tz}`)).status, 400);

  // The installs, newest first, shaped like a ping.
  const list = await get('/admin/installs');
  assert.deepEqual([list.total, list.limit, list.offset], [4, 50, 0]);
  assert.deepEqual(list.installs.map((i) => i.id), [id.D, id.C, id.B, id.A]);
  assert.deepEqual(list.installs[1], {
    id: id.C, version: '1.0.0', installed: true, open: true, online: true, live: true,
    kick: { name: 'MamadXPoker', picture: '', live: true }, twitch: { name: 'cTwitch', picture: '', live: false },
    firstSeen: '2026-10-23T19:55:00.000Z', lastSeen: '2026-10-23T19:55:00.000Z', privacy: { version: 2, acceptedAt: '2026-10-20T20:00:00.000Z' },
    diag: C_DIAG,
  });
  assert.equal(list.installs[2].diag, null, 'no diag in its last ping');
  assert.deepEqual(list.installs[2].twitch, { name: 'mamadpoker', picture: 'https://p.test/b.png', live: true });
  assert.deepEqual([list.installs[2].online, list.installs[2].live], [false, false], 'silent for 2 hours: not online, so not live');
  assert.deepEqual([list.installs[3].open, list.installs[3].firstSeen, list.installs[3].kick.live, list.installs[3].twitch], [false, '2026-10-20T20:00:00.000Z', false, null]);
  assert.equal(list.installs[0].installed, false);

  // Search by channel name (any case, Kick or Twitch; _ and % are letters), paging.
  const found = async (q) => (await get(`/admin/installs?q=${encodeURIComponent(q)}`)).installs.map((i) => i.id);
  assert.deepEqual(await found('MAMAD'), [id.C, id.B, id.A]);
  assert.deepEqual(await found('d_p'), [id.A]);
  assert.deepEqual(await found('ctwitch'), [id.C]);
  assert.deepEqual(await found('100%'), []);
  const page = await get('/admin/installs?limit=2&offset=2');
  assert.deepEqual([page.total, page.installs.map((i) => i.id)], [4, [id.B, id.A]]);
  assert.equal((await get('/admin/installs?limit=5000')).limit, 200);

  assert.equal((await call('/admin/stats', { method: 'POST' })).status, 405);
  assert.equal((await call(`/admin/installs/${id.A}`)).status, 405);
  assert.equal((await call('/admin/nope')).status, 404);

  // Delete one install (a data-deletion request); a wrong key deletes nothing.
  assert.equal((await call(`/admin/installs/${id.B}`, { method: 'DELETE', key: 'nope' })).status, 401);
  assert.deepEqual(await get(`/admin/installs/${id.A}`, { method: 'DELETE' }), { deleted: id.A });
  assert.equal((await call(`/admin/installs/${id.A}`, { method: 'DELETE' })).status, 404);
  assert.deepEqual(db.prepare('SELECT id FROM installs ORDER BY first_seen').all().map((r) => r.id), [id.B, id.C, id.D]);

  // Downloads from GitHub, both repos summed, only the installer counted: kept 10 minutes; while either fails, the last
  // full answer again.
  const real = globalThis.fetch, asked = [];
  const REL = (repo) => `https://api.github.com/repos/MamadPoker/${repo}/releases?per_page=100`;
  let github = {}; // address -> GitHub's answer; none: rate limited
  globalThis.fetch = async (url, init) => (asked.push([url, init.headers['user-agent']]), (github[url] ?? new Response('rate limited', { status: 403 })).clone());
  assert.equal((await call('/admin/downloads')).status, 502, 'nothing to show yet');
  const setup = (n) => ({ name: 'Jarchi-Setup.exe', size: 1000, download_count: n });
  const updates = [{ name: 'Jarchi-Setup.exe.blockmap', size: 5, download_count: 4 }, { name: 'latest.yml', size: 10, download_count: 30 }];
  github[REL('Jarchi-releases')] = Response.json([
    { tag_name: 'v1.0.1', name: 'Jarchi 1.0.1', published_at: '2026-10-23T12:00:00Z', prerelease: false, assets: [setup(6), ...updates] },
    { tag_name: 'v1.0.0', name: 'Jarchi 1.0.0', published_at: '2026-10-20T12:00:00Z', prerelease: false, assets: [setup(8)] },
  ]);
  assert.equal((await call('/admin/downloads')).status, 502, 'one repo alone is not shown: its sum would be short');
  github[REL('Jarchi')] = Response.json([
    { tag_name: 'v1.0.2', name: 'Jarchi 1.0.2', published_at: '2026-10-23T15:00:00Z', prerelease: false, assets: [setup(2), ...updates] },
  ]);
  const d = await get('/admin/downloads');
  const files = (n) => [{ name: 'Jarchi-Setup.exe', size: 1000, downloads: n }, { name: 'Jarchi-Setup.exe.blockmap', size: 5, downloads: 4 }, { name: 'latest.yml', size: 10, downloads: 30 }];
  assert.deepEqual(d, { fetchedAt: '2026-10-23T20:00:00.000Z', downloads: 16, releases: [
    { repo: 'MamadPoker/Jarchi', tag: 'v1.0.2', name: 'Jarchi 1.0.2', publishedAt: '2026-10-23T15:00:00Z', prerelease: false, downloads: 2, files: files(2) },
    { repo: 'MamadPoker/Jarchi-releases', tag: 'v1.0.1', name: 'Jarchi 1.0.1', publishedAt: '2026-10-23T12:00:00Z', prerelease: false, downloads: 6, files: files(6) },
    { repo: 'MamadPoker/Jarchi-releases', tag: 'v1.0.0', name: 'Jarchi 1.0.0', publishedAt: '2026-10-20T12:00:00Z', prerelease: false, downloads: 8,
      files: [{ name: 'Jarchi-Setup.exe', size: 1000, downloads: 8 }] },
  ] });
  assert.deepEqual(asked.slice(-2), [[REL('Jarchi'), 'jarchi-relay'], [REL('Jarchi-releases'), 'jarchi-relay']]);
  at('2026-10-23T20:09:59.000Z');
  assert.deepEqual(await get('/admin/downloads'), d);
  assert.equal(asked.length, 6, 'cached');
  at('2026-10-23T20:10:00.000Z');
  assert.equal((await get('/admin/downloads')).fetchedAt, '2026-10-23T20:10:00.000Z');
  at('2026-10-23T20:30:00.000Z');
  github[REL('Jarchi')] = new Response('down', { status: 500 });
  assert.deepEqual(await get('/admin/downloads'), { ...d, fetchedAt: '2026-10-23T20:10:00.000Z' }, 'one repo down: the last full answer');
  assert.equal(asked.length, 10);
  globalThis.fetch = real;

  // 10 wrong tries from one source in an hour: that source is refused for an hour, even with the right key.
  const X = { ip: '203.0.113.7' }, wrong = { ...X, key: 'nope' };
  for (let i = 0; i < 9; i++) assert.equal((await call('/admin/stats', wrong)).status, 401);
  assert.equal((await call('/admin/stats', X)).status, 200, '9 are allowed');
  assert.equal((await call('/admin/stats', wrong)).status, 401);
  assert.equal((await call('/admin/stats', X)).status, 429);
  assert.equal((await call('/admin/stats', wrong)).status, 429);
  assert.equal((await call('/admin/stats')).status, 200, 'another source goes on');
  at('2026-10-23T21:29:59.000Z');
  assert.equal((await call('/admin/stats', X)).status, 429);
  at('2026-10-23T21:30:00.000Z');
  assert.equal((await call('/admin/stats', X)).status, 200, 'an hour later');
  for (let i = 0; i < 9; i++) assert.equal((await call('/admin/stats', wrong)).status, 401, 'and a new count');
  assert.equal((await call('/admin/stats', X)).status, 200);
  // 9 and, over an hour later, 9 more: never 10 in an hour.
  const Y = { ip: '2001:db8::1' };
  for (let i = 0; i < 9; i++) assert.equal((await call('/admin/stats', { ...Y, key: 'nope' })).status, 401);
  at('2026-10-23T22:30:00.000Z');
  for (let i = 0; i < 9; i++) assert.equal((await call('/admin/stats', { ...Y, key: 'nope' })).status, 401);
  assert.equal((await call('/admin/stats', Y)).status, 200);
  const sources = db.prepare('SELECT source FROM admin_fails').all().map((r) => r.source);
  assert.equal(sources.length, 3);
  assert.ok(sources.every((x) => /^[0-9a-f]{64}$/.test(x)), 'no addresses kept, only keyed hashes');

  // Without an ADMIN_KEY set, nothing gets in.
  for (const key of ['', 'undefined', KEY]) assert.equal((await call('/admin/stats', { key, ip: '198.51.100.1', to: { DB } })).status, 401);

  // Every request counted on its day (UTC); stats shows the newest days first.
  assert.deepEqual(Object.fromEntries(db.prepare('SELECT day, count FROM requests').all().map((r) => [r.day, r.count])), made);
  const { days } = (await get('/admin/stats')).requests;
  assert.deepEqual(days.map((r) => [r.day, r.count]), [['2026-10-23', made['2026-10-23']], ['2026-10-20', 2]]);

  // New in 7 days: first seen after exactly 7 days ago (A is deleted; B 18:00, C 19:55, D a dev run).
  at('2026-10-30T18:00:00.000Z');
  const later = await get('/admin/stats');
  assert.deepEqual([later.installs, later.installsInstalled, later.installsDev, later.installsNew7Days], [3, 2, 1, 1]);
});
