// Jarchi Battle (battle.jarchi.app): the Song Battle page. Jarchi Battle's code is in its own repo; Jarchi only calls
// its app API (that repo's README lists it):
//   no key: POST /api/app/request (a one-time /connect link: the streamer opens it in the browser and signs in with
//   Kick or Twitch there, which says whose channel it is) and POST /api/app/status (none | pending | connected; the
//   first connected answer hands out the key, once);
//   with the key: a new battle, the current one (all of it, after a restart), its song feed, the streamer's own song,
//   taking a song out, start and cancel.
// The key is sealed in data/battle.json like the Kick and Twitch logins (core/store.js), and never sent to the panel.
// Nothing goes to Jarchi Battle before the Privacy Policy is accepted (it learns this install's id) or before the
// streamer presses Connect. No timers here: the panel asks while its page is open (the state every 2.5 s while a link
// waits, the song feed every 3 s while a battle collects), so a forgotten battle costs Jarchi Battle nothing.
const path = require('node:path');
const { DATA_DIR } = require('./config');
const store = require('./store');
const settings = require('./settings');
const stats = require('./stats');

const BATTLE = process.env.JARCHI_BATTLE_URL || 'https://battle.jarchi.app';
const FILE = path.join(DATA_DIR, 'battle.json');
const SECRET = ['key'];
// Jarchi Battle's errors the panel has words for (i18n errors.battle_<code>); any other is battle_failed.
// not_found: that battle or song isn't there any more; the rest are a song's (link, source, notfound, limit, full,
// closed, service) or a setting's (bad, with the field).
const ERRORS = ['rate', 'key', 'state', 'bad', 'link', 'source', 'notfound', 'limit', 'full', 'closed', 'service', 'not_found'];
const failed = (status, code) => Object.assign(new Error(code), { status, code: `battle_${code}` });

// The setup on the page, kept for the next battle. Jarchi Battle takes all of it but voting (the battle screen's: chat
// votes 1 or 2, or the streamer picks) and mods (moderators on or off; the list stays either way).
const SOURCES = ['youtube', 'spotify', 'soundcloud'];
const SETUP = {
  topic: '',
  size: 8,
  perViewer: 1,
  sources: SOURCES,
  voting: 'chat',
  signIn: true,
  showNames: false,
  blurCovers: false,
  hideTitles: false,
  mods: false,
  moderators: [],
};
const bool = (v) => typeof v === 'boolean';
const RULES = {
  topic: (v) => typeof v === 'string' && [...v].length <= 100,
  size: (v) => [4, 8, 16, 32, 64, 128].includes(v),
  perViewer: (v) => [1, 2, 3].includes(v),
  sources: (v) => Array.isArray(v) && v.length > 0 && v.every((s) => SOURCES.includes(s)) && new Set(v).size === v.length,
  voting: (v) => ['chat', 'me'].includes(v),
  signIn: bool,
  showNames: bool,
  blurCovers: bool,
  hideTitles: bool,
  mods: bool,
  moderators: (v) =>
    Array.isArray(v) &&
    v.length <= 50 &&
    v.every((m) => ['kick', 'twitch'].includes(m?.platform) && typeof m.username === 'string' && /^[\w-]{1,30}$/.test(m.username)),
};

let saved = store.load(FILE, SECRET); // { key, channel, platform, setup }
const keep = (fields) => store.save(FILE, (saved = { ...saved, ...fields }), SECRET);
let link = null, // the one-time link waiting for the streamer: { url, expiresAt }
  lost = false, // connected, but the key went to a run that can't read it now: connect again
  error = null, // why the last ask failed
  battle = null; // the battle that hasn't finished: { id, status, topic, settings, createdAt, songs, cursor }

const setup = () => ({ ...SETUP, ...Object.fromEntries(Object.entries(saved.setup ?? {}).filter(([k, v]) => RULES[k]?.(v))) });
// What the panel gets. page: the streamer's battle page, the same link for every battle.
function now() {
  const on = !!saved.key;
  return {
    state: on ? 'connected' : link ? 'pending' : 'none',
    ...(on && { channel: saved.channel, platform: saved.platform, page: `${BATTLE}/${saved.channel}` }),
    battle: on ? battle : null,
    setup: setup(),
    ...(lost && { lost }),
    ...(error && { error }),
  };
}

// One call to Jarchi Battle -> its JSON (null for "204 done"). Throws { status, code, field? } for the panel.
async function call(method, p, body) {
  if (!stats.accepted()) throw failed(403, 'privacy');
  const auth = p !== 'request' && p !== 'status';
  if (auth && !saved.key) throw failed(401, 'key');
  let r;
  try {
    r = await fetch(`${BATTLE}/api/app/${p}`, {
      method,
      body: body && JSON.stringify(body),
      signal: AbortSignal.timeout(15000), // a slow Jarchi Battle: offline, never a request left hanging
      headers: { ...(body && { 'content-type': 'application/json' }), ...(auth && { authorization: `Bearer ${saved.key}` }) },
    });
  } catch {
    throw failed(502, 'offline');
  }
  if (r.status === 204) return null;
  const data = await r.json().catch(() => ({}));
  if (r.ok) return data;
  if (r.status === 401 && auth) {
    keep({ key: undefined }); // stopped: a newer connection for this channel, or deactivated
    battle = null;
    lost = true;
  }
  const err = failed(r.status >= 500 ? 502 : r.status, r.status === 401 ? 'key' : ERRORS.includes(data.error) ? data.error : 'failed');
  throw Object.assign(err, typeof data.field === 'string' && /^\w{1,30}$/.test(data.field) && { field: data.field });
}

