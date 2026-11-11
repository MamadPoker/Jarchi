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
const jp = { status: { status: 'none' }, live: true, down: false, asked: [], fresh: [], cursor: 7, since: [] }; // fresh: paid since the last ask
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url), at = `${init.method ?? 'GET'} ${u.pathname}`;
  assert.equal(u.origin, PAY);
  jp.asked.push({ at, auth: init.headers?.authorization ?? null, body: init.body && (Buffer.isBuffer(init.body) ? init.body : JSON.parse(init.body)) });
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
  if (at === 'GET /api/app/donations/new') jp.since.push(u.search);
  if (at === 'GET /api/app/donations/new') return json(u.searchParams.has('since') ? { donations: jp.fresh.splice(0), cursor: jp.cursor += 2 } : { donations: [], cursor: jp.cursor });
  if (at === 'POST /api/app/wallets/link') return json({ url: 'https://elsewhere.test/wallet/1' }, 201);
  if (at === 'PUT /api/app/page' && JSON.parse(init.body).socials?.kick === 'no/pe') return json({ error: 'bad', field: 'socials.kick' }, 400);
  if (at.startsWith('PUT /api/app/page/') && jp.uploads >= 10) return json({ error: 'rate' }, 429);
  if (at.startsWith('PUT /api/app/page/')) jp.uploads = (jp.uploads ?? 0) + 1;
  if (/^(GET|PUT|DELETE) \/api\/app\/page(\/(avatar|banner))?$/.test(at)) return json({ bio: 'hi', socials: {}, links: {}, avatar: { url: null, custom: false }, banner: { url: null, custom: false } });
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

// Crypto alerts: the first ask only takes the cursor, each new donation becomes an alert once (a hidden name stays
// hidden, a private message never goes on stream, one paid over 10 minutes ago is skipped), the cursor survives a
// restart; the settings pick the look (the highest amount alert reached, else the card) and its time on screen.
test('crypto alerts: cursor, once each, hidden names and private messages, the look and its duration', async () => {
  settingsFile({ privacyAccepted: 1 });
  jp.live = true;
  jp.status = { status: 'approved', channel: 'mamadpoker', token: TOKEN };
  let pay = start(KEY);
  assert.equal((await pay.refresh()).state, 'active');
  let got = [];
  pay.events.on('donation', (ev) => got.push(ev));
  const asks = () => jp.asked.filter((c) => c.at === 'GET /api/app/donations/new');
  jp.fresh = [{ id: 'old', name: 'Before', amount: '5.0000', network: 'bep20', paidAt: Date.now(), message: '' }];
  await pay.pollNew();
  assert.deepEqual(got, [], 'no cursor yet: only the cursor, nothing from before');
  jp.fresh = [
    { id: 'a', name: null, amount: '10.0371', network: 'trc20', paidAt: Date.now(), txHash: 'abc123', message: 'for you only', private: true, platform: 'kick' },
    { id: 'b', name: 'Late', amount: '70.0000', network: 'bep20', paidAt: Date.now() - 11 * 60e3, message: 'old', private: false },
    { id: 'c', name: 'Sara', amount: '60.0000', network: 'bep20', paidAt: Date.now(), txHash: '0xdef', message: 'hi', private: false, platform: 'twitch' },
  ];
  await pay.pollNew();
  assert.equal(asks().at(-1).auth, `Bearer ${TOKEN}`);
  assert.deepEqual(got.map(({ user, amount, network, message, txHash, from, type, platform, test }) => ({ user, amount, network, message, txHash, from, type, platform, test })), [
    { user: '', amount: '10.0371', network: 'trc20', message: '', txHash: 'abc123', from: 'kick', type: 'crypto', platform: 'crypto', test: false },
    { user: 'Sara', amount: '60.0000', network: 'bep20', message: 'hi', txHash: '0xdef', from: 'twitch', type: 'crypto', platform: 'crypto', test: false },
  ]);
  const cursor = jp.cursor;
  assert.match(fs.readFileSync(path.join(dir, 'pay.json'), 'utf8'), new RegExp(`"cursor": ${cursor}`));

  // Started again: on from the saved cursor, nothing again.
  pay = start(KEY);
  got = [];
  pay.events.on('donation', (ev) => got.push(ev));
  await pay.pollNew(); // not active (yet): nothing asked
  await pay.refresh();
  await pay.pollNew();
  assert.deepEqual(jp.since, ['', '?since=7', `?since=${cursor}`]);
  assert.deepEqual(got, []);

  // The look: the highest amount alert reached, else the card; its own time on screen.
  const settings = require('../core/settings'), queue = require('../core/alerts');
  assert.throws(() => settings.update({ crypto: { design: 'rainbow' } }));
  assert.throws(() => settings.saveCryptoFile('main', 'image', Buffer.from('GIF89a')));
  settings.update({ crypto: { design: 'coin', duration: 6 } });
  const { id } = settings.addCryptoTier(50);
  settings.setCryptoLook(id, { duration: 12, pos: 'side', font: 'Bangers' });
  assert.throws(() => settings.setCryptoLook('custom', { min: 5 }), 'only an amount alert has a minimum');
  assert.deepEqual([settings.cryptoPick(49.99), settings.cryptoPick(50), settings.cryptoPick(1e6)], ['coin', id, id]);
  assert.deepEqual([settings.cryptoDuration('coin'), settings.cryptoDuration(id), settings.cryptoDuration('gone')], [6, 12, 6]);
  const played = [];
  queue.events.on('play', (a) => played.push(a));
  queue.join(() => {}, 'all');
  settings.update({ lang: 'fa' }); // the panel's language: a hidden name on stream in it
  queue.push(pay.alertOf({ name: null, amount: '60.0000', network: 'bep20' }));
  assert.deepEqual([played[0].ev.look, played[0].ev.user, played[0].ev.anonymous], [id, '', 'ناشناس']);
  assert.ok(played[0].left > 11000 && played[0].left <= 12000);
  queue.skip();
  assert.equal(pay.alertOf({ name: 'Ali', amount: '1.0000' }, true, 'hologram').look, 'hologram'); // a test plays the look it names
  settings.removeCryptoTier(id);
  assert.deepEqual(settings.get().crypto.tiers, []);
});

