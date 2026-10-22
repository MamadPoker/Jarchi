// Kick alerts from chat events (payloads captured from live Kick channels), Twitch alerts from IRC lines, the server-side alert queue,
// media by amount (tiers) and the proxy tunnel (through local fake HTTP CONNECT and SOCKS5 proxies).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tcp = require('node:net');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarchi-alerts-'));
process.env.JARCHI_DATA_DIR = dataDir;
fs.mkdirSync(path.join(dataDir, 'uploads'));
for (const f of ['kicks-tier-image-small.gif', 'kicks-tier-image-extra.gif', 'kicks-tier-image-big.gif', 'kicks-tier-sound-big.wav', 'raid-tier-image-old.gif',
  'bits-tier-image-100.gif', 'bits-tier-image-500.gif', 'bits-tier-sound-500.wav']) {
  fs.writeFileSync(path.join(dataDir, 'uploads', f), f.endsWith('.wav') ? 'RIFF\0\0\0\0WAVE' : 'GIF89a');
}
const old = (name) => ({ file: name, name: name.replace(/^.*-(\w+)\.(\w+)$/, '$1.$2') });
fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({
  version: 2,
  alerts: {
    kicks: { tiersOn: true, tiers: [{ min: 1, images: [old('kicks-tier-image-small.gif'), old('kicks-tier-image-extra.gif')], sounds: [] },
      { min: 150, images: [old('kicks-tier-image-big.gif')], sounds: [old('kicks-tier-sound-big.wav')] }] },
    raid: { volume: 0.5, tiersOn: true, tiers: [{ min: 10, images: [old('raid-tier-image-old.gif')], sounds: [] }] },
    // Fixed bits tiers of v3/v4 (100, 500, ...): 500 is no Twitch gem, so it goes into 100 (v5).
    bits: { tiers: { 100: { on: false, image: old('bits-tier-image-100.gif') }, 500: { on: true, image: old('bits-tier-image-500.gif'), sound: old('bits-tier-sound-500.wav') } } },
  },
}));
process.env.JARCHI_PORT = '3997';
const { server, io } = require('../server');
const { bus, emitEvent, emitChat, logIncoming } = require('../core/events');
const kick = require('../connectors/kick-chat');
const twitch = require('../connectors/twitch-chat');
const queue = require('../core/alerts');
const goals = require('../core/goals');
const net = require('../core/net');

test.after(() => io.close());
const base = 'http://127.0.0.1:3997';
const call = (method, url, body, headers = {}) => fetch(base + url, {
  method,
  headers: { 'x-jarchi': '1', ...(body && !Buffer.isBuffer(body) && { 'content-type': 'application/json' }), ...headers },
  body: Buffer.isBuffer(body) ? body : body && JSON.stringify(body),
});
const flush = () => new Promise((r) => setImmediate(r));

