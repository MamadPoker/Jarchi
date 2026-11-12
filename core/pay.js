// Jarchi Pay (donate.jarchi.app): the Crypto page. Jarchi Pay's code and keys are private and never in this repo; Jarchi
// only calls its public app API (Jarchi Pay's src/app.js lists it):
//   no token: POST /api/app/request (a one-time /connect link: the streamer opens it in the browser and signs in with
//   Kick or Twitch there, which says whose channel it is) and POST /api/app/status (none | pending | rejected |
//   approved; an approved request hands out its token once);
//   with the token: GET donations, GET donations/new (the crypto alerts), GET wallets, POST wallets/link, POST wallets/cancel,
//   GET / PUT page (the donation page's look), PUT / DELETE page/avatar | page/banner.
// The token is this install's key to its streamer's donations: sealed in data/pay.json with the installed app's key
// (core/secrets.js: Electron safeStorage), never written plain and never sent to the panel. A dev run has no key, so it
// keeps a new token only while it runs. Jarchi Pay learns this install's id, and nothing at all before the Privacy
// Policy is accepted (the policy covers that id).
// refresh(): at start, every 10 minutes and when the Crypto page opens. No token: the request's status. A token: the
// wallets (a 401 = the token was stopped: deactivated, or a newer one for that channel) -> back to the status.
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const { DATA_DIR } = require('./config');
const store = require('./store');
const secrets = require('./secrets');
const settings = require('./settings');
const stats = require('./stats');

const PAY = process.env.JARCHI_PAY_URL || 'https://donate.jarchi.app';
const TERMS = '1'; // the request's terms (i18n panel.cryptoTerms): bump this when they change
const EVERY_MS = 10 * 60 * 1000;
const FILE = path.join(DATA_DIR, 'pay.json');
// Jarchi Pay's errors the panel has words for (i18n errors.crypto_<code>); any other is crypto_failed.
// bad: a page field that isn't right (field: which one, for the panel to mark); size / type: a picture's.
const ERRORS = ['pending', 'cooldown', 'disabled', 'rate', 'token', 'none', 'bad', 'size', 'type'];
const failed = (status, code) => Object.assign(new Error(code), { status, code: `crypto_${code}` });
const events = new EventEmitter(); // 'state' -> the panel; 'donation' (an alert's event) -> the alert queue

let saved = store.load(FILE); // { channel, token: sealed, cursor (the alert queue's, below) }
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

