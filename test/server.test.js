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
const { bus } = require('../core/events');

const base = 'http://127.0.0.1:3999';
const call = (method, url, body, headers = {}) => fetch(base + url, {
  method,
  headers: { 'x-jarchi': '1', ...(body && !Buffer.isBuffer(body) && { 'content-type': 'application/json' }), ...headers },
  body: Buffer.isBuffer(body) ? body : body && JSON.stringify(body),
});
const upload = (type, kind, buf) => call('POST', `/api/upload/${type}/${kind}`, buf, { 'content-type': 'application/octet-stream', 'x-filename': 'party.gif' });
const patch = (fields) => call('PATCH', '/api/settings', { alerts: { follow: fields } });

test('migration, settings, uploads, reset, events', async (t) => {
  t.after(() => io.close());
  if (!server.listening) await new Promise((r) => server.once('listening', r));

  // v1 -> v2: old custom sound keeps playing, old values kept, file still served.
  let s = await (await call('GET', '/api/settings')).json();
  assert.equal(s.theme, 'fun');
  assert.equal(s.alerts.sub.soundMode, 'custom');
  assert.equal(s.alerts.sub.volume, 0.4);
  assert.equal(s.alerts.follow.soundMode, 'theme');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'))).version, 2);
  assert.equal((await fetch(`${base}/uploads/sub-sound-1.wav`)).status, 200);

  assert.equal(s.alerts.kicks.minAmount, 0);
  assert.ok(!('minAmount' in s.alerts.follow));
  assert.ok(s.alerts.raid.fontSize > s.alerts.follow.fontSize, 'raid is bigger than follow');

  let r = await call('PATCH', '/api/settings', { theme: 'galaxy', alerts: { follow: { volume: 0.3, frame: 'custom', frameBg: '#112233', textPos: 'over', textColor: '#ffffff' } } });
  s = await r.json();
  assert.equal(s.theme, 'galaxy');
  assert.deepEqual([s.alerts.follow.volume, s.alerts.follow.frame, s.alerts.follow.frameBg, s.alerts.follow.textPos], [0.3, 'custom', '#112233', 'over']);
  assert.equal((await (await patch({ textColor: null })).json()).alerts.follow.textColor, null);

  for (const bad of [{ volume: 5 }, { minAmount: 5 }, { frameBg: 'red' }, { soundMode: 'loud' }, { textPos: 'left' }, { fontSize: 500 }]) {
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
