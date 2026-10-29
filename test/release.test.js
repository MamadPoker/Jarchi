// A dev run's "a newer Jarchi is out" (core/release.js): asked where the installed app's updates come from
// (package.json build.publish), only a newer published release counts, once; offline, blocked or odd answers say nothing.
const test = require('node:test');
const assert = require('node:assert/strict');
const { version, build } = require('../package.json');
const release = require('../core/release');

test('dev update notice: GitHub latest release from build.publish, newer only, quiet when it fails', async () => {
  assert.ok(release.newer('1.0.10', '1.0.9') && release.newer('2.0.0', '1.9.9'));
  assert.ok(!release.newer('1.0.1', '1.0.1') && !release.newer('0.9.9', '1.0.0') && !release.newer('1.0.2', '1.0.2-beta.1'));

  const [major] = version.split('.').map(Number), next = `${major + 1}.0.0`, after = `${major + 2}.0.0`;
  const page = `https://github.com/${build.publish.owner}/${build.publish.repo}/releases/`;
  const asked = [], found = [];
  let answer;
  globalThis.fetch = async (url) => (asked.push(url), typeof answer === 'function' ? answer() : answer.clone());
  release.events.on('found', (r) => found.push(r));
  const says = (status, body) => (answer = new Response(JSON.stringify(body), { status }));

  says(200, { tag_name: `v${version}`, html_url: `${page}tag/v${version}` });
  await release.check();
  assert.deepEqual(asked, [`https://api.github.com/repos/${build.publish.owner}/${build.publish.repo}/releases/latest`]);
  assert.equal(release.latest(), null, 'the same version: nothing');

  says(200, { tag_name: `v${next}`, html_url: `${page}tag/v${next}` });
  await release.check();
  await release.check();
  assert.deepEqual(found, [{ version: next, url: `${page}tag/v${next}` }], 'once, with its page');

  // Odd or failed answers change nothing: rate limited, a tag that isn't a version, offline.
  says(403, { message: 'API rate limit exceeded' });
  await release.check();
  says(200, { tag_name: 'nightly', html_url: `${page}tag/nightly` });
  await release.check();
  answer = () => { throw new TypeError('fetch failed'); };
  await release.check();
  assert.deepEqual(release.latest(), { version: next, url: `${page}tag/v${next}` });

  // A page that isn't this repo's releases: its latest release page instead.
  says(200, { tag_name: `v${after}`, html_url: 'https://evil.example/download' });
  await release.check();
  assert.deepEqual(release.latest(), { version: after, url: `${page}latest` });
  assert.equal(found.length, 2);
});
