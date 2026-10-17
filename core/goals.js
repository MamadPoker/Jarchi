// Goal counters, fed by the event bus (so Kick/Twitch connectors will move them automatically) and by the panel.
// Saved in goals.json, apart from settings, so restarts and "Reset everything" keep the counts.
// With "Sync from Kick" (settings.kickGoalSync), a goal that's also set on the Kick channel (creator dashboard) shows
// Kick's own count and target instead; the rest stay manual, and the manual counts go on underneath.
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { DATA_DIR } = require('./config');
const { bus } = require('./events');
const settings = require('./settings');
const store = require('./store');

const FILE = path.join(DATA_DIR, 'goals.json');
// How much each normalized event adds to each goal. Followers: nothing (Kick sends no public follow events).
const COUNT = {
  // Kick's, and Twitch's when the sub goal's "Also count Twitch subs" is on.
  subs: (ev) => (ev.platform === 'twitch' && !settings.get().goals.subs.countTwitch ? 0
    : ev.type === 'sub' || ev.type === 'resub' ? 1 : ev.type === 'gift_sub' ? ev.amount : 0),
  kicks: (ev) => (ev.type === 'kicks' && ev.platform !== 'twitch' ? ev.amount : 0), // Kicks are Kick's
};
const KICK_TYPES = { followers: 'followers', subscriptions: 'subs', kicks: 'kicks' }; // Kick's goal type -> ours
const SHOWN = ['active', 'achieved']; // what kick.com still shows; canceled and expired ones go

const goals = new EventEmitter(); // 'change' (idThatJustReachedItsTarget | null)
const saved = store.load(FILE);
const state = Object.fromEntries(settings.GOAL_IDS.map((id) => [id, {
  current: Math.max(0, Math.round(Number(saved[id]?.current) || 0)),
  reached: saved[id]?.reached === true,
}]));
let kick = {}; // our goal id -> { goalId, current, target }: the Kick channel's goals, as last read

const bad = () => Object.assign(new Error('bad_request'), { status: 400, code: 'bad_request' });
const synced = (id) => (settings.get().kickGoalSync ? kick[id] : null);
// What widgets and the panel show, per goal: { current, target, reached, kick (Kick's numbers), onKick (set on Kick) }.
const all = () => Object.fromEntries(settings.GOAL_IDS.map((id) => {
  const k = synced(id);
  return [id, k ? { current: k.current, target: k.target, reached: k.current >= k.target, kick: true, onKick: true }
    : { ...state[id], target: settings.get().goals[id].target, kick: false, onKick: !!kick[id] }];
}));

// "Reached" latches: the bar stays full until the count goes back to 0 or the target changes.
function set(id, value) {
  const s = state[id];
  s.current = Math.max(0, Math.round(value));
  if (s.current === 0) s.reached = false;
  const hit = !s.reached && s.current >= settings.get().goals[id].target;
  if (hit) s.reached = true;
  store.save(FILE, state);
  goals.emit('change', hit && !synced(id) ? id : null); // a goal showing Kick's numbers celebrates Kick's
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

// New Kick values: tell widgets, and celebrate a goal that just got there.
function kickChanged(next) {
  const before = all();
  kick = next;
  const after = all();
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  goals.emit('change', settings.GOAL_IDS.find((id) => after[id].kick && after[id].reached && !before[id].reached) ?? null);
}
const count = (v, old = 0) => (Number.isFinite(v) ? Math.max(0, Math.round(v)) : old); // a missing number keeps the last one
// The Kick channel's whole list (kick.com/api/v2/channels/<slug>/goals), or null: no Kick channel any more.
function kickGoals(list) {
  const next = {};
  for (const g of list ?? []) {
    const id = KICK_TYPES[g?.type];
    if (id && SHOWN.includes(g.status) && !next[id]) next[id] = { goalId: g.id, current: count(g.current_value), target: Math.max(1, count(g.target_value, 1)) };
  }
  kickChanged(next);
}
// One goal from a live Kick event (created, updated, progress, achieved, canceled). Found by type, or by its id.
function kickGoal(g) {
  const id = KICK_TYPES[g?.type] ?? Object.keys(kick).find((k) => kick[k].goalId === g?.id);
  if (!id) return;
  const next = { ...kick };
  const old = kick[id] ?? { current: 0, target: 1 };
  if (SHOWN.includes(g.status ?? 'active')) next[id] = { goalId: g.id ?? old.goalId, current: count(g.current_value, old.current), target: Math.max(1, count(g.target_value, old.target)) };
  else delete next[id];
  kickChanged(next);
}
// "Sync from Kick" switched: widgets get the other numbers.
const refresh = () => goals.emit('change', null);

// Counting goes on while a goal is switched off; off only hides it on stream.
bus.on('event', (ev) => {
  for (const id in COUNT) {
    const n = COUNT[id](ev);
    if (n > 0) set(id, state[id].current + n);
  }
});

module.exports = { all, change, retarget, kickGoals, kickGoal, refresh, events: goals };