test("media by amount: fixed tiers (Kick's gift amounts), on/off and files; old free tiers and raid tiers migrate safely", async () => {
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  let s = await (await call('GET', '/api/settings')).json();
  const file = (f) => path.join(dataDir, 'uploads', f.file ?? f);

  // Migration (v2 -> v3): the old free Kicks tiers moved to the fixed tier at or below their minimum, turned on;
  // a second file in one tier went. Raid's old tiers are ignored (and their file left alone).
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'))).version, 7);
  const k = s.alerts.kicks;
  assert.deepEqual(k.tiers.map((t) => t.amount), [1, 10, 50, 100, 500, 1000, 2000, 5000, 10000, 50000], "Kick's own gift amounts");
  assert.deepEqual(k.tiers.map((t) => t.gift.id).slice(0, 4), ['hell_yeah', 'hype', 'skull_emoji', 'full_send']);
  assert.equal(k.tiersOn, true, 'kept');
  const t1 = k.tiers.find((t) => t.amount === 1), t100 = k.tiers.find((t) => t.amount === 100);
  assert.deepEqual([t1.on, t1.image?.name, t1.sound], [true, 'small.gif', null]);
  assert.deepEqual([t100.on, t100.image?.name, t100.sound?.name], [true, 'big.gif', 'big.wav'], 'min 150 -> the 100 tier');
  assert.ok(fs.existsSync(file(t1.image)) && fs.existsSync(file(t100.sound)), 'their files still there');
  assert.ok(!fs.existsSync(file('kicks-tier-image-extra.gif')), "a tier's second file went");
  assert.ok(k.tiers.filter((t) => t.amount !== 1 && t.amount !== 100).every((t) => !t.on && !t.image && !t.sound), 'the other tiers: off, theme media');
  assert.ok(!('tiers' in s.alerts.raid) && !('tiersOn' in s.alerts.raid), 'raid: no media by amount');
  assert.ok(fs.existsSync(file('raid-tier-image-old.gif')), "raid's old file is left alone");
  assert.equal(k.minAmount, 10, 'Kicks: small taps stay out of the queue by default');

  // Kicks' own look by default (Kick's gift image, Kick-style text, no theme); "Use theme" switches back.
  assert.equal(k.look, 'kick');
  assert.ok(!('look' in s.alerts.bits), 'only Kicks has it');
  assert.equal((await (await call('PATCH', '/api/settings', { alerts: { kicks: { look: 'theme' } } })).json()).alerts.kicks.look, 'theme');
  assert.equal((await call('PATCH', '/api/settings', { alerts: { kicks: { look: 'fancy' } } })).status, 400);
  await call('PATCH', '/api/settings', { alerts: { kicks: { look: 'kick' } } });
  // Every Kick gift has its image here (offline) and a name in the i18n file.
  const names = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'i18n', 'en.json'))).kickGifts;
  for (const { gift } of k.tiers) {
    const img = await fetch(`${base}/assets/kick-gifts/${gift.id}.webp`);
    assert.equal(img.status, 200, gift.id);
    assert.equal(Buffer.from(await img.arrayBuffer()).toString('latin1', 8, 12), 'WEBP', gift.id);
    assert.ok(names[gift.id], gift.id);
  }
  assert.deepEqual([s.alerts.gift_sub.tiers.map((t) => t.amount), s.alerts.bits.tiers.map((t) => t.amount)], [[1, 5, 10, 20, 50, 100], [1, 100, 1000, 5000, 10000]]);
  // Bits tiers are Twitch's gems (served here, offline). The old 500 tier went into 100: its sound moved, its image
  // went (100 had one), and 100 is on because 500 was.
  for (const n of [1, 100, 1000, 5000, 10000]) {
    const gem = await fetch(`${base}/assets/twitch-bits/${n}.gif`);
    assert.equal(Buffer.from(await gem.arrayBuffer()).toString('latin1', 0, 6), 'GIF89a', `gem ${n}`);
  }
  const b100 = s.alerts.bits.tiers.find((t) => t.amount === 100);
  assert.deepEqual([b100.on, b100.image?.name, b100.sound?.name], [true, '100.gif', '500.wav']);
  assert.ok(!fs.existsSync(file('bits-tier-image-500.gif')) && fs.existsSync(file(b100.sound)), "500's image went, its sound moved");

  // On/off, a file per kind (uploading turns the tier on and replaces the old file), remove.
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'); // a real 1 x 1 GIF
  const wav = Buffer.from('RIFF\0\0\0\0WAVE', 'latin1');
  const up = (type, amount, kind, buf, name) => call('POST', `/api/tiers/${type}/${amount}/${kind}`, buf, { 'content-type': 'application/octet-stream', 'x-filename': name });
  const tier = (s, type, amount) => s.alerts[type].tiers.find((t) => t.amount === amount);
  s = await (await up('bits', 1000, 'image', gif, 'a.gif')).json();
  assert.deepEqual([tier(s, 'bits', 1000).on, tier(s, 'bits', 1000).image.name], [true, 'a.gif'], 'uploading turns the tier on');
  const first = tier(s, 'bits', 1000).image;
  s = await (await up('bits', 1000, 'image', gif, 'b.gif')).json();
  assert.equal(tier(s, 'bits', 1000).image.name, 'b.gif');
  assert.ok(!fs.existsSync(file(first)), 'the replaced file is removed');
  s = await (await up('bits', 1000, 'sound', wav, 's.wav')).json();
  s = await (await call('PATCH', '/api/tiers/bits/1000', { on: false })).json();
  assert.deepEqual([tier(s, 'bits', 1000).on, tier(s, 'bits', 1000).sound.name], [false, 's.wav'], 'off keeps the files');
  s = await (await call('DELETE', '/api/tiers/bits/1000/sound')).json();
  assert.equal(tier(s, 'bits', 1000).sound, null);
  for (const [method, url, body] of [['PATCH', '/api/tiers/bits/250', { on: true }], ['PATCH', '/api/tiers/raid/10', { on: true }], ['PATCH', '/api/tiers/kicks/100', { on: 'yes' }],
    ['POST', '/api/tiers/kicks/7/image', gif], ['POST', '/api/tiers/gift_sub/5/video', gif], ['DELETE', '/api/tiers/follow/1/image']]) {
    assert.equal((await call(method, url, body, Buffer.isBuffer(body) ? { 'content-type': 'application/octet-stream' } : {})).status, 400, `${method} ${url}`);
  }
  assert.equal((await up('gift_sub', 5, 'sound', gif, 'x.gif')).status, 400, 'a GIF is not a sound');
  assert.equal((await call('PATCH', '/api/settings', { alerts: { raid: { tiersOn: true } } })).status, 400, 'raid has no tiers');

  // Reset removes tier files.
  const kept = tier(s, 'bits', 1000).image;
  s = await (await call('POST', '/api/reset/bits')).json();
  assert.ok(s.alerts.bits.tiers.every((t) => !t.on && !t.image) && !fs.existsSync(file(kept)));
});

