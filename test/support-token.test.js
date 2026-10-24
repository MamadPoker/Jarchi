// The Support ticket token sealed at rest like the logins (core/secrets.js, through core/settings.js): made sealed, or
// sealed at the installed app's first start when it's from before. A run that can't open it (a dev run, another PC)
// never loses it when settings.json is saved, never makes a new one over it and asks the relay nothing with it.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarchi-support-token-'));
const file = path.join(dir, 'settings.json');
const KEY = crypto.randomBytes(32).toString('base64'); // as electron/main.js hands it over
const disk = () => JSON.parse(fs.readFileSync(file, 'utf8'));
// Jarchi started afresh on this data folder, with the installed app's key or none (a dev run).
function start(key = '') {
  for (const k of Object.keys(require.cache)) if (!k.includes('node_modules')) delete require.cache[k];
  process.env.JARCHI_DATA_DIR = dir;
  process.env.JARCHI_SECRET_KEY = key;
  return require('../core/settings');
}

test("ticket token sealed at rest, never lost or replaced by a run that can't open it", async () => {
  // A new install: made sealed.
  let settings = start(KEY);
  const made = settings.supportToken(true);
  assert.match(made, /^[0-9a-f]{64}$/);
  assert.match(disk().supportToken, /^enc:v1:/);
  assert.equal(start(KEY).supportToken(), made);

  // One from before: sealed at the first start, still the same token.
  const token = 'ab'.repeat(32);
  fs.writeFileSync(file, JSON.stringify({ version: 9, privacyAccepted: 1, supportToken: token }));
  settings = start(KEY);
  assert.equal(settings.supportToken(), token);
  const sealed = disk().supportToken;
  assert.ok(sealed.startsWith('enc:v1:') && !fs.readFileSync(file, 'utf8').includes(token), 'sealed on disk at once');

  // A run without that key: no token, no new one, the relay never asked; every save writes it back as it was.
  settings = start();
  assert.deepEqual([settings.supportToken(), settings.supportToken(true)], [null, null]);
  const support = require('../core/support'), real = globalThis.fetch;
  globalThis.fetch = () => assert.fail('nothing goes to the relay');
  await assert.rejects(support.call('POST', '/support/tickets'), { code: 'support_failed' });
  assert.deepEqual(await (await support.call('GET', '/support/tickets')).json(), []);
  globalThis.fetch = real;
  settings.update({ theme: 'retro' });
  assert.equal(disk().supportToken, sealed);
  settings.reset();
  assert.equal(disk().supportToken, sealed);

  // The installed app again: the same token.
  assert.equal(start(KEY).supportToken(), token);
});
