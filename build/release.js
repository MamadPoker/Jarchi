// semantic-release's Jarchi step (release.config.js, run by .github/workflows/release.yml). The release text is the
// Unreleased entry of i18n/changelog.json (What's new: English, then Persian right to left, core/changelog.js) with the
// commits folded under "Developer changes" below it; streamers never see those: the installed app's What's new reads
// latest.yml, which gets the What's new text only (build/notes.js). At prepare the Unreleased entry gets the version, a
// new empty one goes on top, and package.json / package-lock.json get the version. A release with no What's new lines
// (only no-notes PRs) gets one plain line in both languages, so What's new never shows an empty version.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { text } = require('../core/changelog');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'i18n', 'changelog.json');
const UNRELEASED = 'unreleased';
const GENERIC = { types: ['improve'], en: ['Small fixes and improvements'], fa: ['رفع اشکال‌ها و بهبودهای جزئی'] };

// The two top entries as written by hand (types on one line, each change on its own line); the rest stays as it is.
const J = JSON.stringify;
const lines = (a) => (a.length ? `[\n${a.map((s) => `      ${J(s)}`).join(',\n')}\n    ]` : '[]');
const entry = (c) =>
  `  {\n    "version": ${J(c.version)},\n${c.types ? `    "types": [${c.types.map(J).join(', ')}],\n` : ''}` +
  `    "en": ${lines(c.en)},\n    "fa": ${lines(c.fa)}\n  }`;

// The log after releasing version: a new empty Unreleased entry, then the old one with its version.
function stamp(log, version) {
  const [next, ...rest] = log;
  if (next?.version !== UNRELEASED) throw new Error(`i18n/changelog.json: the top entry must be "${UNRELEASED}"`);
  const { types, en, fa } = next.en.length ? next : GENERIC;
  return [{ version: UNRELEASED, types: [], en: [], fa: [] }, { version, types, en, fa }, ...rest];
}
function rewrite(src, version) {
  src = src.replace(/\r\n/g, '\n');
  const [top, mine] = stamp(JSON.parse(src), version);
  return `[\n${entry(top)},\n${entry(mine)}${src.slice(src.indexOf('\n  }') + 4)}`; // then what came after the old top entry
}
const read = () => fs.readFileSync(FILE, 'utf8');

// semantic-release calls this again after @semantic-release/git's release commit (a prepare step that moves HEAD makes
// it redo the notes), and that second text is the one the release gets. By then prepare has stamped changelog.json, so
// the version's own entry is there and stamping again would read the new empty Unreleased one (v1.0.9's "Small fixes").
async function generateNotes(_, context) {
  const { generateNotes: commits } = await import('@semantic-release/release-notes-generator');
  const dev = await commits({ preset: 'conventionalcommits' }, context);
  const log = JSON.parse(read()),
    { version } = context.nextRelease;
  const whatsNew = text(log.find((c) => c.version === version) ?? stamp(log, version)[1]);
  return `${whatsNew}\n<details><summary>Developer changes</summary>\n\n${dev}\n\n</details>\n`;
}

function prepare(_, { nextRelease: { version } }) {
  fs.writeFileSync(FILE, rewrite(read(), version));
  execFileSync('npm', ['version', version, '--no-git-tag-version', '--allow-same-version'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

// A PR with the big-update label makes a minor release (1.0.9 → 1.1.0); everything else is a patch at most
// (release.config.js). A label isn't in the commit, so ask GitHub which PR each commit came from. A failed ask fails
// the release: running it again is cheap, a wrong version is forever.
const BIG = 'big-update';
async function analyzeCommits(_, { commits, env }) {
  for (const { hash } of commits) {
    const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/commits/${hash}/pulls`, {
      headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error(`GitHub answered ${res.status} when asked which PR ${hash} came from`);
    if ((await res.json()).some((pr) => pr.labels.some((l) => l.name === BIG))) return 'minor';
  }
  return null;
}

module.exports = { analyzeCommits, generateNotes, prepare, stamp, rewrite };
