// 7TV emotes: the global set plus the set of each connected channel (Twitch and Kick), cached in memory
// and refreshed every few minutes. Public API, no key needed.
const API = 'https://7tv.io/v3';
const REFRESH_MS = 5 * 60 * 1000;

const global = new Map(); // name -> emote
const channels = { twitch: { userId: null, emotes: new Map() }, kick: { userId: null, emotes: new Map() } };
let globalLoaded = 0;

const toEmote = (e) => {
  const host = `https:${e.data?.host?.url ?? ''}`;
  return { name: e.name, src: `${host}/2x.webp`, still: `${host}/2x_static.webp`, animated: !!e.data?.animated };
};
const toMap = (list) => new Map((list ?? []).filter((e) => e?.name && e.data?.host?.url).map((e) => [e.name, toEmote(e)]));

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`7tv ${res.status}`);
  return res.json();
}

async function loadGlobal() {
  try {
    const set = await getJson(`${API}/emote-sets/global`);
    global.clear();
    for (const [k, v] of toMap(set.emotes)) global.set(k, v);
    globalLoaded = Date.now();
  } catch (err) {
    console.warn('7TV global emotes:', err.message);
  }
}

// platform: 'twitch' (Twitch user id = room id) or 'kick' (Kick user id). A channel without 7TV just has none.
async function loadChannel(platform, userId) {
  const c = channels[platform];
  c.userId = userId ? String(userId) : null;
  if (!c.userId) return c.emotes.clear();
  try {
    const user = await getJson(`${API}/users/${platform}/${c.userId}`);
    if (c.userId === String(userId)) c.emotes = toMap(user.emote_set?.emotes);
  } catch {
    c.emotes = new Map(); // not on 7TV (404) or 7TV unreachable: no channel emotes
  }
}

setInterval(() => {
  if (globalLoaded) loadGlobal();
  for (const [platform, c] of Object.entries(channels)) if (c.userId) loadChannel(platform, c.userId);
}, REFRESH_MS).unref();

// The channel's own 7TV emote wins over a global one with the same name.
const find = (platform, name) => channels[platform]?.emotes.get(name) ?? global.get(name) ?? null;

// Turn 7TV emote names inside the text parts of a message into emote parts.
function enrich(platform, parts) {
  if (!global.size && !channels[platform]?.emotes.size) return parts;
  const out = [];
  for (const p of parts) {
    if (p.t !== 'text') { out.push(p); continue; }
    for (const piece of p.v.split(/(\s+)/)) {
      const e = piece && find(platform, piece);
      if (e) out.push({ t: 'emote', name: e.name, src: e.src, still: e.still, provider: '7tv' });
      else if (piece) {
        const last = out[out.length - 1];
        if (last?.t === 'text') last.v += piece;
        else out.push({ t: 'text', v: piece });
      }
    }
  }
  return out;
}

const someGlobal = (n) => [...global.values()].slice(0, n);

// For tests: put emotes in directly instead of loading them.
function _set(platform, list) {
  const target = platform === 'global' ? global : channels[platform].emotes;
  target.clear();
  for (const e of list) target.set(e.name, e);
}

module.exports = { loadGlobal, loadChannel, enrich, find, someGlobal, _set };
