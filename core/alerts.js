// Alert queue. The server decides what plays and when, and sends it to every open alerts overlay of its link at once:
// - every overlay of a link shows the same alert at the same time, in the same order, each alert once;
// - a refreshed overlay gets the alert that's playing now with the time it has left, so nothing replays;
// - while no overlay is open (OBS closed) alerts wait; an alert that ends with no overlay open goes back to the front.
// The panel can skip the current alert, clear or remove waiting ones, pause / resume, and replay one of the last played
// or of the saved events (the Home page's live feed, the History page).
// Each OBS link plays its own alerts one at a time, next to the others: the main link ('all') and one per alert type
// (/widgets/alerts/<type>, only that type). While a type's own link is open the main link skips that type; once it's
// closed, the main link plays it again (also what was waiting for it). Who plays an alert is decided when it starts.
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const { DATA_DIR } = require('./config');
const { bus, logIncoming, clock, step, TYPES, PLATFORMS } = require('./events');
const settings = require('./settings');
const store = require('./store');

const STEPS = { gift_sub: [5, 20], kicks: [100, 1000], bits: [100, 1000] }; // as in widgets/alerts/alerts.js: bigger amounts play longer
const OUT_MS = 600; // the overlay's exit animation
const GRACE_MS = 3000; // the last overlay left less than this before the end: a refresh, the alert counts as seen
const MAX_WAITING = 200, HISTORY = 10, FEED = 1000; // ponytail: feed.json is rewritten whole per event; an append-only log if more than 1000 ever matters

const alerts = new EventEmitter(); // 'play' ({ id, ev, left }), 'skip' (id), 'state' (state())
const queue = []; // { id, ev }
const history = []; // the last played, newest first: { id, ev }
// The last events, newest first, also ones that didn't play (switched off, below the minimum). Kept in feed.json, so
// the Home page still has them after a restart.
const FEED_FILE = path.join(DATA_DIR, 'feed.json');
const savedFeed = store.load(FEED_FILE);
const feed = (Array.isArray(savedFeed) ? savedFeed : []).filter((e) => TYPES.includes(e?.type) && PLATFORMS.includes(e.platform)).slice(0, FEED);
// A lane per link. playing: { id, ev, ms, started }; busy: an alert is playing, or it's the gap after one.
const lanes = Object.fromEntries(['all', ...TYPES].map((l) => [l, { playing: null, busy: false, overlays: 0, goneAt: 0, timer: null }]));
const laneOf = (ev) => (lanes[ev.type].overlays ? ev.type : 'all');
const showing = () => Object.values(lanes).find((l) => l.playing); // the one the panel shows (and skips): the main link's first
let paused = false;

// How long an alert stays on screen (ms), before its exit animation.
function onScreenMs(ev) {
  const steps = STEPS[ev.type];
  const tier = steps ? 1 + steps.filter((n) => ev.amount >= n).length : 0;
  return (settings.get().alerts[ev.type].duration + (steps ? (tier - 1) * 1.5 : 0)) * 1000;
}

// What the panel shows: the alert on now (with its length and time left, for the progress bar), the waiting ones
// in order, and the last played.
const brief = ({ id, ev }) => ({ id, type: ev.type, user: ev.user, amount: ev.amount, months: ev.months, platform: ev.platform });
const current = ({ playing: p }) => p && { id: p.id, ev: p.ev, left: p.ms - (Date.now() - p.started) };
const state = () => {
  const on = showing();
  return {
    paused,
    overlays: Object.values(lanes).reduce((n, l) => n + l.overlays, 0),
    waiting: queue.length,
    list: queue.map(brief),
    history: history.map(brief),
    now: on && { ...brief(on.playing), ms: on.playing.ms, left: Math.max(0, current(on).left) },
  };
};
const changed = () => alerts.emit('state', state());
const played = ({ id, ev }) => {
  history.unshift({ id, ev });
  history.length = Math.min(history.length, HISTORY);
};

bus.on('event', (ev) => {
  feed.unshift(ev);
  feed.length = Math.min(feed.length, FEED);
  store.save(FEED_FILE, feed);
  const cfg = settings.get().alerts[ev.type];
  if (!ev.test && (!cfg.enabled || ev.amount < (cfg.minAmount ?? 0))) return; // test buttons always play
  queue.push({ id: ev.id, ev });
  if (queue.length > MAX_WAITING) queue.shift(); // ponytail: a flood drops the oldest; merge similar alerts if that ever matters
  next();
});

