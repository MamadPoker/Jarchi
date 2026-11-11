// Auto proxy help (core/vpn.js) for a VPN app running per app, without Jarchi on its list. What counts as out of reach
// (server/index.js): Kick refusing this network (blocked) and a connection still connecting do, a channel that isn't
// there doesn't. Out of reach 30 s: Jarchi checks the service, looks for the VPN app's local proxy and offers it, or
// shows how to let Jarchi through (with Jarchi's own path); Yes tries Kick and the relay through it before saving it;
// No stops it asking by itself until the streamer looks. This PC's real VPN apps and the network are stood in for.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.JARCHI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jarchi-vpn-'));
process.env.JARCHI_PORT = '3993';
process.env.KICK_RELAY_URL = 'http://127.0.0.1:9'; // nothing there
process.env.JARCHI_PAY_URL = 'http://127.0.0.1:9';

test('auto: 30 s out of reach -> found VPN offered; Yes checks first; No stops asking; none -> the guide', async (t) => {
  const { server, io } = require('../server');
  const chat = require('../core/chat');
  const settings = require('../core/settings');
  const vpn = require('../core/vpn');
  t.after(() => {
    io.close();
    server.closeAllConnections();
  });

  // What counts (server/index.js -> vpn.status): blocked and connecting do; not_found doesn't.
  const told = [], status = vpn.status;
  vpn.status = (...a) => told.push(a);
  const st = (kick) => chat.events.emit('status', { kick, twitch: { state: 'off', detail: '' } });
  st({ state: 'error', detail: 'blocked' });
  st({ state: 'connecting', detail: '' });
  st({ state: 'error', detail: 'not_found' });
  st({ state: 'connected', detail: '' });
  assert.deepEqual(told.filter(([s]) => s === 'kick'), [['kick', false, true], ['kick', false, true], ['kick', false, false], ['kick', true, false]]);
  vpn.status = status;
  // From here on the test alone says how the connections are (this server has no channel, so it keeps saying off).
  for (const c of [chat, require('../connectors/kick-account'), require('../connectors/twitch-account')]) c.events.removeAllListeners('status');

  // Stand-ins: Kick refuses this network directly; through v2rayN's proxy it answers.
  const V2 = { app: 'v2rayN', type: 'socks5', host: '127.0.0.1', port: 10808 };
  let through = null, look = { found: V2, system: null };
  for (const s of Object.keys(vpn.CHECKS)) vpn.CHECKS[s] = async (via) => { if (!via || JSON.stringify(via) !== JSON.stringify(through)) throw new Error('blocked'); };
  vpn.find = async () => look;
  require('../core/net').current = async () => settings.get().proxyFound; // not this PC's Windows proxy
  settings.update({ proxyMode: 'auto', proxyFound: null }, false);
  const tick = () => new Promise((r) => setImmediate(r));
  const flush = async () => { for (let i = 0; i < 20; i++) await tick(); };
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });

  vpn.status('kick', false, true);
  t.mock.timers.tick(vpn.WAIT_MS - 1000);
  await flush();
  assert.equal(vpn.state().state, 'idle', 'not before 30 s');
  t.mock.timers.tick(1000);
  await flush();
  assert.deepEqual(vpn.state(), { state: 'offer', service: 'kick', found: V2 });

  // Yes: Kick and the relay don't answer through it -> failed, nothing saved; then they do -> saved.
  assert.equal(await vpn.accept(), null);
  assert.deepEqual([vpn.state().state, settings.get().proxyFound], ['failed', null]);
  vpn.dismiss();
  vpn.look();
  await flush();
  through = { type: 'socks5', host: '127.0.0.1', port: 10808 };
  const s = await vpn.accept();
  assert.deepEqual([s.proxyFound, s.proxyMode, vpn.state().state], [V2, 'auto', 'idle']);

  // No: never offered by itself again (even 2 minutes later), until the streamer looks.
  settings.update({ proxyFound: null }, false);
  vpn.fine();
  through = null;
  vpn.status('relay', false, true);
  t.mock.timers.tick(vpn.WAIT_MS);
  await flush();
  assert.equal(vpn.state().state, 'offer');
  vpn.dismiss();
  assert.equal(settings.get().proxyAsk, false);
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

  // Off: nothing at all.
  vpn.dismiss();
  vpn.fine();
  settings.update({ proxyMode: 'off' }, false);
  vpn.status('kick', false, false);
  vpn.status('kick', false, true);
  t.mock.timers.tick(vpn.WAIT_MS);
  await flush();
  assert.equal(vpn.state().state, 'idle');
});
