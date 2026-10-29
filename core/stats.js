// Usage stats, only after the current Privacy Policy (i18n/privacy.json) was accepted: a small ping to Jarchi's relay
// (relay/worker.mjs POST /ping) at start, every 5 minutes, when the policy is accepted and when Jarchi quits. It holds
// only: this install's random id, the connected Kick / Twitch channels (name, picture, live now), Jarchi's version,
// installed app or a dev run, open (false: the quit ping), and the policy version accepted and when. Nothing at all
// before it's accepted. A relay that can't be reached changes nothing: the next ping just tries again.
// diag, only once a policy that names it (DIAG_SINCE on) is accepted: codes, never error texts, addresses or links.
// kick / twitch: never (Connect never pressed) | ok | failed, with kickReason / twitchReason when failed (else null):
// network (couldn't reach it, timed out), denied (the streamer said no or cancelled) or other; proxy: the proxy mode
// (off | auto | manual); vpn: whether the VPN app finder (core/vpn.js) found a proxy, null when it hasn't looked.
const settings = require('./settings');
const vpn = require('./vpn');
const kickAccount = require('../connectors/kick-account');
const twitchAccount = require('../connectors/twitch-account');
const privacy = require('../i18n/privacy.json');
const { version } = require('../package.json');

const EVERY_MS = 5 * 60 * 1000;
const DIAG_SINCE = 2; // the Privacy Policy version (i18n/privacy.json) that names connection status and error types
const INSTALLED = process.env.JARCHI_INSTALLED === '1'; // electron/main.js says so in the installed app
const ACCOUNTS = { kick: kickAccount, twitch: twitchAccount };
const lastLive = { kick: null, twitch: null }; // the quit ping doesn't wait for Kick and Twitch: what they said last

const accepted = () => settings.get().privacyAccepted >= privacy.version;

// What each Connect came to, kept (settings.connectState) from the account's status: connected = ok; an error = why
// it failed or keeps failing (expired, relay, client: other); Connect pressed (waiting) = tried, other until it ends;
// cancelled while waiting = denied.
const WHY = { denied: 'denied', network: 'network', timeout: 'network' };
const was = {};
for (const [p, account] of Object.entries(ACCOUNTS)) {
  account.events.on('status', ({ state, error }) => {
    const before = was[p];
    was[p] = state;
    if (state === 'connected') settings.setConnectState(p, 'ok');
    else if (error) settings.setConnectState(p, WHY[error] ?? 'other');
    else if (state === 'waiting' && settings.connectState(p) === 'never') settings.setConnectState(p, 'other');
    else if (state === 'off' && before === 'waiting') settings.setConnectState(p, 'denied');
  });
}

function diag() {
  const [kick, twitch] = ['kick', 'twitch'].map(settings.connectState);
  const failed = (s) => (s === 'never' || s === 'ok' ? null : s);
  return {
    kick: failed(kick) ? 'failed' : kick, kickReason: failed(kick), twitch: failed(twitch) ? 'failed' : twitch, twitchReason: failed(twitch),
    proxy: settings.get().proxyMode, vpn: vpn.looked(),
  };
}

// A connected account -> { name, picture, live }, none -> null. fresh: ask the platform whether the channel is live.
async function channel(p, fresh) {
  const { login, picture } = ACCOUNTS[p].status();
  if (!login) {
    lastLive[p] = null;
    return null;
  }
  if (fresh) lastLive[p] = await ACCOUNTS[p].live();
  return { name: login, picture: picture || '', live: lastLive[p] };
}

async function payload(open) {
  const [kick, twitch] = await Promise.all([channel('kick', open), channel('twitch', open)]);
  return {
    id: settings.installId(), version, installed: INSTALLED, open, kick, twitch,
    privacy: { version: settings.get().privacyAccepted, acceptedAt: settings.privacyAcceptedAt() },
    ...(settings.get().privacyAccepted >= DIAG_SINCE && { diag: diag() }),
  };
}

// open false: the quit ping, quick (Jarchi is closing).
async function ping(open = true) {
  if (!accepted()) return;
  try {
    await fetch(`${kickAccount.RELAY}/ping`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(await payload(open)), signal: AbortSignal.timeout(open ? 10000 : 2000),
    });
  } catch {} // offline, or no relay: the next one
}

function start() {
  ping();
  setInterval(ping, EVERY_MS).unref();
}

module.exports = { start, ping, accepted };
