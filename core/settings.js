// Settings = defaults + whatever the user changed. Only the changes are stored, so "reset" is just deleting them.
const fs = require('node:fs');
const path = require('node:path');
const { DATA_DIR, UPLOADS_DIR } = require('./config');
const { TYPES } = require('./events');
const store = require('./store');
const strings = require('../i18n/en.json');

const FILE = path.join(DATA_DIR, 'settings.json');
const VERSION = 9;
// 'none': no box, background or effects, just the picture and outlined text.
const THEMES = ['neon', 'minimal', 'fun', 'retro', 'glass', 'fire', 'ice', 'galaxy', 'comic', 'simple', 'none'];
// App-wide settings (not per alert). showBadge: platform badge on alerts; it still needs both Kick and Twitch connected.
// alertGap: seconds between two alerts. proxy*: how Jarchi reaches Kick, Twitch, 7TV and its relay (core/net.js);
// proxyFound: the VPN app's proxy the user said Yes to (core/vpn.js), used in auto mode. A 'system' mode saved before
// auto replaced it reads as the default (get() keeps only valid values), so it needs no migration.
// kickGoalSync / twitchGoalSync: goals set on the Kick / Twitch channel show that platform's numbers (core/goals.js).
// welcomed: the panel's welcome tour was shown (it opens by itself once, on the first run).
// privacyAccepted: the version of the Privacy Policy (i18n/privacy.json) the user accepted, 0 = none yet.
const GLOBAL = { theme: 'neon', showBadge: true, alertGap: 0.5, proxyMode: 'auto', proxyType: 'http', proxyHost: '', proxyPort: 0, proxyFound: null, kickGoalSync: true, twitchGoalSync: true, welcomed: false, privacyAccepted: 0 };
const PROXY_HOST = /^[a-z0-9.:[\]_-]{0,253}$/i;
const proxyPort = (v) => Number.isInteger(v) && v >= 0 && v <= 65535;
const GLOBAL_RULES = {
  theme: (v) => THEMES.includes(v),
  showBadge: (v) => typeof v === 'boolean',
  welcomed: (v) => typeof v === 'boolean',
  privacyAccepted: (v) => Number.isInteger(v) && v >= 0,
  kickGoalSync: (v) => typeof v === 'boolean',
  twitchGoalSync: (v) => typeof v === 'boolean',
  alertGap: (v) => typeof v === 'number' && v >= 0 && v <= 60,
  proxyMode: (v) => ['off', 'auto', 'manual'].includes(v),
  proxyType: (v) => ['http', 'socks5'].includes(v),
  proxyHost: (v) => typeof v === 'string' && PROXY_HOST.test(v),
  proxyPort,
  // { app: its name or null (the Windows proxy), type, host, port } | null
  proxyFound: (v) => v === null || (typeof v === 'object' && Object.keys(v).sort().join() === 'app,host,port,type'
    && (v.app === null || (typeof v.app === 'string' && v.app.length <= 40)) && ['http', 'socks5'].includes(v.type)
    && typeof v.host === 'string' && v.host && PROXY_HOST.test(v.host) && proxyPort(v.port) && v.port > 0),
};
// Follow is small and quick, raid is the big one. minAmount only where an amount makes sense.
// Media by amount (tiersOn + tiers): fixed, ready-made tiers. Saved as tiers: { [amount]: { on, image, sound } };
// get() lists every tier: [{ amount, on, image, sound }], lowest first.
// Kick's own Kicks gifts (web.kick.com/api/v1/kicks/gifts; the same table is in kick.com's web app). Their images are
// in assets/kick-gifts/<id>.webp. If Kick adds a gift: add it here, its image there and its name in i18n kickGifts.
const KICK_GIFTS = [
  { amount: 1, id: 'hell_yeah' }, { amount: 10, id: 'hype' }, { amount: 50, id: 'skull_emoji' }, { amount: 100, id: 'full_send' }, { amount: 500, id: 'rage_quit' },
  { amount: 1000, id: 'pack_it_up' }, { amount: 2000, id: 'yap' }, { amount: 5000, id: 'stomp' }, { amount: 10000, id: 'flex' }, { amount: 50000, id: 'boooom' },
];
// Bits: Twitch's own cheer gems (gray, purple, green, blue, red), in assets/twitch-bits/<amount>.gif.
const TIER_AMOUNTS = { gift_sub: [1, 5, 10, 20, 50, 100], kicks: KICK_GIFTS.map((g) => g.amount), bits: [1, 100, 1000, 5000, 10000] };
const TIERED = { tiersOn: false, tiers: {} };
const PER_TYPE = {
  follow: { duration: 4, fontSize: 38 },
  sub: { duration: 6, fontSize: 46 },
  resub: { duration: 6, fontSize: 46 },
  gift_sub: { duration: 6, fontSize: 46, minAmount: 0, ...TIERED },
  // 1-Kick taps come in floods (goals still count them). look 'kick': the gift that was sent, Kick-style text, no theme.
  kicks: { duration: 6, fontSize: 46, minAmount: 10, look: 'kick', ...TIERED },
  bits: { duration: 6, fontSize: 46, minAmount: 0, ...TIERED },
  raid: { duration: 9, fontSize: 54 },
};
const DEFAULTS = Object.fromEntries(TYPES.map((t) => [t, {
  enabled: true,
  template: strings.templates[t],
  volume: 0.7,
  image: null, // { file, name } once uploaded
  videoSound: 'off',
  sound: null,
  soundMode: 'theme',
  frame: 'theme',
  frameBg: '#14141c',
  frameOpacity: 0.85,
  frameBorder: '#8b5cf6',
  frameRadius: 16,
  textPos: 'below',
  textAlign: 'center',
  size: 1, // how much of the Browser Source the alert fills (0.5-1; Style tab)
  // Text style (Text tab; Reset text style restores these). The viewer's name (name*) and the rest of the text (text*)
  // each have a color (null = the theme's), a font ('theme' or one of ALERT_FONTS), bold (true = the theme's weight)
  // and the theme's outline/shadow (or none). One size for the whole line: autoSize, the biggest that fits; off:
  // fontSize from PER_TYPE, smaller only if it wouldn't fit.
  nameColor: null,
  nameFont: 'theme',
  nameBold: true,
  nameShadow: true,
  textColor: null,
  textFont: 'theme',
  textBold: true,
  textShadow: true,
  autoSize: true,
  theme: null, // null = the main theme
  ...PER_TYPE[t],
}]));
const TEXT_STYLE = ['nameColor', 'nameFont', 'nameBold', 'nameShadow', 'textColor', 'textFont', 'textBold', 'textShadow', 'autoSize', 'fontSize'];
// Bundled fonts (assets/fonts) with both Latin and Persian letters. The panel lists them in index.html (Text tab, Font).
const ALERT_FONTS = ['Vazirmatn', 'Lalezar', 'Changa', 'Lemonada', 'Markazi Text'];

