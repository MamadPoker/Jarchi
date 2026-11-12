// The Luck page (panel/js/luck.js): its wheels, the giveaway's options and the coin's score, kept in data/luck.json; and
// the giveaway itself, which reads Kick and Twitch chat for its entry word. Its own file, not settings.json: a spin or a
// flip is no settings change (no Ctrl+Z step, and nothing for the OBS widgets, which get every settings change).
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { DATA_DIR } = require('./config');
const store = require('./store');
const { bus } = require('./events');

const FILE = path.join(DATA_DIR, 'luck.json');
const CHANCES = [0.25, 0.5, 1, 2]; // a slice's chance: very low, low, normal, high
const MAX = { wheels: 30, slices: 60, text: 80, name: 40, recent: 10, people: 5 };
// gw: the entry word; subsOnly (who can join); subLuck (subs count twice); timer (minutes, 0 = closed by hand); spin
// (seconds a name spins); winners and losers (losers only add suspense); order: losers first, or random with a winner
// last; flow: pause after each name until Next, or back to back; noRepeat: earlier winners can't join.
const GW = { keyword: '!join', subsOnly: false, subLuck: true, timer: 0, spin: 5, winners: 1, losers: 2, order: 'losers', flow: 'pause', noRepeat: true };
const DEFAULTS = { wheels: [], wheel: '', perSlice: true, tick: true, removeWinner: false, spins: [], gw: GW, coin: { heads: 0, tails: 0, flips: [] } };

const str = (max) => (v) => typeof v === 'string' && v.length <= max;
const bool = (v) => typeof v === 'boolean';
const int = (min, max) => (v) => Number.isInteger(v) && v >= min && v <= max;
const oneOf =
  (...a) =>
  (v) =>
    a.includes(v);
const list = (max, ok) => (v) => Array.isArray(v) && v.length <= max && v.every(ok);
const time = (v) => Number.isFinite(v) && v > 0;
const slice = (s) => s && str(MAX.text)(s.text) && CHANCES.includes(s.chance);
const wheel = (w) => w && /^[\w-]{1,24}$/.test(w.id) && str(MAX.name)(w.name) && list(MAX.slices, slice)(w.slices) && w.slices.length >= 2;
const GW_RULES = {
  keyword: (v) => typeof v === 'string' && /^\S.{0,29}$/.test(v),
  subsOnly: bool,
  subLuck: bool,
  timer: oneOf(0, 1, 2, 5),
  spin: oneOf(3, 5, 10),
  winners: int(1, MAX.people),
  losers: int(0, MAX.people),
  order: oneOf('losers', 'random'),
  flow: oneOf('pause', 'auto'),
  noRepeat: bool,
};
const RULES = {
  wheels: (v) => list(MAX.wheels, wheel)(v) && v.length >= 1 && new Set(v.map((w) => w.id)).size === v.length,
  wheel: str(24),
  perSlice: bool,
  tick: bool,
  removeWinner: bool,
  spins: list(MAX.recent, (s) => s && str(MAX.text)(s.text) && time(s.at)),
  gw: (v) => v && typeof v === 'object' && Object.entries(v).every(([k, x]) => GW_RULES[k]?.(x)),
  coin: (v) => v && int(0, 1e9)(v.heads) && int(0, 1e9)(v.tails) && list(MAX.recent, (f) => f && bool(f.heads) && time(f.at))(v.flips),
};
const bad = () => Object.assign(new Error('bad_request'), { status: 400, code: 'bad_request' });

let saved = store.load(FILE);
// What the panel gets: the saved values that still pass their rules, the defaults for the rest.
function get() {
  const out = Object.fromEntries(Object.entries(DEFAULTS).map(([k, d]) => [k, k !== 'gw' && RULES[k](saved[k]) ? saved[k] : d]));
  out.gw = { ...GW, ...Object.fromEntries(Object.entries(saved.gw ?? {}).filter(([k, v]) => GW_RULES[k]?.(v))) };
  return out;
}
// A change from the panel: the fields it sends replace the saved ones (gw: field by field). One bad field: nothing changes.
function update(patch) {
  if (!patch || typeof patch !== 'object' || Object.entries(patch).some(([k, v]) => !RULES[k]?.(v))) throw bad();
  const { gw, ...rest } = patch;
  saved = { ...saved, ...rest, ...(gw && { gw: { ...saved.gw, ...gw } }) };
  store.save(FILE, saved);
  return get();
}

