// Smoke test: boots the real server on a temp data dir and exercises migration, settings, uploads, reset and the event bus.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Start from a v0.1 (unversioned) settings file with an uploaded sound, like an existing user would have.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarchi-'));
fs.mkdirSync(path.join(dataDir, 'uploads'));
fs.writeFileSync(path.join(dataDir, 'uploads', 'sub-sound-1.wav'), 'RIFF\0\0\0\0WAVE');
fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({
  theme: 'fun',
  alerts: { sub: { volume: 0.4, sound: { file: 'sub-sound-1.wav', name: 'old.wav' } } },
}));
process.env.JARCHI_DATA_DIR = dataDir;
process.env.JARCHI_PORT = '3999';
const { server, io } = require('../server');
const { bus, setConnected, emitEvent } = require('../core/events');
const goals = require('../core/goals');

test.after(() => io.close());

const base = 'http://127.0.0.1:3999';
const call = (method, url, body, headers = {}) => fetch(base + url, {
  method,
  headers: { 'x-jarchi': '1', ...(body && !Buffer.isBuffer(body) && { 'content-type': 'application/json' }), ...headers },
  body: Buffer.isBuffer(body) ? body : body && JSON.stringify(body),
});
const upload = (type, kind, buf) => call('POST', `/api/upload/${type}/${kind}`, buf, { 'content-type': 'application/octet-stream', 'x-filename': 'party.gif' });
const patch = (fields) => call('PATCH', '/api/settings', { alerts: { follow: fields } });

