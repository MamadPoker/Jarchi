// Secrets at rest, and out of the logs.
// The Kick and Twitch logins (their access and refresh tokens: the fields store.load / save are told) are sealed in the
// data folder with AES-256-GCM in the installed app. Its key comes from electron/main.js (random, kept in
// data/secrets.key encrypted by Electron safeStorage, i.e. Windows DPAPI: only this Windows user on this PC can read
// it) in JARCHI_SECRET_KEY, taken out of the environment at once so nothing Jarchi starts (reg, netstat) inherits it.
// Dev runs (npm start, npm run app, the tests) have no key: plain text, as before. A sealed value this run can't open
// (no key, or another key) is left out: that login reads as not connected, and the file stays as it is until the next
// login writes it.
// ponytail: settings.json would be rewritten on its next change, dropping a sealed field this run can't open; nothing
// in it is sealed yet. Keep unreadable sealed fields aside on save before sealing one there (Support's ticket token).
// redact(): a log line with every secret this run has seen, and anything token-like, blanked out (guardConsole()).
const crypto = require('node:crypto');
const util = require('node:util');

const raw = Buffer.from(process.env.JARCHI_SECRET_KEY ?? '', 'base64');
delete process.env.JARCHI_SECRET_KEY;
const KEY = raw.length === 32 ? raw : null;
const SEALED = 'enc:v1:';
const known = new Set(); // every secret value read or written in this run, for redact()
const remember = (v) => {
  if (typeof v === 'string' && v.length >= 8) known.add(v);
  return v;
};

// One value -> "enc:v1:<base64 of iv, auth tag, ciphertext>". Its field's name is bound in, so a value can't be moved
// to another field. open(): the value, or undefined when this run can't read it.
function seal(name, value, key = KEY) {
  remember(value);
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv).setAAD(Buffer.from(name));
  const body = Buffer.concat([c.update(value, 'utf8'), c.final()]);
  return SEALED + Buffer.concat([iv, c.getAuthTag(), body]).toString('base64');
}
function open(name, sealed, key = KEY) {
  if (!key) return undefined;
  try {
    const b = Buffer.from(sealed.slice(SEALED.length), 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12)).setAAD(Buffer.from(name)).setAuthTag(b.subarray(12, 28));
    return remember(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
  } catch {
    return undefined;
  }
}

// A data file's secret fields as read (store.load) -> { value, plain }: plain = some were still plain text (a file
// from before, or a dev run's), which store.load seals at once when this run has the key.
let told = false;
function openFields(data, fields, file) {
  const value = { ...data }, lost = [];
  let plain = false;
  for (const k of fields) {
    const v = value[k];
    if (typeof v !== 'string') continue;
    if (!v.startsWith(SEALED)) {
      plain = true;
      remember(v);
    } else if ((value[k] = open(k, v)) === undefined) {
      delete value[k];
      lost.push(k);
    }
  }
  if (lost.length) console.warn(`${file}: ${lost.join(', ')} sealed with ${KEY ? 'another key' : "the installed app's key"}, can't be read here: not connected`);
  if (plain && !KEY && !told) {
    told = true;
    console.log('Dev run (no key from the installed app): the Kick and Twitch logins stay unencrypted in the data folder');
  }
  return { value, plain };
}
// The same fields as written (store.save): sealed with the key, plain without it.
function sealFields(data, fields) {
  const out = { ...data };
  for (const k of fields) if (typeof out[k] === 'string') out[k] = KEY ? seal(k, out[k]) : remember(out[k]);
  return out;
}

// Authorization headers' values, and JSON / form / query fields named like a secret.
const AUTH = /\b(Bearer|OAuth|Basic)\s+[\w.~+/-]+=*/gi;
const FIELD = /(\b(?:access_token|refresh_token|id_token|device_code|client_secret|code_verifier|supportToken|password|secret|token|access|refresh)["']?\s*[:=]\s*["']?)[^\s"'&,;}]+/gi;
function redact(text) {
  let s = String(text);
  for (const v of known) s = s.replaceAll(v, '[redacted]');
  return s.replace(AUTH, '$1 [redacted]').replace(FIELD, '$1[redacted]');
}
// Every console line from here on goes out redacted (server/index.js, before anything else loads).
function guardConsole() {
  for (const m of ['log', 'info', 'warn', 'error', 'debug']) {
    const out = console[m].bind(console);
    console[m] = (...args) => out(redact(util.format(...args)));
  }
}

module.exports = { seal, open, openFields, sealFields, redact, guardConsole, on: !!KEY };
