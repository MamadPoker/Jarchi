// Before electron-builder (npm run dist, and the release workflow's build-installers): this version's notes from
// i18n/changelog.json as build/release-notes.md, the release's text (package.json build.releaseInfo): electron-builder
// puts it in latest.yml, for the installed apps' What's new. The GitHub release itself (a draft, with the same text and
// the developer changes) is semantic-release's (build/release.js); electron-builder uploads into it by its tag.
const fs = require('node:fs');
const path = require('node:path');
const { text } = require('../core/changelog');
const { version } = require('../package.json');

const entry = require('../i18n/changelog.json').find((c) => c.version === version);
if (!entry) {
  console.error(`i18n/changelog.json has no notes for ${version}: write them there first.`);
  process.exit(1);
}
fs.writeFileSync(path.join(__dirname, 'release-notes.md'), text(entry));
