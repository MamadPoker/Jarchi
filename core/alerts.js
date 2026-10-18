// Alert queue. The server decides what plays and when, and sends it to every open alerts overlay at once:
// - every overlay shows the same alert at the same time, in the same order, each alert once;
// - a refreshed overlay gets the alert that's playing now with the time it has left, so nothing replays;
// - while no overlay is open (OBS closed) alerts wait; an alert that ends with no overlay open goes back to the front.
// The panel can skip the current alert, clear or remove waiting ones, pause / resume, and replay one of the last played
// or of the last events (the Home page's live feed).
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
const MAX_WAITING = 200, HISTORY = 10, FEED = 20;

const alerts = new EventEmitter(); // 'play' ({ id, ev, left }), 'skip' (id), 'state' (state())
const queue = []; // { id, ev }
const history = []; // the last played, newest first: { id, ev }
// The last events, newest first, also ones that didn't play (switched off, below the minimum). Kept in feed.json, so
// the Home page still has them after a restart.
const FEED_FILE = path.join(DATA_DIR, 'feed.json');
const savedFeed = store.load(FEED_FILE);
const feed = (Array.isArray(savedFeed) ? savedFeed : []).filter((e) => TYPES.includes(e?.type) && PLATFORMS.includes(e.platform)).slice(0, FEED);
let playing = null; // { id, ev, ms, started }
let busy = false; // an alert is playing, or it's the gap after one
let paused = false, overlays = 0, goneAt = 0, timer;

// How long an alert stays on screen (ms), before its exit animation.
function onScreenMs(ev) {
  const steps = STEPS[ev.type];
  const tier = steps ? 1 + steps.filter((n) => ev.amount >= n).length : 0;
  return (settings.get().alerts[ev.type].duration + (steps ? (tier - 1) * 1.5 : 0)) * 1000;
}

// What the panel shows: the alert on now (with its length and time left, for the progress bar), the waiting ones
// in order, and the last played.
const brief = ({ id, ev }) => ({ id, type: ev.type, user: ev.user, amount: ev.amount, months: ev.months, platform: ev.platform });
const current = () => playing && { id: playing.id, ev: playing.ev, left: playing.ms - (Date.now() - playing.started) };
const state = () => ({
  paused,
  overlays,
  waiting: queue.length,
  list: queue.map(brief),
  history: history.map(brief),
  now: playing && { ...brief(playing), ms: playing.ms, left: Math.max(0, current().left) },
});
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

function next() {
  if (!busy && !paused && overlays && queue.length) {
    busy = true;
    playing = { ...queue.shift(), started: Date.now() };
    playing.ms = onScreenMs(playing.ev);
    alerts.emit('play', current());
    timer = setTimeout(ended, playing.ms + OUT_MS);
  }
  changed();
}

function ended() {
  const { id, ev } = playing;
  if (!overlays && Date.now() - goneAt > GRACE_MS) queue.unshift({ id, ev }); // OBS was closed: play it again when it's back
  else played(playing);
  playing = null;
  rest(0);
}

// The gap between alerts, then the next one.
function rest(extraMs) {
  changed();
  timer = setTimeout(() => { busy = false; next(); }, extraMs + settings.get().alertGap * 1000);
}

// An alerts overlay connected: send it what's playing now (if enough is left to be worth showing), then go on.
function join(send) {
  const now = current();
  overlays++;
  if (now?.left > 1000) send({ ...now, late: true });
  next();
}
function leave() {
  overlays--;
  if (!overlays) goneAt = Date.now();
  changed();
}

function skip() {
  if (playing) {
    clearTimeout(timer);
    alerts.emit('skip', playing.id);
    played(playing);
    playing = null;
    rest(OUT_MS); // let the exit animation finish
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
  const at = Number(r?.shown);
  if (!playing || playing.id !== r?.id || playing.id !== playing.ev.id || !Number.isFinite(at)) return null;
  const { ev, started } = playing;
  const line = `${ev.type} ${ev.user.replace(/\p{Cc}/gu, ' ')}  received ${clock(ev.received)}  check ${step(ev.received, ev.time)}  queue ${step(ev.time, started)}  `
    + `overlay ${step(started, at)}  total ${step(ev.received, at)}  ${['OBS', 'browser'].includes(r.where) ? r.where : '?'}/${transport}`;
  console.log(`alert timing  ${ev.platform.padEnd(6)} ${line}`);
  logIncoming(ev.platform, 'timing', line);
  return line;
}

module.exports = { join, leave, skip, clear, remove, replay, pause, shown, state, feed: () => feed, events: alerts };
