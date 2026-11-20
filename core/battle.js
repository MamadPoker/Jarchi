// Jarchi Battle (battle.jarchi.app): the Song Battle page. Jarchi Battle's code is in its own repo; Jarchi only calls
// its app API (that repo's README lists it):
//   no key: POST /api/app/request (a one-time /connect link: the streamer opens it in the browser and signs in with
//   Kick or Twitch there, which says whose channel it is) and POST /api/app/status (none | pending | connected; the
//   first connected answer hands out the key, once);
//   with the key: a new battle, the current one (all of it, after a restart), its song feed, the streamer's own song,
//   taking a song out, start, the live state (live), finish and cancel.
// The key is sealed in data/battle.json like the Kick and Twitch logins (core/store.js), and never sent to the panel.
// Nothing goes to Jarchi Battle before the Privacy Policy is accepted (it learns this install's id) or before the
// streamer presses Connect. Until a battle is live the panel asks while its page is open (the state every 2.5 s while a
// link waits, the song feed every 3 s while a battle collects), so a forgotten battle costs Jarchi Battle nothing; a live
// one is saved there only when something on the battle screen changes.
// Once a battle is live, its matches are run here: the bracket, chat's votes, the vote's timer, the winners; the panel's
// battle screen follows (events 'state'), and so does the battle page (PUT live, vote counts only, never who voted).
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { DATA_DIR } = require('./config');
const { bus } = require('./events');
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
  voteTime: 60, // seconds: the battle screen's length menu
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
  voteTime: (v) => [30, 60, 90].includes(v),
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
    battle: on && battle ? { ...battle, vote: vote && { status: vote.status, endsAt: vote.endsAt } } : null,
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

// A battle from Jarchi Battle (battles/current) as the panel shows it; songs oldest first. While it's live, the bracket
// here is newer than the last one saved there (saves wait up to 2 s), so it stays; after a restart it's the saved one.
const sorted = (songs) => songs.filter((s) => !s.removed).sort((a, b) => a.sentAt - b.sentAt);
function took(b) {
  if (!b && battle?.status === 'finished') return; // Jarchi Battle's "current" has none any more: its bracket stays shown until New battle
  const mine = battle && battle.id === b?.id && battle.bracket.length ? battle : null;
  if (!mine) stopVote();
  battle = b && {
    id: b.id,
    status: b.status,
    topic: b.topic,
    settings: b.settings,
    createdAt: b.createdAt,
    songs: sorted(b.songs ?? []),
    cursor: b.cursor ?? 0,
    bracket: mine?.bracket ?? b.bracket ?? [],
    current: mine?.current ?? b.current ?? null,
  };
  if (battle?.status === 'live' && !battle.bracket.length)
    begin(); // started, but its bracket was never saved
  else if (battle?.status === 'live' && !battle.current) battle.current = nextMatch(battle.bracket);
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
  begin();
  return now();
}
// Cancel: the battle stops; the page goes back to the one before it.
async function cancel() {
  await onBattle('POST', '/cancel');
  battle = null;
  stopVote();
  return now();
}

// ---------- The battle screen ----------
// The bracket: rounds of matches [song A, song B, winner 0 | 1 | null, votes A, votes B] (song ids), as Jarchi Battle
// keeps it. The first round has half the next power of two matches; a song without a rival (a bye) goes through by
// itself, every other match first, so two byes meet in the second round only when more than half are byes.
function bracketFor(ids, rnd = Math.random) {
  ids = [...ids];
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  let n = 2;
  while (n < ids.length) n *= 2;
  const byes = new Set([...Array(n / 2).keys()].sort((a, b) => (a % 2) - (b % 2) || a - b).slice(0, n - ids.length));
  const R = [Array.from({ length: n / 2 }, (_, m) => (byes.has(m) ? [ids.pop(), null, 0, 0, 0] : [ids.pop(), ids.pop(), null, 0, 0]))];
  for (let k = n / 4; k >= 1; k /= 2) R.push(Array.from({ length: k }, () => [null, null, null, 0, 0]));
  R[0].forEach((x, m) => x[2] === 0 && promote(R, 0, m));
  return R;
}
// A match's winner takes its place in the next round.
function promote(R, r, m) {
  const x = R[r][m];
  if (R[r + 1]) R[r + 1][m >> 1][m & 1] = x[x[2]];
}
// The next match to play: the first with both songs and no winner (the battle page's rule too). null: all decided.
function nextMatch(R) {
  for (let r = 0; r < R.length; r++) for (let m = 0; m < R[r].length; m++) if (R[r][m][0] && R[r][m][1] && R[r][m][2] === null) return [r, m];
  return null;
}
const match = () => (battle?.status === 'live' && battle.current ? battle.bracket[battle.current[0]]?.[battle.current[1]] : null);
const wrong = () => failed(409, 'state');

const events = new EventEmitter(); // 'state': now(), on every change on the battle screen
// A change on the battle screen: to the panel now, and to the battle page (save()).
function changed() {
  events.emit('state', now());
  save();
}
function begin() {
  battle.bracket = bracketFor(battle.songs.map((s) => s.id));
  battle.current = nextMatch(battle.bracket);
  changed();
}

