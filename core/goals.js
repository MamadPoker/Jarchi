// Goal counters, fed by the event bus (so Kick/Twitch connectors will move them automatically) and by the panel.
// Saved in goals.json, apart from settings, so restarts and "Reset everything" keep the counts.
// With "Sync from Kick" (settings.kickGoalSync) / "Sync from Twitch" (settings.twitchGoalSync), a goal that's also set on
// the Kick / Twitch channel shows that platform's own count and target instead; the rest stay manual, and the manual
// counts go on underneath. Set on both (subs, followers): the goal's source says Kick's, Twitch's or both added up.
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
  bits: (ev) => (ev.type === 'bits' && ev.platform !== 'kick' ? ev.amount : 0), // bits are Twitch's
};
const KICK_TYPES = { followers: 'followers', subscriptions: 'subs', kicks: 'kicks' }; // Kick's goal type -> ours
// Twitch's goal type -> ours. Its four sub goals (points or subs, all or only new ones) are each the Sub goal.
const TWITCH_TYPES = { follow: 'followers', subscription: 'subs', subscription_count: 'subs', new_subscription: 'subs', new_subscription_count: 'subs', new_bit: 'bits' };
const SHOWN = ['active', 'achieved']; // what kick.com still shows; canceled and expired ones go

const goals = new EventEmitter(); // 'change' (idThatJustReachedItsTarget | null)
const saved = store.load(FILE);
const state = Object.fromEntries(settings.GOAL_IDS.map((id) => [id, {
  current: Math.max(0, Math.round(Number(saved[id]?.current) || 0)),
  reached: saved[id]?.reached === true,
}]));
const on = { kick: {}, twitch: {} }; // platform -> our goal id -> { goalId, current, target }: the channel's goals, as last read

const bad = () => Object.assign(new Error('bad_request'), { status: 400, code: 'bad_request' });
// The platforms a goal has numbers from (sync on, set there), and of those the ones it shows: with both, its source picks.
function sources(id) {
  const s = settings.get();
  const have = ['kick', 'twitch'].filter((p) => s[`${p}GoalSync`] && on[p][id]);
  return { have, use: have.length === 2 && have.includes(s.goals[id].source) ? [s.goals[id].source] : have };
}
// A channel's own goal for one of ours, without Kick's / Twitch's id, or null.
const own = (p, id) => {
  if (!on[p][id]) return null;
  const { goalId, ...g } = on[p][id];
  return g;
};
// What widgets and the panel show, per goal: { current, target, reached, kick / twitch (its numbers are that platform's),
// onKick / onTwitch (that channel's own goal: { current, target } (Twitch's also description, type), null when none
// is set there), both (synced from both: the source choice applies) }.
const all = () => Object.fromEntries(settings.GOAL_IDS.map((id) => {
  const { have, use } = sources(id);
  const marks = { kick: use.includes('kick'), twitch: use.includes('twitch'), onKick: own('kick', id), onTwitch: own('twitch', id), both: have.length === 2 };
  if (!use.length) return [id, { ...state[id], target: settings.get().goals[id].target, ...marks }];
  const sum = (k) => use.reduce((n, p) => n + on[p][id][k], 0);
  return [id, { current: sum('current'), target: sum('target'), reached: sum('current') >= sum('target'), ...marks }];
}));

// "Reached" latches: the bar stays full until the count goes back to 0 or the target changes.
function set(id, value) {
  const s = state[id];
  s.current = Math.max(0, Math.round(value));
  if (s.current === 0) s.reached = false;
  const hit = !s.reached && s.current >= settings.get().goals[id].target;
  if (hit) s.reached = true;
  store.save(FILE, state);
  goals.emit('change', hit && !sources(id).use.length ? id : null); // a goal showing Kick's / Twitch's numbers celebrates theirs
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

// New Kick / Twitch values: tell widgets, and celebrate a goal that just got there.
function platformChanged(platform, next) {
  const before = all();
  on[platform] = next;
  const after = all();
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  goals.emit('change', settings.GOAL_IDS.find((id) => (after[id].kick || after[id].twitch) && after[id].reached && !before[id].reached) ?? null);
}
const count = (v, old = 0) => (Number.isFinite(v) ? Math.max(0, Math.round(v)) : old); // a missing number keeps the last one
// The Kick channel's whole list (kick.com/api/v2/channels/<slug>/goals), or null: no Kick channel any more.
function kickGoals(list) {
  const next = {};
  for (const g of list ?? []) {
    const id = KICK_TYPES[g?.type];
    if (id && SHOWN.includes(g.status) && !next[id]) next[id] = { goalId: g.id, current: count(g.current_value), target: Math.max(1, count(g.target_value, 1)) };
  }
  platformChanged('kick', next);
}
// One goal from a live Kick event (created, updated, progress, achieved, canceled). Found by type, or by its id.
function kickGoal(g) {
  const id = KICK_TYPES[g?.type] ?? Object.keys(on.kick).find((k) => on.kick[k].goalId === g?.id);
  if (!id) return;
  const next = { ...on.kick };
  const old = on.kick[id] ?? { current: 0, target: 1 };
  if (SHOWN.includes(g.status ?? 'active')) next[id] = { goalId: g.id ?? old.goalId, current: count(g.current_value, old.current), target: Math.max(1, count(g.target_value, old.target)) };
  else delete next[id];
  platformChanged('kick', next);
}
// The Twitch channel's active goals, as connectors/twitch-account.js keeps them ([] when not connected).
function twitchGoals(list) {
  const next = {};
  for (const g of list ?? []) {
    const id = TWITCH_TYPES[g?.type];
    if (id && !next[id]) next[id] = { goalId: g.id, current: count(g.current), target: Math.max(1, count(g.target, 1)), description: String(g.description ?? ''), type: g.type };
  }
  platformChanged('twitch', next);
}
// A sync switched, or a goal's source changed: widgets get the other numbers.
const refresh = () => goals.emit('change', null);

// Counting goes on while a goal is switched off; off only hides it on stream.
bus.on('event', (ev) => {
  for (const id in COUNT) {
    const n = COUNT[id](ev);
    if (n > 0) set(id, state[id].current + n);
  }
});

module.exports = { all, change, retarget, kickGoals, kickGoal, twitchGoals, refresh, events: goals };