test('proxy: HTTP CONNECT and SOCKS5 tunnels, Windows proxy strings, plain-word errors, /remote only for the platforms', async () => {
  const echo = tcp.createServer((s) => s.pipe(s)).listen(0, '127.0.0.1');
  const used = { http: 0, socks5: 0 };
  // Fake proxies: every host name means this PC (names like echo.test only exist here).
  const httpProxy = tcp.createServer((c) => c.once('data', (d) => {
    const port = /^CONNECT \S+:(\d+) /.exec(d.toString())?.[1];
    used.http++;
    const up = tcp.connect(Number(port), '127.0.0.1', () => {
      c.write('HTTP/1.1 200 Connection established\r\n\r\n');
      c.pipe(up).pipe(c);
    });
  })).listen(0, '127.0.0.1');
  const socksProxy = tcp.createServer((c) => c.once('data', () => {
    c.write(Buffer.from([5, 0]));
    c.once('data', (d) => {
      const port = d.readUInt16BE(5 + d[4]);
      used.socks5++;
      const up = tcp.connect(port, '127.0.0.1', () => {
        c.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
        c.pipe(up).pipe(c);
      });
    });
  })).listen(0, '127.0.0.1');
  await Promise.all([echo, httpProxy, socksProxy].map((s) => new Promise((r) => s.listening ? r() : s.once('listening', r))));
  const roundTrip = async () => {
    const sock = await net.tunnel('echo.test', echo.address().port);
    sock.resume();
    const back = new Promise((r) => sock.once('data', (d) => r(d.toString())));
    sock.write('hello');
    const v = await back;
    sock.destroy();
    return v;
  };

  for (const type of ['http', 'socks5']) {
    const port = (type === 'http' ? httpProxy : socksProxy).address().port;
    const s = await (await call('PATCH', '/api/settings', { proxyMode: 'manual', proxyType: type, proxyHost: '127.0.0.1', proxyPort: port })).json();
    assert.deepEqual([s.proxyMode, s.proxyType, s.proxyPort], ['manual', type, port]);
    assert.equal(await roundTrip(), 'hello', type);
    assert.equal(used[type], 1, `${type}: went through the proxy`);
  }
  // fetch() goes through it too (the global dispatcher).
  const web = require('node:http').createServer((req, res) => res.end('ok')).listen(0, '127.0.0.1');
  await new Promise((r) => web.once('listening', r));
  assert.equal(await (await fetch(`http://web.test:${web.address().port}/`)).text(), 'ok');
  assert.equal(used.socks5, 2, 'fetch used the proxy');
  assert.equal((await call('GET', '/api/alerts/queue')).status, 200);
  assert.equal(used.socks5, 2, 'this PC itself: never through the proxy');

  // A proxy that isn't running: a clear "can't reach the proxy".
  const dead = tcp.createServer().listen(0, '127.0.0.1');
  await new Promise((r) => dead.once('listening', r));
  const deadPort = dead.address().port;
  dead.close();
  await call('PATCH', '/api/settings', { proxyPort: deadPort });
  await assert.rejects(roundTrip(), (err) => net.why(err) === 'proxy_down');

  for (const bad of [{ proxyMode: 'vpn' }, { proxyType: 'socks4' }, { proxyPort: 70000 }, { proxyHost: 'a b' }, { alertGap: -1 }]) {
    assert.equal((await call('PATCH', '/api/settings', bad)).status, 400, JSON.stringify(bad));
  }
  await call('PATCH', '/api/settings', { proxyMode: 'off', proxyHost: '', proxyPort: 0 });
  for (const s of [echo, httpProxy, socksProxy, web]) s.close();

  assert.deepEqual(net.parseWindows(true, '127.0.0.1:10809'), { type: 'http', host: '127.0.0.1', port: 10809 });
  assert.deepEqual(net.parseWindows(true, 'http=127.0.0.1:8080;https=127.0.0.1:8443;socks=127.0.0.1:1080'), { type: 'http', host: '127.0.0.1', port: 8443 });
  assert.deepEqual(net.parseWindows(true, 'socks=127.0.0.1:10808'), { type: 'socks5', host: '127.0.0.1', port: 10808 });
  assert.equal(net.parseWindows(false, '127.0.0.1:10809'), null, 'proxy switched off in Windows');

  for (const u of ['https://evil.example/x.png', 'http://files.kick.com/x.png', 'https://kick.com.evil.example/x.png', 'nope']) {
    assert.equal((await fetch(`${base}/remote?u=${encodeURIComponent(u)}`)).status, 400, u);
  }
});

