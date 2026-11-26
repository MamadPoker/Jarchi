// ClipQ (panel/js/clipq.js): while the queue is open, a clip link sent in Kick or Twitch chat joins it by itself, no
// command needed; nothing plays until the streamer presses Play (or Auto next goes on to the next one). Its settings are
// kept in data/clipq.json, not settings.json, like the Luck page's (no Ctrl+Z step, nothing for the OBS widgets); the
// queue itself only while Jarchi runs. Mods (and the streamer) can run it from chat when the streamer allows it.
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { DATA_DIR } = require('./config');
const store = require('./store');
const { bus } = require('./events');
const kick = require('../connectors/kick-chat');
const twitchAccount = require('../connectors/twitch-account');

const FILE = path.join(DATA_DIR, 'clipq.json');
const SOURCES = ['youtube', 'instagram', 'twitch', 'kick'];
const COMMANDS = ['skip', 'remove', 'block', 'close'];
// perViewer: clips one viewer can have in the queue at the same time (the one on now counts), 0 = no limit.
const DEFAULTS = {
  sources: SOURCES,
  perViewer: 2,
  showSender: true,
  noRepeats: true,
  autoNext: false,
  mods: false,
  commands: { skip: true, remove: true, block: true, close: true },
};
const MAX = 200; // clips waiting: a flood of links stops here
const PLAYED = 5; // Played: the last clips Next took out of the player, for Previous

const bool = (v) => typeof v === 'boolean';
const RULES = {
  sources: (v) => Array.isArray(v) && v.length >= 1 && v.every((s) => SOURCES.includes(s)) && new Set(v).size === v.length,
  perViewer: (v) => [0, 1, 2, 3].includes(v),
  showSender: bool,
  noRepeats: bool,
  autoNext: bool,
  mods: bool,
  commands: (v) => v && typeof v === 'object' && !Array.isArray(v) && Object.entries(v).every(([k, x]) => COMMANDS.includes(k) && bool(x)),
};
const bad = () => Object.assign(new Error('bad_request'), { status: 400, code: 'bad_request' });

let saved = store.load(FILE);
// The saved values that still pass their rules, the defaults for the rest (commands: one by one).
function get() {
  const out = Object.fromEntries(Object.entries(DEFAULTS).map(([k, d]) => [k, k !== 'commands' && RULES[k](saved[k]) ? saved[k] : d]));
  out.commands = { ...DEFAULTS.commands, ...(RULES.commands(saved.commands) && saved.commands) };
  return out;
}

const events = new EventEmitter(); // 'state': the settings or the queue changed
let open = false,
  now = null, // the clip in the player: { id, source, key, vid, link, vertical, title, thumb, video, by, at }
  queue = [], // the clips after it, in the order they came
  played = []; // the clips before it, the last one first
const seen = new Set(), // source:id of every clip since the queue last opened (Skip repeated links)
  blocked = new Set(); // names a mod's !block keeps out until the queue closes
const state = () => ({ settings: get(), open, now, queue, played });
const changed = () => (events.emit('state', state()), state());

// A change from the panel: the fields it sends replace the saved ones (commands: one by one). One bad field: nothing changes.
function update(patch) {
  if (!patch || typeof patch !== 'object' || Object.entries(patch).some(([k, v]) => !RULES[k]?.(v))) throw bad();
  const { commands, ...rest } = patch;
  saved = { ...saved, ...rest, ...(commands && { commands: { ...get().commands, ...commands } }) };
  store.save(FILE, saved);
  return changed();
}

