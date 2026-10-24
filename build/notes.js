// Before npm run dist / release: this version's notes from i18n/changelog.json as build/release-notes.md, the release's
// text (package.json build.releaseInfo): electron-builder puts it in latest.yml, for the installed apps' What's new,
// and on a release it makes. With --github (npm run release) also on this version's draft release when it's already
// there (a second run), since electron-builder leaves an existing draft's text as it was.
const fs = require('node:fs');
const path = require('node:path');
const { text } = require('../core/changelog');
const { version, build } = require('../package.json');

const entry = require('../i18n/changelog.json').find((c) => c.version === version);
if (!entry) {
  console.error(`i18n/changelog.json has no notes for ${version}: write them there first.`);
  process.exit(1);
}
const notes = text(entry);
fs.writeFileSync(path.join(__dirname, 'release-notes.md'), notes);

async function github() {
  const { owner, repo } = build.publish;
  const gh = async (url, init = {}) => {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases${url}`, {
      ...init, headers: { authorization: `Bearer ${process.env.GH_TOKEN}`, accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
    return res.json();
  };
  const draft = (await gh('?per_page=100')).find((r) => r.draft && r.tag_name === `v${version}`);
  if (draft && draft.body !== notes) await gh(`/${draft.id}`, { method: 'PATCH', body: JSON.stringify({ body: notes }) });
}
if (process.argv.includes('--github')) {
  if (!process.env.GH_TOKEN) {
    console.error('GH_TOKEN is not set (see README: Windows installer and updates).');
    process.exit(1);
  }
  github().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
