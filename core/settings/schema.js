// What the settings can be: every default, style and rule. Plain data and checks, no state (index.js keeps that).
const { TYPES } = require('../events');
const strings = require('../../i18n/en.json');

const VERSION = 10;
// 'none': no box, background or effects, just the picture and outlined text.
const THEMES = ['neon', 'minimal', 'fun', 'retro', 'glass', 'fire', 'ice', 'galaxy', 'comic', 'simple', 'none'];
// App-wide settings (not per alert). showBadge: platform badge on alerts; it still needs both Kick and Twitch connected.
// alertGap: seconds between two alerts. proxy*: how Jarchi reaches Kick, Twitch, 7TV and its relay (core/net.js);
// proxyMode: off (the default: Jarchi never turns a proxy on by itself) | auto (the Windows proxy, only when chosen) |
// manual (proxyType / Host / Port; also what Yes to a found VPN app sets, core/vpn.js). Only Jarchi's own connections use
// it (core/net.js); Windows' own proxy setting is never changed. An older saved value ('system') reads as the default.
// kickGoalSync / twitchGoalSync: goals set on the Kick / Twitch channel show that platform's numbers (core/goals.js).
// welcomed: the panel's welcome tour was shown (it opens by itself once, on the first run).
// privacyAccepted: the version of the Privacy Policy (i18n/privacy.json) the user accepted, 0 = none yet.
// lang: the panel's language (it says so when it starts): what a crypto alert calls a donor who hid the name.
// seenNew: the sidebar pages marked NEW (panel/js/previews.js NEW_PAGES) the streamer has opened: never marked again.
// eyesSeen: the panel showed where its hidden 👀 is (the first Ctrl+Shift+E): never again.
// proxyAsk: Auto may offer the VPN app it finds by itself (core/vpn.js); false after a No, true again when the streamer looks.
const GLOBAL = {
  theme: 'neon',
  showBadge: true,
  alertGap: 0.5,
  proxyMode: 'off',
  proxyType: 'http',
  proxyHost: '',
  proxyPort: 0,
  kickGoalSync: true,
  twitchGoalSync: true,
  welcomed: false,
  privacyAccepted: 0,
  lang: 'en',
  seenNew: [],
  eyesSeen: false,
  proxyAsk: true,
};
const PROXY_HOST = /^[a-z0-9.:[\]_-]{0,253}$/i;
const proxyPort = (v) => Number.isInteger(v) && v >= 0 && v <= 65535;
const GLOBAL_RULES = {
  theme: (v) => THEMES.includes(v),
  showBadge: (v) => typeof v === 'boolean',
  welcomed: (v) => typeof v === 'boolean',
  lang: (v) => v === 'en' || v === 'fa',
  eyesSeen: (v) => typeof v === 'boolean',
  proxyAsk: (v) => typeof v === 'boolean',
  seenNew: (v) => Array.isArray(v) && v.length <= 50 && v.every((p) => typeof p === 'string' && /^[a-z]{1,20}$/.test(p)),
  privacyAccepted: (v) => Number.isInteger(v) && v >= 0,
  kickGoalSync: (v) => typeof v === 'boolean',
  twitchGoalSync: (v) => typeof v === 'boolean',
  alertGap: (v) => typeof v === 'number' && v >= 0 && v <= 60,
  proxyMode: (v) => ['off', 'auto', 'manual'].includes(v),
  proxyType: (v) => ['http', 'socks5'].includes(v),
  proxyHost: (v) => typeof v === 'string' && PROXY_HOST.test(v),
  proxyPort,
};
// Follow is small and quick, raid is the big one. minAmount only where an amount makes sense.
// Media by amount (tiersOn + tiers): fixed, ready-made tiers. Saved as tiers: { [amount]: { on, image, sound } };
// get() lists every tier: [{ amount, on, image, sound }], lowest first.
// Kick's own Kicks gifts (web.kick.com/api/v1/kicks/gifts; the same table is in kick.com's web app). Their images are
// in assets/kick-gifts/<id>.webp. If Kick adds a gift: add it here, its image there and its name in i18n kickGifts.
const KICK_GIFTS = [
  { amount: 1, id: 'hell_yeah' },
  { amount: 10, id: 'hype' },
  { amount: 50, id: 'skull_emoji' },
  { amount: 100, id: 'full_send' },
  { amount: 500, id: 'rage_quit' },
  { amount: 1000, id: 'pack_it_up' },
  { amount: 2000, id: 'yap' },
  { amount: 5000, id: 'stomp' },
  { amount: 10000, id: 'flex' },
  { amount: 50000, id: 'boooom' },
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
const DEFAULTS = Object.fromEntries(
  TYPES.map((t) => [
    t,
    {
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
      customCss: '', // the user's own CSS on top of this alert's look (Advanced, under the tabs); not part of its text style
      ...PER_TYPE[t],
    },
  ]),
);
const TEXT_STYLE = ['nameColor', 'nameFont', 'nameBold', 'nameShadow', 'textColor', 'textFont', 'textBold', 'textShadow', 'autoSize', 'fontSize'];
// Bundled fonts (assets/fonts) with both Latin and Persian letters. The panel lists them in index.html (Text tab, Font).
const ALERT_FONTS = ['Vazirmatn', 'Lalezar', 'Changa', 'Lemonada', 'Markazi Text'];

const num = (min, max) => (v) => typeof v === 'number' && v >= min && v <= max;
const oneOf =
  (...list) =>
  (v) =>
    list.includes(v);
const hex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
// Custom CSS (each widget's Advanced box): plain text, which the widget sets as its <style> element's text, never as HTML.
const css = (v) => typeof v === 'string' && v.length <= 20000;
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
  customCss: css,
};
// ---------- Goals ----------
// Kick's goals, then Twitch's (the ids before v6 stay, so their OBS links keep working). Each counts and syncs from its
// own platform only. Followers: only from a goal set on that channel (no follow counting).
const GOAL_IDS = ['subs', 'kicks', 'followers', 'twitchSubs', 'bits', 'twitchFollowers'];
const FONTS = ['Segoe UI', 'Arial Black', 'Impact', 'Trebuchet MS', 'Georgia', 'Consolas'];
// Each style is a complete set of look values; users then tweak any of them. Picking a style or "Reset style" restores these.
// Circle draws no box (its bg, border and radius go unused) and its fontSize is for its 200 px ring.
const GOAL_STYLES = {
  classic: {
    barColor: '#8b5cf6',
    barBg: '#2b2e3b',
    textColor: '#ffffff',
    fullColor: '#22c55e',
    bg: 'color',
    bgColor: '#14141c',
    bgOpacity: 0.85,
    border: false,
    borderColor: '#8b5cf6',
    borderWidth: 2,
    radius: 14,
    scale: 1,
    font: 'Segoe UI',
    fontSize: 26,
    titlePos: 'above',
    showPercent: false,
    showNumbers: true,
  },
  pill: {
    barColor: '#ff5fa2',
    barBg: '#3a2333',
    textColor: '#ffffff',
    fullColor: '#22c55e',
    bg: 'off',
    bgColor: '#14141c',
    bgOpacity: 0.85,
    border: false,
    borderColor: '#ffffff',
    borderWidth: 2,
    radius: 60,
    scale: 1,
    font: 'Segoe UI',
    fontSize: 24,
    titlePos: 'inside',
    showPercent: true,
    showNumbers: true,
  },
  neon: {
    barColor: '#00f0ff',
    barBg: '#0b1530',
    textColor: '#ffffff',
    fullColor: '#ff2bd6',
    bg: 'color',
    bgColor: '#0a0620',
    bgOpacity: 0.85,
    border: true,
    borderColor: '#00f0ff',
    borderWidth: 2,
    radius: 16,
    scale: 1,
    font: 'Segoe UI',
    fontSize: 26,
    titlePos: 'above',
    showPercent: true,
    showNumbers: true,
  },
  circle: {
    barColor: '#8b5cf6',
    barBg: '#2b2e3b',
    textColor: '#ffffff',
    fullColor: '#22c55e',
    bg: 'off',
    bgColor: '#14141c',
    bgOpacity: 0.85,
    border: false,
    borderColor: '#ffffff',
    borderWidth: 2,
    radius: 24,
    scale: 1,
    font: 'Segoe UI',
    fontSize: 40,
    titlePos: 'below',
    showPercent: true,
    showNumbers: true,
  },
  text: {
    barColor: '#8b5cf6',
    barBg: '#2b2e3b',
    textColor: '#ffffff',
    fullColor: '#22c55e',
    bg: 'off',
    bgColor: '#14141c',
    bgOpacity: 0.85,
    border: false,
    borderColor: '#ffffff',
    borderWidth: 2,
    radius: 12,
    scale: 1,
    font: 'Segoe UI',
    fontSize: 40,
    titlePos: 'above',
    showPercent: false,
    showNumbers: true,
  },
  retro: {
    barColor: '#ffe14d',
    barBg: '#2d2d5a',
    textColor: '#ffffff',
    fullColor: '#4dd2ff',
    bg: 'color',
    bgColor: '#1b1b3a',
    bgOpacity: 1,
    border: true,
    borderColor: '#ffffff',
    borderWidth: 4,
    radius: 0,
    scale: 1,
    font: 'Consolas',
    fontSize: 24,
    titlePos: 'above',
    showPercent: false,
    showNumbers: true,
  },
};
const GOAL_LOOK = Object.keys(GOAL_STYLES.classic); // the fields a style sets
const GOAL_DEFAULTS = Object.fromEntries(
  GOAL_IDS.map((id) => [
    id,
    {
      enabled: id === 'subs' || id === 'kicks', // the later ones: off, so the Home page doesn't ask existing users to add them to OBS
      title: strings.goals[id].title,
      target: { subs: 50, kicks: 1000, followers: 100, twitchSubs: 50, bits: 1000, twitchFollowers: 100 }[id],
      style: 'classic',
      celebrate: true,
      celebrateSound: 'theme',
      sound: null, // { file, name } once uploaded
      volume: 0.7,
      autoSize: true, // text: the biggest that fits (off: the style's fontSize, smaller only if it wouldn't fit). Kept when the style changes
      customCss: '', // the user's own CSS on top of the look: kept when the style changes too
    },
  ]),
);
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
  customCss: css,
};