// One call to Jarchi Pay -> its JSON (null for "204 done"). body: JSON, or a Buffer (a picture) as it is. Throws
// { status, code, field? } for the panel.
async function call(method, p, body) {
  if (!stats.accepted()) throw failed(403, 'privacy');
  const auth = p !== 'request' && p !== 'status';
  if (auth && !token) throw failed(401, 'token');
  const bytes = Buffer.isBuffer(body);
  let r;
  try {
    r = await fetch(`${PAY}/api/app/${p}`, {
      method,
      body: /** @type {BodyInit} */ (bytes ? body : body && JSON.stringify(body)), // a Buffer works; its type says SharedArrayBuffer might not signal: AbortSignal.timeout(bytes ? 60000 : 15000),
      headers: { ...(body && { 'content-type': bytes ? 'application/octet-stream' : 'application/json' }), ...(auth && { authorization: `Bearer ${token}` }) },
    });
  } catch {
    throw failed(502, 'offline');
  }
  if (r.status === 204) return null;
  const data = await r.json().catch(() => ({}));
  if (r.ok) return data;
  if (r.status === 401 && auth) drop();
  const err = failed(r.status >= 500 ? 502 : 400, r.status === 401 ? 'token' : ERRORS.includes(data.error) ? data.error : 'failed');
  throw Object.assign(err, typeof data.field === 'string' && /^[\w.]{1,30}$/.test(data.field) && { field: data.field });
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

// The donation page's look: { bio, socials, links, avatar, banner: { url, custom } }. bio: one line for both languages
// ('' = Jarchi Pay's own); socials: an id each (Jarchi Pay makes the link on the platform's own site; website: a full
// https URL). savePage: what it's given replaces what's there. A picture: PNG, JPG or WebP up to 2 MB (looked at here
// first, then by Jarchi Pay; 10 an hour); reset: the channel's own picture again.
const PICTURES = ['avatar', 'banner'],
  PICTURE_MAX = 2 * 1024 * 1024;
const page = () => call('GET', 'page');
const savePage = (b) => call('PUT', 'page', { bio: b?.bio, socials: b?.socials });
const picture = (kind) => {
  if (!PICTURES.includes(kind)) throw failed(400, 'failed');
  return `page/${kind}`;
};
async function setPicture(kind, buf) {
  const p = picture(kind);
  if (!Buffer.isBuffer(buf) || !['png', 'jpg', 'webp'].includes(settings.sniff(buf))) throw failed(400, 'type');
  if (buf.length > PICTURE_MAX) throw failed(400, 'size');
  return call('PUT', p, buf).catch((err) => {
    throw err.code === 'crypto_rate' ? failed(429, 'uploads') : err; // 10 an hour
  });
}
const resetPicture = async (kind) => call('DELETE', picture(kind));

// ---------- Crypto alerts: new donations ----------
// A donation -> its alert's event (core/alerts.js push, widgets/alerts): name ('' = anonymous: the donor hid it), the
// amount as Jarchi Pay wrote it, network, message (never a private one: it's for the streamer only, never on stream),
// the transaction, and from = the platform the donor signed in with. test: the Crypto page's tests; look: the one to
// play (tests), else the settings pick it when it starts.
const alertOf = (d, test = false, look = undefined) => ({
  id: `crypto-${randomUUID()}`,
  type: 'crypto',
  platform: 'crypto',
  time: Date.now(),
  received: Date.now(),
  test,
  from: ['kick', 'twitch'].includes(d?.platform) ? d.platform : null,
  user: typeof d?.name === 'string' ? d.name.slice(0, 64) : '',
  amount: /^\d{1,9}(\.\d{1,4})?$/.test(d?.amount) ? d.amount : '0',
  network: d?.network === 'trc20' ? 'trc20' : 'bep20',
  message: d?.private || typeof d?.message !== 'string' ? '' : d.message.slice(0, 500),
  txHash: typeof d?.txHash === 'string' && /^\w{1,100}$/.test(d.txHash) ? d.txHash : null,
  ...(typeof look === 'string' && /^[\w-]{1,16}$/.test(look) && { look }),
});

// While the gateway is active: every 20 s (Jarchi Pay looks at the chains once a minute), the donations paid after the
// cursor (Jarchi Pay's /donations/new, in the order it found them), each one an alert. The cursor is kept in pay.json,
// so a restart never plays one again; the first ask (no cursor yet) only takes the cursor, so nothing from before
// plays. One paid over 10 minutes ago (Jarchi was closed then) is skipped, as Jarchi Pay's own overlay does.
const NEW_MS = 20 * 1000,
  LATE_MS = 10 * 60 * 1000;
let polling = false;
async function pollNew() {
  if (!token || state.state !== 'active' || polling || !stats.accepted()) return;
  polling = true;
  try {
    const r = await call('GET', `donations/new${Number.isInteger(saved.cursor) ? `?since=${saved.cursor}` : ''}`);
    if (!token || !Number.isInteger(r?.cursor)) return;
    saved = { ...saved, cursor: r.cursor };
    store.save(FILE, saved);
    for (const d of r.donations ?? []) if (Date.now() - d.paidAt < LATE_MS) events.emit('donation', alertOf(d));
  } catch (err) {
    if (err.code === 'crypto_token') refresh(); // stopped: the page goes back to not active now
  } finally {
    polling = false;
  }
}

function start() {
  refresh();
  setInterval(refresh, EVERY_MS).unref();
  setInterval(pollNew, NEW_MS).unref();
}

module.exports = {
  start,
  refresh,
  pollNew,
  alertOf,
  now: () => state,
  request,
  donations,
  walletLink,
  cancelChange,
  page,
  savePage,
  setPicture,
  resetPicture,
  events,
  PAY,
};
