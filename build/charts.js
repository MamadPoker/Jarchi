// The README's star history and downloads charts, and the installs badge, drawn here in the panel's own colors and
// published to the `badges` branch by .github/workflows/charts.yml. Done in-repo because GitHub limited the stargazers
// API to a repo's own admins and collaborators (2026), which broke the third-party star-history embeds; the workflow's
// GITHUB_TOKEN is on the allowed side. Usage: node build/charts.js <out dir> [previous downloads-history.json]
const fs = require('node:fs');
const path = require('node:path');

const REPO = 'MamadPoker/Jarchi';
// Up to v1.0.2 the installers were released on Jarchi-releases (docs/releasing.md); their downloads count too.
const RELEASE_REPOS = [REPO, 'MamadPoker/Jarchi-releases'];
// Only the installer: latest.yml and the .blockmap are fetched by every installed Jarchi looking for updates, which is
// why GitHub's own downloads total runs several times higher than the real number of downloads.
const INSTALLER = /\.exe$/;

const C = { bg: '#091312', card: '#101e1e', border: '#1d3736', text: '#e7f1f0', muted: '#8fadac', gold: '#d6a83e', goldHi: '#f0cd6e' };
const FONT = "Inter, 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif";
const W = 800,
  H = 320,
  X0 = 64,
  X1 = 768,
  Y0 = 104,
  Y1 = 256;

const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch);
const day = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
// The top of the scale: four grid steps of 1, 2 or 5 × 10^k, the smallest that reaches n, so every line is a whole number.
function niceMax(n) {
  for (let k = 1; ; k *= 10) for (const m of [1, 2, 5]) if (m * k * 4 >= n) return m * k * 4;
}

/** @param {string[]} dates when each star was given → [time, stars so far], oldest first */
function starsSeries(dates) {
  return dates
    .map((d) => Date.parse(d))
    .sort((a, b) => a - b)
    .map((t, i) => [t, i + 1]);
}

/**
 * Installer downloads per version, oldest first. A version released on both repos (v1.0.2) is added up.
 * @param {{ tag_name: string, published_at: string, assets: { name: string, download_count: number }[] }[]} releases
 */
function installsByVersion(releases) {
  /** @type {Map<string, { tag: string, at: number, n: number }>} */
  const by = new Map();
  for (const r of releases) {
    const n = r.assets.filter((a) => INSTALLER.test(a.name)).reduce((s, a) => s + a.download_count, 0);
    const v = by.get(r.tag_name) ?? { tag: r.tag_name, at: Date.parse(r.published_at), n: 0 };
    v.at = Math.min(v.at, Date.parse(r.published_at));
    v.n += n;
    by.set(r.tag_name, v);
  }
  return [...by.values()].sort((a, b) => a.at - b.at);
}

// The card both charts sit on: the panel's dark surface, a soft gold glow, the logo, a title and the big number.
function card({ title, value, unit, max, body, foot, logo }) {
  const grid = [0, 1, 2, 3, 4]
    .map((i) => {
      const y = Y1 - ((Y1 - Y0) * i) / 4;
      return `<line x1="${X0}" x2="${X1}" y1="${y}" y2="${y}" stroke="${C.border}" stroke-dasharray="${i ? '3 5' : ''}"/><text x="${X0 - 12}" y="${y + 4}" text-anchor="end" class="m">${(max * i) / 4}</text>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${title}: ${value} ${unit}`)}">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.card}"/><stop offset="1" stop-color="${C.bg}"/></linearGradient>
<radialGradient id="glow" cx="1" cy="0" r="0.7"><stop offset="0" stop-color="${C.gold}" stop-opacity=".16"/><stop offset="1" stop-color="${C.gold}" stop-opacity="0"/></radialGradient>
<linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.gold}" stop-opacity=".38"/><stop offset="1" stop-color="${C.gold}" stop-opacity="0"/></linearGradient>
</defs>
<style>text{font-family:${FONT}}.m{fill:${C.muted};font-size:11px}.t{fill:${C.text}}</style>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="18" fill="url(#bg)" stroke="${C.border}"/>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="18" fill="url(#glow)"/>
${logo ? `<image href="data:image/png;base64,${logo}" x="28" y="24" width="36" height="36"/>` : ''}
<text x="76" y="40" class="t" font-size="18" font-weight="700">${esc(title)}</text>
<text x="76" y="58" class="m" font-size="12">${esc(REPO)}</text>
<text x="${X1}" y="50" text-anchor="end" fill="${C.gold}" font-size="34" font-weight="800">${esc(value.toLocaleString('en'))}</text>
<text x="${X1}" y="70" text-anchor="end" class="m">${esc(unit)}</text>
${grid}
${body}
${foot}
</svg>
`;
}

/** @param {number[][]} series from starsSeries @param {number} now @param {string} [logo] base64 PNG */
function starsSvg(series, now, logo) {
  const total = series.length ? series[series.length - 1][1] : 0;
  const max = niceMax(total);
  const t0 = series.length ? series[0][0] : now - 864e5;
  const x = (t) => X0 + ((X1 - X0) * (t - t0)) / Math.max(now - t0, 1);
  const y = (n) => Y1 - ((Y1 - Y0) * n) / max;
  // A step line: the count stays flat until the next star.
  let d = `M${x(t0)},${y(0)}`;
  for (const [t, n] of series) d += `H${x(t).toFixed(1)}V${y(n).toFixed(1)}`;
  d += `H${X1}`;
  const body = `<path d="${d}V${Y1}H${X0}Z" fill="url(#fill)"/>
