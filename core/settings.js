// Settings = defaults + whatever the user changed. Only the changes are stored, so "reset" is just deleting them.
const fs = require('node:fs');
const path = require('node:path');
const { DATA_DIR, UPLOADS_DIR } = require('./config');
const { TYPES } = require('./events');
const strings = require('../i18n/en.json');

const FILE = path.join(DATA_DIR, 'settings.json');
const VERSION = 2;
const THEMES = ['neon', 'minimal', 'fun', 'retro', 'glass', 'fire', 'ice', 'galaxy', 'comic'];
// App-wide settings (not per alert). showBadge: platform badge on alerts; it still needs both Kick and Twitch connected.
const GLOBAL = { theme: 'neon', showBadge: true };
const GLOBAL_RULES = { theme: (v) => THEMES.includes(v), showBadge: (v) => typeof v === 'boolean' };
// Follow is small and quick, raid is the big one. minAmount only where an amount makes sense.
const PER_TYPE = {
  follow: { duration: 4, fontSize: 38 },
  sub: { duration: 6, fontSize: 46 },
  resub: { duration: 6, fontSize: 46 },
  gift_sub: { duration: 6, fontSize: 46, minAmount: 0 },
  kicks: { duration: 6, fontSize: 46, minAmount: 0 },
  bits: { duration: 6, fontSize: 46, minAmount: 0 },
  raid: { duration: 9, fontSize: 54 },
};
const DEFAULTS = Object.fromEntries(TYPES.map((t) => [t, {
  enabled: true,
  template: strings.templates[t],
  volume: 0.7,
  image: null, // { file, name } once uploaded
  videoSound: 'off',
  sound: null,
  soundMode: 'theme',
  frame: 'theme',
  frameBg: '#14141c',
  frameOpacity: 0.85,
  frameBorder: '#8b5cf6',
  frameRadius: 16,
  textPos: 'below',
  textAlign: 'center',
  textColor: null, // null = the theme's color
  theme: null, // null = the main theme
  ...PER_TYPE[t],
}]));

const num = (min, max) => (v) => typeof v === 'number' && v >= min && v <= max;
const oneOf = (...list) => (v) => list.includes(v);
const hex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const RULES = {
  enabled: (v) => typeof v === 'boolean',
  template: (v) => typeof v === 'string' && v.length <= 200,
  duration: num(1, 60),
  volume: num(0, 1),
  minAmount: (v) => Number.isInteger(v) && v >= 0,
  videoSound: oneOf('off', 'video', 'both'),
  soundMode: oneOf('theme', 'custom', 'none'),
  frame: oneOf('theme', 'custom', 'off'),
  frameBg: hex,
  frameOpacity: num(0, 1),
  frameBorder: hex,
  frameRadius: num(0, 60),
  textPos: oneOf('above', 'below', 'over'),
  textAlign: oneOf('left', 'center', 'right'),
  theme: (v) => v === null || THEMES.includes(v),
  fontSize: num(12, 120),
  textColor: (v) => v === null || hex(v),
};
const ALLOWED = { image: ['png', 'jpg', 'gif', 'webp', 'webm', 'mp4'], sound: ['mp3', 'wav', 'ogg'] };

const bad = (code = 'bad_request') => Object.assign(new Error(code), { status: 400, code });

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
let saved = load();
if ((saved.version ?? 1) < VERSION) {
  // v1 -> v2: an uploaded sound always played; now soundMode picks the sound, so keep those playing.
  for (const a of Object.values(saved.alerts ?? {})) if (a?.sound && !a.soundMode) a.soundMode = 'custom';
  saved.version = VERSION;
  persist();
}

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`settings.json unreadable (${err.message}), moved aside and starting fresh`);
      fs.renameSync(FILE, `${FILE}.broken-${Date.now()}`);
    }
    return {};
  }
}