const num = (min, max) => (v) => typeof v === 'number' && v >= min && v <= max;
const oneOf = (...list) => (v) => list.includes(v);
const hex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const RULES = {
  enabled: (v) => typeof v === 'boolean',
  template: (v) => typeof v === 'string' && v.length <= 200,
  duration: num(1, 60),
  volume: num(0, 1),
  minAmount: (v) => Number.isInteger(v) && v >= 0,
  tiersOn: (v) => typeof v === 'boolean',
  look: oneOf('kick', 'theme'),
  videoSound: oneOf('off', 'video', 'both'),
  soundMode: oneOf('theme', 'custom', 'none'),
  frame: oneOf('theme', 'custom', 'off'),
  frameBg: hex,
  frameOpacity: num(0, 1),
  frameBorder: hex,
  frameRadius: num(0, 60),
  size: num(0.5, 1),
  textPos: oneOf('above', 'below', 'over'),
  textAlign: oneOf('left', 'center', 'right'),
  theme: (v) => v === null || THEMES.includes(v),
  fontSize: num(12, 120),
  nameColor: (v) => v === null || hex(v),
  textColor: (v) => v === null || hex(v),
  nameFont: oneOf('theme', ...ALERT_FONTS),
  textFont: oneOf('theme', ...ALERT_FONTS),
  nameBold: (v) => typeof v === 'boolean',
  textBold: (v) => typeof v === 'boolean',
  nameShadow: (v) => typeof v === 'boolean',
  textShadow: (v) => typeof v === 'boolean',
  autoSize: (v) => typeof v === 'boolean',
};
// ---------- Goals ----------
// Kick's goals, then Twitch's (the ids before v6 stay, so their OBS links keep working). Each counts and syncs from its
// own platform only. Followers: only from a goal set on that channel (no follow counting).
const GOAL_IDS = ['subs', 'kicks', 'followers', 'twitchSubs', 'bits', 'twitchFollowers'];
const FONTS = ['Segoe UI', 'Arial Black', 'Impact', 'Trebuchet MS', 'Georgia', 'Consolas'];
// Each style is a complete set of look values; users then tweak any of them. Picking a style or "Reset style" restores these.
// Circle draws no box (its bg, border and radius go unused) and its fontSize is for its 200 px ring.
const GOAL_STYLES = {
  classic: { barColor: '#8b5cf6', barBg: '#2b2e3b', textColor: '#ffffff', fullColor: '#22c55e', bg: 'color', bgColor: '#14141c', bgOpacity: 0.85, border: false, borderColor: '#8b5cf6', borderWidth: 2, radius: 14, scale: 1, font: 'Segoe UI', fontSize: 26, titlePos: 'above', showPercent: false, showNumbers: true },
  pill: { barColor: '#ff5fa2', barBg: '#3a2333', textColor: '#ffffff', fullColor: '#22c55e', bg: 'off', bgColor: '#14141c', bgOpacity: 0.85, border: false, borderColor: '#ffffff', borderWidth: 2, radius: 60, scale: 1, font: 'Segoe UI', fontSize: 24, titlePos: 'inside', showPercent: true, showNumbers: true },
  neon: { barColor: '#00f0ff', barBg: '#0b1530', textColor: '#ffffff', fullColor: '#ff2bd6', bg: 'color', bgColor: '#0a0620', bgOpacity: 0.85, border: true, borderColor: '#00f0ff', borderWidth: 2, radius: 16, scale: 1, font: 'Segoe UI', fontSize: 26, titlePos: 'above', showPercent: true, showNumbers: true },
  circle: { barColor: '#8b5cf6', barBg: '#2b2e3b', textColor: '#ffffff', fullColor: '#22c55e', bg: 'off', bgColor: '#14141c', bgOpacity: 0.85, border: false, borderColor: '#ffffff', borderWidth: 2, radius: 24, scale: 1, font: 'Segoe UI', fontSize: 40, titlePos: 'below', showPercent: true, showNumbers: true },
  text: { barColor: '#8b5cf6', barBg: '#2b2e3b', textColor: '#ffffff', fullColor: '#22c55e', bg: 'off', bgColor: '#14141c', bgOpacity: 0.85, border: false, borderColor: '#ffffff', borderWidth: 2, radius: 12, scale: 1, font: 'Segoe UI', fontSize: 40, titlePos: 'above', showPercent: false, showNumbers: true },
  retro: { barColor: '#ffe14d', barBg: '#2d2d5a', textColor: '#ffffff', fullColor: '#4dd2ff', bg: 'color', bgColor: '#1b1b3a', bgOpacity: 1, border: true, borderColor: '#ffffff', borderWidth: 4, radius: 0, scale: 1, font: 'Consolas', fontSize: 24, titlePos: 'above', showPercent: false, showNumbers: true },
};
const GOAL_LOOK = Object.keys(GOAL_STYLES.classic); // the fields a style sets
const GOAL_DEFAULTS = Object.fromEntries(GOAL_IDS.map((id) => [id, {
  enabled: id === 'subs' || id === 'kicks', // the later ones: off, so the Home page doesn't ask existing users to add them to OBS
  title: strings.goals[id].title,
  target: { subs: 50, kicks: 1000, followers: 100, twitchSubs: 50, bits: 1000, twitchFollowers: 100 }[id],
  style: 'classic',
  celebrate: true,
  celebrateSound: 'theme',
  sound: null, // { file, name } once uploaded
  volume: 0.7,
  autoSize: true, // text: the biggest that fits (off: the style's fontSize, smaller only if it wouldn't fit). Kept when the style changes
}]));
const bool = (v) => typeof v === 'boolean';
const GOAL_RULES = {
  enabled: bool,
  title: (v) => typeof v === 'string' && v.length <= 60,
  target: (v) => Number.isInteger(v) && v >= 1 && v <= 1e9,
  style: (v) => v in GOAL_STYLES,
  celebrate: bool,
  celebrateSound: oneOf('theme', 'custom', 'none'),
  volume: num(0, 1),
  barColor: hex,
  barBg: hex,
  textColor: hex,
  fullColor: hex,
  bg: oneOf('color', 'transparent', 'off'),
  bgColor: hex,
  bgOpacity: num(0, 1),
  border: bool,
  borderColor: hex,
  borderWidth: num(1, 12),
  radius: num(0, 60),
  scale: num(0.5, 1), // how much of the Browser Source the goal fills (a saved size over 1 reads as 1 in the widget)
  autoSize: bool,
  font: oneOf(...FONTS),
  fontSize: num(12, 120),
  titlePos: oneOf('above', 'below', 'inside', 'hidden'),
  showPercent: bool,
  showNumbers: bool,
};

