// Twitch badge images and profile pictures.
// Without a key: Twitch's own images for the common global badges (fixed files on Twitch's CDN, no key needed;
// versions with their own image are listed as 'set/version').
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
  'sub-gifter/1': 'a5ef6c17-2e5b-4d8f-9b80-2779fd722414', 'sub-gifter/5': 'ee113e59-c839-4472-969a-1e16d20f3962',
  'sub-gifter/10': 'd333288c-65d7-4c7b-b691-cdd7b3484bf8', 'sub-gifter/25': '052a5d41-f1cc-455c-bc7b-fe841ffaf17f',
  'sub-gifter/50': 'c4a29737-e8a5-4420-917a-314a447f083e', 'sub-gifter/100': '8343ada7-3451-434e-91c4-e82bdcf54460',
  'sub-gifter/150': '514845ba-0fc3-4771-bce1-14d57e91e621', 'sub-gifter/200': 'c6b1893e-8059-4024-b93c-39c84b601732',
  'sub-gifter/250': 'cd479dc0-4a15-407d-891f-9fd2740bddda', 'sub-gifter/300': '9e1bb24f-d238-4078-871a-ac401b76ecf2',
  'sub-gifter/350': '6c4783cd-0aba-4e75-a7a4-f48a70b665b0', 'sub-gifter/400': '6f4cab6b-def9-4d99-ad06-90b0013b28c8',
  'sub-gifter/450': 'b593d68a-f8fb-4516-a09a-18cce955402c', 'sub-gifter/500': '60e9504c-8c3d-489f-8a74-314fb195ad8d',
  'sub-gifter/550': '024d2563-1794-43ed-b8dc-33df3efae900', 'sub-gifter/600': '3ecc3aab-09bf-4823-905e-3a4647171fc1',
  'sub-gifter/650': 'eeabf43c-8e4c-448d-9790-4c2172c57944', 'sub-gifter/700': '4a9acdc7-30be-4dd1-9898-fc9e42b3d304',
  'sub-gifter/750': 'ca17277c-53e5-422b-8bb4-7c5dcdb0ac67', 'sub-gifter/800': '9c1fb96d-0579-43d7-ba94-94672eaef63a',
  'sub-gifter/850': 'cc924aaf-dfd4-4f3f-822a-f5a87eb24069', 'sub-gifter/900': '193d86f6-83e1-428c-9638-d6ca9e408166',
  'sub-gifter/950': '7ce130bd-6f55-40cc-9231-e2a4cb712962', 'sub-gifter/1000': 'bfb7399a-c632-42f7-8d5f-154610dede81',
  'sub-gifter/2000': '4e8b3a32-1513-44ad-8a12-6c90232c77f9', 'sub-gifter/3000': 'b18852ba-65d2-4b84-97d2-aeb6c44a0956',
  'sub-gifter/4000': 'efbf3c93-ecfa-4b67-8d0a-1f732fb07397', 'sub-gifter/5000': 'd775275d-fd19-4914-b63a-7928a22135c3',
};

const hasKey = () => !!(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET);
const fromHelix = new Map(); // 'set/version' -> image url (global first, the channel's own on top)
let channelSubs = []; // with the key: the channel's own sub badge tiers (months, tier 1)
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
    for (const set of [...global.data, ...channel.data]) for (const v of set.versions) fromHelix.set(`${set.set_id}/${v.id}`, v.image_url_4x ?? v.image_url_2x);
    channelSubs = (channel.data.find((set) => set.set_id === 'subscriber')?.versions ?? []).map((v) => Number(v.id)).filter((n) => n < 1000);
  } catch (err) {
    console.warn('Twitch badges:', err.message);
  }
}

function image(set, version) {
  const id = BUILT_IN[`${set}/${version}`] ?? BUILT_IN[set];
  return fromHelix.get(`${set}/${version}`) ?? (id ? `${CDN}/${id}/3` : null); // 3 = 72 px, Twitch's sharpest
}

// The sub badge version Twitch shows for `months` of subscribing: the channel's highest tier up to that, else the default.
const subVersion = (months) => String(Math.max(0, ...channelSubs.filter((n) => n <= months)));

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

module.exports = { image, subVersion, loadChannel, avatar, hasKey };
