// The Luck page's server side (core/luck.js): what it saves, who joins a giveaway from chat, and how a draw picks.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarchi-luck-'));
process.env.JARCHI_DATA_DIR = dataDir;
const luck = require('../core/luck');
const { chatMessage } = require('../core/events');

const say = (platform, login, text, badges = []) =>
  luck.entry(chatMessage({ platform, text, user: { login, name: login.toUpperCase(), badges: badges.map((type) => ({ type, name: type })) } }));

test('saved: only values that pass their rules; a bad field changes nothing', () => {
  const d = luck.get();
  assert.deepEqual(d.wheels, []); // the panel fills the first run's sample wheels
  assert.equal(d.gw.keyword, '!join');
  const wheel = {
    id: 'w1',
    name: 'Prizes',
    slices: [
      { text: 'A', chance: 1 },
      { text: 'B', chance: 0.25 },
    ],
  };
  luck.update({ wheels: [wheel], wheel: 'w1', gw: { winners: 2 } });
  assert.throws(() => luck.update({ gw: { winners: 9 }, tick: false }), /bad_request/);
  assert.throws(() => luck.update({ wheels: [{ ...wheel, slices: [wheel.slices[0]] }] }), /bad_request/); // one slice: no wheel
  assert.throws(() => luck.update({ nope: 1 }), /bad_request/);
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'luck.json'), 'utf8'));
  assert.deepEqual(saved.wheels, [wheel]);
  assert.equal(luck.get().gw.winners, 2);
  assert.equal(luck.get().gw.losers, 2); // the other options keep their defaults
  assert.equal(luck.get().tick, true);
});

test('giveaway: the entry word joins once per viewer, only while open; Subs only', () => {
  say('kick', 'early', '!join');
  assert.equal(luck.state().status, 'idle');
  luck.start();
  say('kick', 'ali', '!JOIN');
  say('kick', 'ali', '!join'); // once
  say('twitch', 'ali', '!join please'); // the same name on Twitch is someone else
  say('kick', 'sara', 'hi !join'); // not at the start
  say('twitch', 'mina', '!join', ['subscriber']);
  assert.deepEqual(
    luck.state().entrants.map((e) => [e.platform, e.login, e.sub]),
    [
      ['kick', 'ali', false],
      ['twitch', 'ali', false],
      ['twitch', 'mina', true],
    ],
  );
  luck.update({ gw: { subsOnly: true } });
  say('kick', 'reza', '!join');
  say('kick', 'nima', '!join', ['subscriber']);
  assert.deepEqual(luck.state().entrants.at(-1).login, 'nima');
  luck.close();
  say('kick', 'late', '!join');
  assert.equal(luck.state().entrants.length, 4);
});

test('draw: winners by weight first (a sub twice), losers from the rest; random order ends on a winner', () => {
  const people = ['a', 'b', 'c', 'd'].map((login) => ({ platform: 'kick', login, name: login, sub: login === 'd' }));
  // a, b, c weigh 1 and d 2 with subLuck. rnd 0.7: the winner at 3.5 of 5 (past a, b, c: d); the losers evenly from
  // a, b, c (2.1 of 3: c), then a, b (1.4 of 2: b).
  const seq = luck.plan(people, { winners: 1, losers: 2, order: 'losers', subLuck: true }, () => 0.7);
  assert.deepEqual(
    seq.map((s) => [s.win, s.who.login]),
    [
      [false, 'c'],
      [false, 'b'],
      [true, 'd'],
    ],
  );
  assert.equal(luck.plan(people, { winners: 1, losers: 0, order: 'losers', subLuck: false }, () => 0.7)[0].who.login, 'c'); // 2.8 of 4
  // Two people, 1 winner and 2 losers asked: one of each, never no winner.
  assert.deepEqual(
    luck.plan(people.slice(0, 2), { winners: 1, losers: 2, order: 'losers', subLuck: false }).map((s) => s.win),
    [false, true],
  );
  for (let i = 0; i < 50; i++) {
    const r = luck.plan(people, { winners: 2, losers: 2, order: 'random', subLuck: true });
    assert.equal(r.length, 4);
    assert.equal(r.at(-1).win, true);
    assert.equal(new Set(r.map((s) => s.who.login)).size, 4); // nobody twice
  }
});