// ---------- Chat ----------
// The Classic look. Every chat style is this plus a few changes; users then tweak any value. Reset style restores them.
const CHAT_BASE = {
  showPlatform: true, showBadges: true, badgeMode: 'important', badgeSize: 1, badgeBroadcaster: true, badgeMod: true, badgeVip: true, badgeSub: true, badgeOther: true, showTime: false, showColon: true,
  emotesAnimated: true, emoteSize: 28, bigEmotes: true, bigEmoteSize: 56,
  font: 'Segoe UI', fontSize: 18, nameSize: 18, nameColorMode: 'user', readableNames: true, nameColor: '#8b5cf6', textColor: '#ffffff', namePos: 'inline', textShadow: true, textDir: 'auto',
  bg: 'color', bgColor: '#14141c', bgOpacity: 0.6, bubbles: false, border: false, borderColor: '#8b5cf6', borderWidth: 2, radius: 12, padding: 12, gap: 6, width: 420, height: 600,
  layout: 'vertical', tickerDir: 'rtl', tickerSpeed: 120, newAt: 'bottom', maxMessages: 30, hideAfter: 0, enterAnim: 'slide', exitAnim: 'fade', animSpeed: 1, fadeZone: 80, fade: true,
  fxSubGlow: true, fxFirst: true, fxRainbowVip: true, fxMention: true, fxCombo: true, avatars: false, blur: 0, typewriter: false, typeSound: false,
  tickerLoop: false,
};
// What the horizontal styles share: a 1920-wide bar that keeps looping the recent messages when chat is quiet.
const BAR = { layout: 'horizontal', width: 1920, height: 64, radius: 0, padding: 10, maxMessages: 15, fadeZone: 120, tickerLoop: true };
// The chat style's look values. The style-<id> CSS class adds what options can't (tails, tape, scanlines, frames...).
const CHAT_STYLES = Object.fromEntries(Object.entries({
  // Kick's own chat: its panel width (340), font (Inter 14px), dark surface (#181b1f), plain lines, no motion.
  kick: { font: 'Inter', fontSize: 14, nameSize: 14, bgColor: '#181b1f', bgOpacity: 0.95, radius: 4, padding: 8, gap: 0, width: 340, textShadow: false,
    showPlatform: false, bigEmotes: false, enterAnim: 'none', exitAnim: 'none', fade: false },
  classic: { bgColor: '#121218', bgOpacity: 0.78, radius: 14, padding: 14 },
  bubbles: { bubbles: true, bgColor: '#ffffff', bgOpacity: 1, textColor: '#1f2330', textShadow: false, namePos: 'above', fontSize: 16, nameSize: 13, radius: 18, padding: 10, gap: 12, enterAnim: 'float' },
  floating: { bg: 'off', padding: 0, gap: 10, fontSize: 22, nameSize: 22, fadeZone: 240, enterAnim: 'fade' },
  neon: { bgColor: '#07031a', bgOpacity: 0.82, border: true, borderColor: '#00f0ff', borderWidth: 2, radius: 14, textColor: '#e8fbff' },
  terminal: { font: 'Consolas', fontSize: 16, nameSize: 16, bgColor: '#0c0c0c', bgOpacity: 0.92, border: true, borderColor: '#3a3a3a', borderWidth: 1, radius: 8, textColor: '#c8ffc8', showTime: true, textShadow: false, emoteSize: 24, enterAnim: 'fade' },
  retro: { font: 'Press Start 2P', fontSize: 12, nameSize: 12, bgColor: '#1b1b3a', bgOpacity: 0.95, border: true, borderColor: '#ffffff', borderWidth: 4, radius: 0, padding: 16, gap: 10, textShadow: false, emoteSize: 24 },
  glass: { bgColor: '#ffffff', bgOpacity: 0.16, border: true, borderColor: '#ffffff', borderWidth: 1, radius: 20, blur: 14 },
  popin: { bubbles: true, bgColor: '#20232e', bgOpacity: 0.92, radius: 22, padding: 10, gap: 8, enterAnim: 'pop', animSpeed: 0.9 },
  side: { bg: 'off', border: true, borderColor: '#8b5cf6', borderWidth: 3, width: 300, height: 900, namePos: 'above', nameSize: 15, gap: 14, padding: 0 },
  ticker: { layout: 'horizontal', width: 1920, height: 64, bgOpacity: 0.85, radius: 0, padding: 10, maxMessages: 15, fadeZone: 120 },
  cyberpunk: { bubbles: true, bgColor: '#0a0a0c', bgOpacity: 0.92, border: true, borderColor: '#fcee0a', borderWidth: 3, radius: 0, padding: 9, gap: 8, textColor: '#e9e9e9', textShadow: false, fontSize: 17, nameSize: 16, enterAnim: 'fade' },
  comic: { bubbles: true, bgColor: '#ffffff', bgOpacity: 1, border: true, borderColor: '#111111', borderWidth: 3, radius: 16, padding: 10, gap: 8, textColor: '#111111', textShadow: false, namePos: 'above', fontSize: 16, nameSize: 21, showColon: false, enterAnim: 'pop' },
  hud: { bgColor: '#04121c', bgOpacity: 0.6, borderColor: '#00e5ff', radius: 2, padding: 18, textColor: '#d8f6ff', nameColor: '#5ff3ff', nameSize: 15, showColon: false },
  sticky: { bubbles: true, bgColor: '#fff27a', bgOpacity: 1, textColor: '#2b2b2b', textShadow: false, nameColor: '#1f1f1f', namePos: 'above', fontSize: 16, nameSize: 15, radius: 3, padding: 12, gap: 16, enterAnim: 'drop' },
  pastel: { bubbles: true, bgColor: '#dccbff', bgOpacity: 1, textColor: '#3b3355', textShadow: false, nameColor: '#2d2546', font: 'Fredoka', fontSize: 17, nameSize: 17, radius: 40, padding: 9, gap: 8, enterAnim: 'bounce' },
  galaxy: { bgColor: '#0b0920', bgOpacity: 0.88, radius: 18, padding: 16, textColor: '#ece8ff', enterAnim: 'float' },
  rpg: { bubbles: true, bgColor: '#13207a', bgOpacity: 0.94, border: true, borderColor: '#ffffff', borderWidth: 3, radius: 6, padding: 12, gap: 24, font: 'Press Start 2P', fontSize: 12, nameSize: 10, textColor: '#ffffff', textShadow: false, namePos: 'above', nameColor: '#ffe066', emoteSize: 24, enterAnim: 'fade', typewriter: true },
  // Horizontal (ticker) styles
  news: { ...BAR, bgColor: '#ffffff', bgOpacity: 1, height: 56, textColor: '#1a1a1a', textShadow: false, padding: 10, fadeZone: 60, tickerSpeed: 110 },
  neonstrip: { ...BAR, bgColor: '#07031a', bgOpacity: 0.9, borderColor: '#ff2bd6', textColor: '#f2e9ff' },
  pills: { ...BAR, bubbles: true, bgColor: '#16161f', bgOpacity: 0.88, radius: 40, padding: 8, gap: 18, fadeZone: 100 },
  minimal: { ...BAR, bg: 'off', height: 72, fontSize: 26, nameSize: 26, padding: 0, tickerSpeed: 70 },
  led: { ...BAR, bgColor: '#050505', bgOpacity: 0.95, radius: 4, font: 'Consolas', fontSize: 22, nameSize: 22, textColor: '#ffb000', textShadow: false, fadeZone: 80 },
  cyberbar: { ...BAR, bgColor: '#0a0a0c', bgOpacity: 0.92, border: true, borderColor: '#fcee0a', borderWidth: 3, textColor: '#0b0b0b', textShadow: false, nameColor: '#0b0b0b', fontSize: 17, nameSize: 16, fadeZone: 80 },
  candy: { ...BAR, bgColor: '#ffffff', bgOpacity: 1, radius: 40, padding: 8, font: 'Fredoka', fontSize: 18, nameSize: 18, textColor: '#3b3355', textShadow: false, nameColor: '#2d2546', tickerDir: 'ltr', fadeZone: 60 },
  glassbar: { ...BAR, bgColor: '#ffffff', bgOpacity: 0.16, border: true, borderColor: '#ffffff', borderWidth: 1, radius: 32, blur: 12, fadeZone: 160 },
  persian: { bgColor: '#0d1b3d', bgOpacity: 0.92, border: true, borderColor: '#d4af37', borderWidth: 8, radius: 6, padding: 20, font: 'Vazirmatn', fontSize: 18, nameSize: 17, textColor: '#f3ead3' },
}).map(([id, change]) => [id, { ...CHAT_BASE, ...change }]));
// The chat can also use these bundled fonts (assets/fonts).
const CHAT_FONTS = [...FONTS, 'Press Start 2P', 'Bangers', 'Fredoka', 'Vazirmatn', 'Inter'];
const CHAT_LOOK = Object.keys(CHAT_BASE); // the fields a style sets
const CHAT_DEFAULTS = {
  enabled: true,
  kickChannel: '',
  twitchChannel: '',
  style: 'kick', // new users; earlier users keep the style they had (see the v3 -> v4 migration)
  emotesKick: true, emotesTwitch: true, emotes7tv: true,
  hideCommands: true, hideBots: true, bots: 'botrix, kickbot', hiddenUsers: '', blockedWords: '', hideLinks: false, source: 'both',
  rainbowUsers: '',
  ogHat: true, hatStyle: 'cap', hatPos: 'first', // Kick's OG viewers get a hat (assets/og-hats): kept when the style changes
  badgeBg: 'auto', // a dark tile behind the platforms' role badges: auto (light backgrounds only) | always | off; kept when the style changes
  tickerPos: 'top', // where a bar sits in the OBS source: kept when the style changes
  showTiming: false, // debug: how late each message shows (a label in the chat, a line in the server output)
  // Events: special lines for what happened (Kicks, subs and resubs, gifted subs, bits, raids), each on or off and some
  // from an amount up; their look (card | glow | line); "Keep special lines longer". Kept when the style changes.
  eventKicks: true, eventKicksMin: 0, eventSubs: true, eventGifts: true, eventGiftsMin: 0, eventBits: true, eventBitsMin: 0, eventRaids: false,
  eventLook: 'card', eventLonger: false,
};
const words = (v) => typeof v === 'string' && v.length <= 1000;
const amount = (v) => Number.isInteger(v) && v >= 0 && v <= 1e6;
const CHAT_RULES = {
  enabled: bool,
  kickChannel: (v) => typeof v === 'string' && /^[a-z0-9_-]{0,40}$/i.test(v),
  twitchChannel: (v) => typeof v === 'string' && /^[a-z0-9_]{0,25}$/i.test(v),
  style: (v) => v in CHAT_STYLES,
  emotesKick: bool, emotesTwitch: bool, emotes7tv: bool,
  hideCommands: bool, hideBots: bool, bots: words, hiddenUsers: words, blockedWords: words, hideLinks: bool, source: oneOf('both', 'kick', 'twitch'),
  rainbowUsers: words,
  ogHat: bool, hatStyle: oneOf('cap', 'beanie', 'fedora'), hatPos: oneOf('first', 'last', 'badge', 'avatar'), badgeBg: oneOf('auto', 'always', 'off'),
  showPlatform: bool, showBadges: bool, badgeMode: oneOf('important', 'all'), badgeSize: num(0.5, 2), badgeBroadcaster: bool, badgeMod: bool, badgeVip: bool, badgeSub: bool, badgeOther: bool, showTime: bool, showColon: bool,
  emotesAnimated: bool, emoteSize: num(12, 112), bigEmotes: bool, bigEmoteSize: num(16, 160),
  font: oneOf(...CHAT_FONTS), fontSize: num(10, 72), nameSize: num(10, 72), nameColorMode: oneOf('user', 'custom', 'style'), readableNames: bool, nameColor: hex, textColor: hex,
  namePos: oneOf('inline', 'above'), textShadow: bool, textDir: oneOf('auto', 'ltr', 'rtl'),
  bg: oneOf('color', 'transparent', 'off'), bgColor: hex, bgOpacity: num(0, 1), bubbles: bool, border: bool, borderColor: hex, borderWidth: num(1, 12),
  radius: num(0, 40), padding: num(0, 60), gap: num(0, 40), width: num(200, 1920), height: num(40, 1080),
  layout: oneOf('vertical', 'horizontal'), tickerDir: oneOf('rtl', 'ltr'), tickerSpeed: num(20, 600), newAt: oneOf('bottom', 'top'),
  maxMessages: (v) => Number.isInteger(v) && v >= 1 && v <= 100, hideAfter: num(0, 600),
  enterAnim: oneOf('slide', 'fade', 'pop', 'float', 'bounce', 'drop', 'none'), exitAnim: oneOf('fade', 'slide', 'none'), animSpeed: num(0.25, 3), fadeZone: num(0, 400), fade: bool,
  fxSubGlow: bool, fxFirst: bool, fxRainbowVip: bool, fxMention: bool, fxCombo: bool, avatars: bool, blur: num(0, 40), typewriter: bool, typeSound: bool,
  tickerLoop: bool, tickerPos: oneOf('top', 'bottom'), showTiming: bool,
  eventKicks: bool, eventKicksMin: amount, eventSubs: bool, eventGifts: bool, eventGiftsMin: amount, eventBits: bool, eventBitsMin: amount, eventRaids: bool,
  eventLook: oneOf('card', 'glow', 'line'), eventLonger: bool,
};