// ---------- Chat ----------
// The Classic look. Every chat style is this plus a few changes; users then tweak any value. Reset style restores them.
const CHAT_BASE = {
  showPlatform: true,
  showBadges: true,
  badgeMode: 'important',
  badgeSize: 1,
  badgeBroadcaster: true,
  badgeMod: true,
  badgeVip: true,
  badgeSub: true,
  badgeOther: true,
  showTime: false,
  showColon: true,
  emotesAnimated: true,
  emoteSize: 28,
  bigEmotes: true,
  bigEmoteSize: 56,
  font: 'Segoe UI',
  fontSize: 18,
  nameSize: 18,
  nameColorMode: 'user',
  readableNames: true,
  nameColor: '#8b5cf6',
  textColor: '#ffffff',
  namePos: 'inline',
  textShadow: true,
  textDir: 'auto',
  bg: 'color',
  bgColor: '#14141c',
  bgOpacity: 0.6,
  bubbles: false,
  border: false,
  borderColor: '#8b5cf6',
  borderWidth: 2,
  radius: 12,
  padding: 12,
  gap: 6,
  width: 420,
  height: 600,
  layout: 'vertical',
  tickerDir: 'rtl',
  tickerSpeed: 120,
  newAt: 'bottom',
  maxMessages: 30,
  hideAfter: 0,
  enterAnim: 'slide',
  exitAnim: 'fade',
  animSpeed: 1,
  fadeZone: 80,
  fade: true,
  fxSubGlow: true,
  fxFirst: true,
  fxRainbowVip: true,
  fxMention: true,
  fxCombo: true,
  avatars: false,
  blur: 0,
  typewriter: false,
  typeSound: false,
  tickerLoop: false,
  replies: 'line', // a reply: line ("↩ replying to name: …" above it) | name ("@name" before it) | quote (a small box above) | off
  borderColorMode: 'custom', // each message's own border: custom (borderColor) | user (the sender's name color; none: borderColor)
};
// What the horizontal styles share: a 1920-wide bar that keeps looping the recent messages when chat is quiet.
const BAR = { layout: 'horizontal', width: 1920, height: 64, radius: 0, padding: 10, maxMessages: 15, fadeZone: 120, tickerLoop: true };
// The chat style's look values. The style-<id> CSS class adds what options can't (tails, tape, scanlines, frames...).
const CHAT_STYLES = Object.fromEntries(
  Object.entries({
    // Kick's own chat: its panel width (340), font (Inter 14px), dark surface (#181b1f), plain lines, no motion.
    kick: {
      font: 'Inter',
      fontSize: 14,
      nameSize: 14,
      bgColor: '#181b1f',
      bgOpacity: 0.95,
      radius: 4,
      padding: 8,
      gap: 0,
      width: 340,
      textShadow: false,
      showPlatform: false,
      bigEmotes: false,
      enterAnim: 'none',
      exitAnim: 'none',
      fade: false,
    },
    classic: { bgColor: '#121218', bgOpacity: 0.78, radius: 14, padding: 14 },
    bubbles: {
      bubbles: true,
      bgColor: '#ffffff',
      bgOpacity: 1,
      textColor: '#1f2330',
      textShadow: false,
      namePos: 'above',
      fontSize: 16,
      nameSize: 13,
      radius: 18,
      padding: 10,
      gap: 12,
      enterAnim: 'float',
    },
    floating: { bg: 'off', padding: 0, gap: 10, fontSize: 22, nameSize: 22, fadeZone: 240, enterAnim: 'fade' },
    neon: { bgColor: '#07031a', bgOpacity: 0.82, border: true, borderColor: '#00f0ff', borderWidth: 2, radius: 14, textColor: '#e8fbff' },
    terminal: {
      font: 'Consolas',
      fontSize: 16,
      nameSize: 16,
      bgColor: '#0c0c0c',
      bgOpacity: 0.92,
      border: true,
      borderColor: '#3a3a3a',
      borderWidth: 1,
      radius: 8,
      textColor: '#c8ffc8',
      showTime: true,
      textShadow: false,
      emoteSize: 24,
      enterAnim: 'fade',
    },
    retro: {
      font: 'Press Start 2P',
      fontSize: 12,
      nameSize: 12,
      bgColor: '#1b1b3a',
      bgOpacity: 0.95,
      border: true,
      borderColor: '#ffffff',
      borderWidth: 4,
      radius: 0,
      padding: 16,
      gap: 10,
      textShadow: false,
      emoteSize: 24,
    },
    glass: { bgColor: '#ffffff', bgOpacity: 0.16, border: true, borderColor: '#ffffff', borderWidth: 1, radius: 20, blur: 14 },
    popin: { bubbles: true, bgColor: '#20232e', bgOpacity: 0.92, radius: 22, padding: 10, gap: 8, enterAnim: 'pop', animSpeed: 0.9 },
    side: { bg: 'off', border: true, borderColor: '#8b5cf6', borderWidth: 3, width: 300, height: 900, namePos: 'above', nameSize: 15, gap: 14, padding: 0 },
    ticker: { layout: 'horizontal', width: 1920, height: 64, bgOpacity: 0.85, radius: 0, padding: 10, maxMessages: 15, fadeZone: 120 },
    cyberpunk: {
      bubbles: true,
      bgColor: '#0a0a0c',
      bgOpacity: 0.92,
      border: true,
      borderColor: '#fcee0a',
      borderWidth: 3,
      radius: 0,
      padding: 9,
      gap: 8,
      textColor: '#e9e9e9',
      textShadow: false,
      fontSize: 17,
      nameSize: 16,
      enterAnim: 'fade',
    },
    comic: {
      bubbles: true,
      bgColor: '#ffffff',
      bgOpacity: 1,
      border: true,
      borderColor: '#111111',
      borderWidth: 3,
      radius: 16,
      padding: 10,
      gap: 8,
      textColor: '#111111',
      textShadow: false,
      namePos: 'above',
      fontSize: 16,
      nameSize: 21,
      showColon: false,
      enterAnim: 'pop',
    },
    hud: {
      bgColor: '#04121c',
      bgOpacity: 0.6,
      borderColor: '#00e5ff',
      radius: 2,
      padding: 18,
      textColor: '#d8f6ff',
      nameColor: '#5ff3ff',
      nameSize: 15,
      showColon: false,
    },
    sticky: {
      bubbles: true,
      bgColor: '#fff27a',
      bgOpacity: 1,
      textColor: '#2b2b2b',
      textShadow: false,
      nameColor: '#1f1f1f',
      namePos: 'above',
      fontSize: 16,
      nameSize: 15,
      radius: 3,
      padding: 12,
      gap: 16,
      enterAnim: 'drop',
    },
    pastel: {
      bubbles: true,
      bgColor: '#dccbff',
      bgOpacity: 1,
      textColor: '#3b3355',
      textShadow: false,
      nameColor: '#2d2546',
      font: 'Fredoka',
      fontSize: 17,
      nameSize: 17,
      radius: 40,
      padding: 9,
      gap: 8,
      enterAnim: 'bounce',
    },
    galaxy: { bgColor: '#0b0920', bgOpacity: 0.88, radius: 18, padding: 16, textColor: '#ece8ff', enterAnim: 'float' },
    rpg: {
      bubbles: true,
      bgColor: '#13207a',
      bgOpacity: 0.94,
      border: true,
      borderColor: '#ffffff',
      borderWidth: 3,
      radius: 6,
      padding: 12,
      gap: 24,
      font: 'Press Start 2P',
      fontSize: 12,
      nameSize: 10,
      textColor: '#ffffff',
      textShadow: false,
      namePos: 'above',
      nameColor: '#ffe066',
      emoteSize: 24,
      enterAnim: 'fade',
      typewriter: true,
    },
    // Horizontal (ticker) styles
    news: { ...BAR, bgColor: '#ffffff', bgOpacity: 1, height: 56, textColor: '#1a1a1a', textShadow: false, padding: 10, fadeZone: 60, tickerSpeed: 110 },
    neonstrip: { ...BAR, bgColor: '#07031a', bgOpacity: 0.9, borderColor: '#ff2bd6', textColor: '#f2e9ff' },
    pills: { ...BAR, bubbles: true, bgColor: '#16161f', bgOpacity: 0.88, radius: 40, padding: 8, gap: 18, fadeZone: 100 },
    minimal: { ...BAR, bg: 'off', height: 72, fontSize: 26, nameSize: 26, padding: 0, tickerSpeed: 70 },
    led: {
      ...BAR,
      bgColor: '#050505',
      bgOpacity: 0.95,
      radius: 4,
      font: 'Consolas',
      fontSize: 22,
      nameSize: 22,
      textColor: '#ffb000',
      textShadow: false,
      fadeZone: 80,
    },
    cyberbar: {
      ...BAR,
      bgColor: '#0a0a0c',
      bgOpacity: 0.92,
      border: true,
      borderColor: '#fcee0a',
      borderWidth: 3,
      textColor: '#0b0b0b',
      textShadow: false,
      nameColor: '#0b0b0b',
      fontSize: 17,
      nameSize: 16,
      fadeZone: 80,
    },
    candy: {
      ...BAR,
      bgColor: '#ffffff',
      bgOpacity: 1,
      radius: 40,
      padding: 8,
      font: 'Fredoka',
      fontSize: 18,
      nameSize: 18,
      textColor: '#3b3355',
      textShadow: false,
      nameColor: '#2d2546',
      tickerDir: 'ltr',
      fadeZone: 60,
    },
    glassbar: { ...BAR, bgColor: '#ffffff', bgOpacity: 0.16, border: true, borderColor: '#ffffff', borderWidth: 1, radius: 32, blur: 12, fadeZone: 160 },
    persian: {
      bgColor: '#0d1b3d',
      bgOpacity: 0.92,
      border: true,
      borderColor: '#d4af37',
      borderWidth: 8,
      radius: 6,
      padding: 20,
      font: 'Vazirmatn',
      fontSize: 18,
      nameSize: 17,
      textColor: '#f3ead3',
    },
  }).map(([id, change]) => [id, { ...CHAT_BASE, ...change }]),
);
// The chat can also use these bundled fonts (assets/fonts).
const CHAT_FONTS = [...FONTS, 'Press Start 2P', 'Bangers', 'Fredoka', 'Vazirmatn', 'Inter', 'Manrope'];
const CHAT_LOOK = Object.keys(CHAT_BASE); // the fields a style sets
// What makes a design itself (font, colors, box, its size, motion): each design remembers the user's own changes to
// these (saved.chat.looks holds the designs not picked), so switching away and back brings them back. The rest of the
// look (text and emote sizes, what a line shows, badges, effects, how long and how many messages) is shared by all
// designs: it stays as it is when the design changes.
const CHAT_OWN = [
  'font',
  'textColor',
  'textShadow',
  'nameColor',
  'namePos',
  'showColon',
  'bg',
  'bgColor',
  'bgOpacity',
  'bubbles',
  'border',
  'borderColor',
  'borderColorMode',
  'borderWidth',
  'radius',
  'padding',
  'gap',
  'width',
  'height',
  'blur',
  'layout',
  'tickerDir',
  'tickerSpeed',
  'tickerLoop',
  'enterAnim',
  'exitAnim',
  'animSpeed',
  'fade',
  'fadeZone',
  'typewriter',
  'typeSound',
];
const CHAT_SHARED = CHAT_LOOK.filter((k) => !CHAT_OWN.includes(k));
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
// The panel's style thumbnails: each design's own look, over the user's shared values (what picking it gives).
const CHAT_DESIGNS = Object.fromEntries(Object.entries(CHAT_STYLES).map(([id, s]) => [id, pick(s, CHAT_OWN)]));
// Up to 2 chats, each with all of these settings of its own: Chat 1 is saved.chat (as before there was a second one, so
// its settings and OBS link /widgets/chat stay), Chat 2 is saved.chat2 (/widgets/chat/2), there once "+" added it. Both
// show the same messages: the channels are Chat 1's (Chat 2 shows them, never keeps its own).
const CHATS = ['chat', 'chat2'];
const CHANNELS = ['kickChannel', 'twitchChannel'];
const CHAT_DEFAULTS = {
  name: '', // the Chat page's tab ('' = "Chat 1" / "Chat 2" in the panel's language)
  enabled: true,
  kickChannel: '',
  twitchChannel: '',
  style: 'kick', // new users; earlier users keep the style they had (see the v3 -> v4 migration)
  emotesKick: true,
  emotesTwitch: true,
  emotes7tv: true,
  hideCommands: true,
  hideBots: true,
  bots: 'botrix, kickbot',
  hiddenUsers: '',
  blockedWords: '',
  hideLinks: false,
  source: 'both',
  rainbowUsers: '',
  ogHat: true,
  hatStyle: 'cap',
  hatPos: 'first', // Kick's OG viewers get a hat (assets/og-hats): kept when the style changes
  badgeBg: 'auto', // a dark tile behind the platforms' role badges: auto (light backgrounds only) | always | off; kept when the style changes
  tickerPos: 'top', // where a bar sits in the OBS source: kept when the style changes
  showTiming: false, // debug: how late each message shows (a label in the chat, a line in the server output)
  // Events: special lines for what happened (Kicks, subs and resubs, gifted subs, bits, raids), each on or off and some
  // from an amount up; their look (card | glow | line); "Keep special lines longer". Kept when the style changes.
  eventKicks: true,
  eventKicksMin: 0,
  eventSubs: true,
  eventGifts: true,
  eventGiftsMin: 0,
  eventBits: true,
  eventBitsMin: 0,
  eventRaids: false,
  eventLook: 'card',
  eventLonger: false,
  customCss: '', // the user's own CSS on top of the look, this chat's (not a design's): kept when the style changes
};
const words = (v) => typeof v === 'string' && v.length <= 1000;
const amount = (v) => Number.isInteger(v) && v >= 0 && v <= 1e6;
const CHAT_RULES = {
  name: (v) => typeof v === 'string' && v.length <= 30,
  enabled: bool,
  kickChannel: (v) => typeof v === 'string' && /^[a-z0-9_-]{0,40}$/i.test(v),
  twitchChannel: (v) => typeof v === 'string' && /^[a-z0-9_]{0,25}$/i.test(v),
  style: (v) => v in CHAT_STYLES,
  emotesKick: bool,
  emotesTwitch: bool,
  emotes7tv: bool,
  hideCommands: bool,
  hideBots: bool,
  bots: words,
  hiddenUsers: words,
  blockedWords: words,
  hideLinks: bool,
  source: oneOf('both', 'kick', 'twitch'),
  rainbowUsers: words,
  ogHat: bool,
  hatStyle: oneOf('cap', 'beanie', 'fedora'),
  hatPos: oneOf('first', 'last', 'badge', 'avatar'),
  badgeBg: oneOf('auto', 'always', 'off'),
  showPlatform: bool,
  showBadges: bool,
  badgeMode: oneOf('important', 'all'),
  badgeSize: num(0.5, 2),
  badgeBroadcaster: bool,
  badgeMod: bool,
  badgeVip: bool,
  badgeSub: bool,
  badgeOther: bool,
  showTime: bool,
  showColon: bool,
  emotesAnimated: bool,
  emoteSize: num(12, 112),
  bigEmotes: bool,
  bigEmoteSize: num(16, 160),
  font: oneOf(...CHAT_FONTS),
  fontSize: num(10, 72),
  nameSize: num(10, 72),
  nameColorMode: oneOf('user', 'custom', 'style'),
  readableNames: bool,
  nameColor: hex,
  textColor: hex,
  namePos: oneOf('inline', 'above'),
  textShadow: bool,
  textDir: oneOf('auto', 'ltr', 'rtl'),
  bg: oneOf('color', 'transparent', 'off'),
  bgColor: hex,
  bgOpacity: num(0, 1),
  bubbles: bool,
  border: bool,
  borderColor: hex,
  borderColorMode: oneOf('custom', 'user'),
  borderWidth: num(1, 12),
  radius: num(0, 40),
  padding: num(0, 60),
  gap: num(0, 40),
  width: num(200, 1920),
  height: num(40, 1080),
  layout: oneOf('vertical', 'horizontal'),
  tickerDir: oneOf('rtl', 'ltr'),
  tickerSpeed: num(20, 600),
  newAt: oneOf('bottom', 'top'),
  maxMessages: (v) => Number.isInteger(v) && v >= 1 && v <= 100,
  hideAfter: num(0, 600),
  enterAnim: oneOf('slide', 'fade', 'pop', 'float', 'bounce', 'drop', 'none'),
  exitAnim: oneOf('fade', 'slide', 'none'),
  animSpeed: num(0.25, 3),
  fadeZone: num(0, 400),
  fade: bool,
  fxSubGlow: bool,
  fxFirst: bool,
  fxRainbowVip: bool,
  fxMention: bool,
  fxCombo: bool,
  avatars: bool,
  blur: num(0, 40),
  typewriter: bool,
  typeSound: bool,
  tickerLoop: bool,
  tickerPos: oneOf('top', 'bottom'),
  showTiming: bool,
  replies: oneOf('line', 'name', 'quote', 'off'),
  eventKicks: bool,
  eventKicksMin: amount,
  eventSubs: bool,
  eventGifts: bool,
  eventGiftsMin: amount,
  eventBits: bool,
  eventBitsMin: amount,
  eventRaids: bool,
  eventLook: oneOf('card', 'glow', 'line'),
  eventLonger: bool,
  customCss: css,
};
// An exclusive design (core/designs.js) becomes a chat style like the others: its look is only a design's own values
// (CHAT_OWN), each one valid. false: not taken.
function addChatDesign(id, look) {
  if (
    !/^x-[a-z0-9-]{1,30}$/.test(id) ||
    !look ||
    typeof look !== 'object' ||
    Array.isArray(look) ||
    !Object.entries(look).every(([k, v]) => CHAT_OWN.includes(k) && CHAT_RULES[k](v))
  )
    return false;
  CHAT_STYLES[id] = { ...CHAT_BASE, ...look };
  CHAT_DESIGNS[id] = pick(CHAT_STYLES[id], CHAT_OWN);
  return true;
}

