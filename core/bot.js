// TheJarchi, Jarchi's chat bot (bot.jarchi.app, its own private repo): it thanks viewers in the streamer's Kick chat.
// Jarchi only tells it what happened (a follow, a sub, gifted subs, Kicks, a host); the bot writes the message and
// posts it as TheJarchi, so the streamer's Kick token never leaves this PC.
// Registering: the relay signs a ticket saying whose channel this Kick login is (kick-account botTicket), and the bot
// trades it for the channel's key (POST /v1/register). The key is sealed in data/bot.json with the installed app's key
// (core/secrets.js: Electron safeStorage), never written plain, logged or sent to the panel; a dev run keeps it in
// memory only. A key the bot stops taking (bad_key) is replaced by registering again, once.
// Events never wait for the bot: each is sent on its own with a short timeout, and one the bot can't take is dropped.
// Nothing at all goes out before the Privacy Policy is accepted (the ticket carries this install's id).
const path = require('node:path');
const { DATA_DIR, TEST } = require('./config');
const store = require('./store');
const secrets = require('./secrets');
const settings = require('./settings');
const stats = require('./stats');
const { bus } = require('./events');
const kickAccount = require('../connectors/kick-account');

// A test copy never reaches the real bot (like the relay, core/config.js TEST); a test's own fake one (JARCHI_BOT_URL) stays.
const WANTED = (process.env.JARCHI_BOT_URL || 'https://bot.jarchi.app').replace(/\/+$/, '');
const BOT = TEST && URL.canParse(WANTED) && new URL(WANTED).host === 'bot.jarchi.app' ? '' : WANTED;
// ponytail: only the owner's channel (and dev runs) until the bot runs on its final machine; then drop OWNER.
const OWNER = 'mamadpoker';
const FILE = path.join(DATA_DIR, 'bot.json');
const TYPES = ['follow', 'sub', 'gift_sub', 'kicks', 'raid']; // the bot's
const RETRY_MS = 10 * 60 * 1000; // an event with no key registers at most this often, so a bot that's down isn't asked at every one
// The errors the panel has words for (i18n errors.bot_<code>); any other is bot_failed. bad_text: field says why.
const ERRORS = ['blocked', 'paused', 'rate', 'bad_text'];
const failed = (status, code, field) => Object.assign(new Error(code), { status, code: `bot_${code}`, ...(field && { field }) });

let saved = store.load(FILE); // { channel: the slug the key is for, key: sealed, on: the main switch, modded: "I did it" }
let key = (typeof saved.key === 'string' && secrets.open('botKey', saved.key)) || null;
let error = ''; // why the last call failed (blocked stays until a call works), '' when fine
let tried = 0;

const me = () => {
  const { login } = kickAccount.status();
  return login ? kickAccount.slug(login) : '';
};
const allowed = () => !stats.INSTALLED || me() === OWNER;
const keyFor = () => (key && saved.channel === me() ? key : null); // another Kick account connected since: a new key

function keep(fields) {
  saved = { ...saved, ...fields };
  store.save(FILE, saved);
}

