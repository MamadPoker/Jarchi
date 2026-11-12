// A PR's rules (.github/workflows/ci.yml). Its title becomes the squashed commit on main, which semantic-release reads
// (release.config.js), so it's a conventional commit. A feat / fix / perf PR adds a change to the Unreleased entry of
// i18n/changelog.json in English and Persian, unless it has the no-notes label (streamers see no difference).
// CI: TITLE, LABELS (JSON array) and BASE (the base commit) in the environment.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const TYPES = ['feat', 'fix', 'perf', 'refactor', 'docs', 'test', 'build', 'ci', 'chore', 'revert'];
const TITLE = new RegExp(`^(${TYPES.join('|')})(\\([\\w./-]+\\))?!?: \\S`);

function problems(title, labels, base, head) {
  if (!TITLE.test(title)) return [`The PR title "${title}" isn't a conventional commit: "<type>(<scope>)?: <what>", type one of ${TYPES.join(', ')}.`];
  if (!/^(feat|fix|perf)\b/.test(title) || labels.includes('no-notes')) return [];
  const top = (log) => (log[0]?.version === 'unreleased' ? log[0] : { en: [], fa: [] });
  const [was, now] = [top(base), top(head)];
  return ['en', 'fa']
    .filter((l) => !now[l].some((s) => !was[l].includes(s)))
    .map(
      (l) => `A ${title.split(/[(:!]/)[0]} PR adds its change to the "unreleased" entry of i18n/changelog.json (${l} is missing), or gets the no-notes label.`,
    );
}

if (require.main === module) {
  const file = 'i18n/changelog.json';
  const base = JSON.parse(execFileSync('git', ['show', `${process.env.BASE}:${file}`], { encoding: 'utf8' }));
  const head = JSON.parse(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
  const found = problems(process.env.TITLE ?? '', JSON.parse(process.env.LABELS || '[]'), base, head);
  for (const p of found) console.error(`::error::${p}`);
  process.exit(found.length ? 1 : 0);
}

module.exports = { problems };
