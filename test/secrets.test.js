// Secrets at rest with the installed app's key (core/secrets.js, through core/store.js): a plain login from before is
// sealed at once and still works; one sealed with another key, or moved to another field, reads as not connected and
// its file stays as it was; the key leaves the environment. Log lines and events.log lose every token.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarchi-secrets-'));
process.env.JARCHI_DATA_DIR = dir;
process.env.JARCHI_SECRET_KEY = crypto.randomBytes(32).toString('base64'); // as electron/main.js hands it over
const secrets = require('../core/secrets');
const store = require('../core/store');
const { logIncoming } = require('../core/events');

const FIELDS = ['access', 'refresh'];
const fake = (c) => c.repeat(40); // token-sized

test('logins sealed at rest: migrated without a logout, unreadable ones left out', () => {
  assert.equal(process.env.JARCHI_SECRET_KEY, undefined, 'nothing Jarchi starts inherits the key');
  const file = path.join(dir, 'kick.json');
  const login = { access: fake('a'), refresh: fake('r'), expires: 5, userId: 42, login: 'mamad' };
  fs.writeFileSync(file, JSON.stringify(login)); // plain, from before
  assert.deepEqual(store.load(file, FIELDS), login, 'still logged in');
  const disk = fs.readFileSync(file, 'utf8');
  assert.ok(!disk.includes(login.access) && !disk.includes(login.refresh), 'sealed on disk at once');
  assert.match(JSON.parse(disk).refresh, /^enc:v1:/);
  assert.equal(JSON.parse(disk).login, 'mamad', 'the rest stays readable');
  assert.deepEqual(store.load(file, FIELDS), login);
  store.save(file, { ...login, refresh: fake('n') }, FIELDS);
  assert.equal(store.load(file, FIELDS).refresh, fake('n'));

  // Another key (the folder copied to another PC), or a value moved to another field: not connected, file untouched.
  const odd = { access: secrets.seal('refresh', fake('x')), refresh: secrets.seal('refresh', fake('y'), crypto.randomBytes(32)), login: 'mamad' };
  fs.writeFileSync(file, JSON.stringify(odd));
  assert.deepEqual(store.load(file, FIELDS), { login: 'mamad' });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), odd);
  assert.equal(secrets.open('refresh', odd.access, null), undefined, 'a dev run (no key) reads nothing sealed');
});

test('log lines and events.log: tokens and token-like fields blanked out', () => {
  const lines = [], real = console.log;
  console.log = (s) => lines.push(s);
  secrets.guardConsole();
  console.log('Kick refresh %s failed', fake('n')); // a token this run has seen
  console.log({ access_token: 'abc123', refresh: 'zzz', user: 'Ava' });
  console.log(new Error('Twitch /helix 401: Bearer qwerty12345 refused'));
  console.log('https://id.kick.com/oauth/revoke?token=hush42&token_hint_type=access_token');
  console.log('Kick chat: mamad on ws-us2.pusher.com, 3 events');
  console.log = real;
  const out = lines.join('\n');
  for (const s of [fake('n'), 'abc123', 'zzz', 'qwerty12345', 'hush42']) assert.ok(!out.includes(s), `${s.slice(0, 6)}… blanked out`);
  assert.match(out, /user: 'Ava'/);
  assert.equal(lines.at(-1), 'Kick chat: mamad on ws-us2.pusher.com, 3 events', 'everything else as it was');

  logIncoming('kick', 'channel.followed', { follower: { username: 'Ava' }, access_token: 'leak9876' });
  const log = fs.readFileSync(path.join(dir, 'logs', 'events.log'), 'utf8');
  assert.ok(!log.includes('leak9876') && log.includes('Ava'));
});
