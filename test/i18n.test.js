const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { text, parse } = require('../core/changelog');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const en = JSON.parse(read('i18n/en.json'));
const fa = JSON.parse(read('i18n/fa.json'));

// Every string in a strings file, by path: "panel.copyObs", "guide.topics.start.steps.0.1".
const paths = (o, pre = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? paths(v, `${pre}${k}.`) : [`${pre}${k}`]));
const at = (o, p) => p.split('.').reduce((x, k) => x?.[k], o);
const vars = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join(' ');

test('fa.json has every key of en.json, with the same {variables}', () => {
  const keys = paths(en);
  assert.deepEqual(
    keys.filter((p) => typeof at(fa, p) !== typeof at(en, p)),
    [],
    'missing in fa.json',
  );
  assert.deepEqual(
    keys.filter((p) => typeof at(en, p) === 'string' && vars(at(fa, p)) !== vars(at(en, p))),
    [],
    '{variables} differ',
  );
});

test('the Privacy Policy has a version and the same parts in English and Persian', () => {
  const { version, icons, en: e, fa: f } = JSON.parse(read('i18n/privacy.json'));
  assert.ok(Number.isInteger(version) && version > 0);
  for (const p of [e, f]) assert.ok(p.title && p.intro && p.items.every(([what, text]) => what && text));
  assert.equal(f.items.length, e.items.length);
  const js = read('panel/panel.js'),
    drawn = js.slice(js.indexOf('const POINT_ICON'), js.indexOf('async function showPrivacy'));
  assert.deepEqual(
    icons.filter((i) => !drawn.includes(`\n  ${i}: '<svg`)),
    [],
    'every point has its icon in the panel',
  );
  assert.equal(icons.length, e.items.length);
});