<path d="${d}" fill="none" stroke="${C.gold}" stroke-width="2.5" stroke-linejoin="round"/>
<circle cx="${X1}" cy="${y(total)}" r="9" fill="${C.gold}" opacity=".2"/><circle cx="${X1}" cy="${y(total)}" r="4" fill="${C.goldHi}"/>`;
  const foot = `<text x="${X0}" y="282" class="m">${day(t0)}</text><text x="${X1}" y="282" text-anchor="end" class="m">${day(now)}</text>
<text x="${W / 2}" y="304" text-anchor="middle" class="m" opacity=".7">as of ${day(now)}</text>`;
  return card({ title: 'Star history', value: total, unit: total === 1 ? 'star' : 'stars', max, body, foot, logo });
}

/**
 * Today's total added to the saved daily readings ([YYYY-MM-DD, total]); a second run on the same day replaces it.
 * @param {[string, number][]} history @param {number} total @param {number} now
 * @returns {[string, number][]}
 */
function addReading(history, total, now) {
  const today = new Date(now).toISOString().slice(0, 10);
  return [...history.filter(([d]) => d !== today), /** @type {[string, number]} */ ([today, total])].sort((a, b) => a[0].localeCompare(b[0]));
}

/**
 * The downloads over time: before the first daily reading, an estimate from the releases (the download link always
 * serves the newest installer, so by each release date the earlier versions' downloads had happened); then the readings.
 * @param {{ tag: string, at: number, n: number }[]} versions @param {[string, number][]} history
 * @returns {{ est: number[][], real: number[][], releases: number[][] }} [time, downloads] points
 */
function downloadsSeries(versions, history) {
  const real = history.map(([d, n]) => [Date.parse(d), n]);
  const start = real.length ? real[0][0] : Infinity;
  let sum = 0;
  const releases = versions.map((v) => [v.at, (sum += v.n) - v.n]);
  const est = releases.filter(([t]) => t < start);
  if (est.length && real.length) est.push(real[0]); // the dashed line meets the solid one
  return { est, real, releases: releases.filter(([t]) => t < start) };
}

/** @param {ReturnType<typeof downloadsSeries>} s @param {number} now @param {string} [logo] */
function downloadsSvg(s, now, logo) {
  const all = [...s.est, ...s.real];
  const total = all.length ? all[all.length - 1][1] : 0;
  const max = niceMax(total);
  const t0 = all.length ? all[0][0] : now - 864e5;
  const x = (t) => (X0 + ((X1 - X0) * (t - t0)) / Math.max(now - t0, 1)).toFixed(1);
  const y = (n) => (Y1 - ((Y1 - Y0) * n) / max).toFixed(1);
  const line = (pts) => pts.map(([t, n], i) => `${i ? 'L' : 'M'}${x(t)},${y(n)}`).join('');
  const d = line(all);
  const body = all.length
    ? `<path d="${d}L${x(all[all.length - 1][0])},${Y1}L${x(t0)},${Y1}Z" fill="url(#fill)"/>
