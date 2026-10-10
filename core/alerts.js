// Alert queue. The server decides what plays and when, and sends it to every open alerts overlay at once:
// - every overlay shows the same alert at the same time, in the same order, each alert once;
// - a refreshed overlay gets the alert that's playing now with the time it has left, so nothing replays;
// - while no overlay is open (OBS closed) alerts wait; an alert that ends with no overlay open goes back to the front.
// The panel can skip the current alert, clear the waiting ones, and pause / resume.
const { EventEmitter } = require('node:events');
const { bus } = require('./events');
const settings = require('./settings');

const STEPS = { gift_sub: [5, 20], kicks: [100, 1000], bits: [100, 1000] }; // as in widgets/alerts/alerts.js: bigger amounts play longer
const OUT_MS = 600; // the overlay's exit animation
const GRACE_MS = 3000; // the last overlay left less than this before the end: a refresh, the alert counts as seen
const MAX_WAITING = 200;

const alerts = new EventEmitter(); // 'play' ({ id, ev, seed, left }), 'skip' (id), 'state' (state())
const queue = []; // { id, ev, seed } — seed: one random number, so every overlay picks the same file from a tier
let playing = null; // { id, ev, seed, ms, started }
let busy = false; // an alert is playing, or it's the gap after one
let paused = false, overlays = 0, goneAt = 0, timer;

// How long an alert stays on screen (ms), before its exit animation.
function onScreenMs(ev) {
  const steps = STEPS[ev.type];
  const tier = steps ? 1 + steps.filter((n) => ev.amount >= n).length : 0;
  return (settings.get().alerts[ev.type].duration + (steps ? (tier - 1) * 1.5 : 0)) * 1000;
}

const state = () => ({
  paused,
  overlays,
  waiting: queue.length,
  now: playing && { type: playing.ev.type, user: playing.ev.user, amount: playing.ev.amount, platform: playing.ev.platform },
});
const changed = () => alerts.emit('state', state());
const current = () => playing && { id: playing.id, ev: playing.ev, seed: playing.seed, left: playing.ms - (Date.now() - playing.started) };

bus.on('event', (ev) => {
  const cfg = settings.get().alerts[ev.type];
  if (!ev.test && (!cfg.enabled || ev.amount < (cfg.minAmount ?? 0))) return; // test buttons always play
  queue.push({ id: ev.id, ev, seed: Math.random() });
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
  const { id, ev, seed } = playing;
  if (!overlays && Date.now() - goneAt > GRACE_MS) queue.unshift({ id, ev, seed }); // OBS was closed: play it again when it's back
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
function pause(on) {
  paused = !!on;
  next();
  return state();
}

module.exports = { join, leave, skip, clear, pause, state, events: alerts };