test("draw: entries close; previous winners can't join or win again", () => {
  luck.update({ gw: { subsOnly: false, winners: 1, losers: 0, noRepeat: true } });
  luck.start();
  say('kick', 'x', '!join');
  say('kick', 'y', '!join');
  const first = luck.draw();
  assert.equal(luck.state().status, 'closed');
  assert.equal(first.pool.length, 2);
  const winner = first.seq[0].who.login,
    other = winner === 'x' ? 'y' : 'x';
  assert.equal(luck.draw().seq[0].who.login, other); // Draw again: someone else
  assert.throws(() => luck.draw(), /luck_empty/); // both won
  luck.start();
  say('kick', winner, '!join');
  assert.equal(luck.state().entrants.length, 0);
  luck.update({ gw: { noRepeat: false } });
  say('kick', winner, '!join');
  assert.equal(luck.state().entrants.length, 1);
  luck.close();
});

test('coin Reset: the score back to 0 and the recent flips cleared, then saved', () => {
  // The panel's code (panel/js/luck.js resetCoin), run here as it is.
  const src = fs.readFileSync(path.join(__dirname, '..', 'panel', 'js', 'luck.js'), 'utf8');
  const code = src.slice(src.indexOf('function resetCoin('), src.indexOf('function wireCoin2('));
  const calls = [];
  const ctx = {
    luck: { coin: { heads: 3, tails: 2, flips: [{ heads: true, at: 1 }] } },
    lkSave: (k) => calls.push(`save ${k}`),
    renderCoin: () => calls.push('render'),
  };
  require('node:vm').runInNewContext(`${code}; resetCoin()`, ctx);
  assert.equal(JSON.stringify(ctx.luck.coin), '{"heads":0,"tails":0,"flips":[]}'); // made in the vm: compared as JSON
  assert.deepEqual(calls, ['save coin', 'render']);
});

test('a wheel keeps the slices Remove the winner after took out (removed), and 60 slices at most counting them', () => {
  const slices = [
    { text: 'A', chance: 1 },
    { text: 'B', chance: 2 },
  ];
  const w = (removed) => ({ id: 'w2', name: 'Out', slices, removed });
  luck.update({ wheels: [w([{ text: 'C', chance: 0.25, at: 1 }])] });
  assert.deepEqual(luck.get().wheels[0].removed, [{ text: 'C', chance: 0.25, at: 1 }]);
  assert.throws(() => luck.update({ wheels: [w([{ text: 'C', chance: 0.25, at: -1 }])] }), /bad_request/);
  assert.throws(() => luck.update({ wheels: [w([{ text: 'C', chance: 3, at: 0 }])] }), /bad_request/);
  const many = Array.from({ length: 59 }, (_, i) => ({ text: `R${i}`, chance: 1, at: 0 }));
  assert.throws(() => luck.update({ wheels: [w(many)] }), /bad_request/, '2 on the wheel + 59 out: over 60');
  luck.update({ wheels: [w(many.slice(1))] });
});

// The panel's code (panel/js/luck.js), run here as it is.
const panelCode = (from, to) => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'panel', 'js', 'luck.js'), 'utf8');
  return src.slice(src.indexOf(from), src.indexOf(to));
};

test('Restore slices: every winner taken out goes back in its place with its chance; slices added meanwhile stay', () => {
  const { lkTakeOut, lkPutBack } = require('node:vm').runInNewContext(
    `${panelCode('function lkTakeOut(', 'function renderWheels(')}; ({ lkTakeOut, lkPutBack })`,
  );
  const was = ['A', 'B', 'C', 'D', 'E'].map((text, i) => ({ text, chance: [1, 0.25, 2, 0.5, 1][i] }));
  const w = { slices: was.map((s) => ({ ...s })) };
  for (const t of ['C', 'A', 'E'])
    lkTakeOut(
      w,
      w.slices.find((s) => s.text === t),
    );
  assert.deepEqual(
    w.slices.map((s) => s.text),
    ['B', 'D'],
  );
  assert.equal(w.removed.length, 3);
  lkPutBack(w);
  assert.equal(JSON.stringify(w), JSON.stringify({ slices: was }), 'same order and chances, nothing left out');
  lkTakeOut(w, w.slices[0]);
  w.slices.push({ text: 'New', chance: 1 });
  lkPutBack(w);
  assert.deepEqual(
    w.slices.map((s) => s.text),
    ['A', 'B', 'C', 'D', 'E', 'New'],
  );
});

