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
