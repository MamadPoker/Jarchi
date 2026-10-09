// Settings = defaults + whatever the user changed. Only the changes are stored, so "reset" is just deleting them.
const fs = require('node:fs');
const path = require('node:path');
const { DATA_DIR, UPLOADS_DIR } = require('./config');
const { TYPES } = require('./events');
const strings = require('../i18n/en.json');

const FILE = path.join(DATA_DIR, 'settings.json');
const THEMES = ['neon', 'minimal', 'fun'];
const MIN_AMOUNT_TYPES = ['gift_sub', 'kicks', 'bits'];
const DEFAULTS = Object.fromEntries(TYPES.map((t) => [t, {
  enabled: true,
  image: null, // { file, name } once uploaded
  sound: null,
  volume: 0.7,
  duration: 6,
  template: strings.templates[t],
  ...(MIN_AMOUNT_TYPES.includes(t) && { minAmount: 0 }),
}]));
const RULES = {
  enabled: (v) => typeof v === 'boolean',
  volume: (v) => typeof v === 'number' && v >= 0 && v <= 1,
  duration: (v) => typeof v === 'number' && v >= 1 && v <= 60,
  template: (v) => typeof v === 'string' && v.length <= 200,
  minAmount: (v) => Number.isInteger(v) && v >= 0,
};
const ALLOWED = { image: ['png', 'jpg', 'gif', 'webp', 'webm'], sound: ['mp3', 'wav', 'ogg'] };

const bad = (code = 'bad_request') => Object.assign(new Error(code), { status: 400, code });

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
let saved = load();

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
  return {
    theme: saved.theme ?? 'neon',
    alerts: Object.fromEntries(TYPES.map((t) => [t, { ...DEFAULTS[t], ...saved.alerts?.[t] }])),
  };
}

const overrides = (type) => ((saved.alerts ??= {})[type] ??= {});

function update(patch) {
  if (!patch || typeof patch !== 'object') throw bad();
  if ('theme' in patch && !THEMES.includes(patch.theme)) throw bad();
  const alerts = Object.entries(patch.alerts ?? {});
  for (const [type, fields] of alerts) {
    if (!TYPES.includes(type) || !fields || typeof fields !== 'object') throw bad();
    for (const [k, v] of Object.entries(fields)) if (!RULES[k] || !(k in DEFAULTS[type]) || !RULES[k](v)) throw bad();
  }
  if ('theme' in patch) saved.theme = patch.theme;
  for (const [type, fields] of alerts) Object.assign(overrides(type), fields);
  persist();
  return get();
}

// Real file type from magic bytes, whatever the filename claims.
function sniff(b) {
  const hex = b.subarray(0, 4).toString('hex');
  const ascii = b.subarray(0, 12).toString('latin1');
  if (hex === '89504e47') return 'png';
  if (hex.startsWith('ffd8ff')) return 'jpg';
  if (ascii.startsWith('GIF8')) return 'gif';
  if (ascii.startsWith('RIFF') && ascii.slice(8) === 'WEBP') return 'webp';
  if (ascii.startsWith('RIFF') && ascii.slice(8) === 'WAVE') return 'wav';
  if (hex === '1a45dfa3') return 'webm';
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
  persist();
  return get();
}

function removeUpload(type, kind) {
  if (!TYPES.includes(type) || !ALLOWED[kind]) throw bad();
  removeFile(saved.alerts?.[type]?.[kind]);
  delete saved.alerts?.[type]?.[kind];
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
  if (!type) saved = {};
  persist();
  return get();
}

module.exports = { get, update, saveUpload, removeUpload, reset };