test("a slice's text: as big as it fits, on one line or two, in full; cut with … only when it can't fit at 20px", () => {
  const { lkFit, LK_TEXT } = require('node:vm').runInNewContext(`${panelCode('const LK_TEXT', '// The slice under the pointer')}; ({ lkFit, LK_TEXT })`);
  const width = (s) => [...s].length * 16; // at 30px
  const len = (fit) => Math.max(...fit.lines.map(width)) * (fit.f / 30);
  const eighth = (Math.PI * 2) / 8;
  assert.deepEqual(JSON.parse(JSON.stringify(lkFit('Spin again', eighth, width))), { f: 30, lines: ['Spin again'] });
  for (const text of ['A sub picks the punishment', 'Chat picks a song to play next', 'یه ساب تنبیه رو انتخاب می‌کنه']) {
    const fit = lkFit(text, eighth, width);
    assert.equal(fit.lines.join(' '), text, `${text}: in full`);
    assert.ok(fit.lines.length <= 2 && fit.f >= LK_TEXT.min && len(fit) <= LK_TEXT.out - LK_TEXT.in, text);
  }
  assert.equal(lkFit('A sub picks the punishment', eighth, width).f, 30, 'two lines before a smaller font');
  const word = lkFit('Supercalifragilistic', eighth, width); // no space: smaller on one line
  assert.deepEqual([word.lines.length, word.lines[0], word.f < 30], [1, 'Supercalifragilistic', true]);
  const thin = lkFit('Funny accent till the game ends', (Math.PI * 2) / 60, width); // 60 slices
  assert.equal(thin.f, LK_TEXT.min);
  assert.ok(thin.lines.length === 1 && thin.lines[0].endsWith('…') && len(thin) <= LK_TEXT.out - LK_TEXT.in);
});

test("Jarchi's own Giveaway texts follow the app's language until the streamer changes them; theirs stay", () => {
  const L = (lang) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'i18n', `${lang}.json`), 'utf8'));
  const en = L('en'),
    fa = L('fa');
  const fd = (v, inFa) => (inFa ? String(v).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]) : String(v));
  const inLang = (S) => require('node:vm').runInNewContext(`${panelCode('const lkOwn', '// The first run: Jarchi')}; ({ lkOwn, lkLocalize })`, { S, fd });
  // One text in a language is one text in the other (else a default could turn into the wrong one).
  for (const [from, to] of [
    [en, fa],
    [fa, en],
  ]) {
    const a = inLang(to).lkOwn(from),
      b = inLang(to).lkOwn(to),
      seen = new Map();
    assert.equal(a.length, b.length);
    a.forEach((t, i) => {
      assert.equal(seen.get(t) ?? b[i], b[i], `"${t}" has one translation`);
      seen.set(t, b[i]);
    });
  }
  // A first run in English: the samples, one slice and one wheel name the streamer changed, one sample slice taken out
  // by Remove the winner after, a new wheel, and the recent spins.
  const s = en.panel.luckSamples[0];
  const english = {
    wheels: [
      { id: 'a', name: s.name, slices: s.slices.slice(1).map(([text, chance]) => ({ text, chance })), removed: [{ text: s.slices[0][0], chance: 1, at: 0 }] },
      {
        id: 'b',
        name: 'My prizes',
        slices: [
          { text: 'Free sub', chance: 1 },
          { text: en.panel.luckSamples[2].slices[0][0], chance: 2 },
        ],
      },
      { id: 'c', name: en.panel.luckNewWheelName, slices: [1, 2].map((n) => ({ text: `${en.panel.luckNewSlice} ${n}`, chance: 1 })) },
    ],
    spins: [
      { text: s.slices[2][0], at: 1 },
      { text: 'Free sub', at: 2 },
    ],
  };
  const d = structuredClone(english);
  assert.equal(inLang(fa).lkLocalize(d, en), true);
  const f = fa.panel.luckSamples[0];
  assert.equal(d.wheels[0].name, f.name);
  assert.deepEqual(
    d.wheels[0].slices.map((x) => x.text),
    f.slices.slice(1).map(([text]) => text),
  );
  assert.equal(d.wheels[0].removed[0].text, f.slices[0][0], 'a slice taken out too');
  assert.equal(d.wheels[1].name, 'My prizes', "the streamer's name stays");
  assert.deepEqual(
    d.wheels[1].slices.map((x) => x.text),
    ['Free sub', fa.panel.luckSamples[2].slices[0][0]],
  );
  assert.equal(d.wheels[2].name, fa.panel.luckNewWheelName);
  assert.equal(d.wheels[2].slices[0].text, `${fa.panel.luckNewSlice} ۱`);
  assert.deepEqual(
    d.spins.map((x) => x.text),
    [f.slices[2][0], 'Free sub'],
  );
  assert.equal(inLang(fa).lkLocalize(d, en), false, 'already in Persian: nothing to save');
  assert.equal(inLang(en).lkLocalize(d, fa), true);
  assert.deepEqual(d, english, 'back in English: exactly as it was');
});