// One call to the bot -> its JSON. Registers first when there's no key for this channel. Throws failed().
async function call(method, p, body, again = true) {
  if (!BOT || !allowed()) throw failed(403, 'soon');
  if (!me()) throw failed(400, 'kick');
  if (!stats.accepted()) throw failed(403, 'privacy');
  if (!keyFor()) await register();
  let r;
  try {
    r = await fetch(`${BOT}${p}`, {
      method,
      headers: { authorization: `Bearer ${key}`, ...(body && { 'content-type': 'application/json' }) },
      body: body && JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw failed(502, 'offline');
  }
  const data = await r.json().catch(() => ({}));
  if (r.ok) return data;
  if (data.error === 'bad_key' && again) {
    key = null;
    return call(method, p, body, false);
  }
  throw failed(r.status === 400 ? 400 : 502, ERRORS.includes(data.error) ? data.error : 'failed', data.error === 'bad_text' && data.why);
}

// A ticket from the relay, then the channel's key from the bot. One at a time (two at once: the second's ticket ends the first's key).
let registering = null;
const register = () =>
  (registering ??= (async () => {
    let ticket;
    try {
      ticket = await kickAccount.botTicket(settings.installId());
    } catch (err) {
      throw failed(502, err.code === 'off' || err.code === 'expired' ? 'kick' : err.status === 429 ? 'rate' : err.status ? 'failed' : 'offline');
    }
    let r;
    try {
      r = await fetch(`${BOT}/v1/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ticket }),
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw failed(502, 'offline');
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok || typeof data.key !== 'string') throw failed(502, ['blocked', 'paused', 'rate'].includes(data.error) ? data.error : 'failed');
    key = data.key;
    keep({ channel: me(), key: secrets.on ? secrets.seal('botKey', key) : undefined });
    if (!secrets.on) console.warn("Dev run: the chat bot's key isn't saved (no key to seal it with), only kept until Jarchi quits");
  })().finally(() => (registering = null)));

// Every call from the panel or an event: its error kept for the page, cleared when one works.
const noted = (p) =>
  p.then(
    (v) => ((error = ''), v),
    (err) => {
      error = err.code?.slice(4) ?? 'failed';
      throw err;
    },
  );

// Jarchi's event -> the bot's ({ type, user, <its number> }), null for one it has no message for (Twitch's bits).
const whole = (n, min, max) => Math.min(max, Math.max(min, Math.round(Number(n) || 0)));
function eventOf(ev) {
  const { user } = ev;
  if (ev.type === 'follow') return { type: 'follow', user };
  if (ev.type === 'sub') return { type: 'sub', user, months: 1 };
  if (ev.type === 'resub') return { type: 'sub', user, months: whole(ev.months, 1, 1200) };
  if (ev.type === 'gift_sub') return { type: 'gift_sub', user, count: whole(ev.amount, 1, 1000) };
  if (ev.type === 'kicks') return { type: 'kicks', user, amount: whole(ev.amount, 1, 10_000_000) };
  if (ev.type === 'raid') return { type: 'raid', user, viewers: whole(ev.amount, 0, 10_000_000) };
  return null;
}

// Real Kick events while the main switch is on: sent, never awaited (the alert goes on at once), dropped when it fails.
bus.on('event', (ev) => {
  const e = !ev.test && ev.platform === 'kick' && ev.user && saved.on && error !== 'blocked' && eventOf(ev);
  if (!e || !BOT || !allowed()) return;
  if (!keyFor() && !registering) {
    if (Date.now() - tried < RETRY_MS) return;
    tried = Date.now();
  }
  noted(call('POST', '/v1/events', e)).catch(() => {});
});

// The Bot page: { allowed } only while it isn't open to this channel; else the switch, the notice, the bot's settings
// ({ on, texts, defaults, placeholders, textMax }, null when it couldn't be asked) and error (why not).
async function state() {
  if (!BOT || !allowed()) return { allowed: false };
  let bot = null;
  try {
    bot = await noted(call('GET', '/v1/settings'));
  } catch {}
  return { allowed: true, on: !!saved.on, modded: !!saved.modded, channel: me(), bot, error };
}
// The main switch: on registers (state() asks the bot) when there's no key yet.
async function setOn(on) {
  if (!allowed()) throw failed(403, 'soon');
  keep({ on: on === true });
  return state();
}
function setModded() {
  keep({ modded: true });
  return state();
}
// The thank-you messages' switches and texts ({ on?: { <type>: bool }, texts?: { <type>: text | null } }), as the bot takes them.
async function save(b) {
  await noted(call('PUT', '/v1/settings', { on: b?.on, texts: b?.texts }));
  return state();
}
// Send a test: one event of that type from the streamer's own name, through the bot like a real one -> { ok, skipped? }.
const SAMPLE = { sub: { months: 1 }, gift_sub: { count: 1 }, kicks: { amount: 100 }, raid: { viewers: 10 } };
async function test(type) {
  if (!TYPES.includes(type)) throw failed(400, 'failed');
  return noted(call('POST', '/v1/events', { type, user: kickAccount.status().login, ...SAMPLE[type] }));
}

module.exports = { state, setOn, setModded, save, test };
