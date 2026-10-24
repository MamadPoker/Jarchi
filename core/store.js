// Small JSON files in the data dir (settings.json, goals.json, feed.json, today.json, kick.json, twitch.json).
const fs = require('node:fs');
const path = require('node:path');
const secrets = require('./secrets');

// An unreadable file is moved aside (not deleted) and we start fresh instead of crashing.
// secret: the fields that are secrets (the logins' tokens), sealed on disk in the installed app (core/secrets.js). A
// file that still has them in plain text is sealed right away, so nobody is logged out by it.
function load(file, secret) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`${path.basename(file)} unreadable (${err.message}), moved aside and starting fresh`);
      fs.renameSync(file, `${file}.broken-${Date.now()}`);
    }
    return {};
  }
  if (!secret) return data;
  const { value, plain } = secrets.openFields(data, secret, path.basename(file));
  if (plain && secrets.on) save(file, value, secret);
  return value;
}

// Atomic: a crash mid-write never leaves a half-written file.
function save(file, data, secret) {
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(secret ? secrets.sealFields(data, secret) : data, null, 2));
  fs.renameSync(`${file}.tmp`, file);
}

module.exports = { load, save };