function persist() {
  fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(saved, null, 2));
  fs.renameSync(`${FILE}.tmp`, FILE); // atomic: a crash mid-write never leaves a half-written settings file
}

function get() {
  const globals = Object.entries(GLOBAL).map(([k, d]) => [k, GLOBAL_RULES[k](saved[k]) ? saved[k] : d]);
  return {
    ...Object.fromEntries(globals),
    alerts: Object.fromEntries(TYPES.map((t) => [t, { ...DEFAULTS[t], ...saved.alerts?.[t] }])),
  };
}

const overrides = (type) => ((saved.alerts ??= {})[type] ??= {});

function update(patch) {
  if (!patch || typeof patch !== 'object') throw bad();
  for (const k in GLOBAL) if (k in patch && !GLOBAL_RULES[k](patch[k])) throw bad();
  const alerts = Object.entries(patch.alerts ?? {});
  for (const [type, fields] of alerts) {
    if (!TYPES.includes(type) || !fields || typeof fields !== 'object') throw bad();
    for (const [k, v] of Object.entries(fields)) if (!RULES[k] || !(k in DEFAULTS[type]) || !RULES[k](v)) throw bad();
  }
  for (const k in GLOBAL) if (k in patch) saved[k] = patch[k];
  for (const [type, fields] of alerts) Object.assign(overrides(type), fields);
  persist();
  return get();
}

// Real file type from magic bytes, whatever the filename claims.
function sniff(b) {
  const hex4 = b.subarray(0, 4).toString('hex');
  const ascii = b.subarray(0, 12).toString('latin1');
  if (hex4 === '89504e47') return 'png';
  if (hex4.startsWith('ffd8ff')) return 'jpg';
  if (ascii.startsWith('GIF8')) return 'gif';
  if (ascii.startsWith('RIFF') && ascii.slice(8) === 'WEBP') return 'webp';
  if (ascii.startsWith('RIFF') && ascii.slice(8) === 'WAVE') return 'wav';
  if (hex4 === '1a45dfa3') return 'webm';
  if (ascii.slice(4, 8) === 'ftyp' && !/^(M4A|M4B|qt)/.test(ascii.slice(8))) return 'mp4'; // not audio-only m4a or QuickTime
  if (ascii.startsWith('OggS')) return 'ogg';
  if (ascii.startsWith('ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'mp3';
}

function removeFile(entry) {
  if (entry?.file) fs.rmSync(path.join(UPLOADS_DIR, path.basename(entry.file)), { force: true });
}

function saveUpload(type, kind, buf, name) {
  if (!TYPES.includes(type) || !ALLOWED[kind] || !Buffer.isBuffer(buf)) throw bad();
  const ext = sniff(buf);
  if (!ALLOWED[kind].includes(ext)) throw bad('bad_type');
  removeFile(saved.alerts?.[type]?.[kind]);
  const file = `${type}-${kind}-${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, file), buf);
  overrides(type)[kind] = { file, name: String(name || file).slice(0, 120) };
  if (kind === 'sound') overrides(type).soundMode = 'custom'; // uploading a sound means "use it"
  persist();
  return get();
}

function removeUpload(type, kind) {
  if (!TYPES.includes(type) || !ALLOWED[kind]) throw bad();
  const o = saved.alerts?.[type];
  removeFile(o?.[kind]);
  delete o?.[kind];
  if (kind === 'sound' && o?.soundMode === 'custom') delete o.soundMode; // back to the theme sound
  persist();
  return get();
}

// No type = reset everything.
function reset(type) {
  if (type !== undefined && !TYPES.includes(type)) throw bad();
  for (const t of type ? [type] : TYPES) {
    removeFile(saved.alerts?.[t]?.image);
    removeFile(saved.alerts?.[t]?.sound);
    delete saved.alerts?.[t];
  }
  if (!type) saved = { version: VERSION };
  persist();
  return get();
}

module.exports = { get, update, saveUpload, removeUpload, reset };
