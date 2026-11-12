// Settings = defaults + whatever the user changed. Only the changes are stored, so "reset" is just deleting them.
// The defaults and rules are in schema.js, the steps from older versions in migrate.js, the upload checks in files.js.
const fs = require('node:fs');
const path = require('node:path');
const { DATA_DIR, UPLOADS_DIR } = require('../config');
const { TYPES } = require('../events');
const store = require('../store');
const secrets = require('../secrets');
const {
  VERSION,
  GLOBAL,
  GLOBAL_RULES,
  KICK_GIFTS,
  TIER_AMOUNTS,
  DEFAULTS,
  TEXT_STYLE,
  RULES,
  GOAL_IDS,
  FONTS,
  GOAL_STYLES,
  GOAL_LOOK,
  GOAL_DEFAULTS,
  GOAL_RULES,
  CHAT_STYLES,
  CHAT_FONTS,
  CHAT_LOOK,
  CHAT_OWN,
  CHAT_SHARED,
  pick,
  CHAT_DESIGNS,
  CHATS,
  CHANNELS,
  CHAT_DEFAULTS,
  CHAT_RULES,
  addChatDesign,
  VIEWER_STYLES,
  VIEWER_LOOK,
  VIEWER_COLORS,
  VIEWERS_DEFAULTS,
  VIEWER_RULES,
  PROFILE,
  PROFILE_RULES,
  CRYPTO_DESIGNS,
  CRYPTO_FONTS,
  CRYPTO_LOOK,
  CRYPTO_TIERS,
  CRYPTO_RULES,
  LOOK_RULES,
  ALLOWED,
  bad,
} = require('./schema');
const { migrate } = require('./migrate');
const { sniff, writeUpload } = require('./files');

const FILE = path.join(DATA_DIR, 'settings.json');

// Undo / redo (the panel's Ctrl+Z / Ctrl+Y): the settings as they were before each of the last 5 changes (past), and
// the ones undone since (future), only while Jarchi runs. Each is JSON without what isn't a setting (KEEP: those stay as
// they are). A file a change replaced or removed stays in uploads until no step has it any more (gone, sweep()).
const UNDO_MAX = 5;
const KEEP = [
  'version',
  'installId',
  'supportToken',
  'obsSize',
  'connect',
  'welcomed',
  'privacyAccepted',
  'privacyAcceptedAt',
  'lang',
  'seenNew',
  'eyesSeen',
  'proxyAsk',
];
let past = [],
  future = [],
  last; // last: the settings now, as JSON (once loaded)
const gone = new Set();
const plain = () => JSON.stringify({ ...saved, ...Object.fromEntries(KEEP.map((k) => [k])) }); // undefined: left out
const files = (json) => [...json.matchAll(/"file":"([^"]+)"/g)].map((m) => path.basename(m[1]));

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
let saved = store.load(FILE);
if (migrate(saved, removeFile)) persist();
// The Support page's ticket token (supportToken()) is sealed in the installed app (core/secrets.js), plain in a dev run.
// saved holds it as it is on disk, so a run that can't open it (a dev run, another PC's key) still writes it back on
// every save and never makes a new one over it: the relay takes only an install's first token.
const PLAIN = /^[0-9a-f]{64}$/;
const sealToken = (t) => (secrets.on ? secrets.seal('supportToken', t) : t);
if (secrets.on && PLAIN.test(saved.supportToken)) {
  saved.supportToken = sealToken(saved.supportToken); // one from before: sealed now
  persist();
}
last = plain();

