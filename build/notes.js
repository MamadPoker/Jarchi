// Before npm run dist / release: this version's notes from i18n/changelog.json as build/release-notes.md, the release's
// text (package.json build.releaseInfo): electron-builder puts it in latest.yml, for the installed apps' What's new.
// With --github (npm run release) this also makes this version's draft release "Jarchi v<version>" with that text (or
// updates it on a second run), before electron-builder uploads into it. electron-builder must not make it: it gets one
// GitHub publisher per file that's ready at once, and each one that finds no release makes its own (two drafts).
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
      ...init,
      headers: { authorization: `Bearer ${process.env.GH_TOKEN}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' },
    });
    if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
    return res.json();
  };
  const tag = `v${version}`;
  const mine = (await gh('?per_page=100')).filter((r) => r.tag_name === tag);
  if (mine.some((r) => !r.draft)) throw new Error(`${tag} is already published on ${repo}: raise the version first.`);
  if (mine.length > 1) throw new Error(`${repo} has ${mine.length} draft releases ${tag}: delete all but one first.`);
  // tag_name every time: a PATCH without it turns a draft's tag into "untagged-…", and electron-builder finds it by tag.
  const release = JSON.stringify({ tag_name: tag, name: `Jarchi ${tag}`, body: notes, draft: true });
  if (mine[0]) await gh(`/${mine[0].id}`, { method: 'PATCH', body: release });
  else await gh('', { method: 'POST', body: release });
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