// ---------- Viewers ----------
// One look for its three OBS links (/widgets/viewers/kick, /twitch, /total). Each style is a complete set of look values,
// as with goals: picking one starts from its look. The rest is kept when the style changes. icon: Jarchi gold's (the
// people icon, a logo, or "switch": the people icon and the logo taking turns). offline: hide it, or "Offline".
const VIEWER_STYLES = {
  gold: { font: 'Inter', numberColor: '#d6a83e', bgColor: '#0f1416', accentColor: '#d6a83e' },
  chart: { font: 'Inter', numberColor: '#ffffff', bgColor: '#0f1416', accentColor: '#2dd4bf' },
  angled: { font: 'Inter', numberColor: '#ffffff', bgColor: '#16181d', accentColor: '#ffffff' },
  comic: { font: 'Bangers', numberColor: '#111111', bgColor: '#ffffff', accentColor: '#111111' },
};
const VIEWER_LOOK = Object.keys(VIEWER_STYLES.gold);
const VIEWER_COLORS = ['numberColor', 'bgColor', 'accentColor']; // Jarchi gold: always its own (Jarchi's brand colors)
const VIEWERS_DEFAULTS = { style: 'gold', icon: 'people', chartMinutes: 10, offline: 'text', anim: 'roll', size: 1, customCss: '' };
const VIEWER_RULES = {
  style: (v) => v in VIEWER_STYLES,
  icon: oneOf('people', 'kick', 'twitch', 'switch'),
  chartMinutes: oneOf(10, 15),
  offline: oneOf('hide', 'text'),
  anim: oneOf('roll', 'flip', 'fade', 'pop'),
  size: num(0.5, 1),
  font: oneOf(...CHAT_FONTS),
  numberColor: hex,
  bgColor: hex,
  accentColor: hex,
  customCss: css,
};