// Every free lane with an open overlay starts its first waiting alert. 'play' names the lane: only its overlays show it.
function next() {
  for (const [name, lane] of Object.entries(lanes)) {
    const i = lane.busy || paused || !lane.overlays ? -1 : queue.findIndex((it) => laneOf(it.ev) === name);
    if (i < 0) continue;
    lane.busy = true;
    lane.playing = { ...queue.splice(i, 1)[0], started: Date.now() };
    lane.playing.ms = onScreenMs(lane.playing.ev);
    alerts.emit('play', current(lane), name);
    lane.timer = setTimeout(() => ended(lane), lane.playing.ms + OUT_MS);
  }
  changed();
}

function ended(lane) {
  const { id, ev } = lane.playing;
  if (!lane.overlays && Date.now() - lane.goneAt > GRACE_MS) queue.unshift({ id, ev }); // OBS was closed: play it again when it's back
  else played(lane.playing);
  lane.playing = null;
  rest(lane, 0);
}

// The gap between alerts, then the next one.
function rest(lane, extraMs) {
  changed();
  lane.timer = setTimeout(() => { lane.busy = false; next(); }, extraMs + settings.get().alertGap * 1000);
}

// An alerts overlay connected (to its link's lane): send it what's playing there now (if enough is left to be worth
// showing), then go on.
function join(send, name = 'all') {
  const lane = lanes[name], now = current(lane);
  lane.overlays++;
  if (now?.left > 1000) send({ ...now, late: true });
  next();
}
function leave(name = 'all') {
  const lane = lanes[name];
  if (!--lane.overlays) lane.goneAt = Date.now();
  next(); // a type's own link closed: the main link takes its alerts again
}

function skip() {
  const lane = showing();
  if (lane) {
    clearTimeout(lane.timer);
    alerts.emit('skip', lane.playing.id);
    played(lane.playing);
    lane.playing = null;
    rest(lane, OUT_MS); // let the exit animation finish
  }
  return state();
}
function clear() {
  queue.length = 0;
  changed();
  return state();
}
// One waiting alert out of the queue.
function remove(id) {
  const i = queue.findIndex((it) => it.id === id);
  if (i >= 0) queue.splice(i, 1);
  changed();
  return state();
}
// One of the last played (or of the feed), again, at the end of the queue. Not a new event: goals don't count it twice.
function replay(id) {
  const ev = history.find((h) => h.id === id)?.ev ?? feed.find((e) => e.id === id);
  if (ev) queue.push({ id: randomUUID(), ev });
  next();
  return state();
}
function pause(on) {
  paused = !!on;
  next();
  return state();
}

// Alert timing: an overlay says when it started an alert -> one line in the server output and the event log, per real
// alert (not replays) and overlay: received = Kick / Twitch's event reached Jarchi; check = Jarchi deciding it (a Kick
// sub waits a moment for a gift that may name the viewer); queue = waiting for the alert before it and the gap, an open
// overlay or a resume; overlay = from here to the overlay starting it. r: { id, shown, where } from the overlay.
function shown(r, transport) {
  const at = Number(r?.shown), playing = Object.values(lanes).find((l) => l.playing?.id === r?.id)?.playing;
  if (!playing || playing.id !== playing.ev.id || !Number.isFinite(at)) return null;
  const { ev, started } = playing;
  const line = `${ev.type} ${ev.user.replace(/\p{Cc}/gu, ' ')}  received ${clock(ev.received)}  check ${step(ev.received, ev.time)}  queue ${step(ev.time, started)}  `
    + `overlay ${step(started, at)}  total ${step(ev.received, at)}  ${['OBS', 'browser'].includes(r.where) ? r.where : '?'}/${transport}`;
  console.log(`alert timing  ${ev.platform.padEnd(6)} ${line}`);
  logIncoming(ev.platform, 'timing', line);
  return line;
}

module.exports = { join, leave, skip, clear, remove, replay, pause, shown, state, feed: () => feed, events: alerts };