test('Kick events become one alert each, repeats are dropped, goals count them', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const id of ['subs', 'kicks']) goals.change(id, { set: 0 });
  const got = [];
  const onEvent = (e) => got.push(e);
  bus.on('event', onEvent);
  const cb = { onMessage() {}, onClear() {}, onAlert: (a) => emitEvent({ ...a, platform: 'kick' }) };
  const H = (event, data) => kick.handle(event, JSON.stringify(data), 'somechannel', { subBadges: [] }, cb);
  const realLookup = kick.subMonths;
  kick.subMonths = async (slug, user) => (user === 'KunciKediri' ? 10 : null);

  // A new sub: Kick sends it on the chat socket and (later) on the channel socket.
  H('App\\Events\\SubscriptionEvent', { chatroom_id: 1769274, username: '747steven_russell', months: 1 });
  H('App\\Events\\SubscriptionEvent', { chatroom_id: 1769274, username: '747steven_russell', months: 1 });
  H('App\\Events\\ChannelSubscriptionEvent', { user_ids: [117887478], username: '747steven_russell', channel_id: 1776677 });
  H('App\\Events\\SubscriptionEvent', { chatroom_id: 1, username: 'Fan', months: 5 });
  // A viewer shares their renewal in chat (a "celebration" message).
  const celebration = { id: '9e2ed9e8', chatroom_id: 25314085, content: "Tersten mağduriyet 31'i", type: 'celebration', created_at: '2026-10-10T15:30:58+00:00',
    sender: { id: 8525034, username: 'xxYCYxx', slug: 'xxycyxx', identity: { color: '#BAFEA3', badges: [{ type: 'subscriber', text: 'Subscriber', count: 31 }] } },
    metadata: { celebration: { id: 'chceleb_01M4H5W4QCCGYYK8RYTW19XNRT', type: 'subscription_renewed', total_months: 31 } } };
  H('App\\Events\\ChatMessageEvent', celebration);
  H('App\\Events\\ChatMessageEvent', { ...celebration, id: 'other-copy' });
  // A gift of 10 subs (real shape, chatroom_<id> socket), sent twice; then "subscribed" for one of the viewers who got
  // one, and the channel socket's "subscribed" for the gifter (Kick sends that one 8-19 s later).
  const gift = { chatroom_id: 25314085, correlation_id: 'pi_3UP2Y4E5WX7FB3n51A7DRkO3', gifted_usernames: ['azizovic1000', 'eyuphalowski', 'tchefy', 'Yaman22ghhf', 'bukamelon',
    'Rentados', 'BySilson', 'ALPERKOKLAR', 'pekiipek', 'BugsNBunny'], gifter_username: 'itsfuuki', gifted_total: 10, gifter_total: 10, chunk_details: null };
  H('GiftedSubscriptionsEvent', gift);
  H('GiftedSubscriptionsEvent', gift);
  H('App\\Events\\SubscriptionEvent', { chatroom_id: 1, username: 'tchefy', months: 1 });
  H('App\\Events\\ChannelSubscriptionEvent', { user_ids: [27009989], username: 'itsfuuki', channel_id: 25602397 });
  // A gift of 50 in two chunks: one alert with the whole amount.
  const chunk = (names) => ({ chatroom_id: 1, correlation_id: 'pi_big', gifted_usernames: names, gifter_username: 'Whale', gifted_total: 50, gifter_total: 900 });
  H('GiftedSubscriptionsEvent', chunk(Array.from({ length: 25 }, (_, i) => `a${i}`)));
  H('GiftedSubscriptionsEvent', chunk(Array.from({ length: 25 }, (_, i) => `b${i}`)));
  // Kicks (two real payloads; the same transaction twice) and a host.
  const kicks = { gift_transaction_id: '8d36fd5d-03d9-4163-8faf-e888dd95a17c', message: "JUST KEEP PLANKING 2 MINS EVERY DAY AND YOU'LL BE ASCENDED",
    sender: { id: 103934106, username: 'hejpparallaa', username_color: '#E26EFF' }, gift: { gift_id: 'rage_quit', name: 'Rage Quit', amount: 500, type: 'LEVEL_UP', tier: 'MID' } };
  H('KicksGifted', kicks);
  H('KicksGifted', kicks);
  H('KicksGifted', { gift_transaction_id: '7ac1a850-ebeb-4d0f-873a-593c69a1fa68', sender: { id: 60563579, username: 'AMITGIDC' }, gift: { gift_id: 'hell_yeah', name: 'Hell Yeah', amount: 1 } });
  H('App\\Events\\StreamHostEvent', { chatroom_id: 22, optional_message: '', number_viewers: 178, host_username: 'CheapCharlieLive' });
  H('App\\Events\\StreamHostEvent', { chatroom_id: 22, optional_message: '', number_viewers: 178, host_username: 'CheapCharlieLive' });
  // An automatic renewal: only on the channel socket, without months (looked up: 10), sent twice.
  H('App\\Events\\ChannelSubscriptionEvent', { user_ids: [89616436], username: 'KunciKediri', channel_id: 87788191 });
  H('App\\Events\\ChannelSubscriptionEvent', { user_ids: [89616436], username: 'KunciKediri', channel_id: 87788191 });
  t.mock.timers.tick(kick.SETTLE_MS);
  t.mock.timers.tick(kick.GIFT_WAIT_MS); // several viewers' subs at once: they wait for a gift that may name them
  await flush();
  bus.off('event', onEvent);
  kick.subMonths = realLookup;

  assert.deepEqual(got.map((e) => [e.type, e.user, e.amount, e.months]), [
    ['resub', 'xxYCYxx', 0, 31],
    ['gift_sub', 'itsfuuki', 10, 0],
    ['gift_sub', 'Whale', 50, 0],
    ['kicks', 'hejpparallaa', 500, 0],
    ['kicks', 'AMITGIDC', 1, 0],
    ['raid', 'CheapCharlieLive', 178, 0],
    ['sub', '747steven_russell', 0, 1], // subs announced in chat wait a moment for a gift that names them
    ['resub', 'Fan', 0, 5],
    ['resub', 'KunciKediri', 0, 10],
  ]);
  assert.ok(got.every((e) => e.platform === 'kick' && !e.test));
  assert.equal(got[0].message, "Tersten mağduriyet 31'i");
  assert.match(got[3].message, /^JUST KEEP PLANKING/);
  const g = goals.all();
  assert.deepEqual([g.subs.current, g.kicks.current], [1 + 1 + 1 + 10 + 50 + 1, 501], 'goals count real events once');
  queue.clear();
});