// Every change is a step Ctrl+Z can undo, but one that isn't undoable (Reset everything, a VPN offer's Yes, a connected
// account's channel): the steps before it are forgotten, as undoing them would undo it too.
function persist(undoable = true) {
  const now = plain();
  if (last !== undefined && now !== last) {
    past = undoable ? [...past, last].slice(-UNDO_MAX) : [];
    future = [];
    last = now;
  }
  store.save(FILE, saved);
  sweep();
}
// Back (undo) or forward again (redo) one step -> the settings, or null when there's none.
function step(from, to) {
  if (!from.length) return null;
  to.push(last);
  files(last).forEach((f) => gone.add(f)); // an upload undone: its file goes once no step has it
  last = from.pop();
  saved = { ...JSON.parse(last), ...pick(saved, KEEP) };
  store.save(FILE, saved);
  sweep();
  return get();
}
const undo = () => step(past, future);
const redo = () => step(future, past);
const canUndo = () => past.length > 0;
// Jarchi quits: no more steps, so their files go.
function forget() {
  past = [];
  future = [];
  sweep();
}
function sweep() {
  const kept = new Set([last ?? plain(), ...past, ...future].flatMap(files));
  for (const f of gone) {
    if (kept.has(f)) continue;
    fs.rmSync(path.join(UPLOADS_DIR, f), { force: true });
    gone.delete(f);
  }
}

function get() {
  const globals = Object.entries(GLOBAL).map(([k, d]) => [k, GLOBAL_RULES[k](saved[k]) ? saved[k] : d]);
  return {
    ...Object.fromEntries(globals),
    alerts: Object.fromEntries(TYPES.map((t) => [t, alert(t)])),
    goals: Object.fromEntries(GOAL_IDS.map((id) => [id, goal(id)])),
    chat: chat(),
    chat2: saved.chat2 ? chat('chat2') : null,
    viewers: viewers(),
    profile: { ...PROFILE, ...saved.profile },
    crypto: cryptoAlerts(),
  };
}

// The crypto alerts = their defaults + the user's changes; amount alerts lowest first.
function cryptoAlerts() {
  const o = saved.crypto ?? {};
  return {
    design: CRYPTO_DESIGNS.includes(o.design) ? o.design : 'hologram',
    sound: o.sound ?? null,
    duration: o.duration ?? 8,
    custom: { ...CRYPTO_LOOK, ...o.custom },
    tiers: (o.tiers ?? []).map((t) => ({ ...CRYPTO_LOOK, ...t })).sort((a, b) => a.min - b.min),
  };
}
// Which crypto alert plays for a donation of this many USDT: the highest amount alert it reaches, else the card picked
// ('coin' | 'hologram' | 'custom' | a tier's id).
function cryptoPick(amount) {
  const c = cryptoAlerts();
  return [...c.tiers].reverse().find((t) => t.min <= amount)?.id ?? c.design;
}
// How long one look stays on screen (s). A tier that's gone meanwhile: the card's.
function cryptoDuration(look) {
  const c = cryptoAlerts();
  const own = look === 'custom' ? c.custom : c.tiers.find((t) => t.id === look);
  return own?.duration ?? (c.design === 'custom' && !['coin', 'hologram'].includes(look) ? c.custom.duration : c.duration);
}

// The viewers widget = its style's look + its defaults + the user's changes. Jarchi gold keeps Jarchi's own colors.
function viewers() {
  const o = saved.viewers ?? {};
  const style = o.style in VIEWER_STYLES ? o.style : VIEWERS_DEFAULTS.style;
  return { ...VIEWER_STYLES[style], ...VIEWERS_DEFAULTS, ...o, style, ...(style === 'gold' && pick(VIEWER_STYLES.gold, VIEWER_COLORS)) };
}

// An alert = its defaults + the user's changes to fields it has (so e.g. raid's old tiers stay ignored),
// with every fixed tier listed (Kicks tiers also name Kick's gift).
function alert(t) {
  const o = saved.alerts?.[t] ?? {};
  const cfg = Object.fromEntries(Object.entries(DEFAULTS[t]).map(([k, d]) => [k, k in o ? o[k] : d]));
  if (TIER_AMOUNTS[t]) {
    cfg.tiers = TIER_AMOUNTS[t].map((amount) => ({
      amount,
      on: false,
      image: null,
      sound: null,
      ...o.tiers?.[amount],
      ...(t === 'kicks' && { gift: KICK_GIFTS.find((g) => g.amount === amount) }),
    }));
  }
  return cfg;
}

