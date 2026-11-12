// Viewers widget (/widgets/viewers/kick | twitch | total): how many people watch the channels of the Kick and Twitch
// accounts connected on the Connections page. Asked every 30 s, only while a viewers page is open (in OBS, or the
// panel's preview), and kept for the last 15 minutes (the Live chart style).
const { EventEmitter } = require('node:events');
const kickAccount = require('../connectors/kick-account');
const twitchAccount = require('../connectors/twitch-account');

const EVERY_MS = 30000;
const KEEP_MS = 15 * 60000;
const ACCOUNTS = { kick: kickAccount, twitch: twitchAccount };
const events = new EventEmitter();
// now: per platform { live, viewers }, null without an account. history: [time, Kick's, Twitch's], null where it wasn't live.
let now = { kick: null, twitch: null },
  history = [],
  timer = null,
  watching = 0;

const state = () => ({ ...now, history });

async function poll() {
  // A platform that doesn't answer this time keeps its last numbers (no "Offline" flash for one failed ask).
  const got = await Promise.all(Object.entries(ACCOUNTS).map(([p, a]) => a.stream().catch(() => now[p])));
  now = { kick: got[0], twitch: got[1] };
  const t = Date.now(),
    n = (s) => (s?.live ? s.viewers : null);
  history = [...history.filter((e) => e[0] > t - KEEP_MS), [t, n(now.kick), n(now.twitch)]];
  events.emit('change', state());
}

// A viewers page opened (+1) or closed (-1). The first one asks at once.
function watch(d) {
  watching += d;
  if (watching > 0 && !timer) {
    timer = setInterval(poll, EVERY_MS);
    timer.unref();
    poll();
  } else if (watching <= 0 && timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { state, watch, poll, events, EVERY_MS, KEEP_MS };