// The sidebar's profile chip (Edit profile): name and picture from the Kick or Twitch account, or the streamer's own
// (name; picture: { file, name } once uploaded, cropped round in the panel).
const PROFILE = { nameFrom: 'kick', name: '', pictureFrom: 'kick', picture: null };
const PROFILE_RULES = {
  nameFrom: oneOf('kick', 'twitch', 'custom'),
  name: (v) => typeof v === 'string' && v.length <= 40,
  pictureFrom: oneOf('kick', 'twitch', 'upload'),
};

const ALLOWED = { image: ['png', 'jpg', 'gif', 'webp', 'webm', 'mp4'], sound: ['mp3', 'wav', 'ogg'], picture: ['png', 'jpg', 'webp'] };

const bad = (code = 'bad_request') => Object.assign(new Error(code), { status: 400, code });

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
let saved = store.load(FILE);
const from = saved.version ?? 1;
if (from < 2) {
  // v1 -> v2: an uploaded sound always played; now soundMode picks the sound, so keep those playing.
  for (const a of Object.values(saved.alerts ?? {})) if (a?.sound && !a.soundMode) a.soundMode = 'custom';
}
if (from < 3) {
  // v2 -> v3: free tiers (a list with min, images[], sounds[]) became fixed tiers. Each old tier's first image and sound
  // move to the fixed tier at or below its minimum, turned on; extra files go. Raid's old tiers are ignored (see alert()).
  for (const [t, amounts] of Object.entries(TIER_AMOUNTS)) {
    const o = saved.alerts?.[t];
    if (!Array.isArray(o?.tiers)) continue;
    const fixed = {};
    for (const old of o.tiers) {
      const tier = (fixed[amounts.findLast((a) => a <= old.min) ?? amounts[0]] ??= { on: true });
      for (const [kind, files] of [['image', old.images], ['sound', old.sounds]]) for (const f of files ?? []) if (tier[kind]) removeFile(f); else tier[kind] = f;
    }
    o.tiers = fixed;
  }
}
if (from < 4 && Object.keys(saved).length) {
  // v3 -> v4: "Kick default" became the chat style for new users. Someone who already used Jarchi without picking a
  // style had Classic: keep it.
  (saved.chat ??= {}).style ??= 'classic';
}
if (from < 5) {
  // v4 -> v5: the bits tiers became Twitch's gems (1, 100, 1000, 5000, 10000). The old 500 tier's files move to the 100
  // tier where it has none of that kind (else they go), and turn it on if the 500 tier was on.
  const tiers = saved.alerts?.bits?.tiers, old = tiers?.[500];
  if (old) {
    const to = (tiers[100] ??= {});
    for (const kind of ['image', 'sound']) if (old[kind]) { if (to[kind]) removeFile(old[kind]); else to[kind] = old[kind]; }
    to.on ||= !!old.on;
    delete tiers[500];
  }
}
if (from < 6) {
  // v5 -> v6: goals split into Kick's and Twitch's, nothing added up. The Sub and Followers goals stay as Kick's (same
  // ids, same OBS links); their "Also count Twitch subs" and Kick/Twitch/Both source go.
  for (const g of Object.values(saved.goals ?? {})) {
    delete g?.countTwitch;
    delete g?.source;
  }
}
if (from < 7 && Object.keys(saved).some((k) => k !== 'version')) {
  // v6 -> v7: the welcome tour is for the first run. Someone who already set Jarchi up doesn't get it.
  saved.welcomed ??= true;
}
if (from < 8) {
  // v7 -> v8: an alert's one font and one outline/shadow switch became the name's and the message's own. Both keep the
  // old choice.
  for (const a of Object.values(saved.alerts ?? {})) {
    if (a?.font) {
      a.nameFont ??= a.font;
      a.textFont ??= a.font;
      delete a.font;
    }
    if (a?.textShadow === false) a.nameShadow ??= false;
  }
}
if (from < 9) {
  // v8 -> v9: one Alert size for every alert (at the top of the Alerts page) became each alert's own (Style tab). Each
  // starts with the old one; a size over 1 (from before the alerts filled the source) was read as 1.
  if (saved.alertSize < 1) for (const t of TYPES) ((saved.alerts ??= {})[t] ??= {}).size ??= Math.max(saved.alertSize, 0.5);
  delete saved.alertSize;
}
if (from < VERSION) {
  saved.version = VERSION;
  persist();
}