// A chat = its style's look + the chat defaults + the user's changes (the other designs' own changes aren't in it).
// Chat 2 gets Chat 1's channels.
function chat(key = 'chat') {
  const { looks, ...o } = saved[key] ?? {};
  const style = o.style in CHAT_STYLES ? o.style : CHAT_DEFAULTS.style;
  return { ...CHAT_STYLES[style], ...CHAT_DEFAULTS, ...o, style, ...(key !== 'chat' && pick(chat(), CHANNELS)) };
}
// A chat the panel names: Chat 1, or Chat 2 while it exists.
function chatKey(key) {
  if (key !== 'chat' && !(key === 'chat2' && saved.chat2)) throw bad();
  return key;
}

// A goal = its style's look + the goal's defaults + the user's changes.
function goal(id) {
  const o = saved.goals?.[id] ?? {};
  const style = o.style in GOAL_STYLES ? o.style : GOAL_DEFAULTS[id].style;
  return { ...GOAL_STYLES[style], ...GOAL_DEFAULTS[id], ...o, style };
}

const overrides = (type) => ((saved.alerts ??= {})[type] ??= {});
const goalOverrides = (id) => ((saved.goals ??= {})[id] ??= {});

// undoable false: a change the server makes, not a step of the panel's Ctrl+Z (persist()).
function update(patch, undoable = true) {
  if (!patch || typeof patch !== 'object') throw bad();
  for (const k in GLOBAL) if (k in patch && !GLOBAL_RULES[k](patch[k])) throw bad();
  const alerts = Object.entries(patch.alerts ?? {});
  for (const [type, fields] of alerts) {
    if (!TYPES.includes(type) || !fields || typeof fields !== 'object') throw bad();
    for (const [k, v] of Object.entries(fields)) if (!RULES[k] || !(k in DEFAULTS[type]) || !RULES[k](v)) throw bad();
  }
  const goals = Object.entries(patch.goals ?? {});
  for (const [id, fields] of goals) {
    if (!GOAL_IDS.includes(id) || !fields || typeof fields !== 'object') throw bad();
    for (const [k, v] of Object.entries(fields)) if (!GOAL_RULES[k] || !(k in GOAL_DEFAULTS[id] || GOAL_LOOK.includes(k)) || !GOAL_RULES[k](v)) throw bad();
  }
  const chats = CHATS.filter((key) => patch[key] !== undefined).map((key) => [chatKey(key), patch[key]]);
  for (const [key, fields] of chats) {
    if (!fields || typeof fields !== 'object') throw bad();
    for (const [k, v] of Object.entries(fields)) if (!CHAT_RULES[k] || !CHAT_RULES[k](v) || (key !== 'chat' && CHANNELS.includes(k))) throw bad();
  }
  const view = patch.viewers;
  if (view !== undefined) {
    if (!view || typeof view !== 'object') throw bad();
    for (const [k, v] of Object.entries(view)) if (!VIEWER_RULES[k] || !VIEWER_RULES[k](v)) throw bad();
  }
  const cryptoPatch = patch.crypto;
  if (cryptoPatch !== undefined) {
    if (!cryptoPatch || typeof cryptoPatch !== 'object') throw bad();
    for (const [k, v] of Object.entries(cryptoPatch)) if (!CRYPTO_RULES[k] || !CRYPTO_RULES[k](v)) throw bad();
  }
  const profile = patch.profile;
  if (profile !== undefined) {
    if (!profile || typeof profile !== 'object') throw bad();
    for (const [k, v] of Object.entries(profile)) if (!PROFILE_RULES[k] || !PROFILE_RULES[k](v)) throw bad();
  }
  if (patch.privacyAccepted > (saved.privacyAccepted ?? 0)) saved.privacyAcceptedAt = new Date().toISOString(); // when (a newer one)
  for (const k in GLOBAL) if (k in patch) saved[k] = patch[k];
  if (profile) Object.assign((saved.profile ??= {}), profile);
  if (cryptoPatch) Object.assign((saved.crypto ??= {}), cryptoPatch);
  if (view) {
    const o = (saved.viewers ??= {});
    if ('style' in view) for (const k of VIEWER_LOOK) delete o[k]; // a new style starts from its own look
    Object.assign(o, view);
  }
  for (const [type, fields] of alerts) Object.assign(overrides(type), fields);
  for (const [id, fields] of goals) {
    const o = goalOverrides(id);
    if ('style' in fields) for (const k of GOAL_LOOK) delete o[k]; // a new style starts from its own look
    Object.assign(o, fields);
  }
  for (const [key, chatFields] of chats) {
    const o = (saved[key] ??= {});
    const from = chat(key).style,
      to = chatFields.style;
    if (to && to !== from) {
      // Another design: the shared look stays as it was (the old design's value where the user never changed it); the
      // old design's own changes are put away and the new one's come back.
      for (const k of CHAT_SHARED) o[k] ??= CHAT_STYLES[from][k];
      const looks = (o.looks ??= {});
      looks[from] = pick(o, CHAT_OWN);
      for (const k of CHAT_OWN) delete o[k];
      Object.assign(o, looks[to]);
      delete looks[to];
    }
    Object.assign(o, chatFields);
  }
  persist(undoable);
  return get();
}

