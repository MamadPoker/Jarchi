// Goal counters, fed by the event bus (so Kick/Twitch connectors will move them automatically) and by the panel.
// Saved in goals.json, apart from settings, so restarts and "Reset everything" keep the counts.
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { DATA_DIR } = require('./config');
const { bus } = require('./events');
const settings = require('./settings');
const store = require('./store');

const FILE = path.join(DATA_DIR, 'goals.json');
// How much each normalized event adds to each goal.
const COUNT = {
  // Kick's, and Twitch's when the sub goal's "Also count Twitch subs" is on.
  subs: (ev) => (ev.platform === 'twitch' && !settings.get().goals.subs.countTwitch ? 0
    : ev.type === 'sub' || ev.type === 'resub' ? 1 : ev.type === 'gift_sub' ? ev.amount : 0),
  kicks: (ev) => (ev.type === 'kicks' && ev.platform !== 'twitch' ? ev.amount : 0), // Kicks are Kick's
};

const goals = new EventEmitter(); // 'change' (idThatJustReachedItsTarget | null)
const saved = store.load(FILE);
const state = Object.fromEntries(settings.GOAL_IDS.map((id) => [id, {
  current: Math.max(0, Math.round(Number(saved[id]?.current) || 0)),
  reached: saved[id]?.reached === true,
}]));

const bad = () => Object.assign(new Error('bad_request'), { status: 400, code: 'bad_request' });
const all = () => structuredClone(state);

// "Reached" latches: the bar stays full until the count goes back to 0 or the target changes.
function set(id, value) {
  const s = state[id];
  s.current = Math.max(0, Math.round(value));
  if (s.current === 0) s.reached = false;
  const hit = !s.reached && s.current >= settings.get().goals[id].target;
  if (hit) s.reached = true;
  store.save(FILE, state);
  goals.emit('change', hit ? id : null);
}

// From the panel: { add: n } (Test, + and -) or { set: n } (number field, Reset to 0).
function change(id, body) {
  if (!state[id]) throw bad();
  if (Number.isFinite(body?.add)) set(id, state[id].current + body.add);
  else if (Number.isFinite(body?.set) && body.set >= 0) set(id, body.set);
  else throw bad();
  return all();
}

// After a target change: forget "reached" and check again against the new target.
function retarget(id) {
  state[id].reached = false;
  set(id, state[id].current);
}

// Counting goes on while a goal is switched off; off only hides it on stream.
bus.on('event', (ev) => {
  for (const id in COUNT) {
    const n = COUNT[id](ev);
    if (n > 0) set(id, state[id].current + n);
  }
});

module.exports = { all, change, retarget, events: goals };