test("What's new: every version in English and Persian, newest first; this version's notes make the release text", () => {
  const log = JSON.parse(read('i18n/changelog.json'));
  const js = read('panel/panel.js'),
    drawn = js.slice(js.indexOf('const NEWS_ICON'), js.indexOf('const newsIcon'));
  const NEWS_TYPES = [...drawn.matchAll(/\n {2}(\w+):\s+(?:'<svg|CAT_ICON\.)/g)].map((m) => m[1]);
  assert.deepEqual(NEWS_TYPES, ['feature', 'improve', 'fix', 'security']);
  assert.ok(
    NEWS_TYPES.every((t) => en.panel[`news_${t}`] && fa.panel[`news_${t}`]),
    'every type has its name',
  );
  // On top, the Unreleased entry: the changes merged since the last release (build/release.js), maybe none yet.
  assert.equal(log[0].version, 'unreleased');
  const order = (v) =>
    v
      .split('.')
      .map((n) => n.padStart(6, '0'))
      .join('.'); // 1.10.0 after 1.9.0
  log.slice(2).forEach((c, i) => assert.ok(order(log[i + 1].version) > order(c.version), `${log[i + 1].version} before ${c.version}`));
  for (const c of log) {
    if (c !== log[0]) assert.match(c.version, /^\d+\.\d+\.\d+$/);
    assert.ok((c.en.length || c === log[0]) && c.en.length === c.fa.length, `${c.version}: the same changes in both languages`);
    assert.ok(
      [...c.en, ...c.fa].every((s) => s.trim() && !s.includes('\n')),
      `${c.version}: one line each`,
    );
    // types (optional): one per line, each one the panel draws (an empty one: the line's dot)
    if (c.types) assert.ok(c.types.length === c.en.length && c.types.every((t) => !t || NEWS_TYPES.includes(t)), `${c.version}: one known type per line`);
  }
  const mine = log.find((c) => c.version === JSON.parse(read('package.json')).version);
  assert.ok(mine, "package.json's version has its notes (build/notes.js needs them)");
  assert.deepEqual(parse(text(mine)), { en: mine.en, fa: mine.fa }); // what an installed app reads back from the update
});

test('release: the Unreleased entry gets the version under a new empty one; the rest of changelog.json stays as it is', () => {
  const { stamp, rewrite } = require('../build/release');
  const src = read('i18n/changelog.json').replace(/\r\n/g, '\n'),
    log = JSON.parse(src);
  const after = rewrite(src, '9.0.0');
  assert.deepEqual(JSON.parse(after), stamp(log, '9.0.0'));
  assert.ok(after.endsWith(src.slice(src.indexOf('\n  }') + 4)), 'the released entries stay as they are, byte for byte');
  const next = { version: 'unreleased', types: ['fix'], en: ['A fix'], fa: ['یک اصلاح'] };
  const [top, mine, ...rest] = stamp([next, ...log.slice(1)], '9.0.0');
  assert.deepEqual(top, { version: 'unreleased', types: [], en: [], fa: [] });
  assert.deepEqual(mine, { ...next, version: '9.0.0' });
  assert.deepEqual(rest, log.slice(1));
  // Only no-notes PRs: one plain line in both languages, never an empty version.
  const [, plain] = stamp([{ version: 'unreleased', types: [], en: [], fa: [] }], '9.0.1');
  assert.ok(plain.en.length === 1 && plain.fa.length === 1 && plain.types.length === 1);
  assert.throws(() => stamp(log.slice(1), '9.0.0'), /must be "unreleased"/);
});

test('release version: feat / fix / perf, even breaking, are a patch; only a big-update PR is a minor', async () => {
  const { analyzeCommits: analyzer } = await import('@semantic-release/commit-analyzer');
  const [[, config]] = require('../release.config').plugins;
  const logger = { log() {} },
    cwd = process.cwd();
  const bump = (...messages) => analyzer(config, { commits: messages.map((message, i) => ({ message, hash: `${i}` })), logger, cwd });
  assert.equal(await bump('feat: x'), 'patch');
  assert.equal(await bump('feat!: x', 'fix: y'), 'patch');
  assert.equal(await bump('perf(panel): x\n\nBREAKING CHANGE: y'), 'patch');
  assert.equal(await bump('chore: x', 'docs: y'), null);

  const { analyzeCommits } = require('../build/release');
  const fetch = globalThis.fetch,
    asked = [];
  const env = { GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 't' };
  const prs = { a: [{ labels: [{ name: 'panel' }] }], b: [{ labels: [{ name: 'big-update' }] }] };
  try {
    globalThis.fetch = async (url) => (asked.push(url), Response.json(prs[url.split('/').at(-2)] ?? []));
    assert.equal(await analyzeCommits({}, { commits: [{ hash: 'a' }], env }), null);
    assert.equal(await analyzeCommits({}, { commits: [{ hash: 'a' }, { hash: 'b' }], env }), 'minor');
    assert.equal(asked[0], 'https://api.github.com/repos/o/r/commits/a/pulls');
    globalThis.fetch = async () => new Response('', { status: 403 });
    await assert.rejects(analyzeCommits({}, { commits: [{ hash: 'a' }], env }), /403/, 'a failed ask fails the release');
  } finally {
    globalThis.fetch = fetch;
  }
});

// The real notes step, so a dependency update that breaks it (conventional-changelog-conventionalcommits 10 needs a
// newer notes generator) fails here, in its own PR, instead of in the next Release run.
test('release text: What\'s new, then the commits under "Developer changes"', async () => {
  const { generateNotes } = require('../build/release');
  const notes = await generateNotes(
    {},
    {
      commits: [{ hash: 'a1b2c3d', message: 'fix(alerts): x', committerDate: new Date().toISOString() }],
      lastRelease: { gitTag: 'v1.0.0', version: '1.0.0' },
      nextRelease: { gitTag: 'v1.0.1', version: '1.0.1' },
      options: { repositoryUrl: 'https://github.com/o/r' },
      cwd: process.cwd(),
      env: {},
      logger: { log() {} },
    },
  );
  assert.match(notes, /<details><summary>Developer changes[\s\S]*\*\*alerts:\*\* x[\s\S]*<\/details>/);
});

test("PR rules: a conventional title; feat / fix / perf add What's new lines in both languages, or no-notes", () => {
  const { problems } = require('../build/check-pr');
  const base = [
    { version: 'unreleased', en: ['old'], fa: ['قدیم'] },
    { version: '1.0.0', en: ['x'], fa: ['ی'] },
  ];
  const added = [{ version: 'unreleased', en: ['old', 'new'], fa: ['قدیم', 'جدید'] }, base[1]];
  for (const t of ['feat: x', 'fix(relay): x', 'perf!: x', 'chore(deps): x', 'ci: x']) assert.deepEqual(problems(t, [], base, added), [], t);
  for (const t of ['Relay: revoke a code', 'feat:x', 'feature: x', 'fix x', '1.0.8: the code field']) assert.equal(problems(t, [], base, base).length, 1, t);
  assert.equal(problems('feat: x', [], base, base).length, 2, 'neither language');
  assert.equal(problems('fix: x', [], base, [{ ...added[0], fa: ['قدیم'] }, base[1]]).length, 1, 'English only');
  assert.deepEqual(problems('fix: x', ['no-notes'], base, base), []);
  assert.deepEqual(problems('refactor: x', [], base, base), []);
  assert.deepEqual(problems('fix: x', [], base, [{ ...base[0], en: ['old, reworded'], fa: ['قدیم، بازنویسی'] }, base[1]]), [], 'a reworded line counts');
});

// An on-handler property (el.onkeydown = ...) that returns false cancels its event: "e.key === 'Enter' && go()" did
// for every other key, and nothing could be typed (1.0.7's code field). Handlers that test something use a block.
test('no on-handler in the panel returns a test (false cancels the event)', () => {
  const panel = ['panel/panel.js', 'panel/crypto-popout.html'].map((f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')).join('\n');
  // The arrow's own expression, with what's inside brackets and quotes taken out (a test inside a call's arguments is fine).
  const flat = (x) => {
    for (let was; was !== x;) [was, x] = [x, x.replace(/\([^()]*\)|\[[^[\]]*\]|\{[^{}]*\}|`[^`]*`|'[^']*'|"[^"]*"/g, '_')];
    return x;
  };
  const bad = panel.split('\n').filter((l) => {
    const m = /\.on[a-z]+ = (?:async )?(?:\([^)]*\)|\w+) => (?![({])(.*)$/.exec(l);
    return m && /&&|\|\||\?(?![.?])/.test(flat(m[1].replace(/\s*\/\/.*$/, '')));
  });
  assert.deepEqual(bad, []);
});

test('every "?" in the panel has its help text', () => {
  const html = [...read('panel/index.html').matchAll(/data-help="([\w.]+)"/g)].map((m) => m[1]);
  const js = read('panel/panel.js');
  const chatTabs = js.slice(js.indexOf('const CHAT_TABS'), js.indexOf('function chatControl'));
  const chat = [...chatTabs.matchAll(/\['(?:toggle|range|seg|select|color|text|number)', '(\w+)'/g)].map((m) => `chat.${m[1]}`);
  const groups = [...js.matchAll(/help: '([\w.]+)'/g)].map((m) => m[1]);
  const keys = [...html, ...chat, ...groups];
  assert.ok(keys.length > 100);
  assert.deepEqual(
    keys.filter((k) => typeof at(en.help, k) !== 'string'),
    [],
  );
});
