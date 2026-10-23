// Usage stats: Jarchi's ping (core/stats.js) with fake Kick, Twitch and relay (no network), and the relay's POST /ping
// (relay/worker.mjs) on a real SQLite with schema.sql standing in for D1. Nothing before the Privacy Policy is
// accepted; only the listed fields; a relay that's down changes nothing; the relay's rows, refusals and rate limit.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

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

let sent; // the ping Jarchi sent, for the relay test below
test('usage ping: only after the Privacy Policy, only its fields, silent when the relay is down', async () => {
  await stats.ping();
  assert.equal(calls.length, 0, 'nothing at all before it is accepted, not even Kick or Twitch asked');
  assert.ok(!('installId' in JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8') || '{}')), 'no install id made yet');

  const before = Date.now();
  settings.update({ privacyAccepted: 1 });
  await stats.ping();
  assert.equal(pings().length, 1);
  sent = JSON.parse(pings()[0].body);
  assert.deepEqual(Object.keys(sent), ['id', 'version', 'installed', 'open', 'kick', 'twitch', 'privacy']);
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

  // Reset everything: the same install, but no pings until the policy is accepted again.
  settings.reset();
  assert.equal(settings.installId(), sent.id);
  const m = calls.length;
  await stats.ping();
  assert.equal(calls.length, m);
});

test('relay POST /ping: one row per install, UTC times, refusals, rate limit', async (t) => {
  const { default: worker } = await import('../relay/worker.mjs');
  // D1 stand-in: SQLite with the real schema; D1's ?NNN parameters made plain ? for node:sqlite.
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'relay', 'schema.sql'), 'utf8'));
  const DB = { prepare: (sql) => ({ bind: (...args) => ({ run: async () => {
    const order = [...sql.matchAll(/\?(\d+)/g)].map((m) => args[m[1] - 1]);
    return { meta: { changes: db.prepare(sql.replace(/\?\d+/g, '?')).run(...order).changes } };
  } }) }) };
  const post = (body, headers = { 'content-type': 'application/json' }) => worker.fetch(new Request('https://relay.test/ping', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }), { DB });
  const row = (id) => db.prepare('SELECT * FROM installs WHERE id = ?').get(id);
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-23T09:00:00.000Z') });

  assert.equal((await post(sent)).status, 200, 'what Jarchi sends is taken');
  let r = row(sent.id);
  assert.deepEqual({ ...r }, {
    id: sent.id, first_seen: '2026-10-23T09:00:00.000Z', last_seen: '2026-10-23T09:00:00.000Z', version: sent.version, installed: 0, is_open: 1,
    kick_name: 'Mamad_Poker', kick_picture: sent.kick.picture, kick_live: 0, twitch_name: 'mamadpoker', twitch_picture: sent.twitch.picture, twitch_live: 1,
    privacy_version: 1, privacy_accepted_at: sent.privacy.acceptedAt, window_start: Date.parse('2026-10-23T09:00:00.000Z'), window_pings: 1,
  });

  // 5 minutes later, quitting, Kick no longer connected: first_seen stays.
  t.mock.timers.tick(5 * 60e3);
  assert.equal((await post({ ...sent, open: false, kick: null })).status, 200);
  r = row(sent.id);
  assert.deepEqual([r.first_seen, r.last_seen, r.is_open, r.kick_name, r.kick_live], ['2026-10-23T09:00:00.000Z', '2026-10-23T09:05:00.000Z', 0, null, null]);

  // Rate limit: 10 in 10 minutes per install, then refused until the window is over.
  for (let i = 2; i < 10; i++) assert.equal((await post(sent)).status, 200);
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
    Object.fromEntries(Object.entries(sent).filter(([k]) => k !== 'twitch'))]) {
    assert.equal((await post(bad)).status, 400, JSON.stringify(bad)?.slice(0, 80));
  }
  assert.equal((await worker.fetch(new Request('https://relay.test/ping'), { DB })).status, 405);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM installs').get().n, 2);
});