${s.est.length > 1 ? `<path d="${line(s.est)}" fill="none" stroke="${C.gold}" stroke-width="2.5" stroke-dasharray="6 5" stroke-linecap="round" opacity=".8"/>` : ''}
${s.real.length > 1 ? `<path d="${line(s.real)}" fill="none" stroke="${C.gold}" stroke-width="2.5" stroke-linejoin="round"/>` : ''}
${s.releases.map(([t, n]) => `<circle cx="${x(t)}" cy="${y(n)}" r="3" fill="${C.bg}" stroke="${C.gold}" stroke-width="1.5"/>`).join('')}
<circle cx="${x(all[all.length - 1][0])}" cy="${y(total)}" r="9" fill="${C.gold}" opacity=".2"/><circle cx="${x(all[all.length - 1][0])}" cy="${y(total)}" r="4" fill="${C.goldHi}"/>`
    : '';
  const since = s.real.length ? `counted daily since ${day(s.real[0][0])}` : 'counted daily from now on';
  const foot = `<text x="${X0}" y="282" class="m">${day(t0)}</text><text x="${X1}" y="282" text-anchor="end" class="m">${day(now)}</text>
<text x="${W / 2}" y="304" text-anchor="middle" class="m" opacity=".7">Windows installer downloads, update checks left out · dashed: estimated from releases (dots), ${since}</text>`;
  return card({ title: 'Downloads', value: total, unit: 'installer downloads', max, body, foot, logo });
}

// GitHub's REST API, every page (Link: rel="next").
async function gh(url, accept = 'application/vnd.github+json') {
  const out = [];
  for (let next = `https://api.github.com/${url}${url.includes('?') ? '&' : '?'}per_page=100`; next;) {
    const res = await fetch(next, { headers: { accept, authorization: `Bearer ${process.env.GITHUB_TOKEN}`, 'user-agent': 'jarchi-charts' } });
    if (!res.ok) throw new Error(`${url}: ${res.status} ${await res.text()}`);
    out.push(...(await res.json()));
    next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') ?? '')?.[1] ?? '';
  }
  return out;
}

// The saved daily readings: the one thing that can't be fetched again, since GitHub keeps no download history.
function loadHistory(file) {
  if (!file || !fs.existsSync(file)) return [];
  const h = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(h) || !h.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r?.[0]) && Number.isInteger(r[1]))) throw new Error(`${file} isn't a downloads history`);
  return h;
}

async function main(dir, prevHistory) {
  const now = Date.now();
  const logo = fs.readFileSync(path.join(__dirname, '..', 'assets', 'brand', 'icons', 'jarchi-64.png')).toString('base64');
  const stars = await gh(`repos/${REPO}/stargazers`, 'application/vnd.github.star+json');
  const releases = (await Promise.all(RELEASE_REPOS.map((r) => gh(`repos/${r}/releases`)))).flat().filter((r) => !r.draft);
  const versions = installsByVersion(releases);
  const installs = versions.reduce((s, v) => s + v.n, 0);
  const history = addReading(loadHistory(prevHistory), installs, now);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'stars.svg'), starsSvg(starsSeries(stars.map((s) => s.starred_at)), now, logo));
  fs.writeFileSync(path.join(dir, 'downloads.svg'), downloadsSvg(downloadsSeries(versions, history), now, logo));
  fs.writeFileSync(path.join(dir, 'downloads-history.json'), JSON.stringify(history));
  // A shields.io endpoint badge: https://img.shields.io/endpoint?url=<raw installs.json>
  fs.writeFileSync(
    path.join(dir, 'installs.json'),
    JSON.stringify({ schemaVersion: 1, label: 'downloads', message: installs.toLocaleString('en'), color: 'd6a83e' }),
  );
  console.log(`${stars.length} stars, ${installs} installer downloads over ${versions.length} versions`);
}

module.exports = { starsSeries, installsByVersion, addReading, downloadsSeries, starsSvg, downloadsSvg, niceMax };

if (require.main === module)
  main(process.argv[2] || 'charts-out', process.argv[3]).catch((e) => {
    console.error(e);
    process.exit(1);
  });
