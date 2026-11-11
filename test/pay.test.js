// The Crypto page's link to Jarchi Pay (core/pay.js), against a stand-in for Jarchi Pay's app API: nothing asked before
// the Privacy Policy is accepted; the request's one-time link; an approved request's token taken once and sealed on disk
// (never plain; a dev run keeps it in memory only); a stopped token (401) = back to not active.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarchi-pay-'));
const KEY = crypto.randomBytes(32).toString('base64'); // as electron/main.js hands it over
const PAY = 'https://pay.test';
const TOKEN = `jpa_${'x'.repeat(43)}`;
const WALLETS = { bep20: null, trc20: null, pending: null };
const disk = () => fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
const settingsFile = (s) => fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ version: 9, ...s }));
// Jarchi started afresh on this data folder, with the installed app's key or none (a dev run).
function start(key = '') {
  for (const k of Object.keys(require.cache)) if (!k.includes('node_modules')) delete require.cache[k];
  Object.assign(process.env, { JARCHI_DATA_DIR: dir, JARCHI_SECRET_KEY: key, JARCHI_PAY_URL: PAY });
  return require('../core/pay');
}

// Jarchi Pay: this install's request (status: its token goes out once), whether the token still works, every call.
const jp = { status: { status: 'none' }, live: true, down: false, asked: [] };
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url), at = `${init.method ?? 'GET'} ${u.pathname}`;
  assert.equal(u.origin, PAY);
  jp.asked.push({ at, auth: init.headers?.authorization ?? null, body: init.body && JSON.parse(init.body) });
  if (jp.down) throw new TypeError('fetch failed');
  const json = (b, status = 200) => Response.json(b, { status });
  if (at === 'POST /api/app/request') return json({ url: `${PAY}/connect/abc`, expiresAt: 1 }, 201);
  if (at === 'POST /api/app/status') {
    const s = jp.status;
    if (s.token) jp.status = { status: 'approved', channel: s.channel };
    return json(s);
  }
  if (init.headers?.authorization !== `Bearer ${TOKEN}` || !jp.live) return json({ error: 'token' }, 401);
  if (at === 'GET /api/app/wallets') return json(WALLETS);
  if (at === 'GET /api/app/donations') return json({ search: u.search });
  if (at === 'POST /api/app/wallets/link') return json({ url: 'https://elsewhere.test/wallet/1' }, 201);
  return json({ error: 'not_found' }, 404);
};

test('Jarchi Pay: request, token once and sealed, 401 = not active, dev runs never write it', async () => {
  // No Privacy Policy accepted: nothing goes to Jarchi Pay.
  settingsFile({});
  let pay = start(KEY);
  assert.deepEqual(await pay.refresh(), { state: 'none' });
  await assert.rejects(pay.request(true), { code: 'crypto_privacy' });
  assert.equal(jp.asked.length, 0);

  // The request: only with the terms ticked; Jarchi Pay's link, for the browser.
  settingsFile({ privacyAccepted: 1 });
  pay = start(KEY);
  const installId = require('../core/settings').installId();
  await assert.rejects(pay.request(), { code: 'crypto_failed' });
  assert.deepEqual(await pay.request(true), { url: `${PAY}/connect/abc` });
  assert.deepEqual(jp.asked.at(-1), { at: 'POST /api/app/request', auth: null, body: { installId, termsVersion: '1', acceptTerms: true } });
  jp.status = { status: 'pending', requestedAt: 5 };
  assert.deepEqual(await pay.refresh(), { state: 'pending' });
  jp.status = { status: 'rejected', reason: 'Too new', retryAt: 99 };
  assert.deepEqual(await pay.refresh(), { state: 'rejected', retryAt: 99, reason: 'Too new' });

  // Approved: the token once (two asks at once are one), sealed on disk, then the wallets with it.
  jp.status = { status: 'approved', channel: 'mamadpoker', token: TOKEN };
  const told = [];
  pay.events.on('state', (s) => told.push(s.state));
  const [a, b] = await Promise.all([pay.refresh(), pay.refresh()]);
  assert.deepEqual(a, { state: 'active', channel: 'mamadpoker', page: `${PAY}/mamadpoker`, wallets: WALLETS });
  assert.equal(a, b);
  assert.deepEqual(told, ['active']);
  assert.ok(!disk().includes(TOKEN), 'never plain on disk');
  assert.match(fs.readFileSync(path.join(dir, 'pay.json'), 'utf8'), /"token": "enc:v1:/);

  // Started again: still active, from the sealed token (the status isn't asked).
  pay = start(KEY);
  const n = jp.asked.length;
  assert.equal((await pay.refresh()).state, 'active');
  assert.deepEqual(jp.asked.slice(n).map((c) => [c.at, c.auth]), [['GET /api/app/wallets', `Bearer ${TOKEN}`]]);
  assert.deepEqual(await pay.donations({ today: '5', week: '1', cursor: '7_x', other: 'y' }), { search: '?cursor=7_x&today=5&week=1' });
  await assert.rejects(pay.walletLink(), { code: 'crypto_failed' }); // a link that isn't Jarchi Pay's is never opened
  jp.down = true; // offline: still active, says why
  assert.deepEqual(await pay.refresh(), { state: 'active', channel: 'mamadpoker', page: `${PAY}/mamadpoker`, wallets: WALLETS, error: 'crypto_offline' });
  jp.down = false;

  // A dev run can't open it: approved, but lost here (ask again).
  assert.deepEqual(await start().refresh(), { state: 'none', lost: true });

  // The token stopped: dropped from disk, back to the request's status.
  pay = start(KEY);
  jp.live = false;
  jp.status = { status: 'none' };
  assert.deepEqual(await pay.refresh(), { state: 'none' });
  assert.ok(!disk().includes('enc:v1:'));
  await assert.rejects(pay.donations({}), { code: 'crypto_token' });

  // A dev run gets a token: active while it runs, never written.
  jp.live = true;
  jp.status = { status: 'approved', channel: 'mamadpoker', token: TOKEN };
  pay = start();
  assert.equal((await pay.refresh()).state, 'active');
  assert.ok(!disk().includes(TOKEN) && !disk().includes('enc:v1:'));
  assert.equal((await start().refresh()).lost, true); // quit and started again: gone
});
