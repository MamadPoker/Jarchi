// Twitch badge images and profile pictures.
// Without a key: Twitch's own images for the common global badges (fixed files on Twitch's CDN, no key needed).
// With a key: every global badge, the channel's custom subscriber badges, and viewers' profile pictures.
// THE KEY GOES HERE, via .env (create an app at https://dev.twitch.tv/console, no user login needed):
//   TWITCH_CLIENT_ID=...
//   TWITCH_CLIENT_SECRET=...
const CDN = 'https://static-cdn.jtvnw.net/badges/v1';
const BUILT_IN = {
  broadcaster: '5527c58c-fb7d-422d-b71b-f309dcb85cc1',
  moderator: '3267646d-33f0-4b17-b3df-f923a41db1d0',
  vip: 'b817aba4-fad8-49e2-b88a-7cc744dfa6ec',
  partner: 'd12a2e27-16f6-41d0-ab77-b780518f00a3',
  subscriber: '5d9f2208-5dd8-11e7-8513-2ff4adfae661',
  founder: '511b78a9-ab37-472f-9569-457753bbe7d3',
  premium: 'bbbe0db0-a598-423e-86d0-f9fb98ca1933',
  turbo: 'bd444ec6-8f34-4bf9-91f4-af1e3428d80f',
  staff: 'd97c37bd-a6f5-4c38-8f57-4e4bef88af34',
  'artist-badge': '4300a897-03dc-4e83-8c0e-c332fee7057f',
};

const hasKey = () => !!(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET);
const fromHelix = new Map(); // 'set/version' -> image url (global first, the channel's own on top)
let token = null, tokenUntil = 0;

async function appToken() {
  if (token && Date.now() < tokenUntil) return token;
  const q = new URLSearchParams({ client_id: process.env.TWITCH_CLIENT_ID, client_secret: process.env.TWITCH_CLIENT_SECRET, grant_type: 'client_credentials' });
  const res = await fetch(`https://id.twitch.tv/oauth2/token?${q}`, { method: 'POST', signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`twitch token ${res.status}`);
  const j = await res.json();
  token = j.access_token;
  tokenUntil = Date.now() + (j.expires_in - 60) * 1000;
  return token;
}

async function helix(path) {
  const res = await fetch(`https://api.twitch.tv/helix/${path}`, {
    headers: { 'client-id': process.env.TWITCH_CLIENT_ID, authorization: `Bearer ${await appToken()}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`helix ${path} ${res.status}`);
  return res.json();
}

// Called when the bot joins a channel (roomId = the channel's Twitch user id). Does nothing without a key.
async function loadChannel(roomId) {
  if (!hasKey()) return;
  try {
    const [global, channel] = await Promise.all([helix('chat/badges/global'), helix(`chat/badges?broadcaster_id=${roomId}`)]);
    fromHelix.clear();
    for (const set of [...global.data, ...channel.data]) for (const v of set.versions) fromHelix.set(`${set.set_id}/${v.id}`, v.image_url_2x);
  } catch (err) {
    console.warn('Twitch badges:', err.message);
  }
}

const image = (set, version) => fromHelix.get(`${set}/${version}`) ?? (BUILT_IN[set] ? `${CDN}/${BUILT_IN[set]}/2` : null);

// Profile picture by login, or null without a key.
const avatars = new Map();
async function avatar(login) {
  if (!hasKey()) return null;
  if (avatars.has(login)) return avatars.get(login);
  try {
    const j = await helix(`users?login=${encodeURIComponent(login)}`);
    const url = j.data[0]?.profile_image_url ?? null;
    if (avatars.size > 500) avatars.delete(avatars.keys().next().value);
    avatars.set(login, url);
    return url;
  } catch {
    return null;
  }
}

module.exports = { image, loadChannel, avatar, hasKey };
