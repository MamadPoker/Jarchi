// Internal event bus. Connectors (Kick, Twitch, test button) call emitEvent(); widgets only ever see what comes out of here.
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');

const TYPES = ['follow', 'sub', 'resub', 'gift_sub', 'kicks', 'bits', 'raid'];
const PLATFORMS = ['kick', 'twitch', 'test'];

const bus = new EventEmitter();

function emitEvent(e) {
  if (!PLATFORMS.includes(e.platform) || !TYPES.includes(e.type)) throw new Error(`bad event: ${e.platform}/${e.type}`);
  const ev = {
    id: randomUUID(),
    time: Date.now(),
    platform: e.platform,
    type: e.type,
    user: String(e.user ?? '').slice(0, 64),
    amount: Number(e.amount) || 0,
    months: Number(e.months) || 0,
    message: String(e.message ?? '').slice(0, 500),
    test: !!e.test, // so future widgets (leaderboard, recent events) can ignore test events
  };
  bus.emit('event', ev);
  return ev;
}

// Which platform accounts are connected. Connectors will call setConnected(); until then nothing is connected.
const connected = new Set();
function setConnected(platform, on) {
  if (!PLATFORMS.includes(platform)) throw new Error(`bad platform: ${platform}`);
  if (on) connected.add(platform);
  else connected.delete(platform);
  bus.emit('connections');
}
const connectedPlatforms = () => [...connected];

module.exports = { bus, emitEvent, setConnected, connectedPlatforms, TYPES, PLATFORMS };