// The donation page's look: the line and links as given, a wrong one named (field); a picture is looked at here first
// (PNG / JPG / WebP, 2 MB, avatar or banner only: none of those reach Jarchi Pay) and sent as it is; 10 an hour; Reset.
test('donation page: looks, a wrong field named, pictures looked at first', async () => {
  settingsFile({ privacyAccepted: 1 });
  jp.live = true;
  jp.status = { status: 'approved', channel: 'mamadpoker', token: TOKEN };
  const pay = start(KEY);
  assert.equal((await pay.refresh()).state, 'active');
  assert.equal((await pay.page()).bio, 'hi');
  await pay.savePage({ bio: 'Thanks', socials: { kick: 'mamadpoker' }, wallets: { bep20: '0x1' } });
  assert.deepEqual(jp.asked.at(-1), { at: 'PUT /api/app/page', auth: `Bearer ${TOKEN}`, body: { bio: 'Thanks', socials: { kick: 'mamadpoker' } } });
  await assert.rejects(pay.savePage({ socials: { kick: 'no/pe' } }), { code: 'crypto_bad', field: 'socials.kick' });

  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(16)]);
  const asked = jp.asked.length;
  await assert.rejects(pay.setPicture('banner', Buffer.from('GIF89a')), { code: 'crypto_type' });
  await assert.rejects(pay.setPicture('banner', Buffer.concat([png, Buffer.alloc(2 * 1024 * 1024)])), { code: 'crypto_size' });
  await assert.rejects(pay.setPicture('../wallets', png), { code: 'crypto_failed' });
  await assert.rejects(pay.resetPicture('../wallets'), { code: 'crypto_failed' });
  assert.equal(jp.asked.length, asked);
  jp.uploads = 9;
  await pay.setPicture('avatar', png);
  assert.deepEqual([jp.asked.at(-1).at, jp.asked.at(-1).body], ['PUT /api/app/page/avatar', png]);
  await assert.rejects(pay.setPicture('avatar', png), { code: 'crypto_uploads' }); // the 11th this hour
  await pay.resetPicture('banner');
  assert.equal(jp.asked.at(-1).at, 'DELETE /api/app/page/banner');
});
