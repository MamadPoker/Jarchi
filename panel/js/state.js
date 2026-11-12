let S, EN, settings, samples, goalData; // S: the panel's strings, EN: English for the overlays. goalData = { state, styles, fonts } from /api/goals; state then follows the socket
let chatStyles,
  chatFonts,
  chatStatus,
  chatExclusive = {}; // (chatExclusive: unlocked exclusive designs, id -> name { en, fa }, core/designs.js)
// chat style looks and fonts (/api/chat/styles), connection status (follows the socket)
let chatThumbs; // sample messages for the chat style thumbnails (/api/chat/thumbs: random viewers and badges each visit)
let view = 'home',
  cur = 'follow',
  curGoal = 'subs',
  topic = 'start'; // the open page, and the alert, goal and guide topic selected in theirs
let queue = { paused: false, overlays: 0, waiting: 0, now: null }; // the alert queue (follows the socket)
let home,
  open = {},
  feedFilter = 'all'; // Home: { today, started, kickGoals } (/api/home, then the socket), widget pages open now (socket)
let hist = { list: [], filter: 'all', page: 0 }; // every saved event (/api/history, then the socket): Home's live feed and History; History's filter and page
let twitch; // the Twitch account: { state, error, code, uri, login, goals } (/api/twitch, then the socket)
let kick; // the Kick account: { state, error, uri, login } (/api/kick, then the socket)
let privacy; // the Privacy Policy: { version, en, fa } (i18n/privacy.json)
let showGoalTab; // the Goals list's Kick | Twitch tab (wireTabs, in build())
let viewerData; // the Viewers widget's { styles, fonts } (/api/viewers)
// The Viewers page's preview: one of its OBS links (remembered in this browser).
const VIEWER_SOURCES = ['kick', 'twitch', 'total'];
const viewerSource = () => (VIEWER_SOURCES.includes(remember.get('jarchi.viewersSource')) ? remember.get('jarchi.viewersSource') : 'total');

const pct = (v) => `${Math.round(v * 100)}%`;
const px = (v) => `${v}px`;
const FORMAT = {
  volume: pct,
  frameOpacity: pct,
  frameRadius: px,
  fontSize: px,
  bgOpacity: pct,
  borderWidth: px,
  radius: px,
  scale: pct,
  size: pct,
  emoteSize: px,
  bigEmoteSize: px,
  badgeSize: pct,
  nameSize: px,
  padding: px,
  gap: px,
  width: px,
  height: px,
  fadeZone: px,
  blur: px,
  tickerSpeed: (v) => `${v} px/s`,
  maxMessages: (v) => String(v),
  hideAfter: (v) => (Number(v) ? tpl(S.panel.seconds, { n: v }) : S.panel.never),
  animSpeed: (v) => `×${v}`,
};
const GOAL_STEP = { subs: 1, kicks: 100, followers: 1, twitchSubs: 1, bits: 100, twitchFollowers: 1 }; // what "Test", "+" and "−" add
const GOAL_SAMPLE = {
  subs: { current: 32, target: 50 },
  kicks: { current: 640, target: 1000 },
  followers: { current: 374, target: 500 }, // numbers on style thumbnails
  twitchSubs: { current: 32, target: 50 },
  bits: { current: 3200, target: 5000 },
  twitchFollowers: { current: 374, target: 500 },
};
// Each goal is Kick's or Twitch's (its group on the Goals page). Outside its group it's named with its platform: "Sub goal (Twitch)".
const TWITCH_GOALS = ['twitchSubs', 'bits', 'twitchFollowers'];
const goalPlatform = (id) => (TWITCH_GOALS.includes(id) ? 'twitch' : 'kick');
const goalName = (id) => tpl(S.panel.goalOn, { goal: S.goals[id].name, platform: S.platforms[goalPlatform(id)] });
const isVideo = (file) => /\.(webm|mp4)$/.test(file ?? '');
const tpl = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => v[k] ?? m);
const kickLook = (type, cfg) => type === 'kicks' && cfg.look === 'kick';
// What plays when there's no file: the theme's, or (Kicks in its Kick look) Kick's gift and the Kick chime; bits show Twitch's gem.
const defaultMedia = (kind, kick) =>
  S.panel[kind === 'image' ? (kick ? 'mediaKickGift' : cur === 'bits' ? 'mediaTwitchGem' : 'mediaDefault') : kick ? 'soundKickDefault' : 'tierNoSound'];
const ACCEPT = { image: 'image/png,image/jpeg,image/gif,image/webp,video/webm,video/mp4,.webm,.mp4', sound: 'audio/mpeg,audio/wav,audio/ogg,.mp3,.wav,.ogg' };
const valueOf = (inp) => (inp.type === 'checkbox' ? inp.checked : ['number', 'range'].includes(inp.type) ? Number(inp.value) : inp.value);
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};

// The lists inside the Alerts and Goals pages: a click opens the item, its switch turns it on or off.
const ALERT_ORDER = ['follow', 'sub', 'gift_sub', 'resub', 'raid', 'kicks', 'bits'];
// Alerts from one platform only (the list shows its logo); the others play for both Kick and Twitch.
const ALERT_PLATFORMS = { kicks: ['kick'], bits: ['twitch'] };
const LISTS = () => ({
  alert: ALERT_ORDER.map((t) => ({ key: t, label: S.types[t], toggle: (on) => patchAlert(t, { enabled: on }) })),
  goal: Object.keys(settings.goals).map((id) => ({ key: id, label: S.goals[id].name, toggle: (on) => patchGoal(id, { enabled: on }) })),
});
