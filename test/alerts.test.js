// Kick alerts from chat events (payloads captured from live Kick channels), the server-side alert queue,
// media by amount (tiers) and the proxy tunnel (through local fake HTTP CONNECT and SOCKS5 proxies).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tcp = require('node:net');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarchi-alerts-'));
process.env.JARCHI_DATA_DIR = dataDir;
process.env.JARCHI_PORT = '3997';
const { server, io } = require('../server');
const { bus, emitEvent } = require('../core/events');
const kick = require('../connectors/kick-chat');
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

test('media by amount: tiers are added, sorted, get files, and are removed with their files', async () => {
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  let s = await (await call('GET', '/api/settings')).json();
  assert.deepEqual([s.alerts.kicks.tiersOn, s.alerts.kicks.tiers], [false, []], 'off by default');
  assert.ok(!('tiersOn' in s.alerts.follow), 'only for types with an amount');
  assert.equal((await call('POST', '/api/tiers/follow')).status, 400);

  for (let i = 0; i < 3; i++) s = await (await call('POST', '/api/tiers/kicks')).json();
  assert.deepEqual(s.alerts.kicks.tiers.map((t) => t.min), [1, 10, 100]);
  s = await (await call('PATCH', '/api/tiers/kicks/1', { min: 500 })).json();
  assert.deepEqual(s.alerts.kicks.tiers.map((t) => t.min), [1, 100, 500], 'kept sorted');
  assert.equal((await call('PATCH', '/api/tiers/kicks/0', { min: 0 })).status, 400);
  assert.equal((await call('PATCH', '/api/tiers/kicks/9', { min: 5 })).status, 400);

  const gif = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1');
  const wav = Buffer.from('RIFF\0\0\0\0WAVE', 'latin1');
  const up = (i, kind, buf, name) => call('POST', `/api/tiers/kicks/${i}/${kind}`, buf, { 'content-type': 'application/octet-stream', 'x-filename': name });
  await up(2, 'image', gif, 'a.gif');
  await up(2, 'image', gif, 'b.gif');
  s = await (await up(2, 'sound', wav, 'big.wav')).json();
  const top = s.alerts.kicks.tiers[2];
  assert.deepEqual([top.images.map((f) => f.name), top.sounds.map((f) => f.name)], [['a.gif', 'b.gif'], ['big.wav']]);
  assert.equal((await up(2, 'sound', gif, 'x.gif')).status, 400, 'a GIF is not a sound');
  assert.equal((await up(2, 'video', gif, 'x.gif')).status, 400);
  const file = (f) => path.join(dataDir, 'uploads', f.file);
  assert.ok(top.images.every((f) => fs.existsSync(file(f))));

  s = await (await call('DELETE', '/api/tiers/kicks/2/image/0')).json();
  assert.deepEqual(s.alerts.kicks.tiers[2].images.map((f) => f.name), ['b.gif']);
  assert.ok(!fs.existsSync(file(top.images[0])), 'file removed');
  s = await (await call('PATCH', '/api/settings', { alerts: { kicks: { tiersOn: true } } })).json();
  assert.equal(s.alerts.kicks.tiersOn, true);
  s = await (await call('DELETE', '/api/tiers/kicks/2')).json();
  assert.equal(s.alerts.kicks.tiers.length, 2);
  assert.ok(!fs.existsSync(file(top.images[1])) && !fs.existsSync(file(top.sounds[0])), 'a removed tier takes its files');

  await up(1, 'image', gif, 'c.gif');
  s = await (await call('POST', '/api/reset/kicks')).json();
  assert.deepEqual([s.alerts.kicks.tiersOn, s.alerts.kicks.tiers], [false, []]);
  assert.deepEqual(fs.readdirSync(path.join(dataDir, 'uploads')).filter((f) => f.includes('tier')), [], 'reset removes tier files');
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
  t.mock.timers.tick(kick.HOLD_MS);
  await flush();
  bus.off('event', onEvent);
  kick.subMonths = realLookup;

  assert.deepEqual(got.map((e) => [e.type, e.user, e.amount, e.months]), [
    ['sub', '747steven_russell', 0, 1],
    ['resub', 'Fan', 0, 5],
    ['resub', 'xxYCYxx', 0, 31],
    ['gift_sub', 'itsfuuki', 10, 0],
    ['gift_sub', 'Whale', 50, 0],
    ['kicks', 'hejpparallaa', 500, 0],
    ['kicks', 'AMITGIDC', 1, 0],
    ['raid', 'CheapCharlieLive', 178, 0],
    ['resub', 'KunciKediri', 0, 10],
  ]);
  assert.ok(got.every((e) => e.platform === 'kick' && !e.test));
  assert.equal(got[2].message, "Tersten mağduriyet 31'i");
  assert.match(got[5].message, /^JUST KEEP PLANKING/);
  const g = goals.all();
  assert.deepEqual([g.subs.current, g.kicks.current], [1 + 1 + 1 + 10 + 50 + 1, 501], 'goals count real events once');
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
  overlay('obs')();
  assert.deepEqual(plays, ['A']);
  tick(5.1);
  assert.deepEqual(plays, ['A', 'B']);
  tick(2);
  overlay('second')(); // a second overlay opens in the middle of B: it gets B with the time left, flagged late (no sound)
  assert.deepEqual(late, [['second', 'B', true, 4]]);
  queue.leave(); overlay('obs')(); // OBS refreshes one overlay: same thing, B isn't replayed
  tick(4.6 + 0.5);
  assert.deepEqual(plays, ['A', 'B', 'C'], 'same order, each once');
  queue.skip();
  assert.equal(skips.length, 1);
  tick(1.1);
  assert.deepEqual([queue.state().now, queue.state().waiting], [null, 0]);

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

  // Pause holds new alerts; resume plays them. Clear empties the waiting list.
  queue.pause(true);
  fire('E');
  tick(10);
  assert.notEqual(plays.at(-1), 'E');
  queue.pause(false);
  assert.equal(plays.at(-1), 'E');
  queue.pause(true);
  fire('F'); fire('G');
  assert.equal(queue.state().waiting, 2);
  queue.clear();
  assert.equal(queue.state().waiting, 0);
  queue.pause(false);
  tick(10);

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