function persist() {
  store.save(FILE, saved);
}

function get() {
  const globals = Object.entries(GLOBAL).map(([k, d]) => [k, GLOBAL_RULES[k](saved[k]) ? saved[k] : d]);
  return {
    ...Object.fromEntries(globals),
    alerts: Object.fromEntries(TYPES.map((t) => [t, alert(t)])),
    goals: Object.fromEntries(GOAL_IDS.map((id) => [id, goal(id)])),
    chat: chat(),
    profile: { ...PROFILE, ...saved.profile },
  };
}

// An alert = its defaults + the user's changes to fields it has (so e.g. raid's old tiers stay ignored),
// with every fixed tier listed (Kicks tiers also name Kick's gift).
function alert(t) {
  const o = saved.alerts?.[t] ?? {};
  const cfg = Object.fromEntries(Object.entries(DEFAULTS[t]).map(([k, d]) => [k, k in o ? o[k] : d]));
  if (TIER_AMOUNTS[t]) {
    cfg.tiers = TIER_AMOUNTS[t].map((amount) => ({
      amount, on: false, image: null, sound: null, ...o.tiers?.[amount],
      ...(t === 'kicks' && { gift: KICK_GIFTS.find((g) => g.amount === amount) }),
    }));
  }
  return cfg;
}