// The sidebar's profile chip (Edit profile): name and picture from the Kick or Twitch account, or the streamer's own
// (name; picture: { file, name } once uploaded, cropped round in the panel).
const PROFILE = { nameFrom: 'kick', name: '', pictureFrom: 'kick', picture: null };
const PROFILE_RULES = {
  nameFrom: oneOf('kick', 'twitch', 'custom'),
  name: (v) => typeof v === 'string' && v.length <= 40,
  pictureFrom: oneOf('kick', 'twitch', 'upload'),
};

// ---------- Crypto alerts (the Crypto page's Alert settings; core/pay.js brings the donations) ----------
// design: the card that plays ('coin' | 'hologram', Jarchi's two, or 'custom' = Your own alert). sound: an uploaded sound
// for the two designs instead of their own; duration (s): theirs. custom and each amount alert (tiers: { id, min USDT })
// = a look: { image, sound, pos (text top / bottom / side of the image), font, duration }. The highest tier a donation
// reaches plays instead of the card (cryptoPick).
const CRYPTO_DESIGNS = ['coin', 'hologram', 'custom'];
const CRYPTO_FONTS = ['Lalezar', 'Vazirmatn', 'Bangers'];
const CRYPTO_LOOK = { image: null, sound: null, pos: 'bottom', font: 'Lalezar', duration: 8 };
const CRYPTO_TIERS = 20;
const cryptoSeconds = num(3, 60);
const CRYPTO_RULES = { design: oneOf(...CRYPTO_DESIGNS), duration: cryptoSeconds };
const LOOK_RULES = { pos: oneOf('top', 'bottom', 'side'), font: oneOf(...CRYPTO_FONTS), duration: cryptoSeconds, min: num(0.01, 1e6) };

