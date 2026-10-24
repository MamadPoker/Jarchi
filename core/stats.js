// Usage stats, only after the current Privacy Policy (i18n/privacy.json) was accepted: a small ping to Jarchi's relay
// (relay/worker.mjs POST /ping) at start, every 5 minutes, when the policy is accepted and when Jarchi quits. It holds
// only: this install's random id, the connected Kick / Twitch channels (name, picture, live now), Jarchi's version,
// installed app or a dev run, open (false: the quit ping), and the policy version accepted and when. Nothing at all
// before it's accepted. A relay that can't be reached changes nothing: the next ping just tries again.
const settings = require('./settings');
const kickAccount = require('../connectors/kick-account');
const twitchAccount = require('../connectors/twitch-account');
const privacy = require('../i18n/privacy.json');
const { version } = require('../package.json');

const EVERY_MS = 5 * 60 * 1000;
const INSTALLED = process.env.JARCHI_INSTALLED === '1'; // electron/main.js says so in the installed app
const ACCOUNTS = { kick: kickAccount, twitch: twitchAccount };
const lastLive = { kick: null, twitch: null }; // the quit ping doesn't wait for Kick and Twitch: what they said last

const accepted = () => settings.get().privacyAccepted >= privacy.version;

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