test('Kick subs: a sub on its own plays after a moment; a gift of 2 is one gift alert even when its viewers\' "subscribed" comes first', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  const got = [], lines = [];
  // [type, user, amount or months, how long it waited (ms)]
  const cb = { onMessage: (m) => lines.push(m.system || m.text), onClear() {}, onAlert: (a) => got.push([a.type, a.user, a.amount ?? a.months, Date.now() - (a.received ?? Date.now())]) };
  const H = (event, data) => kick.handle(event, JSON.stringify(data), 'somechannel', { subBadges: [] }, cb);
  const wait = (ms) => { for (let i = 0; i < ms / 100; i++) t.mock.timers.tick(100); }; // timers set inside timers too
  // A sub on its own: no gift looks likely, so it doesn't wait for one.
  H('App\\Events\\SubscriptionEvent', { chatroom_id: 1, username: 'Solo', months: 1 });
  wait(kick.SETTLE_MS);
  assert.deepEqual(got, [['sub', 'Solo', 1, kick.SETTLE_MS]]);
  // The chat socket's "subscribed" for both viewers reaches Jarchi 1 s before the gift itself (another socket channel):
  // two viewers at once look like a gift, so they wait for it.
  H('App\\Events\\SubscriptionEvent', { chatroom_id: 1, username: 'GiftedOne', months: 1 });
  H('App\\Events\\SubscriptionEvent', { chatroom_id: 1, username: 'GiftedTwo', months: 1 });
  wait(1000);
  assert.equal(got.length, 1, 'they wait');
  H('GiftedSubscriptionsEvent', { chatroom_id: 1, correlation_id: 'pi_two', gifted_usernames: ['GiftedOne', 'GiftedTwo'], gifter_username: 'Santa', gifted_total: 2, gifter_total: 2, chunk_details: null });
  H('App\\Events\\SubscriptionEvent', { chatroom_id: 1, username: 'RealFan', months: 1 });
  H('App\\Events\\ChatMessageEvent', { id: 'm1', content: 'hi', sender: { username: 'Chatter', slug: 'chatter' } });
  // The wait is for sub alerts only: every chat line, the sub lines too, is out at once.
  assert.deepEqual(lines, ['Solo subscribed for 1 months!', 'GiftedOne subscribed for 1 months!', 'GiftedTwo subscribed for 1 months!', 'Santa gifted 2 subs!', 'RealFan subscribed for 1 months!', 'hi']);
  assert.deepEqual(got.slice(1), [['gift_sub', 'Santa', 2, 0]]);
  wait(kick.SETTLE_MS); // the gift named its viewers: a real sub just after it doesn't wait for a gift
  wait(kick.GIFT_WAIT_MS);
  assert.deepEqual(got.slice(2), [['sub', 'RealFan', 1, kick.SETTLE_MS]], 'no sub alerts for the gifted viewers');
  // Two real subs at once and no gift comes: they play once the gift wait is over.
  H('App\\Events\\SubscriptionEvent', { chatroom_id: 1, username: 'FanA', months: 1 });
  H('App\\Events\\SubscriptionEvent', { chatroom_id: 1, username: 'FanB', months: 3 });
  wait(kick.GIFT_WAIT_MS - 100);
  assert.equal(got.length, 3);
  wait(100);
  assert.deepEqual(got.slice(3), [['sub', 'FanA', 1, kick.GIFT_WAIT_MS], ['resub', 'FanB', 3, kick.GIFT_WAIT_MS]]);

  // The event log: those Kick events as they came, in order, not the chat message; only the last 500 lines are kept.
  const log = () => fs.readFileSync(path.join(dataDir, 'logs', 'events.log'), 'utf8').trim().split('\n');
  assert.deepEqual(log().slice(-7).map((l) => l.split(' ')[3]), ['App\\Events\\SubscriptionEvent', 'App\\Events\\SubscriptionEvent', 'App\\Events\\SubscriptionEvent',
    'GiftedSubscriptionsEvent', 'App\\Events\\SubscriptionEvent', 'App\\Events\\SubscriptionEvent', 'App\\Events\\SubscriptionEvent']);
  assert.match(log().at(-4), /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} kick GiftedSubscriptionsEvent \{.*"gifter_username":"Santa"/);
  for (let i = 0; i < 500; i++) logIncoming('kick', 'filler', { i });
  assert.deepEqual([log().length, log()[0].endsWith('filler {"i":0}')], [500, true]);
});