test('migration, settings, uploads, reset, events', async () => {
  if (!server.listening) await new Promise((r) => server.once('listening', r));

  // v1 -> v2: old custom sound keeps playing, old values kept, file still served.
  let s = await (await call('GET', '/api/settings')).json();
  assert.equal(s.theme, 'fun');
  assert.equal(s.alerts.sub.soundMode, 'custom');
  assert.equal(s.alerts.sub.volume, 0.4);
  assert.equal(s.alerts.follow.soundMode, 'theme');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'))).version, 3);
  assert.equal((await fetch(`${base}/uploads/sub-sound-1.wav`)).status, 200);

  // Platform badge: setting on by default, but nothing is connected yet, so widgets keep it hidden.
  assert.equal(s.showBadge, true);
  assert.deepEqual(s.connected, []);
  assert.equal((await (await call('PATCH', '/api/settings', { showBadge: false })).json()).showBadge, false);
  assert.equal((await call('PATCH', '/api/settings', { showBadge: 'yes' })).status, 400);
  setConnected('kick', true);
  assert.deepEqual((await (await call('GET', '/api/settings')).json()).connected, ['kick']);
  setConnected('kick', false);

  assert.equal(s.alerts.kicks.minAmount, 10, "Kicks: 1-Kick taps stay out of the queue by default");
  assert.ok(!('minAmount' in s.alerts.follow));
  assert.ok(s.alerts.raid.fontSize > s.alerts.follow.fontSize, 'raid is bigger than follow');

  let r = await call('PATCH', '/api/settings', { theme: 'galaxy', alerts: { follow: { volume: 0.3, frame: 'custom', frameBg: '#112233', textPos: 'over', textColor: '#ffffff' } } });
  s = await r.json();
  assert.equal(s.theme, 'galaxy');
  assert.deepEqual([s.alerts.follow.volume, s.alerts.follow.frame, s.alerts.follow.frameBg, s.alerts.follow.textPos], [0.3, 'custom', '#112233', 'over']);
  assert.equal((await (await patch({ textColor: null })).json()).alerts.follow.textColor, null);

  // Per-alert theme (null = main theme) and text alignment (default center, also for old files without it).
  assert.equal(s.alerts.follow.theme, null);
  assert.equal(s.alerts.sub.textAlign, 'center', 'migrated v1 alert gets the center default');
  s = await (await patch({ theme: 'fire', textAlign: 'left' })).json();
  assert.deepEqual([s.alerts.follow.theme, s.alerts.follow.textAlign, s.theme], ['fire', 'left', 'galaxy']);
  assert.equal((await (await patch({ theme: null })).json()).alerts.follow.theme, null);
  await patch({ theme: 'ice' });

  for (const bad of [{ volume: 5 }, { minAmount: 5 }, { frameBg: 'red' }, { soundMode: 'loud' }, { textPos: 'left' }, { fontSize: 500 }, { theme: 'casino' }, { textAlign: 'justify' }]) {
    assert.equal((await patch(bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await call('PATCH', '/api/settings', { theme: 'casino' })).status, 400);
  assert.equal((await fetch(base + '/api/reset', { method: 'POST' })).status, 403, 'missing x-jarchi header must be rejected');

  r = await upload('follow', 'image', Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1'));
  assert.equal(r.status, 200);
  const file = (await r.json()).alerts.follow.image.file;
  assert.ok(fs.existsSync(path.join(dataDir, 'uploads', file)));
  assert.equal((await fetch(`${base}/uploads/${file}`)).status, 200);

  r = await upload('raid', 'image', Buffer.from('\0\0\0\x18ftypisom\0\0\0\0', 'latin1'));
  assert.equal(r.status, 200, 'mp4 accepted');
  assert.match((await r.json()).alerts.raid.image.file, /\.mp4$/);
  assert.equal((await upload('raid', 'image', Buffer.from('\0\0\0\x18ftypM4A \0\0\0\0', 'latin1'))).status, 400, 'm4a audio is not a video');

  assert.equal((await upload('follow', 'image', Buffer.from('<html>not an image</html>'))).status, 400);
  assert.equal((await upload('follow', 'sound', Buffer.from('GIF89a', 'latin1'))).status, 400, 'gif is not a sound');
  assert.equal((await upload('follow', 'image', Buffer.alloc(21 * 1024 * 1024))).status, 413);

  s = await (await upload('follow', 'sound', Buffer.from('RIFF\0\0\0\0WAVE', 'latin1'))).json();
  assert.equal(s.alerts.follow.soundMode, 'custom', 'uploading a sound selects it');
  s = await (await call('DELETE', '/api/upload/follow/sound')).json();
  assert.equal(s.alerts.follow.soundMode, 'theme', 'removing it goes back to the theme sound');

  s = await (await call('POST', '/api/reset/follow')).json();
  assert.equal(s.alerts.follow.image, null);
  assert.equal(s.alerts.follow.volume, 0.7);
  assert.equal(s.alerts.follow.frame, 'theme');
  assert.equal(s.alerts.follow.theme, null, 'reset goes back to the main theme');
  assert.equal(s.alerts.follow.textAlign, 'center');
  assert.equal(s.theme, 'galaxy', 'per-type reset keeps the theme');
  assert.ok(!fs.existsSync(path.join(dataDir, 'uploads', file)));

  s = await (await call('POST', '/api/reset')).json();
  assert.equal(s.theme, 'neon');
  assert.ok(!fs.existsSync(path.join(dataDir, 'uploads', 'sub-sound-1.wav')));

  const samples = await (await call('GET', '/api/samples')).json();
  assert.equal(samples.raid.amount, 42);

  const got = new Promise((r) => bus.once('event', r));
  assert.equal((await call('POST', '/api/test/kicks', { platform: 'kick', amount: 2500 })).status, 200);
  const ev = await got;
  assert.deepEqual([ev.platform, ev.type, ev.amount, ev.test], ['kick', 'kicks', 2500, true]);
});

test('goals: count from events, latch when reached, saved, styles', async () => {
  const goalsNow = async () => (await (await call('GET', '/api/goals')).json()).state;
  const count = async (id, body) => (await call('PATCH', `/api/goals/${id}`, body)).json();
  for (const id of ['subs', 'kicks']) await count(id, { set: 0 });

  // From the event bus: subs/resubs +1 and each gifted sub +1 on both platforms; Kicks only from Kick.
  emitEvent({ platform: 'twitch', type: 'sub', user: 'a' });
  emitEvent({ platform: 'kick', type: 'resub', user: 'a', months: 3 });
  emitEvent({ platform: 'kick', type: 'gift_sub', user: 'a', amount: 5 });
  emitEvent({ platform: 'twitch', type: 'kicks', user: 'a', amount: 100 });
  emitEvent({ platform: 'kick', type: 'kicks', user: 'a', amount: 250 });
  emitEvent({ platform: 'twitch', type: 'bits', user: 'a', amount: 500 });
  let st = await goalsNow();
  assert.deepEqual([st.subs.current, st.kicks.current], [7, 250]);

  // Reaching the target latches "reached" and announces it once.
  await call('PATCH', '/api/settings', { goals: { subs: { target: 10 } } });
  const announced = new Promise((r) => goals.events.once('change', r));
  st = await count('subs', { add: 3 });
  assert.equal(await announced, 'subs');
  assert.deepEqual([st.subs.current, st.subs.reached], [10, true]);
  st = await count('subs', { add: 3 });
  assert.equal(st.subs.current, 13, 'counts past the target');
  st = await count('subs', { add: -8 });
  assert.deepEqual([st.subs.current, st.subs.reached], [5, true], 'stays full until reset or a new target');
  await call('PATCH', '/api/settings', { goals: { subs: { target: 50 } } });
  assert.equal((await goalsNow()).subs.reached, false, 'a new target clears it');
  await call('PATCH', '/api/settings', { goals: { subs: { target: 5 } } });
  assert.equal((await goalsNow()).subs.reached, true, 'a target at or below the count is reached right away');
  st = await count('subs', { set: 0 });
  assert.deepEqual([st.subs.current, st.subs.reached], [0, false], 'Reset to 0 clears it');
  assert.equal((await call('PATCH', '/api/goals/subs', { add: 'x' })).status, 400);
  assert.equal((await call('PATCH', '/api/goals/nope', { add: 1 })).status, 400);

  // Counts are saved (goals.json), separate from settings.
  await count('kicks', { set: 640 });
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'goals.json'))).kicks.current, 640);

  // A style is a starting point: options apply on top, a new style brings its own look, Reset style keeps title/target.
  let s = await (await call('PATCH', '/api/settings', { goals: { kicks: { barColor: '#123456', title: 'K', target: 2000 } } })).json();
  assert.equal(s.goals.kicks.barColor, '#123456');
  s = await (await call('PATCH', '/api/settings', { goals: { kicks: { style: 'neon' } } })).json();
  assert.deepEqual([s.goals.kicks.barColor, s.goals.kicks.title], ['#00f0ff', 'K']);
  await call('PATCH', '/api/settings', { goals: { kicks: { bg: 'off', radius: 3, enabled: false } } });
  s = await (await call('POST', '/api/goals/kicks/reset-style')).json();
  const k = s.goals.kicks;
  assert.deepEqual([k.style, k.bg, k.radius, k.title, k.target, k.enabled], ['neon', 'color', 16, 'K', 2000, false]);
  for (const bad of [{ style: 'fancy' }, { target: 0 }, { titlePos: 'left' }, { font: 'Wingdings' }, { barColor: 'red' }, { scale: 9 }]) {
    assert.equal((await call('PATCH', '/api/settings', { goals: { kicks: bad } })).status, 400, JSON.stringify(bad));
  }

  // Celebration sound upload selects it.
  s = await (await call('POST', '/api/goals/kicks/sound', Buffer.from('RIFF\0\0\0\0WAVE', 'latin1'), { 'content-type': 'audio/wav', 'x-filename': 'yay.wav' })).json();
  assert.deepEqual([s.goals.kicks.celebrateSound, s.goals.kicks.sound.name], ['custom', 'yay.wav']);

  // One OBS page per goal.
  assert.equal((await fetch(`${base}/widgets/goal/subs`)).status, 200);
  assert.equal((await fetch(`${base}/widgets/goal/kicks/`)).status, 200);
  assert.equal((await fetch(`${base}/widgets/goal/nope`)).status, 404);
});
