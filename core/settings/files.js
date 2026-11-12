// Uploaded files: their real type, and writing them into the uploads folder. No settings state here.
const fs = require('node:fs');
const path = require('node:path');
const { UPLOADS_DIR } = require('../config');
const { ALLOWED, bad } = require('./schema');

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

// Check an upload's real type and write it -> { file, name }.
function writeUpload(prefix, kind, buf, name) {
  if (!Buffer.isBuffer(buf)) throw bad();
  const ext = sniff(buf);
  if (!ALLOWED[kind].includes(ext)) throw bad('bad_type');
  const file = `${prefix}-${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, file), buf);
  return { file, name: String(name || file).slice(0, 120) };
}

module.exports = { sniff, writeUpload };
