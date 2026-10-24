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
  assert.deepEqual(keys.filter((p) => typeof at(fa, p) !== typeof at(en, p)), [], 'missing in fa.json');
  assert.deepEqual(keys.filter((p) => typeof at(en, p) === 'string' && vars(at(fa, p)) !== vars(at(en, p))), [], '{variables} differ');
});

test('the Privacy Policy has a version and the same parts in English and Persian', () => {
  const { version, icons, en: e, fa: f } = JSON.parse(read('i18n/privacy.json'));
  assert.ok(Number.isInteger(version) && version > 0);
  for (const p of [e, f]) assert.ok(p.title && p.intro && p.items.every(([what, text]) => what && text));
  assert.equal(f.items.length, e.items.length);
  const js = read('panel/panel.js'), drawn = js.slice(js.indexOf('const POINT_ICON'), js.indexOf('async function showPrivacy'));
  assert.deepEqual(icons.filter((i) => !drawn.includes(`\n  ${i}: '<svg`)), [], 'every point has its icon in the panel');
  assert.equal(icons.length, e.items.length);
});

test("What's new: every version in English and Persian, newest first; this version's notes make the release text", () => {
  const log = JSON.parse(read('i18n/changelog.json'));
  const order = (v) => v.split('.').map((n) => n.padStart(6, '0')).join('.'); // 1.10.0 after 1.9.0
  log.slice(1).forEach((c, i) => assert.ok(order(log[i].version) > order(c.version), `${log[i].version} before ${c.version}`));
  for (const c of log) {
    assert.match(c.version, /^\d+\.\d+\.\d+$/);
    assert.ok(c.en.length && c.en.length === c.fa.length, `${c.version}: the same changes in both languages`);
    assert.ok([...c.en, ...c.fa].every((s) => s.trim() && !s.includes('\n')), `${c.version}: one line each`);
  }
  const mine = log.find((c) => c.version === JSON.parse(read('package.json')).version);
  assert.ok(mine, "package.json's version has its notes (npm run release needs them)");
  assert.deepEqual(parse(text(mine)), { en: mine.en, fa: mine.fa }); // what an installed app reads back from the update
});

test('every "?" in the panel has its help text', () => {
  const html = [...read('panel/index.html').matchAll(/data-help="([\w.]+)"/g)].map((m) => m[1]);
  const js = read('panel/panel.js');
  const chatTabs = js.slice(js.indexOf('const CHAT_TABS'), js.indexOf('function chatControl'));
  const chat = [...chatTabs.matchAll(/\['(?:toggle|range|seg|select|color|text|number)', '(\w+)'/g)].map((m) => `chat.${m[1]}`);
  const groups = [...js.matchAll(/help: '([\w.]+)'/g)].map((m) => m[1]);
  const keys = [...html, ...chat, ...groups];
  assert.ok(keys.length > 100);
  assert.deepEqual(keys.filter((k) => typeof at(en.help, k) !== 'string'), []);
});