// Chat = its style's look + the chat defaults + the user's changes.
function chat() {
  const o = saved.chat ?? {};
  const style = o.style in CHAT_STYLES ? o.style : CHAT_DEFAULTS.style;
  return { ...CHAT_STYLES[style], ...CHAT_DEFAULTS, ...o, style };
}

// A goal = its style's look + the goal's defaults + the user's changes.
function goal(id) {
  const o = saved.goals?.[id] ?? {};
  const style = o.style in GOAL_STYLES ? o.style : GOAL_DEFAULTS[id].style;
  return { ...GOAL_STYLES[style], ...GOAL_DEFAULTS[id], ...o, style };
}

const overrides = (type) => ((saved.alerts ??= {})[type] ??= {});
const goalOverrides = (id) => ((saved.goals ??= {})[id] ??= {});

function update(patch) {
  if (!patch || typeof patch !== 'object') throw bad();
  for (const k in GLOBAL) if (k in patch && !GLOBAL_RULES[k](patch[k])) throw bad();
  const alerts = Object.entries(patch.alerts ?? {});
  for (const [type, fields] of alerts) {
    if (!TYPES.includes(type) || !fields || typeof fields !== 'object') throw bad();
    for (const [k, v] of Object.entries(fields)) if (!RULES[k] || !(k in DEFAULTS[type]) || !RULES[k](v)) throw bad();
  }
  const goals = Object.entries(patch.goals ?? {});
  for (const [id, fields] of goals) {
    if (!GOAL_IDS.includes(id) || !fields || typeof fields !== 'object') throw bad();
    for (const [k, v] of Object.entries(fields)) if (!GOAL_RULES[k] || !(k in GOAL_DEFAULTS[id] || GOAL_LOOK.includes(k)) || !GOAL_RULES[k](v)) throw bad();
  }
  const chatFields = patch.chat;
  if (chatFields !== undefined) {
    if (!chatFields || typeof chatFields !== 'object') throw bad();
    for (const [k, v] of Object.entries(chatFields)) if (!CHAT_RULES[k] || !CHAT_RULES[k](v)) throw bad();
  }
  const profile = patch.profile;
  if (profile !== undefined) {
    if (!profile || typeof profile !== 'object') throw bad();
    for (const [k, v] of Object.entries(profile)) if (!PROFILE_RULES[k] || !PROFILE_RULES[k](v)) throw bad();
  }
  if (patch.privacyAccepted > (saved.privacyAccepted ?? 0)) saved.privacyAcceptedAt = new Date().toISOString(); // when (a newer one)
  for (const k in GLOBAL) if (k in patch) saved[k] = patch[k];
  if (profile) Object.assign((saved.profile ??= {}), profile);
  for (const [type, fields] of alerts) Object.assign(overrides(type), fields);
  for (const [id, fields] of goals) {
    const o = goalOverrides(id);
    if ('style' in fields) for (const k of GOAL_LOOK) delete o[k]; // a new style starts from its own look
    Object.assign(o, fields);
  }
  if (chatFields) {
    const o = (saved.chat ??= {});
    if ('style' in chatFields) for (const k of CHAT_LOOK) delete o[k];
    Object.assign(o, chatFields);
  }
  persist();
  return get();
}

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