// A battle from Jarchi Battle (battles/current) as the panel shows it; songs oldest first.
const sorted = (songs) => songs.filter((s) => !s.removed).sort((a, b) => a.sentAt - b.sentAt);
function took(b) {
  battle = b && {
    id: b.id,
    status: b.status,
    topic: b.topic,
    settings: b.settings,
    createdAt: b.createdAt,
    songs: sorted(b.songs ?? []),
    cursor: b.cursor ?? 0,
  };
}

async function ask() {
  error = null;
  if (!stats.accepted()) return now();
  try {
    if (!saved.key && link) {
      if (link.expiresAt <= Date.now()) link = null;
      else {
        const s = await call('POST', 'status', { installId: settings.installId() });
        if (s.status !== 'pending') link = null;
        if (s.key) keep({ key: s.key, channel: s.channel, platform: s.platform });
        else if (s.status === 'connected') lost = true;
      }
    }
    if (saved.key) {
      lost = false;
      took((await call('GET', 'battles/current')).battle);
    }
  } catch (err) {
    error = err.code === 'battle_key' ? null : err.code; // a stopped key: lost says so
  }
  return now();
}
// One ask at a time: two at once could both see "connected", and only the first gets the key.
let busy;
const refresh = () => (busy ??= ask().finally(() => (busy = null)));

// Connect: a one-time link on Jarchi Battle's own site, for the panel to open in the browser.
async function request() {
  const r = await call('POST', 'request', { installId: settings.installId() });
  if (!URL.canParse(r?.url) || new URL(r.url).origin !== new URL(BATTLE).origin) throw failed(502, 'failed');
  link = { url: r.url, expiresAt: Number(r.expiresAt) || Date.now() + 15 * 60000 };
  lost = false;
  return { url: r.url };
}

// The setup changed on the page: the fields sent replace the saved ones. One bad field: nothing changes.
function update(patch) {
  if (!patch || typeof patch !== 'object' || Object.entries(patch).some(([k, v]) => !RULES[k]?.(v)))
    throw Object.assign(new Error('bad_request'), { status: 400, code: 'bad_request' });
  keep({ setup: { ...setup(), ...patch } });
  return now();
}

// A battle's call: one that finds the battle moved on (409) or gone (404) first takes the battle as it is now.
async function onBattle(method, p, body) {
  if (!battle) throw failed(409, 'state');
  try {
    return await call(method, `battles/${battle.id}${p}`, body);
  } catch (err) {
    if (['battle_state', 'battle_not_found'].includes(err.code)) await refresh();
    throw err;
  }
}

// A new battle with this setup (saved for the next one too), collecting songs. It cancels an earlier one that hasn't
// finished, on Jarchi Battle's side.
async function create(patch) {
  update(patch ?? {});
  const s = setup();
  if (!s.topic.trim()) throw Object.assign(failed(400, 'bad'), { field: 'topic' });
  await call('POST', 'battles', {
    topic: s.topic.trim(),
    size: s.size,
    perViewer: s.perViewer,
    sources: s.sources,
    signIn: s.signIn,
    showNames: s.showNames,
    blurCovers: s.blurCovers,
    hideTitles: s.hideTitles,
    moderators: s.mods ? s.moderators : [],
  });
  return refresh();
}

// The song feed: every song changed since the last ask (new, taken out, its similar mark), merged by id.
let feeding;
async function pull() {
  if (!battle || !['collecting', 'closed'].includes(battle.status)) return now();
  const { id, cursor } = battle,
    r = await onBattle('GET', `/songs?since=${cursor}`);
  if (battle?.id !== id) return now(); // cancelled, or a new battle, meanwhile
  const songs = new Map(battle.songs.map((s) => [s.id, s]));
  for (const s of r.songs ?? []) songs.set(s.id, s);
  battle = { ...battle, songs: sorted([...songs.values()]), cursor: Number.isInteger(r.cursor) ? r.cursor : cursor };
  return now();
}
const feed = () => (feeding ??= pull().finally(() => (feeding = null)));

// The streamer's own song (a pasted link), with the same limits as everyone's.
async function add(songLink) {
  if (typeof songLink !== 'string' || !songLink.trim() || songLink.length > 500) throw failed(400, 'link');
  const s = await onBattle('POST', '/songs', { link: songLink.trim() });
  if (battle && !battle.songs.some((x) => x.id === s.id)) battle = { ...battle, songs: sorted([...battle.songs, s]) };
  return now();
}
async function remove(id) {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) throw failed(404, 'not_found');
  await onBattle('DELETE', `/songs/${id}`);
  if (battle) battle = { ...battle, songs: battle.songs.filter((s) => s.id !== id) };
  return now();
}

// Start: no new songs, the battle is on (the battle screen takes it from here). Two songs at least.
async function start() {
  if (battle && battle.songs.length < 2) throw failed(409, 'few');
  await onBattle('POST', '/start');
  battle = { ...battle, status: 'live' };
  return now();
}
// Cancel: the battle stops; the page goes back to the one before it.
async function cancel() {
  await onBattle('POST', '/cancel');
  battle = null;
  return now();
}

module.exports = { now, refresh, request, update, create, feed, add, remove, start, cancel, BATTLE };
