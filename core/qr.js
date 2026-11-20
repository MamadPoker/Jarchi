// A QR code for the Song Battle page's link, made here as an SVG, so the link never goes to a QR service. One size
// only: version 4 (33 x 33) with error correction M holds 62 bytes, and the longest battle link
// (https://battle.jarchi.app/ and a 30-letter channel) is 56. Byte mode, and the mask with the lowest penalty, as
// ISO/IEC 18004 says. A longer text: null.
const SIZE = 33,
  MAX = 62,
  BLOCKS = 2,
  DATA = 32, // data codewords per block
  ECC = 18; // error correction codewords per block

// GF(256) for Reed-Solomon, with the QR polynomial x^8 + x^4 + x^3 + x^2 + 1.
const EXP = [],
  LOG = [];
for (let i = 0, x = 1; i < 255; i++, x = (x << 1) ^ (x & 0x80 ? 0x11d : 0)) [EXP[i], LOG[x]] = [x, i];
const mul = (a, b) => (a && b ? EXP[(LOG[a] + LOG[b]) % 255] : 0);
// The generator (x - a^0)(x - a^1)...(x - a^17), highest power first, without its leading 1.
const GEN = Array.from({ length: ECC }, (_, i) => i).reduce((g, i) => [...g, 0].map((c, k) => c ^ (k ? mul(g[k - 1], EXP[i]) : 0)), [1]);
function eccOf(data) {
  const r = new Array(ECC).fill(0);
  for (const d of data) {
    const f = d ^ r.shift();
    r.push(0);
    for (let k = 0; k < ECC; k++) r[k] ^= mul(GEN[k + 1], f);
  }
  return r;
}

// The codewords: mode 0100, the length, the bytes, a terminator, then the pad bytes; per block its error
// correction; the two blocks interleaved.
function codewords(bytes) {
  const bits = [];
  const put = (v, n) => {
    for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1);
  };
  put(4, 4);
  put(bytes.length, 8);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, BLOCKS * DATA * 8 - bits.length));
  put(0, -bits.length & 7);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b));
  for (let pad = 0xec; data.length < BLOCKS * DATA; pad ^= 0xec ^ 0x11) data.push(pad);
  const blocks = [0, 1].map((b) => data.slice(b * DATA, (b + 1) * DATA));
  const eccs = blocks.map(eccOf);
  return [...blocks[0].flatMap((d, i) => [d, blocks[1][i]]), ...eccs[0].flatMap((e, i) => [e, eccs[1][i]])];
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

// The modules (rows of true = dark) with one mask.
function draw(words, mask) {
  const m = Array.from({ length: SIZE }, () => new Array(SIZE).fill(false));
  const fixed = Array.from({ length: SIZE }, () => new Array(SIZE).fill(false));
  const set = (r, c, dark) => ((m[r][c] = dark), (fixed[r][c] = true));
  // Finders (with their light separators), timing lines, the one alignment pattern, the dark module.
  for (const [r0, c0] of [
    [0, 0],
    [0, SIZE - 7],
    [SIZE - 7, 0],
  ])
    for (let r = -1; r <= 7; r++)
      for (let c = -1; c <= 7; c++) {
        const d = Math.max(Math.abs(r - 3), Math.abs(c - 3));
        if (r0 + r >= 0 && r0 + r < SIZE && c0 + c >= 0 && c0 + c < SIZE) set(r0 + r, c0 + c, d !== 2 && d !== 4);
      }
  for (let i = 8; i < SIZE - 8; i++) (set(6, i, i % 2 === 0), set(i, 6, i % 2 === 0));
  for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) set(26 + r, 26 + c, Math.max(Math.abs(r), Math.abs(c)) !== 1);
  // Format: level M (00) and the mask, BCH-coded, in its two places.
  let rem = mask;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const f = ((mask << 10) | rem) ^ 0x5412,
    bit = (i) => ((f >>> i) & 1) === 1;
  for (let i = 0; i < 15; i++) {
    set(i < 6 ? i : i < 8 ? i + 1 : SIZE - 15 + i, 8, bit(i));
    set(8, i < 8 ? SIZE - 1 - i : i < 9 ? 15 - i : 14 - i, bit(i));
  }
  set(SIZE - 8, 8, true);
  // The data, two columns at a time from the bottom right, up then down, around what's fixed.
  let n = 0;
  for (let right = SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < SIZE; v++)
      for (let j = 0; j < 2; j++) {
        const c = right - j,
          r = ((right + 1) & 2) === 0 ? SIZE - 1 - v : v;
        if (fixed[r][c]) continue;
        const dark = n < words.length * 8 && ((words[n >> 3] >>> (7 - (n & 7))) & 1) === 1;
        n++;
        m[r][c] = dark !== MASKS[mask](r, c);
      }
  }
  return m;
}

// The standard's penalty: runs of 5 or more, 2 x 2 blocks, finder-like patterns, and how far from half dark.
function penalty(m) {
  let p = 0,
    dark = 0;
  const lines = [...m, ...m.map((_, c) => m.map((row) => row[c]))];
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= SIZE; i++) {
      if (i < SIZE && line[i] === line[i - 1]) run++;
      else {
        if (run >= 5) p += run - 2;
        run = 1;
      }
    }
    const s = line.map(Number).join('');
    for (let i = s.indexOf('1011101'); i >= 0; i = s.indexOf('1011101', i + 1)) if (s.slice(i - 4, i) === '0000' || s.slice(i + 7, i + 11) === '0000') p += 40;
  }
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) {
      dark += m[r][c];
      if (r && c && m[r][c] === m[r - 1][c] && m[r][c] === m[r][c - 1] && m[r][c] === m[r - 1][c - 1]) p += 3;
    }
  return p + Math.floor(Math.abs((dark * 100) / (SIZE * SIZE) - 50) / 5) * 10;
}

// text -> its modules, or null when it doesn't fit. mask: one of the 8 (the tests), else the best one.
function matrix(text, mask) {
  const bytes = Buffer.from(String(text), 'utf8');
  if (bytes.length > MAX) return null;
  const words = codewords(bytes);
  if (mask !== undefined) return draw(words, mask);
  const all = MASKS.map((_, k) => draw(words, k));
  const scores = all.map(penalty);
  return all[scores.indexOf(Math.min(...scores))];
}

// text -> an SVG (dark on white, with the 4-module quiet zone), or null.
function svg(text) {
  const m = matrix(text);
  if (!m) return null;
  let d = '';
  m.forEach((row, r) =>
    row.forEach((on, c) => {
      if (on && !row[c - 1]) d += `M${c + 4} ${r + 4}h${row.indexOf(false, c) < 0 ? SIZE - c : row.indexOf(false, c) - c}v1H${c + 4}z`;
    }),
  );
  const n = SIZE + 8;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

module.exports = { matrix, svg };