test("Kick subs from two sources: the chat socket and Kick's official events (Connect Kick) alert each sub and gift once", (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  const got = [];
  const cb = { onMessage() {}, onClear() {}, onAlert: (a) => { const e = emitEvent({ ...a, platform: 'kick' }); if (e) got.push([e.type, e.user, e.amount || e.months]); } };
  const H = (event, data) => kick.handle(event, JSON.stringify(data), 'somechannel', { subBadges: [] }, cb);
  const O = (type, data) => kick.official(type, { broadcaster: { user_id: 1 }, ...data }, cb);
  const wait = (ms = kick.GIFT_WAIT_MS) => { for (let i = 0; i < ms / 100; i++) t.mock.timers.tick(100); };
  const realLookup = kick.subMonths;
  kick.subMonths = async () => null;

  // Official first, then the socket's copies (one named without "App\Events\", as Kick does for newer events).
  O('channel.subscription.new', { subscriber: { username: 'OffFirst' }, duration: 1 });
  wait();
  H('App\\Events\\ChannelSubscriptionEvent', { user_ids: [1], username: 'OffFirst', channel_id: 1 });
  H('SubscriptionEvent', { chatroom_id: 1, username: 'OffFirst', months: 1 });
  wait();
  // The socket first, then the official renewal.
  H('App\\Events\\SubscriptionEvent', { chatroom_id: 1, username: 'SockFirst', months: 4 });
  wait();
  O('channel.subscription.renewal', { subscriber: { username: 'SockFirst' }, duration: 4 });
  wait();
  // The socket missed it: the official event alone.
  O('channel.subscription.renewal', { subscriber: { username: 'Missed' }, duration: 7 });
  wait();
  // Gifts: official first (and a "new sub" for a viewer it named); the socket first; official sent twice; anonymous.
  O('channel.subscription.gifts', { gifter: { username: 'GiverA' }, giftees: [{ username: 'g1' }, { username: 'g2' }] });
  O('channel.subscription.new', { subscriber: { username: 'g1' }, duration: 1 });
  H('GiftedSubscriptionsEvent', { chatroom_id: 1, correlation_id: 'pi_a', gifted_usernames: ['g1', 'g2'], gifter_username: 'GiverA', gifted_total: 2, gifter_total: 2 });
  H('GiftedSubscriptionsEvent', { chatroom_id: 1, correlation_id: 'pi_b', gifted_usernames: ['h1'], gifter_username: 'GiverB', gifted_total: 1, gifter_total: 1 });
  O('channel.subscription.gifts', { gifter: { username: 'GiverB' }, giftees: [{ username: 'h1' }] });
  O('channel.subscription.gifts', { gifter: { username: 'GiverC' }, giftees: [{ username: 'k1' }] });
  O('channel.subscription.gifts', { gifter: { username: 'GiverC' }, giftees: [{ username: 'k1' }] });
  O('channel.subscription.gifts', { gifter: { is_anonymous: true, username: null }, giftees: [{ username: 'm1' }] });
  wait();
  kick.subMonths = realLookup;
  assert.deepEqual(got, [['sub', 'OffFirst', 1], ['resub', 'SockFirst', 4], ['resub', 'Missed', 7],
    ['gift_sub', 'GiverA', 2], ['gift_sub', 'GiverB', 1], ['gift_sub', 'GiverC', 1], ['gift_sub', 'Anonymous', 1]]);

  // Every socket event but chat itself goes to the event log, also ones Jarchi doesn't know.
  const log = () => fs.readFileSync(path.join(dataDir, 'logs', 'events.log'), 'utf8').trim().split('\n');
  H('SomethingNewEvent', { username: 'Who' });
  H('App\\Events\\ChatMessageEvent', { id: 'm2', content: 'hi', sender: { username: 'Chatter', slug: 'chatter' } });
  assert.match(log().at(-1), / kick SomethingNewEvent \{"username":"Who"\}$/);
  queue.clear();
});

test('a WebSocket that went quiet is given up on: its onclose runs once, even when the connection never answers', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const closes = [];
  const dead = { close() {}, onclose: (e) => closes.push(e.code), onmessage: () => assert.fail('nothing passed on after hangUp') };
  net.hangUp(dead);
  assert.equal(dead.onmessage, null);
  t.mock.timers.tick(3000);
  assert.deepEqual(closes, [1006]);
  dead.onclose({ code: 1000 }); // the real close, if it ever comes
  net.hangUp(dead);
  t.mock.timers.tick(3000);
  assert.deepEqual(closes, [1006]);
});