// Chat votes: viewers type 1 or 2 (a Persian or Arabic keyboard's digit too), one vote each, their last counts. Who
// voted stays in memory for this vote only, never saved, never sent; the match keeps the counts.
const BALLOT = { 1: 0, '۱': 0, '١': 0, 2: 1, '۲': 1, '٢': 1 };
let vote = null, // the current match's vote: { status: 'open' | 'done', endsAt, voters: Map 'platform:login' -> 0 | 1 }
  voteTimer,
  soonTimer;
function stopVote() {
  clearTimeout(voteTimer);
  vote = null;
}
function ballot(m) {
  const x = match(),
    side = BALLOT[m.text?.trim()];
  if (vote?.status !== 'open' || !x || side === undefined || m.test || m.kind !== 'message' || !m.user?.login) return;
  const who = `${m.platform}:${m.user.login.toLowerCase()}`,
    was = vote.voters.get(who);
  if (was === side) return;
  vote.voters.set(who, side);
  if (was !== undefined) x[3 + was]--;
  x[3 + side]++;
  soonTimer ??= setTimeout(() => ((soonTimer = null), changed()), 250); // a busy chat: 4 updates a second at most
}
bus.on('chat', ballot);

// Start vote: for the length in the setup, from 0 again. Only in "Chat votes" and before the match has its winner.
function openVote() {
  const x = match();
  if (!x || x[2] !== null || setup().voting !== 'chat') throw wrong();
  const ms = setup().voteTime * 1000;
  stopVote();
  x[3] = x[4] = 0;
  vote = { status: 'open', endsAt: Date.now() + ms, voters: new Map() };
  voteTimer = setTimeout(closeVote, ms);
  changed();
  return now();
}
// Time's up, or End now: the counts stay for the streamer to confirm (a tie: the coin).
function closeVote() {
  clearTimeout(voteTimer);
  if (vote?.status === 'open') {
    vote = { ...vote, status: 'done', endsAt: Date.now() };
    changed();
  }
  return now();
}
// Vote again: the counts back to 0, ready for Start vote.
function resetVote() {
  const x = match();
  if (!x || x[2] !== null) throw wrong();
  stopVote();
  x[3] = x[4] = 0;
  changed();
  return now();
}
// Confirm winner, "This one wins" (either song, any time) or the coin: the match's winner (0: song 1, 1: song 2).
function pick(side) {
  const x = match();
  if (![0, 1].includes(side) || !x || x[2] !== null) throw wrong();
  stopVote();
  x[2] = side;
  promote(battle.bracket, ...battle.current);
  changed();
  return now();
}
// Next match; after the final, the champion: the last bracket saved first (live is refused once it's finished), then
// finish. The finished battle stays here (status finished, champion: its song id) for the bracket and the champion,
// in every battle window, until New battle (clear) or a new battle; not after a restart.
async function next() {
  const x = match();
  if (!x || x[2] === null) throw wrong();
  const c = nextMatch(battle.bracket);
  if (c) {
    battle.current = c;
    stopVote();
    changed();
    return now();
  }
  const f = battle.bracket.at(-1)[0],
    song = battle.songs.find((s) => s.id === f[f[2]]);
  clearTimeout(saveTimer);
  saveTimer = null;
  await saving;
  dirty = false;
  await onBattle('PUT', '/live', { bracket: battle.bracket, current: battle.current });
  await onBattle('POST', '/finish', { champion: song.id });
  battle = { ...battle, status: 'finished', champion: song.id };
  changed();
  return now();
}
// New battle, after the champion: back to the setup.
function clear() {
  if (battle?.status !== 'finished') throw wrong();
  battle = null;
  events.emit('state', now());
  return now();
}

// The battle page's copy: about every 2 s at most (it asks every 5), one call at a time with the newest state; a save
// that fails is tried again 5 s later. One the battle moved on from (cancelled elsewhere: 409) is dropped.
let saveTimer = null,
  saving = null,
  dirty = false,
  savedAt = 0;
function save() {
  dirty = true;
  if (!saveTimer && !saving) saveTimer = setTimeout(sendLive, Math.max(0, savedAt + 2000 - Date.now()));
}
function sendLive() {
  saveTimer = null;
  if (!dirty || battle?.status !== 'live') return;
  const { id, bracket, current } = battle;
  dirty = false;
  savedAt = Date.now();
  saving = onBattle('PUT', '/live', { bracket, current })
    .catch((err) => {
      if (battle?.id !== id || ['battle_state', 'battle_not_found', 'battle_key'].includes(err.code)) return;
      dirty = true;
      savedAt += 3000;
    })
    .finally(() => {
      saving = null;
      if (dirty) save();
    });
}

module.exports = {
  now,
  refresh,
  request,
  update,
  create,
  feed,
  add,
  remove,
  start,
  cancel,
  openVote,
  closeVote,
  resetVote,
  pick,
  next,
  clear,
  bracketFor,
  events,
  BATTLE,
};
