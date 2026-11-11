// Exclusive chat designs: chat looks a code from Jarchi's team unlocks for this install. They live only on the relay
// (relay/worker.mjs "Exclusive chat designs"), never in this repo. A code is redeemed from the panel (its hidden 👀,
// Ctrl+Shift+E); the design then comes from the relay, for this install only, and is kept in data/designs/<id>.json so
// it works offline. At start (once the Privacy Policy is accepted: the relay only knows installs that have pinged) this
// install's designs are downloaded again, so a fixed design arrives by itself.
// A design is a chat look's values (checked like any chat setting, core/settings.js addChatDesign) and CSS: never a
// script, and the CSS is checked here before it's used (cssOk). Each one is a chat style; the panel marks it Exclusive.
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { DATA_DIR } = require('./config');
const store = require('./store');
const settings = require('./settings');
const stats = require('./stats');
const { RELAY } = require('../connectors/kick-account');

const DIR = path.join(DATA_DIR, 'designs');
const ID = /^x-[a-z0-9-]{1,30}$/;
const CSS_MAX = 200 * 1024;
const events = new EventEmitter(); // 'change' -> the panel (its chat styles)
const mine = new Map(); // id -> { id, name: { en, fa }, css }
const failed = (status, code) => Object.assign(new Error(code), { status, code: `designs_${code}` });

// CSS that can only draw: no @import, no escapes (a backslash could spell anything), nothing that runs or loads from
// elsewhere; url() only to Jarchi's own /assets or a data: image or font.
const URL_OK = /url\(\s*(["']?)(\/assets\/(?:[\w-]+\/)*[\w-]+(?:\.[\w-]+)*|data:(?:image|font)\/[\w.+-]+;base64,[A-Za-z0-9+/=]+)\1\s*\)/gi;
const cssOk = (css) => typeof css === 'string' && css.length <= CSS_MAX && !/[\\<]|@import|expression\s*\(|javascript:|behavior\s*:|-moz-binding/i.test(css)
  && !/url\(|image-set\(|src\(/i.test(css.replace(URL_OK, ''));
const nameOk = (n) => !!n && ['en', 'fa'].every((k) => typeof n[k] === 'string' && n[k].trim() && n[k].length <= 40 && !/[<>]/.test(n[k]));

// A design (from the relay or from disk) -> kept and a chat style; false: not one Jarchi takes.
function use(d) {
  if (!d || !ID.test(d.id) || !nameOk(d.name) || !cssOk(d.css) || !settings.addChatDesign(d.id, d.look)) return false;
  mine.set(d.id, { id: d.id, name: { en: d.name.en, fa: d.name.fa }, css: d.css });
  return true;
}
if (fs.existsSync(DIR)) for (const f of fs.readdirSync(DIR)) if (f.endsWith('.json')) use(store.load(path.join(DIR, f)));

const ask = (p, method = 'GET', body = undefined) => fetch(`${RELAY}/designs${p}`, {
  method, body: body && JSON.stringify(body), signal: AbortSignal.timeout(15000),
  headers: { 'x-jarchi-install': settings.installId(), ...(body && { 'content-type': 'application/json' }) },
});
// One of this install's designs from the relay, kept. false: not there, or not one Jarchi takes.
async function download(id) {
  const r = await ask(`/${id}`);
  const d = r.ok && (await r.json());
  if (d?.id !== id || !use(d)) return false;
  fs.mkdirSync(DIR, { recursive: true });
  store.save(path.join(DIR, `${id}.json`), { id, name: d.name, look: d.look, css: d.css });
  return true;
}

// The code the streamer typed -> { id, name }: that design is this install's now, here and on the relay.
async function redeem(code) {
  if (!stats.accepted()) throw failed(403, 'privacy');
  if (typeof code !== 'string' || !/^[\w -]{4,20}$/.test(code.trim())) throw failed(400, 'bad_code');
  let r;
  try {
    r = await ask('/redeem', 'POST', { code: code.trim() });
  } catch {
    throw failed(502, 'offline');
  }
  const b = await r.json().catch(() => ({}));
  if (r.status === 429) throw failed(429, 'rate');
  if (!r.ok) throw failed(400, b.error === 'bad_code' ? 'bad_code' : 'failed');
  if (!ID.test(b.id) || !(await download(b.id).catch(() => false))) throw failed(502, 'failed');
  events.emit('change');
  return { id: b.id, name: mine.get(b.id).name };
}

// At start: this install's designs again (a new or fixed one, or a data folder that lost them). Offline: what's kept.
async function sync() {
  if (!stats.accepted()) return;
  try {
    const r = await ask('');
    const list = r.ok ? await r.json() : [];
    let got = false;
    for (const d of Array.isArray(list) ? list : []) if (ID.test(d?.id) && (await download(d.id))) got = true;
    if (got) events.emit('change');
  } catch {}
}

const names = () => Object.fromEntries([...mine.values()].map((d) => [d.id, d.name]));
const css = (id) => mine.get(id)?.css ?? null;

module.exports = { redeem, sync, names, css, cssOk, events };