test('Twitch IRC events become one alert each: a community gift is one alert, not one per viewer', () => {
  for (const id of ['subs', 'kicks']) goals.change(id, { set: 0 });
  const got = [];
  const onEvent = (e) => got.push(e);
  bus.on('event', onEvent);
  const cb = { onMessage() {}, onClear() {}, onChannel() {}, onAlert: (a) => emitEvent({ ...a, platform: 'twitch' }) };
  const H = (tags, rest) => twitch.handle(`@${tags};room-id=71092938 ${rest}`, 'somechannel', cb);
  const notice = (tags, text) => H(tags, `:tmi.twitch.tv USERNOTICE #somechannel${text ? ` :${text}` : ''}`);

  notice('display-name=NewFan;login=newfan;id=n1;msg-id=sub;msg-param-cumulative-months=1;msg-param-sub-plan=1000');
  notice('display-name=ronni;login=ronni;id=r1;msg-id=resub;msg-param-cumulative-months=8;msg-param-streak-months=2;msg-param-sub-plan=Prime', 'Great stream -- keep it up!');
  notice('display-name=ronni;login=ronni;id=r1;msg-id=resub;msg-param-cumulative-months=8', 'Great stream -- keep it up!'); // the same line again
  // A community gift of 3: the gift itself, then one subgift per viewer with the same community gift id.
  notice('display-name=Santa;login=santa;id=g1;msg-id=submysterygift;msg-param-community-gift-id=344143;msg-param-mass-gift-count=3;msg-param-sender-count=50');
  for (const [i, v] of ['Ann', 'Bob', 'Cy'].entries()) notice(`display-name=Santa;login=santa;id=g1-${i};msg-id=subgift;msg-param-community-gift-id=344143;msg-param-recipient-display-name=${v};msg-param-months=1`);
  // A sub gifted to one chosen viewer: no community gift id.
  notice('display-name=Elf;login=elf;id=g2;msg-id=subgift;msg-param-recipient-display-name=Lucky;msg-param-months=1');
  notice('display-name=AnAnonymousGifter;login=ananonymousgifter;id=g3;msg-id=anonsubmysterygift;msg-param-community-gift-id=99;msg-param-mass-gift-count=5');
  notice('display-name=TestChannel;login=testchannel;id=rd1;msg-id=raid;msg-param-displayName=TestChannel;msg-param-login=testchannel;msg-param-viewerCount=15');
  H('display-name=Cheery;bits=100;id=b1;user-id=5', ':cheery!cheery@cheery.tmi.twitch.tv PRIVMSG #somechannel :Cheer100 great gg2 cheer100 stream');
  // Not alerts: a chat line, bits from another channel in a shared chat, a Prime upgrade.
  H('display-name=Chatter;id=m1', ':chatter!chatter@chatter.tmi.twitch.tv PRIVMSG #somechannel :Cheer100 is just text here');
  H('display-name=Guest;bits=500;id=b2;source-room-id=1234', ':guest!guest@guest.tmi.twitch.tv PRIVMSG #somechannel :Cheer500');
  notice('display-name=Up;login=up;id=u1;msg-id=primepaidupgrade;msg-param-sub-plan=1000');
  bus.off('event', onEvent);

  assert.deepEqual(got.map((e) => [e.type, e.user, e.amount, e.months]), [
    ['sub', 'NewFan', 0, 1],
    ['resub', 'ronni', 0, 8],
    ['gift_sub', 'Santa', 3, 0],
    ['gift_sub', 'Elf', 1, 0],
    ['gift_sub', 'AnAnonymousGifter', 5, 0],
    ['raid', 'TestChannel', 15, 0],
    ['bits', 'Cheery', 100, 0],
  ]);
  assert.ok(got.every((e) => e.platform === 'twitch' && !e.test));
  assert.equal(got[1].message, 'Great stream -- keep it up!');
  assert.equal(got[6].message, 'great gg2 stream', "cheermotes left out, other words with numbers kept");
  assert.equal(goals.all().subs.current, 0, 'the sub goal counts Twitch subs only with "Also count Twitch subs" on (server.test.js)');
  queue.clear();
});