const ALLOWED = { image: ['png', 'jpg', 'gif', 'webp', 'webm', 'mp4'], sound: ['mp3', 'wav', 'ogg'], picture: ['png', 'jpg', 'webp'] };

const bad = (code = 'bad_request') => Object.assign(new Error(code), { status: 400, code });

module.exports = {
  VERSION,
  THEMES,
  GLOBAL,
  PROXY_HOST,
  proxyPort,
  GLOBAL_RULES,
  KICK_GIFTS,
  TIER_AMOUNTS,
  TIERED,
  PER_TYPE,
  DEFAULTS,
  TEXT_STYLE,
  ALERT_FONTS,
  num,
  oneOf,
  hex,
  css,
  RULES,
  GOAL_IDS,
  FONTS,
  GOAL_STYLES,
  GOAL_LOOK,
  GOAL_DEFAULTS,
  bool,
  GOAL_RULES,
  CHAT_BASE,
  BAR,
  CHAT_STYLES,
  CHAT_FONTS,
  CHAT_LOOK,
  CHAT_OWN,
  CHAT_SHARED,
  pick,
  CHAT_DESIGNS,
  CHATS,
  CHANNELS,
  CHAT_DEFAULTS,
  words,
  amount,
  CHAT_RULES,
  addChatDesign,
  VIEWER_STYLES,
  VIEWER_LOOK,
  VIEWER_COLORS,
  VIEWERS_DEFAULTS,
  VIEWER_RULES,
  PROFILE,
  PROFILE_RULES,
  CRYPTO_DESIGNS,
  CRYPTO_FONTS,
  CRYPTO_LOOK,
  CRYPTO_TIERS,
  cryptoSeconds,
  CRYPTO_RULES,
  LOOK_RULES,
  ALLOWED,
  bad,
};