// Deleted at the next save, or once no undo step has it (sweep()).
function removeFile(entry) {
  if (entry?.file) gone.add(path.basename(entry.file));
}
// Keep an uploaded file on o[kind]. Uploading a sound also selects it (o[modeKey] = 'custom').
function keepUpload(o, prefix, kind, buf, name, modeKey) {
  const entry = writeUpload(prefix, kind, buf, name);
  removeFile(o[kind]);
  o[kind] = entry;
  if (kind === 'sound' && modeKey) o[modeKey] = 'custom';
  persist();
  return get();
}

function dropUpload(o, kind, modeKey) {
  removeFile(o?.[kind]);
  delete o?.[kind];
  if (kind === 'sound' && o?.[modeKey] === 'custom') delete o[modeKey]; // back to the theme sound
  persist();
  return get();
}

function saveUpload(type, kind, buf, name) {
  if (!TYPES.includes(type) || !ALLOWED[kind]) throw bad();
  return keepUpload(overrides(type), `${type}-${kind}`, kind, buf, name, 'soundMode');
}
function removeUpload(type, kind) {
  if (!TYPES.includes(type) || !ALLOWED[kind]) throw bad();
  return dropUpload(saved.alerts?.[type], kind, 'soundMode');
}
function saveGoalSound(id, buf, name) {
  if (!GOAL_IDS.includes(id)) throw bad();
  return keepUpload(goalOverrides(id), `goal-${id}-sound`, 'sound', buf, name, 'celebrateSound');
}
function removeGoalSound(id) {
  if (!GOAL_IDS.includes(id)) throw bad();
  return dropUpload(saved.goals?.[id], 'sound', 'celebrateSound');
}
// Uploading a profile picture also selects it.
function saveProfilePicture(buf, name) {
  const o = (saved.profile ??= {});
  const entry = writeUpload('profile-picture', 'picture', buf, name);
  removeFile(o.picture);
  Object.assign(o, { picture: entry, pictureFrom: 'upload' });
  persist();
  return get();
}

// ---------- Media by amount: fixed tiers ----------
// One tier = { on, image, sound } under its amount. Uploading a file turns the tier on.
function tierOf(type, amount) {
  if (!TIER_AMOUNTS[type]?.includes(amount)) throw bad();
  return ((overrides(type).tiers ??= {})[amount] ??= {});
}
function setTier(type, amount, fields) {
  if (typeof fields?.on !== 'boolean') throw bad();
  tierOf(type, amount).on = fields.on;
  persist();
  return get();
}
function saveTierFile(type, amount, kind, buf, name) {
  if (!ALLOWED[kind]) throw bad();
  const tier = tierOf(type, amount);
  tier.on = true;
  return keepUpload(tier, `${type}-tier-${amount}-${kind}`, kind, buf, name);
}
function removeTierFile(type, amount, kind) {
  if (!ALLOWED[kind]) throw bad();
  return dropUpload(tierOf(type, amount), kind);
}