test('alert queue: one at a time to every overlay, survives refreshes and OBS closing, skip / pause / clear', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  queue.clear();
  const plays = [], skips = [];
  queue.events.on('play', (a) => plays.push(a.ev.user));
  queue.events.on('skip', (id) => skips.push(id));
  const fire = (user, type = 'follow', extra = {}) => emitEvent({ platform: 'test', type, user, test: true, ...extra });
  const late = [];
  const overlay = (name) => () => queue.join((a) => late.push([name, a.ev.user, a.late, Math.round(a.left / 1000)]));
  // In small steps: a timer set inside a callback counts from the end of a tick() call.
  const tick = (s) => { for (let i = 0; i < Math.round(s * 10); i++) t.mock.timers.tick(100); };
  // follow: 4s on screen + 0.6s exit + 0.5s gap. sub: 6s.

  fire('A'); fire('B', 'sub'); fire('C');
  assert.deepEqual([plays, queue.state().waiting], [[], 3], 'no overlay open: they wait');
  assert.deepEqual(queue.state().list.map((a) => [a.user, a.type]), [['A', 'follow'], ['B', 'sub'], ['C', 'follow']], 'the waiting list, in order');
  tick(2);
  overlay('obs')();
  assert.deepEqual(plays, ['A']);
  // The overlay says it started A: a timing line with where the time went (here: 2 s waiting for an open overlay).
  assert.match(queue.shown({ id: queue.state().now.id, shown: Date.now() + 40, where: 'OBS' }, 'websocket'),
    /^follow A {2}received \d\d:\d\d:\d\d\.\d{3} {2}check \+0\.00s {2}queue \+2\.00s {2}overlay \+0\.04s {2}total \+2\.04s {2}OBS\/websocket$/);
  assert.equal(queue.shown({ id: 'not-playing', shown: Date.now() }, 'websocket'), null);
  tick(5.1);
  assert.deepEqual(plays, ['A', 'B']);
  tick(2);
  overlay('second')(); // a second overlay opens in the middle of B: it gets B with the time left, flagged late (no sound)
  assert.deepEqual(late, [['second', 'B', true, 4]]);
  const { user, ms, left } = queue.state().now;
  assert.deepEqual([user, ms, left], ['B', 6000, 4000], 'now playing, with its length and time left (progress bar)');
  queue.leave(); overlay('obs')(); // OBS refreshes one overlay: same thing, B isn't replayed
  tick(4.6 + 0.5);
  assert.deepEqual(plays, ['A', 'B', 'C'], 'same order, each once');
  queue.skip();
  assert.equal(skips.length, 1);
  tick(1.1);
  assert.deepEqual([queue.state().now, queue.state().waiting], [null, 0]);
  assert.deepEqual(queue.state().history.map((a) => a.user), ['C', 'B', 'A'], 'last played, newest first; a skipped one counts');

  // OBS closes while D plays: D comes back when OBS is back.
  fire('D');
  assert.equal(plays.at(-1), 'D');
  tick(1);
  queue.leave(); queue.leave();
  assert.equal(queue.state().overlays, 0);
  tick(10);
  assert.deepEqual([plays.at(-1), queue.state().waiting], ['D', 1], 'D is waiting again');
  overlay('obs')();
  assert.deepEqual(plays.slice(-2), ['D', 'D'], 'D plays again once OBS is back');
  tick(5.1);

  // Pause holds new alerts; resume plays them. × removes one waiting alert, Clear all of them.
  queue.pause(true);
  fire('E');
  tick(10);
  assert.notEqual(plays.at(-1), 'E');
  queue.pause(false);
  assert.equal(plays.at(-1), 'E');
  queue.pause(true);
  fire('F'); fire('G'); fire('H');
  const g = queue.state().list.find((a) => a.user === 'G');
  assert.deepEqual(queue.remove(g.id).list.map((a) => a.user), ['F', 'H']);
  queue.clear();
  assert.equal(queue.state().waiting, 0);
  queue.pause(false);
  tick(10);

  // Replay one of the last played: it plays again, but it's not a new event (goals don't count it twice).
  const busEvents = [];
  const onEvent = (e) => busEvents.push(e);
  bus.on('event', onEvent);
  const a = queue.state().history.find((h) => h.user === 'A');
  queue.replay(a.id);
  bus.off('event', onEvent);
  assert.deepEqual([plays.at(-1), busEvents.length], ['A', 0]);
  assert.ok(queue.state().history.length <= 10);
  tick(5.1);

  // Real (not test) events follow the alert's on/off and minimum amount; the gap setting is used.
  const settings = require('../core/settings');
  settings.update({ alertGap: 3, alerts: { follow: { enabled: false }, kicks: { minAmount: 100 } } });
  fire('off', 'follow', { test: false });
  fire('small', 'kicks', { test: false, amount: 50 });
  fire('big', 'kicks', { test: false, amount: 100 });
  fire('next');
  assert.equal(plays.at(-1), 'big');
  tick(7.5 + 0.6 + 2.9); // 100 Kicks is one step bigger: 1.5s longer
  assert.equal(plays.at(-1), 'big', 'still in the 3s gap');
  tick(0.2);
  assert.equal(plays.at(-1), 'next');
  queue.leave();
});

test("History: every saved event (any can replay), Home: today's real alerts and chat, widget pages open right now", async () => {
  queue.clear();
  const home = async () => (await call('GET', '/api/home')).json();
  const before = (await home()).today;
  for (let i = 1; i <= 22; i++) emitEvent({ platform: 'test', type: 'follow', user: `T${i}`, test: true });
  emitEvent({ platform: 'kick', type: 'kicks', user: 'Small', amount: 1 }); // below the minimum: no alert, still in the feed
  emitChat({ platform: 'twitch', user: { name: 'viewer' }, text: 'hi' });
  emitChat({ platform: 'twitch', user: { name: 'tester' }, text: 'hi', test: true });
  const h = await home();
  const saved = await (await call('GET', '/api/history')).json();
  assert.deepEqual(saved.slice(0, 3).map((e) => e.user), ['Small', 'T22', 'T21'], 'newest first');
  assert.ok(saved.length >= 23, 'no longer only the last 20');
  assert.deepEqual(h.today, { alerts: before.alerts + 1, chat: before.chat + 1 }, 'test alerts and test messages not counted');
  const q = await (await call('POST', `/api/alerts/replay/${saved[0].id}`)).json();
  assert.equal(q.list.at(-1).user, 'Small', 'replays from the feed, even one that never played');
  queue.clear();

  // Widget pages say which they are once connected (Socket.IO over a plain WebSocket); closing one counts it out.
  const seen = [];
  const sio = (onReady) => {
    const ws = new WebSocket('ws://127.0.0.1:3997/socket.io/?EIO=4&transport=websocket');
    ws.onmessage = ({ data }) => {
      if (data.startsWith('0')) ws.send('40'); // engine.io open -> join the main namespace
      else if (data.startsWith('40')) onReady?.(ws);
      else if (data.startsWith('42["widgets"')) seen.push(JSON.parse(data.slice(2))[1]);
    };
    return ws;
  };
  const until = async (ok) => {
    for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 10));
    assert.ok(ok(), JSON.stringify(seen));
  };
  const panel = sio();
  const chatPage = sio((ws) => ws.send('42["widgetJoin","chat"]'));
  const stranger = sio((ws) => ws.send('42["widgetJoin","nope"]')); // unknown names are ignored
  await until(() => seen.at(-1)?.chat === 1);
  chatPage.close();
  await until(() => seen.at(-1)?.chat === 0);
  assert.ok(seen.every((w) => !('nope' in w)));
  panel.close();
  stranger.close();
});
