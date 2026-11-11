// Jarchi Pay (donate.jarchi.app): the Crypto page. Jarchi Pay's code and keys are private and never in this repo; Jarchi
// only calls its public app API (Jarchi Pay's src/app.js lists it):
//   no token: POST /api/app/request (a one-time /connect link: the streamer opens it in the browser and signs in with
//   Kick or Twitch there, which says whose channel it is) and POST /api/app/status (none | pending | rejected |
//   approved; an approved request hands out its token once);
//   with the token: GET donations, GET wallets, POST wallets/link, POST wallets/cancel.
// The token is this install's key to its streamer's donations: sealed in data/pay.json with the installed app's key
// (core/secrets.js: Electron safeStorage), never written plain and never sent to the panel. A dev run has no key, so it
// keeps a new token only while it runs. Jarchi Pay learns this install's id, and nothing at all before the Privacy
// Policy is accepted (the policy covers that id).
// refresh(): at start, every 3 minutes and when the Crypto page opens. No token: the request's status. A token: the
// wallets (a 401 = the token was stopped: deactivated, or a newer one for that channel) -> back to the status.
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { DATA_DIR } = require('./config');
const store = require('./store');
const secrets = require('./secrets');
const settings = require('./settings');
const stats = require('./stats');

const PAY = process.env.JARCHI_PAY_URL || 'https://donate.jarchi.app';
const TERMS = '1'; // the request's terms (i18n panel.cryptoTerms): bump this when they change
const EVERY_MS = 3 * 60 * 1000;
const FILE = path.join(DATA_DIR, 'pay.json');
// Jarchi Pay's errors the panel has words for (i18n errors.crypto_<code>); any other is crypto_failed.
const ERRORS = ['pending', 'cooldown', 'disabled', 'rate', 'token', 'none'];
const failed = (status, code) => Object.assign(new Error(code), { status, code: `crypto_${code}` });
const events = new EventEmitter(); // 'state' -> the panel

let saved = store.load(FILE); // { channel, token: sealed }
let token = (typeof saved.token === 'string' && secrets.open('payToken', saved.token)) || null;
let state = { state: 'none' };

// A token from an approved request. Sealed on disk; a dev run (no key) keeps it in memory only.
function keep(t, channel) {
  token = t;
  saved = { channel, ...(secrets.on && { token: secrets.seal('payToken', t) }) };
  store.save(FILE, saved);
  if (!secrets.on) console.warn("Dev run: the Jarchi Pay token isn't saved (no key to seal it with), only kept until Jarchi quits");
}
function drop() {
  token = null;
  saved = {};
  store.save(FILE, saved);
}

// One call to Jarchi Pay -> its JSON (null for "204 done"). Throws { status, code } for the panel.
async function call(method, p, body) {
  if (!stats.accepted()) throw failed(403, 'privacy');
  const auth = p !== 'request' && p !== 'status';
  if (auth && !token) throw failed(401, 'token');
  let r;
  try {
    r = await fetch(`${PAY}/api/app/${p}`, {
      method, body: body && JSON.stringify(body), signal: AbortSignal.timeout(15000),
      headers: { ...(body && { 'content-type': 'application/json' }), ...(auth && { authorization: `Bearer ${token}` }) },
    });
  } catch {
    throw failed(502, 'offline');
  }
  if (r.status === 204) return null;
  const data = await r.json().catch(() => ({}));
  if (r.ok) return data;
  if (r.status === 401 && auth) drop();
  throw failed(r.status >= 500 ? 502 : 400, r.status === 401 ? 'token' : ERRORS.includes(data.error) ? data.error : 'failed');
}
// A one-time link from Jarchi Pay, opened in the streamer's browser: only ever one on Jarchi Pay's own site.
const link = (r) => {
  if (!URL.canParse(r?.url) || new URL(r.url).origin !== new URL(PAY).origin) throw failed(502, 'failed');
  return { url: r.url };
};

function set(s) {
  if (JSON.stringify(s) !== JSON.stringify(state)) events.emit('state', (state = s));
  return state;
}
// The page's state: { state: none | pending | rejected | active, ... }. lost: approved, but this run can't read its
// token (a dev run that quit, a key that changed): ask again. error: why the last ask failed (the state stays as it was).
async function ask() {
  if (!stats.accepted()) return set({ state: 'none' });
  try {
    if (token) {
      try {
        return set({ ...active(), wallets: await call('GET', 'wallets') });
      } catch (err) {
        if (token) return set({ ...active(), wallets: state.wallets ?? null, error: err.code }); // offline, disabled
      }
    }
    const s = await call('POST', 'status', { installId: settings.installId() });
    if (s.token) {
      keep(s.token, s.channel);
      return ask();
    }
    const { status, retryAt = null, reason = null } = s;
    return set(status === 'approved' ? { state: 'none', lost: true } : status === 'rejected' ? { state: status, retryAt, reason } : { state: status });
  } catch (err) {
    const { error, ...was } = state;
    return set({ ...was, error: err.code });
  }
}
// page: the streamer's donation page on Jarchi Pay.
const active = () => ({ state: 'active', channel: saved.channel, page: `${PAY}/${saved.channel}` });
// One ask at a time: two at once could both see "approved", and only the first gets the token.
let busy;
const refresh = () => (busy ??= ask().finally(() => (busy = null)));

// accept: the streamer ticked "I accept" under the terms (the panel's request dialog).
const request = async (accept) => {
  if (accept !== true) throw failed(400, 'failed');
  return link(await call('POST', 'request', { installId: settings.installId(), termsVersion: TERMS, acceptTerms: true }));
};
// The page's list: newest first, a page at a time (cursor), with the totals since today / week (ms, the panel's time zone).
function donations(q) {
  const p = new URLSearchParams();
  for (const k of ['cursor', 'today', 'week']) if (typeof q[k] === 'string' && q[k]) p.set(k, q[k]);
  return call('GET', `donations?${p}`);
}
const walletLink = async () => link(await call('POST', 'wallets/link'));
const cancelChange = async () => (await call('POST', 'wallets/cancel'), refresh());

function start() {
  refresh();
  setInterval(refresh, EVERY_MS).unref();
}

module.exports = { start, refresh, now: () => state, request, donations, walletLink, cancelChange, events, PAY };
