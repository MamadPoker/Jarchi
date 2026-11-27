// Test copies never reach Jarchi's own relay (core/config.js TEST, connectors/kick-account.js RELAY): under the test
// runner, with JARCHI_TEST=1, or with a data folder in the temp folder, no usage ping, ticket, design or Kick login goes
// to it, even with the Privacy Policy accepted and KICK_RELAY_URL naming it. A Dev run (npm start / npm run app) and the
// installed app, on their own data folders, still use it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REAL = 'https://jarchi-kick.thejarchi.workers.dev';
process.env.JARCHI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jarchi-copy-'));
process.env.KICK_RELAY_URL = `${REAL}/`; // as if a .env named it
const sent = [];
globalThis.fetch = async (url) => {
  sent.push(String(url));
  throw new TypeError('no network in this test');
};
const settings = require('../core/settings');
const stats = require('../core/stats');
const support = require('../core/support');
const designs = require('../core/designs');
const kickAccount = require('../connectors/kick-account');

// What core/config.js says about a fresh copy of Jarchi started with this env (from an empty folder: no .env read).
function isTest(env) {
  const base = { ...process.env };
  for (const k of ['NODE_TEST_CONTEXT', 'JARCHI_TEST', 'JARCHI_DATA_DIR', 'KICK_RELAY_URL']) delete base[k];
  const out = execFileSync(process.execPath, ['-p', `require(${JSON.stringify(require.resolve('../core/config'))}).TEST`], {
    cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'jarchi-cwd-')),
    env: { ...base, ...env },
    encoding: 'utf8',
  });
  return out.trim() === 'true';
}

test('A test copy is one: the test runner, JARCHI_TEST=1, a data folder in the temp folder; a Dev run or the installed app is not', () => {
  const own = path.join(os.homedir(), 'Jarchi', 'data'); // a data folder outside the temp folder, like ./data or %APPDATA%
  assert.equal(isTest({ JARCHI_DATA_DIR: own }), false, 'Dev run / installed app: reports as before');
  assert.equal(isTest({ JARCHI_DATA_DIR: own, NODE_TEST_CONTEXT: 'child-v8' }), true, 'under node --test');
  assert.equal(isTest({ JARCHI_DATA_DIR: own, JARCHI_TEST: '1' }), true, 'JARCHI_TEST=1');
  assert.equal(isTest({ JARCHI_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'jarchi-scratch-')) }), true, 'a scratch data folder');
});

test("A test copy sends nothing to Jarchi's relay, even with the policy accepted and KICK_RELAY_URL naming it", async () => {
  assert.equal(kickAccount.RELAY, '');
  settings.update({ privacyAccepted: 2 });
  await stats.ping();
  await stats.ping(false);
  await assert.rejects(support.call('POST', '/support/tickets', '{}', 'application/json'), { code: 'support_offline' });
  await assert.rejects(designs.redeem('ABCD-1234'), { code: 'designs_offline' });
  assert.equal((await kickAccount.login()).error, 'relay');
  assert.ok(sent.length >= 4, 'they all tried');
  assert.deepEqual(
    sent.filter((u) => URL.canParse(u)),
    [],
    'and had no address to go to',
  );
});