// ---------- Links ----------
// One word of a chat message -> the clip it links to: { source, vid, key, link (its page, the same however it was
// written), vertical }, or null. With or without https://, www. or m.
const ID = { youtube: /^[\w-]{11}$/, instagram: /^[\w-]{5,40}$/, twitch: /^[\w-]{3,100}$/, kick: /^clip_[0-9a-z]{26}$/i };
function clipOf(word) {
  let u;
  try {
    u = new URL(/^https?:\/\//i.test(word) ? word : `https://${word}`);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, ''),
    p = u.pathname.split('/').filter(Boolean);
  const clip = (source, vid, link, vertical = false) => (ID[source].test(vid ?? '') ? { source, vid, key: `${source}:${vid}`, link, vertical } : null);
  if (host === 'youtu.be') return clip('youtube', p[0], `https://www.youtube.com/watch?v=${p[0]}`);
  if (host === 'youtube.com') {
    if (p[0] === 'shorts') return clip('youtube', p[1], `https://www.youtube.com/shorts/${p[1]}`, true);
    const v = p[0] === 'watch' && u.searchParams.get('v');
    return v ? clip('youtube', v, `https://www.youtube.com/watch?v=${v}`) : null;
  }
  if (host === 'instagram.com') {
    const i = p.findIndex((x) => ['reel', 'reels', 'p', 'tv'].includes(x)), // instagram.com/<name>/reel/<code> too
      post = p[i] === 'p';
    return i < 0 ? null : clip('instagram', p[i + 1], `https://www.instagram.com/${post ? 'p' : 'reel'}/${p[i + 1]}/`, true);
  }
  if (host === 'clips.twitch.tv') return p[0] === 'embed' ? null : clip('twitch', p[0], `https://clips.twitch.tv/${p[0]}`);
  if (host === 'twitch.tv') {
    const i = p.indexOf('clip'); // twitch.tv/<channel>/clip/<slug>, m.twitch.tv/clip/<slug>
    return i < 0 ? null : clip('twitch', p[i + 1], `https://clips.twitch.tv/${p[i + 1]}`);
  }
  if (host === 'kick.com' && p[0]) {
    const id = p[1] === 'clips' ? p[2] : u.searchParams.get('clip'); // kick.com/<channel>/clips/<id>, kick.com/<channel>?clip=<id>
    return clip('kick', id, `https://kick.com/${p[0]}/clips/${id}`);
  }
  return null;
}
// Every clip link in a message, from the sites the queue takes ("(link)." is the link).
const clipsIn = (text, sources) =>
  String(text)
    .split(/\s+/)
    .map((w) => clipOf(w.replace(/^[([{<'"«]+|[)\]}>.,!?'"»؛،]+$/g, '')))
    .filter((c) => c && sources.includes(c.source));

// Its title, picture and (Kick, Instagram) the video, asked once it's in the queue; until then (looked: false) the panel
// names it by its site. A site that doesn't answer leaves it as it is: it still plays, but a Kick clip needs Kick's
// answer to, and an Instagram one without its video plays in Instagram's embed, which takes none of Jarchi's buttons.
const https = (u) => (/^https:\/\//.test(u ?? '') ? u : null);
const title = (t) => String(t ?? '').slice(0, 200);
// An Instagram clip's video on Instagram's CDN, from its embed page: the post's data is in it (contextJSON, a JSON
// string), when it's asked for without a browser's headers (tested). null: a photo, several in one post, or not there.
function igVideo(html) {
  try {
    const json = String(html).match(/"contextJSON":("(?:[^"\\]|\\.)*")/)?.[1],
      v = json && JSON.parse(JSON.parse(json)).gql_data?.shortcode_media?.video_url;
    return /^https:\/\/[\w.-]+\.(fbcdn\.net|cdninstagram\.com)\/\S+\.mp4(\?\S*)?$/.test(v ?? '') ? v : null;
  } catch {
    return null;
  }
}
async function look(c) {
  try {
    if (c.source === 'youtube') {
      const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(c.link)}`, { signal: AbortSignal.timeout(10000) });
      if (r.ok) c.title = title((await r.json()).title);
    } else if (c.source === 'twitch') {
      const t = await twitchAccount.clip(c.vid); // only with the Twitch account connected
      if (t) Object.assign(c, { title: title(t.title), thumb: https(t.thumbnail_url) });
    } else if (c.source === 'kick') {
      const { status, json } = await kick.kickGet(`/api/v2/clips/${c.vid}`),
        k = status === 200 && json?.clip;
      if (k)
        Object.assign(c, {
          title: title(k.title),
          thumb: https(k.thumbnail_url),
          video: /^https:\/\/clips\.kick\.com\/\S+\.m3u8$/.test(k.clip_url ?? '') ? k.clip_url : null,
        });
    } else if (c.source === 'instagram') {
      const r = await fetch(`${c.link}embed/`, { signal: AbortSignal.timeout(10000) });
      if (r.ok) c.video = igVideo(await r.text());
    }
  } catch {}
  c.looked = true;
  if (now === c || queue.includes(c)) changed();
}

// ---------- The queue ----------
const who = (by) => `${by.platform}:${by.login}`;
const nameKey = (n) => String(n).toLowerCase().replace(/^@/, '').replace(/_/g, '-'); // Kick's login is its name with - for _
function take(m) {
  const s = get(),
    by = { platform: m.platform, login: m.user.login, name: m.user.name || m.user.login };
  if (blocked.has(nameKey(by.login)) || blocked.has(nameKey(by.name))) return;
  let added = 0;
  for (const c of clipsIn(m.text, s.sources)) {
    const mine = [now, ...queue].filter((x) => x && who(x.by) === who(by)).length;
    if (queue.length >= MAX || (s.perViewer && mine >= s.perViewer)) break;
    if (s.noRepeats && (seen.has(c.key) || [now, ...queue].some((x) => x?.key === c.key))) continue;
    seen.add(c.key);
    const clip = {
      id: randomUUID(),
      ...c,
      title: '',
      thumb: c.source === 'youtube' ? `https://i.ytimg.com/vi/${c.vid}/mqdefault.jpg` : null,
      video: null,
      looked: false,
      by,
      at: Date.now(),
    };
    if (now) queue.push(clip);
    else now = clip; // nothing in the player: this one waits there for Play
    added++;
    look(clip);
  }
  if (added) changed();
}

function setOpen(on) {
  if (on && !open) seen.clear();
  if (!on) blocked.clear();
  open = on;
  return changed();
}
// The next clip into the player (none left: an empty player); the one it was on goes to Played. from: the clip the
// window was on, so two windows that both finished it go on only once.
function next(from) {
  if (from && now?.id !== from) return state();
  if (now) played = [now, ...played].slice(0, PLAYED);
  now = queue.shift() ?? null;
  return changed();
}
// Previous (no id: the last one played), or a clip of Played, back into the player; the one it was on goes back to the
// top of Up next, so a Next pressed by mistake loses nothing.
function back(id, from) {
  const c = id ? played.find((x) => x.id === id) : played[0];
  if (!c || (from && now?.id !== from)) return state();
  played = played.filter((x) => x !== c);
  if (now) queue.unshift(now);
  now = c;
  return changed();
}
// Out of Up next; the clip in the player: gone, the next one in, and not to Played (it was taken out, not played).
function remove(id) {
  if (now?.id === id) now = queue.shift() ?? null;
  else queue = queue.filter((c) => c.id !== id);
  return changed();
}
// Clear queue: everything waiting goes; the clip in the player stays.
function clear() {
  queue = [];
  return changed();
}

// ---------- Chat ----------
// Persian and Arabic keyboards' digits count too: "!remove ۲".
const digits = (s) => s.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0)).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660));
const isMod = (m) => m.user.badges.some((b) => b.type === 'moderator' || b.type === 'broadcaster');
// A mod's (or the streamer's) command, when "Mods can manage the queue" and that command are on.
function command(m, text) {
  const s = get(),
    [cmd, arg = ''] = text.toLowerCase().split(/\s+/);
  if (!s.mods || !isMod(m)) return;
  if (cmd === '!skip' && s.commands.skip) next();
  else if (cmd === '!remove' && s.commands.remove) {
    const c = queue[Number(digits(arg)) - 1];
    if (/^\d+$/.test(digits(arg)) && c) remove(c.id);
  } else if (cmd === '!block' && s.commands.block && open && /^@?[\w-]{1,30}$/.test(arg)) blocked.add(nameKey(arg));
  else if (cmd === '!clipq' && arg === 'close' && s.commands.close && open) setOpen(false);
}
function heard(m) {
  if (m.test || m.kind !== 'message' || !m.user?.login) return;
  const text = m.text.trim();
  if (text.startsWith('!')) command(m, text);
  else if (open) take(m);
}
bus.on('chat', heard);

module.exports = { get, update, state, setOpen, next, back, remove, clear, clipsIn, igVideo, heard, events };