// ---------- Crypto alerts: looks and their files ----------
// look: 'main' (the two designs: only their sound), 'custom' (Your own alert) or an amount alert's id.
function cryptoSlot(look) {
  const o = (saved.crypto ??= {});
  if (look === 'main') return o;
  if (look === 'custom') return (o.custom ??= {});
  const t = o.tiers?.find((x) => x.id === look);
  if (!t) throw bad();
  return t;
}
// fields: pos, font, duration; an amount alert's min (USDT) too.
function setCryptoLook(look, fields) {
  const o = cryptoSlot(look);
  if (look === 'main' || !fields || typeof fields !== 'object') throw bad();
  for (const [k, v] of Object.entries(fields)) if (!LOOK_RULES[k]?.(v) || (k === 'min' && look === 'custom')) throw bad();
  Object.assign(o, fields);
  persist();
  return get();
}
// A new amount alert -> { settings, id }.
function addCryptoTier(min) {
  const tiers = ((saved.crypto ??= {}).tiers ??= []);
  if (!LOOK_RULES.min(min) || tiers.length >= CRYPTO_TIERS) throw bad();
  const id = crypto.randomUUID().slice(0, 8);
  tiers.push({ id, min });
  persist();
  return { settings: get(), id };
}
function removeCryptoTier(id) {
  const tiers = saved.crypto?.tiers ?? [],
    i = tiers.findIndex((t) => t.id === id);
  if (i < 0) throw bad();
  removeFile(tiers[i].image);
  removeFile(tiers[i].sound);
  tiers.splice(i, 1);
  persist();
  return get();
}
// The two designs take only a sound; the other looks an image (or GIF, or video) and a sound.
function saveCryptoFile(look, kind, buf, name) {
  if (!ALLOWED[kind] || kind === 'picture' || (look === 'main' && kind !== 'sound')) throw bad();
  return keepUpload(cryptoSlot(look), `crypto-${look}-${kind}`, kind, buf, name);
}
function removeCryptoFile(look, kind) {
  if (!ALLOWED[kind]) throw bad();
  return dropUpload(cryptoSlot(look), kind);
}

// Back to the selected style's look; title, target, count and celebration settings stay.
function resetGoalStyle(id) {
  if (!GOAL_IDS.includes(id)) throw bad();
  for (const k of GOAL_LOOK) delete saved.goals?.[id]?.[k];
  persist();
  return get();
}

// An alert's text style back to its defaults; its words, position and everything else stay.
function resetAlertText(type) {
  if (!TYPES.includes(type)) throw bad();
  for (const k of TEXT_STYLE) delete saved.alerts?.[type]?.[k];
  persist();
  return get();
}

// A chat (key) back to its style's look; channels, filters and emote sources stay. own: only the style's own settings
// (CHAT_OWN), the shared ones stay too.
function resetChatStyle(own, key = 'chat') {
  for (const k of own ? CHAT_OWN : CHAT_LOOK) delete saved[chatKey(key)]?.[k];
  persist();
  return get();
}

// The Chat page's "+": Chat 2, starting as a copy of Chat 1 (its look, the styles' own changes, filters...) with a name
// of its own. Deleting it is a step Ctrl+Z can undo too.
function addChat() {
  if (saved.chat2) throw bad();
  const { name, kickChannel, twitchChannel, ...o } = saved.chat ?? {};
  saved.chat2 = structuredClone(o);
  persist();
  return get();
}
function removeChat() {
  delete saved[chatKey('chat2')];
  persist();
  return get();
}

