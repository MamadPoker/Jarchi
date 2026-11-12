// The VPN help (core/vpn.js) for a VPN app running per app, without Jarchi on its list. Jarchi never turns a proxy on by
// itself: the default is Off (an older install's Yes is Manual now), and help only offers. What counts as out of reach
// (server/sockets.js): Kick refusing this network (blocked) and a connection still connecting do, a channel that isn't
// there doesn't. Out of reach 30 s: Jarchi checks the service, looks for the VPN app's local proxy and offers it, or
// shows how to let Jarchi through (with Jarchi's own path); Yes tries Kick and the relay through it, then sets Manual
// with it; No stops it asking by itself until the streamer looks. Kick's login page in the browser says why it failed.
// This PC's real VPN apps and the network are stood in for.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarchi-vpn-'));
process.env.JARCHI_DATA_DIR = dataDir;
process.env.JARCHI_PORT = '3993';
process.env.KICK_RELAY_URL = 'http://127.0.0.1:9'; // nothing there
process.env.JARCHI_PAY_URL = 'http://127.0.0.1:9';
// A 1.0.7 dev install that said Yes to v2rayN (Auto + proxyFound, settings v9).
fs.writeFileSync(
  path.join(dataDir, 'settings.json'),
  JSON.stringify({ version: 9, proxyMode: 'auto', proxyFound: { app: 'v2rayN', type: 'socks5', host: '127.0.0.1', port: 10808 } }),
);

test('help only offers: 30 s out of reach -> VPN offered; Yes checks, then Manual; No stops asking; none -> the guide', async (t) => {
  const { server, io } = require('../server');
  const chat = require('../core/chat');
  const settings = require('../core/settings');
  const vpn = require('../core/vpn');
  t.after(() => {
    io.close();
    server.closeAllConnections();
  });

  // v9 -> v10: the Yes from before is Manual with that proxy; nothing else of it is kept.
  const mode = () => {
    const s = settings.get();
    return [s.proxyMode, s.proxyType, s.proxyHost, s.proxyPort];
  };
  assert.deepEqual(mode(), ['manual', 'socks5', '127.0.0.1', 10808]);
  assert.ok(!('proxyFound' in JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'))));
  settings.update({ proxyMode: 'off', proxyHost: '', proxyPort: 0 }, false);

  // Kick's login page in the browser: an old link (nothing waits for it) says so, plainly and safely.
  const page = await fetch('http://127.0.0.1:3993/api/kick/callback?code=c&state=1.<b>x');
  const text = await page.text();
  assert.match(text, /This login link is old/);
  assert.ok(!text.includes('<b>x'));
  assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);

  // What counts (server/sockets.js -> vpn.status): blocked and connecting do; not_found doesn't.
  const told = [],
    status = vpn.status;
  vpn.status = (...a) => told.push(a);
  const st = (kick) => chat.events.emit('status', { kick, twitch: { state: 'off', detail: '' } });
  st({ state: 'error', detail: 'blocked' });
  st({ state: 'connecting', detail: '' });
  st({ state: 'error', detail: 'not_found' });
  st({ state: 'connected', detail: '' });
  assert.deepEqual(
    told.filter(([s]) => s === 'kick'),
    [
      ['kick', false, true],
      ['kick', false, true],
      ['kick', false, false],
      ['kick', true, false],
    ],
  );
  vpn.status = status;
  // From here on the test alone says how the connections are (this server has no channel, so it keeps saying off).
  for (const c of [chat, require('../connectors/kick-account'), require('../connectors/twitch-account')]) c.events.removeAllListeners('status');

  // Stand-ins: Kick refuses this network directly; through v2rayN's proxy it answers.
  const V2 = { app: 'v2rayN', type: 'socks5', host: '127.0.0.1', port: 10808 };
  let through = null,
    look = { found: V2, system: null };
  for (const s of Object.keys(vpn.CHECKS))
    vpn.CHECKS[s] = async (via) => {
      if (!via || JSON.stringify(via) !== JSON.stringify(through)) throw new Error('blocked');
    };
  vpn.find = async () => look;
  require('../core/net').current = async () => {
    // not this PC's Windows proxy
    const s = settings.get();
    return s.proxyMode === 'manual' ? { type: s.proxyType, host: s.proxyHost, port: s.proxyPort } : null;
  };
  const tick = () => new Promise((r) => setImmediate(r));
  const flush = async () => {
    for (let i = 0; i < 20; i++) await tick();
  };
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });

  // Off: still offered (help only), and nothing changes until Yes.
  vpn.status('kick', false, true);
  t.mock.timers.tick(vpn.WAIT_MS - 1000);
  await flush();
  assert.equal(vpn.state().state, 'idle', 'not before 30 s');
  t.mock.timers.tick(1000);
  await flush();
  assert.deepEqual(vpn.state(), { state: 'offer', service: 'kick', found: V2 });
  assert.deepEqual(mode(), ['off', 'socks5', '', 0], 'nothing changed by itself');

  // Yes: Kick and the relay don't answer through it -> failed, nothing saved; then they do -> Manual with it.
  assert.equal(await vpn.accept(), null);
  assert.deepEqual([vpn.state().state, settings.get().proxyMode], ['failed', 'off']);
  vpn.dismiss();
  vpn.look();
  await flush();
  through = { type: 'socks5', host: '127.0.0.1', port: 10808 };
  await vpn.accept();
  assert.deepEqual([...mode(), vpn.state().state], ['manual', 'socks5', '127.0.0.1', 10808, 'idle']);

  // No: never offered by itself again (even 2 minutes later), until the streamer looks.
  settings.update({ proxyMode: 'off', proxyHost: '', proxyPort: 0 }, false);
  vpn.fine();
  through = null;
  vpn.status('relay', false, true);
  t.mock.timers.tick(vpn.WAIT_MS);
  await flush();
  assert.equal(vpn.state().state, 'offer');
  vpn.dismiss();
  assert.deepEqual([settings.get().proxyAsk, settings.get().proxyMode], [false, 'off']);
  t.mock.timers.tick(3 * 60 * 1000);
  vpn.status('relay', false, false);
  vpn.status('relay', false, true);
  t.mock.timers.tick(vpn.WAIT_MS);
  await flush();
  assert.equal(vpn.state().state, 'idle', 'No: not by itself');
  vpn.look();
  await flush();
  assert.deepEqual([vpn.state().state, settings.get().proxyAsk], ['offer', true]);
  vpn.dismiss();

  // Nothing found: the guide, with Jarchi's own path and the system-wide VPN app that's running.
  settings.update({ proxyAsk: true }, false);
  look = { found: null, system: 'NordVPN' };
  vpn.fine();
  vpn.status('kick', false, false);
  vpn.status('kick', false, true);
  t.mock.timers.tick(vpn.WAIT_MS);
  await flush();
  assert.deepEqual(vpn.state(), { state: 'none', service: 'kick', system: 'NordVPN', exe: process.execPath });
  assert.equal(settings.get().proxyMode, 'off');
});