function removeFile(entry) {
  if (entry?.file) fs.rmSync(path.join(UPLOADS_DIR, path.basename(entry.file)), { force: true });
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

// Keep an uploaded file on o[kind]. Uploading a sound also selects it (o[modeKey] = 'custom').
function keepUpload(o, prefix, kind, buf, name, modeKey) {
  const entry = writeUpload(prefix, kind, buf, name);
  removeFile(o[kind]);
  o[kind] = entry;
  if (kind === 'sound' && modeKey) o[modeKey] = 'custom';
  persist();
  return get();
}

function dropUpload(o, kind, modeKey) {
  removeFile(o?.[kind]);
  delete o?.[kind];
  if (kind === 'sound' && o?.[modeKey] === 'custom') delete o[modeKey]; // back to the theme sound
  persist();
  return get();
}

function saveUpload(type, kind, buf, name) {
  if (!TYPES.includes(type) || !ALLOWED[kind]) throw bad();
  return keepUpload(overrides(type), `${type}-${kind}`, kind, buf, name, 'soundMode');
}
function removeUpload(type, kind) {
  if (!TYPES.includes(type) || !ALLOWED[kind]) throw bad();
  return dropUpload(saved.alerts?.[type], kind, 'soundMode');
}
function saveGoalSound(id, buf, name) {
  if (!GOAL_IDS.includes(id)) throw bad();
  return keepUpload(goalOverrides(id), `goal-${id}-sound`, 'sound', buf, name, 'celebrateSound');
}
function removeGoalSound(id) {
  if (!GOAL_IDS.includes(id)) throw bad();
  return dropUpload(saved.goals?.[id], 'sound', 'celebrateSound');
}
// Uploading a profile picture also selects it.
function saveProfilePicture(buf, name) {
  const o = (saved.profile ??= {});
  const entry = writeUpload('profile-picture', 'picture', buf, name);
  removeFile(o.picture);
  Object.assign(o, { picture: entry, pictureFrom: 'upload' });
  persist();
  return get();
}

// ---------- Media by amount: fixed tiers ----------
// One tier = { on, image, sound } under its amount. Uploading a file turns the tier on.
function tierOf(type, amount) {
  if (!TIER_AMOUNTS[type]?.includes(amount)) throw bad();
  return ((overrides(type).tiers ??= {})[amount] ??= {});
}
function setTier(type, amount, fields) {
  if (typeof fields?.on !== 'boolean') throw bad();
  tierOf(type, amount).on = fields.on;
  persist();
  return get();
}
function saveTierFile(type, amount, kind, buf, name) {
  if (!ALLOWED[kind]) throw bad();
  const tier = tierOf(type, amount);
  tier.on = true;
  return keepUpload(tier, `${type}-tier-${amount}-${kind}`, kind, buf, name);
}
function removeTierFile(type, amount, kind) {
  if (!ALLOWED[kind]) throw bad();
  return dropUpload(tierOf(type, amount), kind);
}

// Back to the selected style's look; title, target, count and celebration settings stay.
function resetGoalStyle(id) {
  if (!GOAL_IDS.includes(id)) throw bad();
  for (const k of GOAL_LOOK) delete saved.goals?.[id]?.[k];
  persist();
  return get();
}

// An alert's text style back to its defaults; its words, position and everything else stay.
function resetAlertText(type) {
  if (!TYPES.includes(type)) throw bad();
  for (const k of TEXT_STYLE) delete saved.alerts?.[type]?.[k];
  persist();
  return get();
}

// Back to the selected chat style's look; channels, filters and emote sources stay.
function resetChatStyle() {
  for (const k of CHAT_LOOK) delete saved.chat?.[k];
  persist();
  return get();
}

// The usage ping's (core/stats.js): this install's random id, made the first time it's asked for and kept through
// Reset everything; when the Privacy Policy accepted was accepted (ISO, UTC), or null. Neither is in get().
function installId() {
  if (!saved.installId) {
    saved.installId = crypto.randomUUID();
    persist();
  }
  return saved.installId;
}
const privacyAcceptedAt = () => saved.privacyAcceptedAt ?? null;

// No type = reset everything.
function reset(type) {
  if (type !== undefined && !TYPES.includes(type)) throw bad();
  for (const t of type ? [type] : TYPES) {
    removeFile(saved.alerts?.[t]?.image);
    removeFile(saved.alerts?.[t]?.sound);
    for (const tier of Object.values(saved.alerts?.[t]?.tiers ?? {})) [tier.image, tier.sound, ...(tier.images ?? []), ...(tier.sounds ?? [])].forEach(removeFile); // old free tiers too
    delete saved.alerts?.[t];
  }
  if (!type) {
    for (const id of GOAL_IDS) removeFile(saved.goals?.[id]?.sound);
    removeFile(saved.profile?.picture);
    saved = { version: VERSION, ...(saved.installId && { installId: saved.installId }) }; // still the same install
  }
  persist();
  return get();
}

module.exports = {
  get, update, saveUpload, removeUpload, reset, saveGoalSound, removeGoalSound, saveProfilePicture, resetGoalStyle, resetChatStyle,
  resetAlertText, setTier, saveTierFile, removeTierFile, sniff, installId, privacyAcceptedAt,
  GOAL_IDS, GOAL_STYLES, CHAT_STYLES, CHAT_FONTS, FONTS, KICK_GIFTS,
};