// The usage ping's (core/stats.js): this install's random id, made the first time it's asked for and kept through
// Reset everything; when the Privacy Policy accepted was accepted (ISO, UTC), or null. Neither is in get().
function installId() {
  if (!saved.installId) {
    saved.installId = crypto.randomUUID();
    persist();
  }
  return saved.installId;
}
const privacyAcceptedAt = () => saved.privacyAcceptedAt ?? null;
// The Support page's (core/support.js): this install's ticket token for the relay, random, made the first time it's
// needed (make) and kept through Reset everything (its tickets stay readable); null before that, and while it's sealed
// with a key this run doesn't have. Never in get().
function supportToken(make) {
  if (!saved.supportToken && make) {
    saved.supportToken = sealToken(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex'));
    persist();
  }
  const t = saved.supportToken;
  return (PLAIN.test(t) ? t : t && secrets.open('supportToken', t)) ?? null;
}

// The alerts overlay's size in OBS (its Browser Source's width x height), the last one it told (server/index.js): the
// panel's alert preview is that size, so it lays out the same. OBS's default 800 x 600 until then. Not a setting: not
// in get(), kept through Reset everything.
const okSize = (v) => !!v && [v.w, v.h].every((n) => Number.isInteger(n) && n >= 16 && n <= 16384);
const obsSize = () => (okSize(saved.obsSize) ? { w: saved.obsSize.w, h: saved.obsSize.h } : { w: 800, h: 600 });
// -> true for a new size (saved; the panel needs telling), false for the same one or one that isn't a size.
function setObsSize(v) {
  if (!okSize(v) || (v.w === obsSize().w && v.h === obsSize().h)) return false;
  saved.obsSize = { w: v.w, h: v.h };
  persist();
  return true;
}

// The usage ping's connection diagnostics (core/stats.js): per platform, what its last Connect came to: 'ok', or why
// it failed ('network' | 'denied' | 'other'); 'never' until Connect is pressed. Not a setting: not in get(), kept
// through Reset everything.
const CONNECTS = ['never', 'ok', 'network', 'denied', 'other'];
const connectState = (p) => (CONNECTS.includes(saved.connect?.[p]) ? saved.connect[p] : 'never');
function setConnectState(p, v) {
  if (!CONNECTS.includes(v) || connectState(p) === v) return;
  saved.connect = { ...saved.connect, [p]: v };
  persist();
}

// No type = reset everything.
function reset(type) {
  if (type !== undefined && !TYPES.includes(type)) throw bad();
  for (const t of type ? [type] : TYPES) {
    removeFile(saved.alerts?.[t]?.image);
    removeFile(saved.alerts?.[t]?.sound);
    for (const tier of Object.values(saved.alerts?.[t]?.tiers ?? {}))
      [tier.image, tier.sound, ...(tier.images ?? []), ...(tier.sounds ?? [])].forEach(removeFile); // old free tiers too
    delete saved.alerts?.[t];
  }
  if (!type) {
    for (const id of GOAL_IDS) removeFile(saved.goals?.[id]?.sound);
    removeFile(saved.profile?.picture);
    const c = saved.crypto ?? {};
    [c.sound, c.custom?.image, c.custom?.sound, ...(c.tiers ?? []).flatMap((t) => [t.image, t.sound])].forEach(removeFile);
    saved = {
      version: VERSION,
      installId: saved.installId,
      supportToken: saved.supportToken,
      obsSize: saved.obsSize,
      connect: saved.connect,
      lang: saved.lang,
      seenNew: saved.seenNew,
      eyesSeen: saved.eyesSeen,
    }; // still the same install, OBS and panel (none yet: left out)
  }
  persist(!!type); // Reset everything can't be undone
  return get();
}

module.exports = {
  get,
  update,
  saveUpload,
  removeUpload,
  reset,
  saveGoalSound,
  removeGoalSound,
  saveProfilePicture,
  resetGoalStyle,
  resetChatStyle,
  addChat,
  removeChat,
  resetAlertText,
  setTier,
  saveTierFile,
  removeTierFile,
  sniff,
  installId,
  privacyAcceptedAt,
  supportToken,
  obsSize,
  setObsSize,
  connectState,
  setConnectState,
  undo,
  redo,
  canUndo,
  forget,
  cryptoPick,
  cryptoDuration,
  setCryptoLook,
  addCryptoTier,
  removeCryptoTier,
  saveCryptoFile,
  removeCryptoFile,
  CRYPTO_FONTS,
  GOAL_IDS,
  GOAL_STYLES,
  CHAT_DESIGNS,
  CHAT_FONTS,
  FONTS,
  KICK_GIFTS,
  VIEWER_STYLES,
  addChatDesign,
};
