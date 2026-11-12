// Team messages: what Jarchi's team writes in Jarchi Admin, shown as cards on the panel's Home page (never in OBS: only
// the panel's sockets get them, server/index.js). From the relay as its answer to each usage ping (core/stats.js,
// relay/worker.mjs POST /ping?messages=1), so only once the Privacy Policy is accepted: at start and every 3 minutes.
// The relay sends this install's own only (by its id, version, and installed app or dev run, as the ping says). A closed one is
// remembered here too (data/messages.json), so it never comes back, even closed offline: the relay is told again the
// next time it sends it.
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { DATA_DIR } = require('./config');
const store = require('./store');
const settings = require('./settings');
const stats = require('./stats');
const { RELAY } = require('../connectors/kick-account');
const { version } = require('../package.json');

const FILE = path.join(DATA_DIR, 'messages.json');
const events = new EventEmitter(); // 'change' (the list) -> the panel
const closed = new Set(store.load(FILE).closed ?? []);
let list = [];

const set = (l) => events.emit('change', (list = l));
// seen | closed -> told the relay (false: offline, or the relay doesn't have it any more).
const mark = (id, what) => fetch(`${RELAY}/messages/${id}/${what}?version=${encodeURIComponent(version)}&installed=${stats.INSTALLED ? 1 : 0}`, {
  method: 'POST', headers: { 'x-jarchi-install': settings.installId() }, signal: AbortSignal.timeout(15000),
}).then((r) => r.ok, () => false);

// A ping the relay didn't answer (offline, refused) brings nothing: what we had stays.
stats.events.on('messages', (got) => {
  if (!Array.isArray(got)) return;
  for (const m of got) if (closed.has(m.id)) mark(m.id, 'closed');
  set(got.filter((m) => !closed.has(m.id)));
});

// The panel showed it (on Home): the relay counts it once. Offline: the next ping brings it unseen, shown = told again.
function seen(id) {
  const m = list.find((x) => x.id === id);
  if (!m) return false;
  if (!m.seen) {
    m.seen = true;
    set(list);
    mark(id, 'seen');
  }
  return true;
}

// ✕ on its card: gone for good, here at once and on the relay when it can be reached.
function close(id) {
  if (!list.some((m) => m.id === id)) return false;
  closed.add(id);
  store.save(FILE, { closed: [...closed] });
  set(list.filter((m) => m.id !== id));
  mark(id, 'closed');
  return true;
}

module.exports = { seen, close, list: () => list, events };