// ---------- The giveaway ----------
// idle (none yet) -> open (chat's entry word joins, each viewer once) -> closed (Close entries, its timer, or a draw).
// Start again begins a new one. Only while Jarchi runs: a restart ends it.
const events = new EventEmitter(); // 'state' (live, on every status change), 'join' (one new entrant)
let live = { status: 'idle', endsAt: null, entrants: [] },
  timer;
const won = new Set(); // 'platform:login' of every winner since Jarchi started: "Previous winners can't join"
const who = (e) => `${e.platform}:${e.login}`;
const isSub = (m) => m.user.badges.some((b) => b.type === 'subscriber' || b.name === 'founder'); // Twitch's founder is a subscriber type already

function setLive(v) {
  live = v;
  events.emit('state', live);
  return live;
}
function start() {
  clearTimeout(timer);
  const { timer: min } = get().gw;
  if (min) timer = setTimeout(close, min * 60000);
  return setLive({ status: 'open', endsAt: min ? Date.now() + min * 60000 : null, entrants: [] });
}
function close() {
  clearTimeout(timer);
  return live.status === 'open' ? setLive({ ...live, status: 'closed', endsAt: null }) : live;
}
// A chat message: its sender joins when it starts with the entry word (any case), once, if the giveaway lets them.
function entry(m) {
  if (live.status !== 'open' || m.test || m.kind !== 'message' || !m.user.login) return;
  const g = get().gw,
    text = m.text.trim().toLowerCase(),
    word = g.keyword.trim().toLowerCase();
  if (text !== word && !text.startsWith(`${word} `)) return;
  const e = { platform: m.platform, login: m.user.login, name: m.user.name || m.user.login, sub: isSub(m) };
  if ((g.subsOnly && !e.sub) || (g.noRepeat && won.has(who(e))) || live.entrants.some((x) => who(x) === who(e))) return;
  live.entrants.push(e);
  events.emit('join', e);
}
bus.on('chat', entry);

// Who is shown, in order: { win, who } each. Winners first, by weight (a sub twice, with subLuck); then the losers from
// the rest, evenly (being shown as a loser is no chance lost). Fewer people than asked: winners still come first.
// order 'random': shuffled, with a winner always last.
function plan(pool, { winners, losers, order, subLuck }, rnd = Math.random) {
  const left = [...pool];
  const take = (weight) => {
    let r = rnd() * left.reduce((a, e) => a + weight(e), 0);
    const i = left.findIndex((e) => (r -= weight(e)) < 0);
    return left.splice(i < 0 ? left.length - 1 : i, 1)[0];
  };
  const W = Array.from({ length: Math.min(winners, left.length) }, () => ({ win: true, who: take((e) => (subLuck && e.sub ? 2 : 1)) }));
  const L = Array.from({ length: Math.min(losers, left.length) }, () => ({ win: false, who: take(() => 1) }));
  const seq = [...L, ...W];
  if (order !== 'random') return seq;
  for (let i = seq.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [seq[i], seq[j]] = [seq[j], seq[i]];
  }
  const last = seq.findLastIndex((s) => s.win);
  return [...seq.filter((_, i) => i !== last), seq[last]];
}
// Draw (again): entries close; with noRepeat, earlier winners are out of this draw too (Draw again: someone else).
function draw() {
  if (live.status === 'idle') throw Object.assign(new Error('luck_empty'), { status: 409, code: 'luck_empty' });
  close();
  const g = get().gw,
    pool = live.entrants.filter((e) => !(g.noRepeat && won.has(who(e))));
  if (!pool.length) throw Object.assign(new Error('luck_empty'), { status: 409, code: 'luck_empty' });
  const seq = plan(pool, g);
  seq.filter((s) => s.win).forEach((s) => won.add(who(s.who)));
  return { pool, seq };
}

module.exports = { get, update, start, close, draw, plan, entry, events, state: () => live, CHANCES };
