const test = require('node:test');
const assert = require('node:assert/strict');
const { single, tokens } = require('../connectors/account');

test('single: one refresh at a time; the next call after it settles runs again', async () => {
  let calls = 0;
  const refresh = single(async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 10));
    if (calls === 2) throw new Error('expired');
    return calls;
  });
  const [a, b] = [refresh(), refresh()];
  assert.equal(a, b);
  assert.equal(await a, 1);
  await assert.rejects(refresh(), /expired/);
  assert.equal(await refresh(), 3, 'a failed refresh lets the next one run');
});

test('tokens: an answer without expires_in lasts an hour', () => {
  const t = tokens({ access_token: 'a', refresh_token: 'r' });
  assert.equal(t.access, 'a');
  assert.ok(Math.abs(t.expires - Date.now() - 3600000) < 1000);
});
