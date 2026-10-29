// Dev runs only (server/index.js DEV): they don't update themselves (electron/main.js updates the installed app only),
// so they'd never hear of a new version. This asks where the installed app's updates come from (package.json
// build.publish, electron-updater's own config: GitHub releases, so a move there is followed) a minute after start
// (Jarchi's own connections first; a test run is over by then) and every 6 hours. A newer version than this copy's
// -> latest() and 'found': the panel's banner. Offline, blocked, rate limited: nothing, the next check tries again.
const { EventEmitter } = require('node:events');
const { version, build } = require('../package.json');

const FIRST_MS = 60 * 1000, EVERY_MS = 6 * 3600 * 1000;
const events = new EventEmitter(); // 'found' { version, url }
let latest = null; // the newest release, when it's newer than this copy: { version, url (its page) }

// "1.0.10" > "1.0.9"; a pre-release part ("-beta.1") is ignored.
function newer(a, b) {
  const [x, y] = [a, b].map((v) => v.split(/[.-]/).slice(0, 3).map(Number));
  const i = x.findIndex((n, k) => n !== y[k]);
  return i >= 0 && x[i] > y[i];
}

async function check() {
  const { provider, owner, repo } = build?.publish ?? {};
  if (provider !== 'github') return; // ponytail: GitHub releases only, as now; another provider: read its latest.yml
  try {
    // GitHub's latest: the newest published release, never a draft or a pre-release
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'jarchi' }, signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return;
    const r = await res.json();
    const v = /^v?(\d+\.\d+\.\d+)$/.exec(r.tag_name ?? '')?.[1];
    if (!v || !newer(v, version) || latest?.version === v) return;
    const page = `https://github.com/${owner}/${repo}/releases/`;
    latest = { version: v, url: typeof r.html_url === 'string' && r.html_url.startsWith(page) ? r.html_url : `${page}latest` };
    events.emit('found', latest);
  } catch {} // offline or blocked: the next check
}

function start() {
  setTimeout(check, FIRST_MS).unref();
  setInterval(check, EVERY_MS).unref();
}

module.exports = { start, check, newer, latest: () => latest, events };
