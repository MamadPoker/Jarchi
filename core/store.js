// Small JSON files in the data dir (settings.json, goals.json).
const fs = require('node:fs');
const path = require('node:path');

// An unreadable file is moved aside (not deleted) and we start fresh instead of crashing.
function load(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`${path.basename(file)} unreadable (${err.message}), moved aside and starting fresh`);
      fs.renameSync(file, `${file}.broken-${Date.now()}`);
    }
    return {};
  }
}

// Atomic: a crash mid-write never leaves a half-written file.
function save(file, data) {
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2));
  fs.renameSync(`${file}.tmp`, file);
}

module.exports = { load, save };
