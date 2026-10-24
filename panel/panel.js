// Settings panel. All visible text comes from /i18n/en.json, or /i18n/fa.json in Persian (the "فا | EN" switch).
// The language is the panel's only: overlays, and their previews here, always use en.json.
// Layout: a sidebar with one item per page (a <section data-view>), a top bar with the page's title. Alerts and Goals
// have their own list (LISTS below) next to the editor of the selected item. Previews are the real overlays in scaled iframes: alerts are driven by postMessage, the goal by its own live socket.
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
// Remembered in this browser: the language, the colors.
const remember = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};
const FA = remember.get('jarchi.lang') === 'fa';
document.documentElement.lang = FA ? 'fa' : 'en';
document.documentElement.dir = FA ? 'rtl' : 'ltr';
// The panel's look, remembered in this browser: Dark (default) or Light (jarchi.theme, the top bar); on Appearance a color
// theme (jarchi.palette), the text size (jarchi.size), the background art (jarchi.art) and Reduce animations
// (jarchi.still: the art stays still). index.html puts them on <html>
// before the first paint; panel.css has each theme's colors. A saved theme that no longer exists is Jarchi.
const PALETTES = ['jarchi', 'system', 'graphite', 'ocean', 'wine', 'aurora', 'obsidian'];
const SIZES = ['small', 'normal', 'large'];
const palette = () => (PALETTES.includes(remember.get('jarchi.palette')) ? remember.get('jarchi.palette') : 'jarchi');
// System = Windows' accent color (GET /api/accent) -> the hue and saturation panel.css works from, and the main color's
// lightness: 32%, darker where white text on it would read under 4.5:1 (bright accents like yellow). Kept in jarchi.accent
// for index.html; null (no accent color found): System shows Jarchi's colors.
let accent = (() => { try { return JSON.parse(remember.get('jarchi.accent')); } catch { return null; } })();
const hslRgb = (h, s, l) => { // 0-360, 0-100, 0-100 -> sRGB 0-1
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  return [0, 8, 4].map((n) => { const k = (n + h / 30) % 12; return l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); });
};
const luminance = (rgb) => rgb.reduce((t, c, i) => t + [0.2126, 0.7152, 0.0722][i] * (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4), 0);
function accentVars(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const h = (!d ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  const s = Math.min(70, d ? (d / (1 - Math.abs(max + min - 1))) * 100 : 0); // a very bright accent would tint every background
  let l = 32;
  while (l > 12 && 1.05 / (luminance(hslRgb(h, s, l)) + 0.05) < 4.5) l--;
  return { '--h': h.toFixed(1), '--s': `${s.toFixed(1)}%`, '--l': `${l}%` };
}
const shown = (id) => (id === 'system' && !accent ? 'jarchi' : id);
// The whole panel in a color theme: the saved one, or (Appearance) the one under the mouse, not saved.
const show = (id) => (document.documentElement.dataset.palette = shown(id));
const applyLook = () => {
  const de = document.documentElement;
  de.dataset.theme = remember.get('jarchi.theme') === 'light' ? 'light' : 'dark';
  de.dataset.size = SIZES.includes(remember.get('jarchi.size')) ? remember.get('jarchi.size') : 'normal';
  de.toggleAttribute('data-art', remember.get('jarchi.art') !== '0');
  de.toggleAttribute('data-still', remember.get('jarchi.still') === '1');
  for (const k of ['--h', '--s', '--l']) accent ? de.style.setProperty(k, accent[k]) : de.style.removeProperty(k);
  show(palette());
  $$('[name=palette]').forEach((r) => (r.checked = r.value === palette()));
  $$('[name=size]').forEach((r) => (r.checked = r.value === de.dataset.size));
  $('#bgArtOn').checked = de.hasAttribute('data-art');
  $('#stillOn').checked = de.hasAttribute('data-still');
  $('#stillOn').disabled = !de.hasAttribute('data-art'); // nothing to keep still without the art
  $('#stillRow').classList.toggle('dim', !de.hasAttribute('data-art'));
  $$('.mode button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === de.dataset.theme)));
  $$('#palettes .mini').forEach((m) => Object.assign(m.dataset, { theme: de.dataset.theme, palette: shown(m.dataset.id) })); // in the mode shown now
};
const setLook = (key, value) => (remember.set(key, value), applyLook());
const readAccent = () => fetch('/api/accent').then((r) => r.json()).then((r) => {
  const next = r.accent ? accentVars(r.accent) : null;
  if (JSON.stringify(next) === JSON.stringify(accent)) return;
  accent = next;
  remember.set('jarchi.accent', JSON.stringify(accent));
  applyLook();
}).catch(() => {});
$$('.mode button').forEach((b) => (b.onclick = () => setLook('jarchi.theme', b.dataset.mode)));
$$('[name=size]').forEach((r) => (r.onchange = () => (setLook('jarchi.size', r.value), toast(S.panel.saved))));
$('#bgArtOn').onchange = (e) => (setLook('jarchi.art', e.target.checked ? '1' : '0'), artRun(), toast(S.panel.saved));
$('#stillOn').onchange = (e) => (setLook('jarchi.still', e.target.checked ? '1' : '0'), artRun(), toast(S.panel.saved));
// The accent color can change in Windows any time: looked at again every few seconds while System is in use or on
// screen (Appearance), and whenever the window comes back to the front.
const watchAccent = () => !document.hidden && (palette() === 'system' || view === 'appearance') && readAccent();
setInterval(watchAccent, 4000);
addEventListener('focus', watchAccent);
applyLook();
readAccent();
// The desktop app colors its window buttons like the title bar: its color as the page's theme-color (electron/main.js),
// again whenever <html> changes look (mode, color theme, the accent, a theme previewed on Appearance).
const tintTitleBar = () => ($('meta[name=theme-color]').content = getComputedStyle($('.titlebar')).backgroundColor);
new MutationObserver(tintTitleBar).observe(document.documentElement, { attributes: true });
tintTitleBar();
// Persian digits (and ٪ ٫) in labels; inputs keep theirs.
const fd = (v, fa = FA) => (fa ? String(v).replace(/(?<=\d)\.(?=\d)/g, '٫').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]).replace(/%/g, '٪') : String(v));
const fmt = (n) => n.toLocaleString(FA ? 'fa-IR' : undefined);
const ltr = (s) => (FA ? `\u2066${s}\u2069` : s); // an address inside a Persian sentence keeps its order
let S, EN, settings, samples, goalData; // S: the panel's strings, EN: English for the overlays. goalData = { state, styles, fonts } from /api/goals; state then follows the socket
let chatStyles, chatFonts, chatStatus; // chat style looks and fonts (/api/chat/styles), connection status (follows the socket)
let chatThumbs; // sample messages for the chat style thumbnails (/api/chat/thumbs: random viewers and badges each visit)
let view = 'home', cur = 'follow', curGoal = 'subs', topic = 'start'; // the open page, and the alert, goal and guide topic selected in theirs
let queue = { paused: false, overlays: 0, waiting: 0, now: null }; // the alert queue (follows the socket)
let home, open = {}, feedFilter = 'all'; // Home: { today, started, kickGoals } (/api/home, then the socket), widget pages open now (socket)
let hist = { list: [], filter: 'all', page: 0 }; // every saved event (/api/history, then the socket): Home's live feed and History; History's filter and page
let twitch; // the Twitch account: { state, error, code, uri, login, goals } (/api/twitch, then the socket)
let kick; // the Kick account: { state, error, uri, login } (/api/kick, then the socket)
let privacy; // the Privacy Policy: { version, en, fa } (i18n/privacy.json)
let showGoalTab; // the Goals list's Kick | Twitch tab (wireTabs, in build())

const pct = (v) => `${Math.round(v * 100)}%`;
const px = (v) => `${v}px`;
const FORMAT = {
  volume: pct, frameOpacity: pct, frameRadius: px, fontSize: px, bgOpacity: pct, borderWidth: px, radius: px, scale: pct, size: pct,
  emoteSize: px, bigEmoteSize: px, badgeSize: pct, nameSize: px, padding: px, gap: px, width: px, height: px, fadeZone: px, blur: px,
  tickerSpeed: (v) => `${v} px/s`, maxMessages: (v) => String(v), hideAfter: (v) => (Number(v) ? tpl(S.panel.seconds, { n: v }) : S.panel.never), animSpeed: (v) => `×${v}`,
};
const GOAL_STEP = { subs: 1, kicks: 100, followers: 1, twitchSubs: 1, bits: 100, twitchFollowers: 1 }; // what "Test", "+" and "−" add
const GOAL_SAMPLE = { subs: { current: 32, target: 50 }, kicks: { current: 640, target: 1000 }, followers: { current: 374, target: 500 }, // numbers on style thumbnails
  twitchSubs: { current: 32, target: 50 }, bits: { current: 3200, target: 5000 }, twitchFollowers: { current: 374, target: 500 } };
// Each goal is Kick's or Twitch's (its group on the Goals page). Outside its group it's named with its platform: "Sub goal (Twitch)".
const TWITCH_GOALS = ['twitchSubs', 'bits', 'twitchFollowers'];
const goalPlatform = (id) => (TWITCH_GOALS.includes(id) ? 'twitch' : 'kick');
const goalName = (id) => tpl(S.panel.goalOn, { goal: S.goals[id].name, platform: S.platforms[goalPlatform(id)] });
const isVideo = (file) => /\.(webm|mp4)$/.test(file ?? '');
const tpl = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => v[k] ?? m);
const kickLook = (type, cfg) => type === 'kicks' && cfg.look === 'kick';
// What plays when there's no file: the theme's, or (Kicks in its Kick look) Kick's gift and the Kick chime; bits show Twitch's gem.
const defaultMedia = (kind, kick) => S.panel[kind === 'image' ? (kick ? 'mediaKickGift' : cur === 'bits' ? 'mediaTwitchGem' : 'mediaDefault') : (kick ? 'soundKickDefault' : 'tierNoSound')];
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

// The Chat page's tabs, built from this list: tab -> [[box title, [[kind, field, options]...]]...].
// kind: toggle | range | seg | select | color | text | number. options.only: shown only when renderChat()'s show[only] is true.
const CHAT_TABS = () => ({
  text: [
    ['chatText', [['select', 'font', { options: chatFonts.map((x) => [x, x]) }], ['range', 'fontSize', { min: 10, max: 72, label: 'messageSize' }],
      ['color', 'textColor', { label: 'messageColor' }], ['toggle', 'textShadow'], ['select', 'textDir', { options: [['auto', 'dirAuto'], ['ltr', 'dirLtr'], ['rtl', 'dirRtl']] }],
      ['toggle', 'showTime'], ['toggle', 'showColon']]],
    ['chatEmotes', [['toggle', 'emotesKick'], ['toggle', 'emotesTwitch'], ['toggle', 'emotes7tv'], ['toggle', 'emotesAnimated'], ['range', 'emoteSize', { min: 12, max: 112 }],
      ['toggle', 'bigEmotes'], ['range', 'bigEmoteSize', { min: 16, max: 160, only: 'big' }]]],
  ],
  names: [
    ['nameBox', [['range', 'nameSize', { min: 10, max: 72 }],
      ['seg', 'nameColorMode', { label: 'nameColor', options: [['user', 'nameOwn'], ['style', 'nameStyle'], ['custom', 'nameCustom']] }], ['color', 'nameColor', { only: 'nameCustom' }],
      ['toggle', 'readableNames', { only: 'nameOwn' }], ['seg', 'namePos', { options: [['inline', 'nameInline'], ['above', 'nameAbove']] }],
      ['toggle', 'showPlatform'], ['toggle', 'avatars', { hint: 'avatarsHint' }], ['toggle', 'fxRainbowVip'], ['text', 'rainbowUsers', { hint: 'listHint' }]]],
    ['badgeBox', [['toggle', 'showBadges'], ['seg', 'badgeMode', { options: [['important', 'badgesImportant'], ['all', 'badgesAll']], only: 'badges' }],
      ['range', 'badgeSize', { min: 0.5, max: 2, step: 0.05, only: 'badges' }],
      ['seg', 'badgeBg', { options: [['auto', 'badgeBgAuto'], ['always', 'badgeBgAlways'], ['off', 'badgeBgOff']], only: 'badges' }], ['toggle', 'badgeBroadcaster', { only: 'badges' }], ['toggle', 'badgeMod', { only: 'badges' }],
      ['toggle', 'badgeVip', { only: 'badges' }], ['toggle', 'badgeSub', { only: 'badges' }], ['toggle', 'badgeOther', { only: 'badges' }],
      ['toggle', 'ogHat'], ['seg', 'hatStyle', { options: [['cap', 'hatCap'], ['beanie', 'hatBeanie'], ['fedora', 'hatFedora']], only: 'hat' }],
      ['select', 'hatPos', { options: [['first', 'hatFirst'], ['last', 'hatLast'], ['badge', 'hatBadge'], ['avatar', 'hatAvatar']], only: 'hat' }]]],
  ],
  events: [
    ['eventLines', [['toggle', 'eventKicks'], ['number', 'eventKicksMin', { only: 'evKicks' }], ['toggle', 'eventSubs'], ['toggle', 'eventGifts'], ['number', 'eventGiftsMin', { only: 'evGifts' }],
      ['toggle', 'eventBits'], ['number', 'eventBitsMin', { only: 'evBits' }], ['toggle', 'eventRaids']]],
    ['eventLookBox', [['seg', 'eventLook', { options: [['card', 'lookCard'], ['glow', 'lookGlow'], ['line', 'lookLine']] }], ['toggle', 'eventLonger']]],
    ['chatFx', [['toggle', 'fxSubGlow'], ['toggle', 'fxFirst'], ['toggle', 'fxMention'], ['toggle', 'fxCombo']]],
  ],
  filters: [
    ['chatFilters', [['toggle', 'hideCommands'], ['toggle', 'hideBots'], ['text', 'bots', { only: 'bots', hint: 'listHint' }], ['text', 'hiddenUsers', { hint: 'listHint' }],
      ['text', 'blockedWords', { hint: 'listHint', dir: 'auto' }], ['toggle', 'hideLinks'], ['select', 'source', { options: [['both', 'sourceBoth'], ['kick', 'sourceKick'], ['twitch', 'sourceTwitch']] }]]],
  ],
  layout: [
    ['chatBox', [['seg', 'bg', { label: 'bgMode', options: [['color', 'bgColor'], ['transparent', 'bgTransparent'], ['off', 'bgOff']] }], ['color', 'bgColor', { only: 'bgColor' }],
      ['range', 'bgOpacity', { min: 0, max: 1, step: 0.05, only: 'bgColor' }], ['toggle', 'bubbles', { label: 'bubblesOpt' }], ['toggle', 'border'],
      ['color', 'borderColor', { only: 'borderOn' }], ['range', 'borderWidth', { min: 1, max: 12, only: 'borderOn' }], ['range', 'radius', { min: 0, max: 40 }],
      ['range', 'padding', { min: 0, max: 60 }], ['range', 'gap', { min: 0, max: 40 }], ['range', 'width', { min: 200, max: 1920, step: 10, label: 'chatWidth' }],
      ['range', 'height', { min: 40, max: 1080, step: 10, label: 'chatHeight' }], ['range', 'blur', { min: 0, max: 40 }]]],
    ['chatMotion', [['seg', 'layout', { options: [['vertical', 'layoutVertical'], ['horizontal', 'layoutHorizontal']] }],
      ['seg', 'tickerDir', { options: [['rtl', 'dirRtlArrow'], ['ltr', 'dirLtrArrow']], only: 'ticker' }], ['range', 'tickerSpeed', { min: 20, max: 600, step: 10, only: 'ticker' }],
      ['toggle', 'tickerLoop', { only: 'ticker' }], ['seg', 'tickerPos', { options: [['top', 'posTop'], ['bottom', 'posBottom']], only: 'ticker' }],
      ['seg', 'newAt', { options: [['bottom', 'newBottom'], ['top', 'newTop']], only: 'vertical' }], ['range', 'maxMessages', { min: 1, max: 100 }],
      ['range', 'hideAfter', { min: 0, max: 600, step: 5 }], ['select', 'enterAnim', { options: [['slide', 'animSlide'], ['fade', 'animFade'], ['pop', 'animPop'], ['float', 'animFloat'], ['bounce', 'animBounce'], ['drop', 'animDrop'], ['none', 'animNone']] }],
      ['select', 'exitAnim', { options: [['fade', 'animFade'], ['slide', 'animSlide'], ['none', 'animNone']] }], ['range', 'animSpeed', { min: 0.25, max: 3, step: 0.25 }],
      ['toggle', 'fade'], ['range', 'fadeZone', { min: 0, max: 400, step: 5, only: 'fade' }], ['toggle', 'typewriter'], ['toggle', 'typeSound', { only: 'typewriter' }]]],
    ['chatDebug', [['toggle', 'showTiming']]],
  ],
});

// One control of a Chat tab. Inputs carry data-f like the other editors, so fill() and the save handler just work.
function chatControl(kind, f, o) {
  const label = S.panel[o.label ?? f] ?? f;
  const input = (props) => {
    const i = el(props.tag ?? 'input', props.tag ? {} : props);
    i.dataset.f = f;
    return i;
  };
  let node;
  if (kind === 'toggle') {
    node = el('label', { className: 'row between toggle-row' }, el('span', { textContent: label }), el('span', { className: 'switch' }, input({ type: 'checkbox' }), el('span')));
  } else if (kind === 'range') {
    const out = el('b');
    out.dataset.out = f;
    node = el('label', { className: 'field' }, el('span', {}, el('span', { textContent: label }), ' ', out), input({ type: 'range', min: o.min, max: o.max, step: o.step ?? 1 }));
  } else if (kind === 'seg') {
    node = el('div', { className: 'field' }, el('span', { textContent: label }), el('div', { className: 'seg' }, ...o.options.map(([v, k]) => {
      const r = input({ type: 'radio', name: `chat-${f}`, value: v });
      return el('label', {}, r, el('span', { textContent: S.panel[k] ?? k }));
    })));
  } else if (kind === 'select') {
    const sel = input({ tag: 'select' });
    sel.append(...o.options.map(([v, k]) => new Option(S.panel[k] ?? k, v)));
    node = el('label', { className: 'field' }, el('span', { textContent: label }), sel);
  } else if (kind === 'number') { // a smallest amount, under its line's switch
    node = el('label', { className: 'row between toggle-row sub-row' }, el('span', { textContent: label }), input({ type: 'number', min: 0, step: 1, className: 'num' }));
  } else {
    node = el('label', { className: 'field' }, el('span', { textContent: label }), input({ type: kind === 'color' ? 'color' : 'text', maxLength: 1000, ...(o.dir && { dir: o.dir }) }), o.hint ? el('small', { textContent: S.panel[o.hint] }) : '');
  }
  node.firstChild.dataset.help = `chat.${f}`; // the label: build() adds its "?"
  if (o.only) node.dataset.only = o.only;
  return node;
}

// Each style's own look with sample messages; filters off so the samples always show. Only the group on screen: a
// hidden thumbnail has no size to lay its messages out in (the other group is drawn when it's picked).
function drawChatThumbs() {
  if (!chatThumbs || view !== 'chat') return;
  for (const f of $$('.chat-tile:not([hidden]) iframe')) {
    const style = f.dataset.style;
    const ticker = chatStyles[style].layout === 'horizontal';
    const cfg = { ...settings.chat, ...chatStyles[style], style, enabled: true, width: ticker ? 440 : 400, height: ticker ? 64 : 290, maxMessages: 6,
      hideCommands: false, hideBots: false, hiddenUsers: '', blockedWords: '', hideLinks: false, source: 'both', avatars: false, fxMention: false };
    f.contentWindow?.postMessage({ strings: EN, cfg, messages: chatThumbs }, location.origin);
  }
}

// The style gallery shows one group: vertical styles or bars (horizontal). Starts on the current style's group.
let styleGroup;
function showStyleGroup(g) {
  styleGroup = g;
  $$('[name=styleGroup]').forEach((r) => (r.checked = r.value === g));
  $$('.chat-tile').forEach((t) => (t.hidden = chatStyles[t.dataset.style].layout !== g));
  const grid = $('#chatStyleGrid'), current = $('.chat-tile.selected:not([hidden])', grid);
  grid.dataset.group = g;
  grid.scrollTop = current ? current.offsetTop - 8 : 0; // the chat's own style in view
  drawChatThumbs();
}

// The chat preview iframe is as big as the chat (+ a margin), scaled down to fit and centered.
function fitChat() {
  const box = $('.chat-preview'), f = $('#chatPreview'), c = settings.chat;
  const W = c.width + 60, H = c.height + 60;
  const k = Math.min(box.clientWidth / W, box.clientHeight / H, 1);
  Object.assign(f.style, { width: `${W}px`, height: `${H}px`, transform: `translate(${(box.clientWidth - W * k) / 2}px, ${(box.clientHeight - H * k) / 2}px) scale(${k})` });
}

// Chat page status lines, and the top bar's Kick / Twitch pills (green dot = connected).
function renderStatus() {
  const names = { off: 'stOff', connecting: 'stConnecting', connected: 'stConnected', error: 'stError' };
  for (const p of ['kick', 'twitch']) {
    const st = chatStatus[p];
    const e = $(`#${p}Status`);
    e.className = `status st-${st.state}`;
    e.textContent = S.panel[names[st.state]] + (st.state === 'error' && st.detail ? ` · ${S.panel[`err_${st.detail}`] ?? st.detail}` : '');
    const pill = $(`.plat[data-p="${p}"]`);
    pill.classList.toggle('on', st.state === 'connected');
    pill.setAttribute('aria-label', (pill.title = `${S.platforms[p]}: ${e.textContent}`));
  }
  renderConnWarn();
}

// The top bar's warning: a Kick / Twitch connection that should be up (a channel set, an account connected) has been
// down for over 30 s, counted from when this panel saw it go (or opened). A click opens where it's set up.
const DOWN_MS = 30000, downSince = {};
const secs = new Intl.NumberFormat(FA ? 'fa' : 'en', { style: 'unit', unit: 'second', unitDisplay: 'short' });
const mins = new Intl.NumberFormat(FA ? 'fa' : 'en', { style: 'unit', unit: 'minute', unitDisplay: 'short' });
function renderConnWarn() {
  const now = Date.now(), long = [];
  const conns = [
    ['kickChat', 'kick', 'chat', !['off', 'connected'].includes(chatStatus.kick.state)],
    ['twitchChat', 'twitch', 'chat', !['off', 'connected'].includes(chatStatus.twitch.state)],
    ['kickAccount', 'kick', 'connections', kick?.state === 'connecting'],
    ['twitchAccount', 'twitch', 'connections', twitch?.state === 'connecting'],
  ];
  for (const [id, platform, page, down] of conns) {
    if (!down) delete downSince[id];
    else if (now - (downSince[id] ??= now) > DOWN_MS) long.push({ platform, page, since: downSince[id] });
  }
  const w = $('#connWarn');
  w.hidden = !long.length;
  if (!long.length) return;
  const s = Math.floor((now - Math.min(...long.map((c) => c.since))) / 1000);
  w.dataset.page = long[0].page;
  w.title = S.panel.connDownHint;
  $('span', w).textContent = tpl(S.panel.connDown, {
    platforms: [...new Set(long.map((c) => S.platforms[c.platform]))].join(FA ? '، ' : ', '),
    time: s < 60 ? secs.format(s) : mins.format(Math.floor(s / 60)),
  });
}

async function api(method, url, body, headers = {}) {
  const isFile = body instanceof Blob || body instanceof FormData;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { 'x-jarchi': '1', ...(body && !isFile && { 'content-type': 'application/json' }), ...headers },
      body: isFile ? body : body && JSON.stringify(body),
    });
  } catch {
    throw new Error(S.errors.offline);
  }
  const data = await res.json().catch(() => ({ error: 'server_error' }));
  if (!res.ok) throw new Error(S.errors[data.error] || S.errors.server_error);
  return data;
}

let toastTimer;
function toast(msg, isError) {
  const t = $('#toast');
  ($('dialog[open]') ?? document.body).append(t); // over an open dialog's backdrop, not under it
  t.textContent = msg;
  t.className = isError ? 'show error' : 'show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), 2000);
}

// Any call that returns settings: store them, re-sync the UI (also reverts rejected values), replay the preview.
async function send(method, url, body, headers) {
  try {
    settings = await api(method, url, body, headers);
    if (view === 'chat') { // the Chat page's own "Saved" note lights up instead of the toast
      const note = $('#chatSaved');
      note.classList.remove('flash');
      void note.offsetWidth; // restart its animation
      note.classList.add('flash');
    } else toast(S.panel.saved);
    preview();
  } catch (err) {
    toast(err.message, true);
  }
  render();
}
const patchAlert = (type, fields) => send('PATCH', '/api/settings', { alerts: { [type]: fields } });
const patchGoal = (id, fields) => send('PATCH', '/api/settings', { goals: { [id]: fields } });
const patchChat = (fields) => send('PATCH', '/api/settings', { chat: fields });

// Change a goal's count (the selected one's by default): { add: n } or { set: n }.
async function goalCount(body, id = curGoal) {
  try {
    goalData.state = await api('PATCH', `/api/goals/${id}`, body);
  } catch (err) {
    toast(err.message, true);
  }
  render();
}

// A goal's row in the Goals list: its count (click it and type another), "/ target", and Reset to 0 (click twice).
function goalCountRow(id) {
  const input = el('input', { type: 'number', min: 0, step: 1, className: 'count-input', onchange: () => goalCount({ set: Math.max(0, Math.round(Number(input.value) || 0)) }, id) });
  input.setAttribute('aria-label', `${goalName(id)}: ${S.panel.goalCurrent}`);
  const zero = el('button', { className: 'ghost zero', textContent: S.panel.goalZero });
  twoClick(zero, zero, S.panel.goalZero, S.panel.confirmZero, () => goalCount({ set: 0 }, id));
  // Synced from Kick / Twitch: their count, read-only, without Reset to 0 (the tab already says which platform).
  return el('div', { className: 'goal-count' }, input, el('small', { className: 'of' }), zero);
}

// ---------- Previews ----------
const sample = (type, amount) => ({ ...samples[type], type, platform: $('#testAs').value, test: true, ...(amount !== undefined && { amount }) });
const previewAmount = () => (samples[cur].amount > 0 ? Number($('#previewAmount').value) || 0 : undefined);

const post = (frame, s, event, muted, hold = false) => frame.contentWindow?.postMessage({ strings: EN, settings: s, event, muted, hold }, location.origin);

function preview() {
  if (view === 'alert') post($('#preview'), settings, sample(cur, previewAmount()), !$('#previewSound').checked);
}

// Theme cards: the sub alert in that theme with its own look and sound; it stays on the card (hold) until the next play.
const THEME_TEXT = { nameColor: null, nameFont: 'theme', nameBold: true, nameShadow: true, textColor: null, textFont: 'theme', textBold: true, textShadow: true, autoSize: true };
function playTile(frame, muted = true) {
  const sub = { ...settings.alerts.sub, ...THEME_TEXT, size: 1, theme: null, image: null, soundMode: 'theme', frame: 'theme', textPos: 'below', textAlign: 'center' };
  post(frame, { theme: frame.dataset.theme, alerts: { sub } }, sample('sub'), muted, true);
}

// Style thumbnails: each style's own look with this goal's title and sample numbers.
function drawThumbs() {
  const g = settings.goals[curGoal];
  const { current, target } = GOAL_SAMPLE[curGoal];
  for (const f of $$('.goal-tile iframe')) {
    const style = f.dataset.style;
    f.contentWindow?.postMessage({ cfg: { ...goalData.styles[style], style, title: g.title, target, enabled: true }, state: { current, reached: false } }, location.origin);
  }
}

// Scale each iframe (the alert editor's 800x600, the theme cards' 1920x1080, goals' 1000x400) down to its box.
const fit = new ResizeObserver((entries) => {
  for (const e of entries) e.target.style.setProperty('--k', e.contentRect.width / e.target.querySelector('iframe').offsetWidth);
});

// Open a page (and in Alerts / Goals / Guide, an item of it: without `key`, the one selected before).
function select(v, key) {
  view = v;
  if (v === 'alert') {
    cur = key ?? cur;
    $('#previewAmount').value = samples[cur].amount;
  }
  if (v === 'goal') {
    curGoal = key ?? curGoal;
    if (key) showGoalTab(goalPlatform(key)); // e.g. Home's Fix for a Twitch goal: the Twitch tab
    const src = `/widgets/goal/${curGoal}?preview`;
    if ($('#goalPreview').getAttribute('src') !== src) $('#goalPreview').src = src;
  }
  if (v === 'chat' && !$('#chatPreview').getAttribute('src')) $('#chatPreview').src = '/widgets/chat?preview';
  if (v === 'home') loadHome(); // today's numbers may have started again at midnight
  if (v === 'events') loadHistory();
  if (v === 'support') loadTickets();
  if (v === 'settings') showProxyNow();
  if (v === 'about') api('GET', '/api/version').then(({ version }) => ($('#aboutVersion').textContent = S.panel.version.replace('{version}', version)), () => {});
  if (v === 'guide') {
    if (S.guide.topics[key]) topic = key;
    renderGuide();
  }
  $$('main .view').forEach((s) => (s.hidden = !s.dataset.view.split(' ').includes(v)));
  const page = v === 'theme' ? 'alert' : v; // the theme page is part of Alerts
  $$('.nav-item').forEach((b) => b.setAttribute('aria-current', b.dataset.view === page ? 'page' : 'false'));
  $('#pageTitle').textContent = $(`.nav-item[data-view="${page}"] [data-i18n]`).textContent;
  render();
  preview();
  if (v === 'theme') $$('.theme-tile iframe').forEach((f) => playTile(f));
  if (v === 'chat') {
    fitChat();
    if (!styleGroup) showStyleGroup(chatStyles[settings.chat.style].layout);
    api('GET', '/api/chat/thumbs').then((m) => { chatThumbs = m; drawChatThumbs(); }, () => {});
  }
}

// A page's tabs (Alerts, Chat): the open one stays open from item to item, and next time (remembered under `key`).
// Arrow keys move between them.
function wireTabs(root, key) {
  const tabs = $$('.tabs [role=tab]', root);
  const showTab = (t) => {
    remember.set(key, t);
    tabs.forEach((b) => {
      b.setAttribute('aria-selected', String(b.dataset.tab === t));
      b.tabIndex = b.dataset.tab === t ? 0 : -1;
    });
    $$('.pane', root).forEach((p) => (p.hidden = p.dataset.tab !== t));
  };
  tabs.forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
  showTab(tabs.some((b) => b.dataset.tab === remember.get(key)) ? remember.get(key) : tabs[0].dataset.tab);
  $('.tabs', root).onkeydown = (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key] * (FA ? -1 : 1), i = tabs.indexOf(e.target);
    if (!step || i < 0) return;
    const next = tabs[(i + step + tabs.length) % tabs.length];
    showTab(next.dataset.tab);
    next.focus();
  };
  return showTab;
}

// A preview's background: dark, light or checkered (radios name=`name`, remembered in this browser under `key`).
function wireBg(box, name, key) {
  const bg = ['dark', 'light', 'checker'].includes(remember.get(key)) ? remember.get(key) : 'checker';
  box.dataset.bg = bg;
  $$(`[name=${name}]`).forEach((r) => {
    r.checked = r.value === bg;
    r.onchange = () => remember.set(key, (box.dataset.bg = r.value));
  });
}

// A button that opens a small menu under it (the Home page's OBS links, the Chat page's other tests). A pick, a click
// anywhere else or Escape closes it.
function wireMenu(btn, pop) {
  const show = (on) => {
    pop.hidden = !on;
    btn.setAttribute('aria-expanded', String(on));
  };
  btn.onclick = () => show(pop.hidden);
  pop.addEventListener('click', () => show(false));
  addEventListener('click', (e) => { if (!btn.parentNode.contains(e.target)) show(false); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') show(false); });
}

// ---------- Alert queue (its own page) ----------
// One line icon per alert type, in the type's own color (the --dot colors).
const TYPE_ICON = {
  follow: 'M15 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M8.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19 8v6M22 11h-6',
  sub: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  resub: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  gift_sub: 'M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-1-3-5-3-5-1s3 1 5 1zM12 7c1-3 5-3 5-1s-3 1-5 1z',
  kicks: 'M13 2L4 14h7l-1 8 9-12h-7z',
  bits: 'M12 2l8 5v10l-8 5-8-5V7z',
  raid: 'M17 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M21 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8',
};
function typeIcon(type) {
  const i = el('span', { className: 'q-icon', title: S.types[type] });
  i.dataset.key = type;
  i.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${TYPE_ICON[type]}"/></svg>`; // fixed paths, no user text
  return i;
}
// An alert from one platform only: that platform's logo, "Kick only" / "Twitch only".
const platMarks = (type) => el('span', { className: 'plat-marks' }, ...(ALERT_PLATFORMS[type] ?? []).map((p) => {
  const only = tpl(S.panel.platformOnly, { platform: S.platforms[p] });
  return el('img', { src: `/assets/platform-logos/${p}.svg`, alt: only, title: only });
}));
// "Rich · Gifted subs · 10": icon, name, type, and the amount (or a resub's months).
function alertRow(a, action) {
  const amount = a.type === 'resub' && a.months ? tpl(S.panel.qMonths, { n: fmt(a.months) }) : a.amount ? fmt(a.amount) : '';
  return el('li', { className: 'q-item' }, typeIcon(a.type),
    el('span', { className: 'q-who' }, el('b', { textContent: a.user, title: a.user, dir: 'auto' }), el('small', { textContent: S.types[a.type] })),
    el('span', { className: 'q-amt', textContent: amount }), action ?? '');
}

function renderQueue() {
  const q = queue, n = q.now;
  for (const c of $$('#qCount, #qNavCount')) c.textContent = fd(q.waiting);
  $('#qNavCount').hidden = !q.waiting; // in the sidebar: only when alerts are waiting
  $('#qPaused').hidden = !q.paused;
  $('#queue').dataset.state = q.paused ? 'paused' : n ? 'playing' : 'idle';
  $('#qNow').replaceChildren(n ? alertRow(n) : el('p', { className: 'q-empty', textContent: S.panel.qIdle }));
  // Progress bar: from where the alert is now to the end, in the time it has left.
  const bar = $('#qBar');
  bar.style.transition = 'none';
  bar.style.width = n ? `${(1 - n.left / n.ms) * 100}%` : '0';
  if (n) {
    bar.getBoundingClientRect(); // start the transition from that width
    bar.style.transition = `width ${n.left}ms linear`;
    bar.style.width = '100%';
  }
  $('#qPause span').textContent = q.paused ? S.panel.qResume : S.panel.qPause;
  $('#qPause').title = q.paused ? S.panel.qResumeHint : S.panel.qPauseHint;
  $('#qSkip').disabled = !n;
  $('#qClear').disabled = !q.waiting;
  $('#qList').replaceChildren(...q.list.map((a) => alertRow(a, el('button', {
    className: 'x', textContent: '×', title: S.panel.qRemove, ariaLabel: S.panel.qRemove, onclick: () => queueCall('DELETE', `queue/${encodeURIComponent(a.id)}`),
  }))));
  $('#qEmpty').hidden = q.list.length > 0;
  $('#qHistory').replaceChildren(...q.history.map((a) => alertRow(a, el('button', {
    className: 'replay', textContent: S.panel.qReplay, onclick: () => queueCall('POST', `replay/${encodeURIComponent(a.id)}`).then((r) => r && toast(S.panel.qReplayed)),
  }))));
  $('#qNoHistory').hidden = q.history.length > 0;
  $('#qNoObs').hidden = q.overlays > 0;
}
const queueCall = (method, what, body) => api(method, `/api/alerts/${what}`, body).then((q) => { queue = q; renderQueue(); return q; }, (err) => toast(err.message, true));

// ---------- Goal marks (panel only): an icon per goal in its colour (CSS [data-goal]), Kick's K ----------
// Kick's own logo shape (assets/platform-logos/kick.svg), drawn in currentColor so light mode can use a darker green.
const KICK_K = '<svg class="kick-k" viewBox="0 0 26 26" aria-hidden="true"><path fill-rule="evenodd" d="M1 0H9.76711V5.79452H12.589V2.82193H15.5616V0H24.1781V8.61645H21.3561V11.589H18.3836V14.411H21.3561V17.3836H24.1781V26H15.5616V23.1781H12.589V20.2055H9.76711V26H1V0Z"/></svg>';
const HEART = 'M12 20.5s-7.6-4.5-9.4-9.2C1.4 8.1 3.5 4.7 7 4.7c2 0 3.6 1.1 5 2.9 1.4-1.8 3-2.9 5-2.9 3.5 0 5.6 3.4 4.4 6.6-1.8 4.7-9.4 9.2-9.4 9.2z';
const GOAL_ICON = {
  subs: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${TYPE_ICON.sub}"/></svg>`, // star
  kicks: KICK_K,
  followers: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${HEART}"/></svg>`, // heart
  bits: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${TYPE_ICON.bits}"/></svg>`, // gem
};
GOAL_ICON.twitchSubs = GOAL_ICON.subs; // Twitch's look like Kick's
GOAL_ICON.twitchFollowers = GOAL_ICON.followers;
const svgIn = (cls, markup) => { // fixed markup only
  const s = el('span', { className: cls });
  s.innerHTML = markup;
  return s;
};
// A Kick / Twitch channel goal's icon and bar colour (Home), by its type, never its title: the Jarchi goal of the same
// kind, so a Twitch followers goal looks exactly like Kick's (green heart). Cheerers are bits too.
const CHANNEL_GOAL = { followers: 'followers', subscriptions: 'subs', kicks: 'kicks', follow: 'followers', subscription: 'subs', subscription_count: 'subs',
  new_subscription: 'subs', new_subscription_count: 'subs', new_bit: 'bits', new_cheerer: 'bits' };
const goalIcon = (id) => svgIn('goal-icon', GOAL_ICON[id] ?? ''); // a goal type that's new to Jarchi: none

// ---------- Home ----------
const COPY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>';
const copyLink = (url, msg = S.panel.copied) => navigator.clipboard.writeText(url).then(() => toast(msg));
const copyBtn = (name, url) => { // a widget's copy icon (Home's Widgets card, the welcome tour)
  const b = el('button', { className: 'icon-btn', title: S.panel.copyObs, ariaLabel: `${S.panel.copyObs}: ${name}`, onclick: () => copyLink(url) });
  b.innerHTML = COPY_ICON; // fixed markup
  return b;
};
// The widget pages: [id the server counts them by, name, OBS link]. Only the switched-on ones are needed (alerts always).
const widgetPages = () => [
  ['alerts', S.panel.groupAlerts, `${location.origin}/widgets/alerts`],
  ['chat', S.panel.chatName, `${location.origin}/widgets/chat`],
  ...Object.keys(settings.goals).map((id) => [id, goalName(id), `${location.origin}/widgets/goal/${id}`]),
];
const widgetOn = (id) => id === 'alerts' || (id === 'chat' ? settings.chat : settings.goals[id]).enabled;
const FEED_FILTERS = { all: null, subs: ['sub', 'resub', 'gift_sub'], kicks: ['kicks'], raids: ['raid'], follows: ['follow'] };
const ofType = (list, f) => list.filter((ev) => !FEED_FILTERS[f] || FEED_FILTERS[f].includes(ev.type));
const pressFilter = (box, f) => $$('button', box).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === f)));

// What's missing before going live: [text, the page (and item) that fixes it]. Widgets switched off aren't needed.
function issues() {
  const out = ['kick', 'twitch'].filter((p) => chatStatus[p].state !== 'connected')
    .map((p) => [tpl(S.panel.issuePlatform, { platform: S.platforms[p] }), ['chat']]); // the channel names are on the Chat page for now
  if (!open.alerts) out.push([S.panel.issueAlerts, ['alert']]);
  if (settings.chat.enabled && !open.chat) out.push([S.panel.issueChat, ['chat']]);
  for (const [id, g] of Object.entries(settings.goals)) if (g.enabled && !open[id]) out.push([tpl(S.panel.issueGoal, { goal: goalName(id) }), ['goal', id]]);
  return out;
}

// "gifted 5 subs", "sent 100 Kicks"; feedDidOne for 1 (and a resub without its months).
function did(ev) {
  const n = ev.type === 'resub' ? ev.months : ev.amount;
  const one = S.panel.feedDidOne[ev.type];
  return one && (n === 1 || (ev.type === 'resub' && !n)) ? one : tpl(S.panel.feedDid[ev.type], { n: fmt(n) });
}
const since = new Intl.RelativeTimeFormat(FA ? 'fa' : 'en', { numeric: 'auto', style: 'short' });
function ago(t) {
  const s = (Date.now() - t) / 1000;
  return s < 60 ? since.format(0, 'second') : s < 3600 ? since.format(-Math.floor(s / 60), 'minute')
    : s < 86400 ? since.format(-Math.floor(s / 3600), 'hour') : since.format(-Math.floor(s / 86400), 'day');
}
function uptime() {
  const m = Math.floor((Date.now() - home.started) / 60000);
  return fd(tpl(S.panel[m < 60 ? 'uptimeM' : 'uptimeHM'], { h: Math.floor(m / 60), m: m % 60 }));
}

const loadHome = () => api('GET', '/api/home').then((h) => { home = h; if (view === 'home') renderHome(); }, () => {});

// An event (Home's live feed, History), with when it came; a test button's alert says so.
const feedRow = (ev, when) => el('li', { className: 'feed-row' },
  ev.platform === 'test' ? typeIcon(ev.type) : el('img', { className: 'feed-logo', src: `/assets/platform-logos/${ev.platform}.svg`, alt: S.platforms[ev.platform], title: S.platforms[ev.platform] }),
  el('span', { className: 'feed-what' }, el('b', { textContent: ev.user, dir: 'auto' }), ` ${did(ev)}`, ev.test ? el('span', { className: 'pill', textContent: S.platforms.test }) : ''),
  el('small', { textContent: when }),
  el('button', { className: 'replay', textContent: S.panel.qReplay, onclick: () => queueCall('POST', `replay/${encodeURIComponent(ev.id)}`).then((q) => q && toast(S.panel.qReplayed)) }));

// History: every saved event, newest first, 20 a page, each with its local date and time ("19 Oct 2026, 04:50"; in
// Persian the Persian calendar: "۲۷ مهر ۱۴۰۵، ۰۴:۵۰"). Page buttons: all of them up to 7, else the first, the last and
// the ones beside the open one.
const PAGE = 20;
const dayFmt = new Intl.DateTimeFormat(FA ? 'fa-IR' : 'en-GB', { day: 'numeric', month: FA ? 'long' : 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat(FA ? 'fa-IR' : 'en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dateTime = (t) => `${dayFmt.format(t)}${FA ? '، ' : ', '}${timeFmt.format(t)}`; // one fa-IR format would say "ساعت"
const loadHistory = () => api('GET', '/api/history').then((list) => { hist.list = list; if (view === 'events') renderHistory(); }, () => {});
function renderHistory() {
  pressFilter($('#histChips'), hist.filter);
  const rows = ofType(hist.list, hist.filter);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  hist.page = Math.min(hist.page, pages - 1);
  $('#histList').replaceChildren(...rows.slice(hist.page * PAGE, (hist.page + 1) * PAGE).map((ev) => feedRow(ev, dateTime(ev.time))));
  $('#histEmpty').hidden = rows.length > 0;
  const go = (p, text, props) => el('button', { textContent: text, onclick: () => { hist.page = p; renderHistory(); }, ...props });
  const nums = [];
  for (let p = 0; p < pages; p++) {
    if (pages <= 7 || p === 0 || p === pages - 1 || Math.abs(p - hist.page) <= 1) nums.push(go(p, fd(p + 1), p === hist.page && { ariaCurrent: 'page' }));
    else if (nums.at(-1).tagName !== 'SPAN') nums.push(el('span', { textContent: '…' }));
  }
  $('#histPages').hidden = pages < 2;
  $('#histPages').replaceChildren(go(hist.page - 1, S.panel.prev, { disabled: !hist.page }), ...nums, go(hist.page + 1, S.panel.next, { disabled: hist.page === pages - 1 }));
}

function renderHome() {
  const missing = issues();
  $('#banner').classList.toggle('ready', !missing.length);
  $('#bannerTitle').textContent = S.panel[missing.length ? 'notReadyTitle' : 'readyTitle'];
  $('#bannerHint').hidden = missing.length > 0;
  $('#issues').replaceChildren(...missing.map(([text, page]) => el('li', {}, el('span', { textContent: text }),
    el('button', { textContent: S.panel.fix, onclick: () => select(...page) }))));

  // Live feed: the 10 newest events, whenever they came. View all = History.
  pressFilter($('#feedChips'), feedFilter);
  const rows = ofType(hist.list, feedFilter).slice(0, 10);
  $('#feedList').replaceChildren(...rows.map((ev) => feedRow(ev, ago(ev.time))));
  $('#feedEmpty').hidden = rows.length > 0;

  // Widgets: only the ones switched on (alerts always), green when a page of it is open (in OBS) right now.
  $('#widgetList').replaceChildren(...widgetPages().filter(([id]) => widgetOn(id)).map(([id, name, url]) => el('li', { className: `widget-row${open[id] ? ' on' : ''}` }, el('i', { className: 'state-dot' }),
    el('span', { className: 'stack' }, el('b', { textContent: name }), el('small', { textContent: S.panel[open[id] ? 'widgetOpen' : 'widgetClosed'] })), copyBtn(name, url))));

  // Goals: what's set on each channel right now, exactly as Kick / Twitch list it (read-only; whatever the syncs do).
  // Kick's have no title: their type names them. A Twitch goal's title is its description, else its type.
  $('#kickGoals').replaceChildren(...home.kickGoals.map((g) => homeGoal(CHANNEL_GOAL[g.type], S.panel.kickGoalTypes[g.type] ?? g.type, g.current, g.target)));
  hint('#kickGoalsHint', !settings.chat.kickChannel ? S.panel.kickSyncNoChannel : home.kickGoals.length ? '' : S.panel.kickSyncNone);
  $('#twitchGoals').replaceChildren(...twitch.goals.map((g) => {
    const kind = S.panel.twitchGoalTypes[g.type] ?? g.type;
    return homeGoal(CHANNEL_GOAL[g.type], g.description || kind, g.current, g.target, [], g.description ? el('small', { textContent: kind }) : '');
  }));
  hint('#twitchGoalsHint', twitch.state === 'off' ? S.panel.twitchGoalsOff : twitch.state === 'connected' && !twitch.goals.length ? S.panel.twitchGoalsNone : '');
  $('#twitchGoalsConnect').hidden = twitch.state !== 'off';

  $('#statAlerts').textContent = fmt(home.today.alerts);
  $('#statChat').textContent = fmt(home.today.chat);
  $('#statUptime').textContent = uptime();
}

// A hint line: its text, hidden when there's none.
const hint = (sel, text) => Object.assign($(sel), { textContent: text, hidden: !text });
// One goal on Home: its icon and name, current / target, more (marks, a line under it), and a bar, in the goal's colour.
function homeGoal(id, name, current, target, marks = [], under = '') {
  const bar = el('i');
  bar.style.width = `${Math.min(100, target ? (current / target) * 100 : 0)}%`;
  const row = el('div', { className: 'home-goal' },
    el('div', { className: 'row' }, goalIcon(id), el('b', { textContent: name, dir: 'auto' }), el('small', { textContent: `${fmt(current)} / ${fmt(target)}` }), ...marks),
    under, el('div', { className: 'goal-bar' }, bar));
  row.dataset.goal = id;
  return row;
}

// Two clicks instead of confirm(): no blocking dialog. The first click arms the button for 3 seconds.
function twoClick(btn, label, idle, confirm, action) {
  let armed;
  const disarm = () => {
    clearTimeout(armed);
    armed = null;
    label.textContent = idle;
    btn.classList.remove('armed');
  };
  btn.onclick = () => {
    if (armed) return disarm(), action();
    armed = setTimeout(disarm, 3000);
    btn.classList.add('armed');
    label.textContent = confirm;
  };
}

// ---------- Media by amount: one card per fixed tier, rebuilt only when the tiers change ----------
let tiersDrawn = '';
function renderTiers(cfg) {
  const key = JSON.stringify([cur, cfg.tiers, cfg.look]);
  if (key === tiersDrawn) return;
  tiersDrawn = key;
  $('#tiers').replaceChildren(...cfg.tiers.map((t) => {
    const on = el('input', { type: 'checkbox', checked: t.on, onchange: () => send('PATCH', `/api/tiers/${cur}/${t.amount}`, { on: on.checked }) });
    on.setAttribute('aria-label', S.panel.tierOn);
    const amount = tpl(S.panel.tierAmount[cur][t.amount === 1 ? 'one' : 'many'], { n: fmt(t.amount) });
    const name = t.gift // Kicks: Kick's own gift, its icon and name
      ? [el('img', { className: 'gift-icon', alt: '', src: `/assets/kick-gifts/${t.gift.id}.webp` }),
        el('b', { textContent: S.kickGifts[t.gift.id] ?? t.gift.id }), el('small', { textContent: amount })]
      : cur === 'bits' ? [el('img', { className: 'gift-icon', alt: '', src: `/assets/twitch-bits/${t.amount}.gif` }), el('b', { textContent: amount })] // Twitch's gem
      : [el('b', { textContent: amount })];
    return el('div', { className: `tier${t.on ? '' : ' off'}` },
      el('div', { className: 'tier-head' },
        el('label', { className: 'switch' }, on, el('span')),
        el('span', { className: 'tier-name' }, ...name),
        el('button', { textContent: S.panel.tierTest, onclick: () => testTier(t.amount) })),
      tierFile(t, 'image', kickLook(cur, cfg)), tierFile(t, 'sound', kickLook(cur, cfg)));
  }));
}

// A tier's image or sound: the file's name (or the theme's), Upload (replaces it), Remove. Wired like the alert's own .file rows.
function tierFile(t, kind, kick) {
  const f = t[kind];
  const row = el('div', { className: 'tier-files' },
    el('span', { className: 'tier-label', textContent: S.panel[kind === 'image' ? 'mediaTitle' : 'soundTitle'] }),
    el('div', { className: 'chips' },
      el('span', { className: `fname${f ? '' : ' default'}`, textContent: f ? f.name : defaultMedia(kind, kick), title: f?.name ?? '' }),
      el('button', { className: 'ghost add upload', textContent: S.panel.upload }),
      el('button', { className: 'ghost add remove', textContent: S.panel.remove, hidden: !f }),
      el('input', { type: 'file', hidden: true, accept: ACCEPT[kind] })));
  const url = () => `/api/tiers/${cur}/${t.amount}/${kind}`;
  wireFile(row, url, url);
  return row;
}

// A tier's Test: plays it here in the preview and sends it to OBS, with the tier's amount.
function testTier(amount) {
  $('#previewAmount').value = amount;
  preview();
  api('POST', `/api/test/${cur}`, { platform: $('#testAs').value, amount }).then(() => toast(S.panel.testSent), (err) => toast(err.message, true));
}

// ---------- Settings: proxy ----------
const proxyLabel = (p) => ltr(`${p.host}:${p.port} (${p.type === 'socks5' ? 'SOCKS5' : 'HTTP'})`);
function showProxyNow() {
  api('GET', '/api/net/proxy').then(({ proxy }) => {
    $('#proxyNow').textContent = proxy ? tpl(S.net.systemNow, { proxy: proxyLabel(proxy) }) : S.net.systemNone;
  }, () => {});
}
function renderNet({ proxy, results }) {
  const p = proxy && proxyLabel(proxy);
  $('#netUsing').textContent = p ? tpl(S.net.using, { proxy: p }) : S.net.direct;
  const lines = new Map(); // text -> ok; a dead proxy is one line, not one per service
  for (const [id, code] of Object.entries(results)) {
    const key = code !== 'ok' && p && (code === 'timeout' || code === 'network') ? 'viaProxy' : code;
    lines.set(tpl(S.net[key] ?? S.net.network, { name: S.net.names[id], proxy: p }), code === 'ok');
  }
  $('#netResults').replaceChildren(...[...lines].map(([text, ok]) => el('li', { className: ok ? 'ok' : 'bad', textContent: text })));
}

// A .file row's Upload, Paste a link and Remove. A link: Jarchi downloads the file once and keeps it like an upload
// (the x-link header; the same 10 MB limit and shrinking, core/media.js). A file over 10 MB isn't even sent.
const MAX_FILE = 10 * 1024 * 1024;
function wireFile(row, upload, remove) {
  const input = $('input[type=file]', row), up = $('.upload', row);
  up.onclick = () => input.click();
  input.onchange = () => {
    const f = input.files[0];
    input.value = '';
    if (!f) return;
    if (f.size > MAX_FILE) return toast(S.errors.too_large, true);
    send('POST', upload(), f, { 'content-type': f.type || 'application/octet-stream', 'x-filename': encodeURIComponent(f.name) });
  };
  $('.remove', row).onclick = () => send('DELETE', remove());
  // Paste a link: a field under the buttons. "giphy.com/…" without https:// is fine too.
  const field = el('input', { type: 'text', inputMode: 'url', dir: 'ltr', placeholder: 'https://', spellcheck: false });
  field.setAttribute('aria-label', S.panel.pasteLink);
  const form = el('form', { className: 'link-row', hidden: true }, field,
    el('button', { className: 'primary', textContent: S.panel.linkAdd }),
    el('button', { type: 'button', className: 'ghost', textContent: S.panel.twCancel, onclick: () => (form.hidden = true) }));
  form.onsubmit = (e) => {
    e.preventDefault();
    const text = field.value.trim();
    let link;
    try { link = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`).href; } catch { return toast(S.errors.bad_link, true); }
    form.hidden = true;
    field.value = '';
    toast(S.panel.linkLoading);
    send('POST', upload(), null, { 'x-link': link });
  };
  up.after(el('button', { className: up.className.replace('upload', 'link'), textContent: S.panel.pasteLink, onclick: () => {
    form.hidden = !form.hidden;
    if (!form.hidden) field.focus();
  } }));
  up.parentElement.append(form);
}

// ---------- Help ("?") and Guide text ----------
// `code` stays left to right (links, {user}), **bold** names a button; {alertsUrl}-style names become this PC's links.
const LINKS = {
  panelUrl: location.origin, alertsUrl: `${location.origin}/widgets/alerts`, chatUrl: `${location.origin}/widgets/chat`,
  goalSubsUrl: `${location.origin}/widgets/goal/subs`, goalKicksUrl: `${location.origin}/widgets/goal/kicks`,
};
const rich = (s) => tpl(s, LINKS).replace(/ × /g, '\u00a0×\u00a0').split('`').flatMap((part, i) => (i % 2 // "420 × 600" stays on one line
  ? [el('code', { dir: 'ltr', textContent: part })]
  : part.split('**').map((t, j) => (j % 2 ? el('b', { textContent: t }) : t))));
const helpText = (key) => key.split('.').reduce((o, k) => o?.[k], S.help);

// A "?" after a setting's label (data-help="alert.volume" -> S.help.alert.volume). Its text is the "?"'s
// description for screen readers, and one shared tooltip shows it while the mouse is on the "?", on keyboard focus or a tap.
// The "?" is a <span role="button">, not a <button>: a <label> belongs to its first <button> or <input>, so a <button>
// "?" would take the row's clicks (and focus) away from the row's own switch or field.
let helpCount = 0;
function addHelp(host) {
  const text = helpText(host.dataset.help);
  if (!text) return;
  const desc = el('span', { id: `help-${++helpCount}`, hidden: true, textContent: tpl(text, LINKS).replace(/`|\*\*/g, '') });
  const q = el('span', { className: 'help', tabIndex: 0, textContent: S.panel.helpMark }, desc);
  q.dataset.tip = text;
  q.setAttribute('role', 'button');
  q.setAttribute('aria-label', S.panel.help);
  q.setAttribute('aria-describedby', desc.id);
  host.append(q);
}
// To the side of the "?" (left in English, right in Persian), on the other side if there's no room, inside the window.
function showTip(q) {
  const tip = $('#tip'), gap = 8;
  tip.replaceChildren(...rich(q.dataset.tip));
  Object.assign(tip.style, { left: '0px', top: '0px' }); // measured at full width, not squeezed by where it was last
  tip.hidden = false;
  const r = q.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
  const left = r.left - gap - w, right = r.right + gap;
  const fitsLeft = left >= gap, fitsRight = right + w <= innerWidth - gap;
  const x = FA ? (fitsRight || !fitsLeft ? right : left) : (fitsLeft || !fitsRight ? left : right);
  Object.assign(tip.style, {
    left: `${Math.min(Math.max(gap, x), innerWidth - w - gap)}px`,
    top: `${Math.min(Math.max(gap, r.top + r.height / 2 - h / 2), innerHeight - h - gap)}px`,
  });
}
const hideTip = () => ($('#tip').hidden = true);
function wireHelp() {
  const helpOf = (e) => e.target.closest?.('.help');
  addEventListener('mouseover', (e) => helpOf(e) && showTip(helpOf(e)));
  addEventListener('mouseout', (e) => { if (helpOf(e) && !helpOf(e).contains(e.relatedTarget)) hideTip(); }); // left the "?"
  addEventListener('focusin', (e) => helpOf(e) && showTip(helpOf(e)));
  addEventListener('focusout', (e) => helpOf(e) && hideTip());
  addEventListener('click', (e) => {
    if (!helpOf(e)) return hideTip(); // a tap anywhere else closes it
    e.preventDefault(); // inside a <label>: don't flip its switch
    showTip(helpOf(e));
  });
  addEventListener('scroll', hideTip, true);
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideTip();
    if (helpOf(e) && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); showTip(helpOf(e)); } // a role="button": Space doesn't scroll
  });
}

// Guide page: the topic list, then the topic: intro, numbered step cards, a tip, and questions that open their answers.
function renderGuide() {
  $$('#guideTopics button').forEach((b) => b.setAttribute('aria-current', String(b.dataset.topic === topic)));
  const t = S.guide.topics[topic];
  $('#guideBody').replaceChildren(
    el('h2', { textContent: t.title }),
    el('p', { className: 'guide-intro' }, ...rich(t.intro)),
    t.steps.length ? el('ol', { className: 'steps' }, ...t.steps.map(([title, text], i) => el('li', { className: 'step' },
      el('span', { className: 'step-n', textContent: fd(i + 1) }),
      el('div', {}, el('b', { textContent: title }), el('p', {}, ...rich(text)))))) : '',
    t.tip ? el('aside', { className: 'tip' }, el('b', { textContent: S.guide.tip }), el('p', {}, ...rich(t.tip))) : '',
    ...(t.faq ?? []).map(({ q, a }) => el('details', { className: 'faq' },
      el('summary', { textContent: q }), el('ul', {}, ...a.map((line) => el('li', {}, ...rich(line)))))),
  );
}

// The panel's language (top bar, Appearance, the welcome tour): the page reloads in it and comes back to what was open.
function setLang(lang) {
  if (lang === S.lang) return;
  remember.set('jarchi.lang', lang);
  try { sessionStorage.setItem('jarchi.back', JSON.stringify([view, { alert: cur, goal: curGoal, guide: topic }[view]])); } catch {}
  location.reload();
}

// ---------- Privacy Policy ----------
// i18n/privacy.json, in English and Persian, with its version. The tour's Hello doesn't go on (or close) before it's
// accepted; one newer than the version accepted (settings.privacyAccepted) opens by itself to Accept, as "Privacy
// Policy updated" ("Privacy Policy" for someone who never accepted one). The popup switches between the two languages.
const mustAccept = () => settings.privacyAccepted < privacy.version;
const acceptPrivacy = () => api('PATCH', '/api/settings', { privacyAccepted: privacy.version }).then((s) => (settings = s), () => {});
// A language's strings: the panel's, English (always loaded) or Persian (fetched once, for an English panel).
const stringsOf = async (lang) => (lang === S.lang ? S : lang === 'en' ? EN : (faStrings ??= await (await fetch('/i18n/fa.json')).json()));
const POINT_ICON = { // privacy.json's icons, one per point
  collect: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  never: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>',
  why: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"/></svg>',
  where: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 19a5 5 0 0 1-.6-10A6.5 6.5 0 0 1 18.8 10.5 4.25 4.25 0 0 1 17.5 19z"/></svg>',
  choice: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/></svg>',
};
async function showPrivacy(lang = S.lang, accept = false) {
  const d = $('#privacy');
  d.classList.toggle('accept', accept);
  $('#privacyAgree').hidden = !accept;
  $('#privacyCheck').checked = false;
  $('#privacyOk').disabled = accept; // until it's ticked
  $('#privacyOk').onclick = () => (accept && acceptPrivacy(), d.close());
  await renderPrivacy(lang);
  d.showModal();
}
async function renderPrivacy(lang) {
  const d = $('#privacy'), p = privacy[lang], P = (await stringsOf(lang)).panel, accept = d.classList.contains('accept');
  Object.assign(d, { lang, dir: lang === 'fa' ? 'rtl' : 'ltr' });
  $$('input[name=privacyLang]', d).forEach((r) => (r.checked = r.value === lang));
  $('#privacyTitle').textContent = !accept ? p.title : settings.privacyAccepted ? P.privacyUpdated : P.privacyPolicy;
  $('#privacyVersion').textContent = tpl(P.version, { version: fd(privacy.version, lang === 'fa') });
  $('#privacyText').replaceChildren(el('p', { textContent: p.intro }), el('ul', { className: 'privacy-points' }, ...p.items.map(([what, text], i) =>
    el('li', { className: `pt-${privacy.icons[i]}` }, svgIn('pt-icon', POINT_ICON[privacy.icons[i]]), el('span', { className: 'stack' }, el('b', { textContent: what }), el('span', { textContent: text }))))));
  $('#privacyAgree span').textContent = tpl(P.privacyAgree, { policy: P.privacyPolicy });
  $('#privacyOk').textContent = accept ? P.privacyAccept : P.updateClose;
}
// Escape doesn't close what waits for the policy to be accepted: the Accept popup, or the tour's Hello (the policy
// opened from it still closes). On keydown, not cancel: a dialog that opened by itself, before any click, can't stop
// its cancel event.
addEventListener('keydown', (e) => {
  const p = $('#privacy'), held = p.open ? p.classList.contains('accept') : $('#tour').open && TOUR[tourStep] === 'hello' && mustAccept();
  if (e.key === 'Escape' && held) e.preventDefault();
});

// ---------- Support ----------
// My tickets on Jarchi's relay (/api/support, core/support.js), once the Privacy Policy is accepted: the list (again
// every 5 minutes and when the page opens; an admin reply not opened yet puts a dot on Support in the sidebar), the New
// ticket form, or one ticket as a chat with its reply box (none while it's closed). Screenshots are made small here
// before they go (shrinkShot).
const support = { tickets: [], error: '', mode: 'list', open: null }; // mode: list | new | ticket; open: the ticket shown, with its messages
let formShots, replyShots; // the screenshots picked for a new ticket / a reply (wireShots)
const SHOTS = 3, SHOT_PX = 1920, SHOT_BYTES = 2 * 1024 * 1024, SHOT_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const shotUrl = (id, name) => `/api/support/tickets/${id}/images/${name}`;
const statusPill = (s) => el('span', { className: `pill tk-${s}`, textContent: S.panel.ticketStatus[s] });

function loadTickets() {
  if (mustAccept()) return renderSupport();
  api('GET', '/api/support/tickets').then((list) => {
    support.tickets = list;
    support.error = '';
    // A reply to the ticket open on the page right now: shown at once.
    if (view === 'support' && support.mode === 'ticket' && list.some((t) => t.unread && t.id === support.open.id)) openTicket(support.open.id);
  }, (err) => (support.error = err.message)).finally(renderSupport);
}

function renderSupport() {
  const ok = !mustAccept();
  $('#supportPrivacy').hidden = ok;
  for (const [sel, mode] of [['#ticketsBox', 'list'], ['#ticketForm', 'new'], ['#ticketView', 'ticket']]) $(sel).hidden = !ok || support.mode !== mode;
  $('#ticketList').replaceChildren(...support.tickets.map((t) => el('li', {}, el('button', { className: 'ticket-row', onclick: () => openTicket(t.id) },
    el('span', { className: 'stack' }, el('b', { textContent: t.subject, dir: 'auto' }), el('small', { textContent: `${S.panel.ticketCats[t.category]} · ${dateTime(Date.parse(t.updatedAt))}` })),
    t.unread ? el('span', { className: 'pill unread', textContent: S.panel.ticketUnread }) : '', statusPill(t.status)))));
  $('#ticketsEmpty').hidden = support.tickets.length > 0 || !!support.error;
  $('#ticketsError').hidden = !support.error;
  $('#ticketsError span').textContent = support.error;
  $('#supportDot').hidden = !ok || !support.tickets.some((t) => t.unread);
}

function showSupport(mode) {
  support.mode = mode;
  renderSupport();
  if (mode === 'ticket') renderThread();
  if (mode === 'new') $('#ticketForm').subject.focus();
}

async function openTicket(id) {
  if (support.open?.id !== id) { // another ticket: not the last one's half-written reply
    $('#replyForm').reset();
    replyShots.clear();
  }
  try {
    support.open = await api('GET', `/api/support/tickets/${id}`); // read now (the relay marks it)
  } catch (err) {
    return toast(err.message, true);
  }
  const t = support.tickets.find((x) => x.id === id);
  if (t) t.unread = false;
  showSupport('ticket');
}

// The open ticket: mine on one side, the admin's on the other, oldest first, scrolled to the newest.
function renderThread() {
  const t = support.open, box = $('#ticketThread'), closed = t.status === 'closed';
  $('#ticketSubject').textContent = t.subject;
  $('#ticketMeta').textContent = [S.panel.ticketCats[t.category], ltr(`#${t.id}`), dateTime(Date.parse(t.createdAt))].join(' · ');
  Object.assign($('#ticketStatus'), { className: `pill tk-${t.status}`, textContent: S.panel.ticketStatus[t.status] });
  box.replaceChildren(...t.messages.map((m) => el('li', { className: `msg ${m.author === 'user' ? 'me' : 'them'}` },
    el('small', { className: 'who', textContent: m.author === 'user' ? S.panel.ticketYou : S.panel.ticketAdmin }),
    m.text ? el('p', { textContent: m.text, dir: 'auto' }) : '',
    m.images.length ? el('span', { className: 'msg-shots' }, ...m.images.map((n) => el('a', { href: shotUrl(t.id, n), target: '_blank', rel: 'noopener' },
      el('img', { src: shotUrl(t.id, n), alt: S.panel.ticketShot })))) : '',
    el('small', { className: 'when', textContent: dateTime(Date.parse(m.at)) }))));
  box.scrollTop = box.scrollHeight;
  $$('#replyForm textarea, #replyForm button').forEach((e) => (e.disabled = closed));
  $('#replyClosed').hidden = !closed;
}

// A screenshot as the relay takes it (a PNG, JPG or WebP of at most SHOT_BYTES): one over SHOT_PX on a side, over
// SHOT_BYTES or of another image type is drawn again at most SHOT_PX on a side, as WebP (a lower quality if still too big).
async function shrinkShot(file) {
  const img = await createImageBitmap(file); // not an image: throws
  const k = Math.min(1, SHOT_PX / Math.max(img.width, img.height));
  if (k === 1 && file.size <= SHOT_BYTES && SHOT_TYPES.includes(file.type)) return file;
  const c = el('canvas', { width: Math.round(img.width * k), height: Math.round(img.height * k) });
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  for (const q of [0.9, 0.75, 0.6]) {
    const blob = await new Promise((done) => c.toBlob(done, 'image/webp', q));
    if (blob?.size <= SHOT_BYTES) return blob;
  }
  throw Object.assign(new Error('too big'), { big: true });
}

// A message's screenshots (the New ticket form's, a reply's) in `box`: up to SHOTS, each with its preview and a remove
// button; also pasted ones (Ctrl+V in `field`). -> { list: [{ blob, url }], clear() }
function wireShots(box, field) {
  const list = [];
  const input = el('input', { type: 'file', accept: SHOT_TYPES.join(','), multiple: true, hidden: true });
  const add = el('button', { type: 'button', className: 'shot-add', textContent: S.panel.ticketAddShot, onclick: () => input.click() });
  const draw = () => box.replaceChildren(...list.map((s, i) => {
    const x = el('button', { type: 'button', className: 'shot-x', title: S.panel.ticketRemoveShot, onclick: () => {
      URL.revokeObjectURL(s.url);
      list.splice(i, 1);
      draw();
    } });
    x.innerHTML = POINT_ICON.never; // ✕
    x.setAttribute('aria-label', S.panel.ticketRemoveShot);
    return el('span', { className: 'shot' }, el('img', { src: s.url, alt: '' }), x);
  }), ...(list.length < SHOTS ? [add] : []), input);
  const take = async (files) => {
    for (const f of files) {
      if (list.length >= SHOTS) {
        toast(S.errors.support_too_many_images, true);
        break;
      }
      try {
        const blob = await shrinkShot(f);
        list.push({ blob, url: URL.createObjectURL(blob) });
      } catch (err) {
        toast(S.errors[err.big ? 'support_image_too_large' : 'support_bad_image'], true);
      }
    }
    draw();
  };
  input.onchange = () => {
    take([...input.files]);
    input.value = '';
  };
  field.addEventListener('paste', (e) => {
    const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    take(files);
  });
  draw();
  return { list, clear: () => (list.splice(0).forEach((s) => URL.revokeObjectURL(s.url)), draw()) };
}

// A form (a new ticket, a reply) and its screenshots -> the ticket as it is now, or nothing (the error toasted).
async function sendForm(url, form, shots) {
  const data = new FormData(form), btn = $('button[type=submit]', form);
  shots.list.forEach((s, i) => data.append('image', s.blob, `screenshot-${i + 1}`));
  btn.disabled = true;
  btn.textContent = S.panel.ticketSending;
  try {
    return await api('POST', url, data);
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = S.panel.ticketSend;
  }
}

function wireSupport() {
  const form = $('#ticketForm'), reply = $('#replyForm');
  $('#ticketCats').append(...Object.entries(S.panel.ticketCats).map(([v, name], i) => el('label', {},
    el('input', { type: 'radio', name: 'category', value: v, defaultChecked: !i }), el('span', { textContent: name }))));
  const catHint = () => ($('#ticketCatHint').textContent = S.panel.ticketCatHints[form.category.value]);
  $('#ticketCats').onchange = catHint;
  catHint();
  formShots = wireShots($('#ticketShots'), form.message);
  replyShots = wireShots($('#replyShots'), reply.message);
  $('#ticketNew').onclick = () => showSupport('new');
  $$('.ticket-back').forEach((b) => (b.onclick = () => showSupport('list'))); // a half-written ticket stays for later
  $('#ticketsRetry').onclick = loadTickets;
  $('#supportPrivacyOpen').onclick = () => showPrivacy(S.lang, true);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const t = await sendForm('/api/support/tickets', form, formShots);
    if (!t) return;
    form.reset();
    formShots.clear();
    catHint();
    support.open = t;
    showSupport('ticket');
    loadTickets();
  };
  reply.onsubmit = async (e) => {
    e.preventDefault();
    if (!reply.message.value.trim() && !replyShots.list.length) return reply.message.focus();
    const t = await sendForm(`/api/support/tickets/${support.open.id}/messages`, reply, replyShots);
    if (!t) return;
    reply.reset();
    replyShots.clear();
    support.open = t;
    renderThread();
    loadTickets();
  };
  loadTickets();
  setInterval(loadTickets, 5 * 60 * 1000);
}

// ---------- Welcome tour ----------
// Opens by itself on the first run (then settings.welcomed is saved), and from the Guide. Hello speaks both languages
// and picks the panel's: another one reloads the panel in it, back at Connect. Connect shows the Connections page's own
// Kick and Twitch cards (moved in while it's shown), so their states, Twitch's code and Open buttons all work here too.
// Sidebar isn't in the dialog: the sidebar itself, one group of pages at a time (spotTo). Escape or Skip ends it all,
// but Hello waits for the Privacy Policy.
const TOUR = ['hello', 'connect', 'obs', 'sidebar', 'done'];
const SIDEBAR = TOUR.indexOf('sidebar');
// Sidebar's stops, the sidebar's own groups: [the group's name, its pages, first to last]. Main (the pages on top) and
// More (under the line) have no title in the sidebar.
const SPOTS = [['navMain', ['home', 'alert', 'chat', 'goal']], ['navLive', ['queue', 'events']], ['navBot', ['bot']], ['navDonations', ['donations']],
  ['navSetup', ['connections', 'appearance', 'settings', 'guide']], ['navMore', ['about', 'support']]];
const obsSize = (id) => (id === 'alerts' ? [800, 600] : id === 'chat' ? [settings.chat.width, settings.chat.height] : settings.goals[id].style === 'circle' ? [400, 400] : [800, 200]);
const connCards = () => [$('#kcConnect'), $('#twConnect')].map((b) => b.closest('.box'));
let tourStep = 0, spot = 0, faStrings;

// A step (and in Sidebar, which stop): the dialog for the others, the sidebar's spotlight for Sidebar.
async function tourTo(n, stop = 0) {
  if (!n) faStrings = await stringsOf('fa'); // Hello's Persian half
  tourStep = n;
  const d = $('#tour');
  (n === SIDEBAR ? d : $('#spot')).close();
  if (n === SIDEBAR) return spotTo(stop);
  renderTour();
  if (!d.open) d.showModal();
  ($('#tourNav').hidden ? $('.tour-langs button:enabled, .tour-agree input') : $('#tourNext')).focus(); // the step's way on
}
function openTour(step = 0) {
  if (!settings.welcomed) api('PATCH', '/api/settings', { welcomed: true }).then((s) => (settings = s), () => {});
  return tourTo(step);
}

// The sidebar's elements in the stop's group: its pages, the titles among them and the group's own title above them.
function spotGroup() {
  const kids = [...$('.nav').children], at = (v) => kids.indexOf($(`.nav-item[data-view="${v}"]`)), views = SPOTS[spot][1];
  const a = at(views[0]);
  return kids.slice(kids[a - 1]?.matches('.group-title') ? a - 1 : a, at(views.at(-1)) + 1);
}
function spotTo(i) {
  const s = $('#spot'), W = S.panel.welcome, [name, views] = SPOTS[i];
  spot = i;
  $('#spotTitle').textContent = S.panel[name];
  $('#spotCount').textContent = fd(`${i + 1}/${SPOTS.length}`);
  $('#spotCount').ariaLabel = tpl(W.stepOf, { n: fd(i + 1), total: fd(SPOTS.length) });
  $('#spotItems').replaceChildren(...views.map((v) => el('li', {},
    el('b', { textContent: $(`.nav-item[data-view="${v}"] [data-i18n]`).textContent }), el('span', { textContent: W.pages[v] }))));
  const group = spotGroup();
  group.at(-1).scrollIntoView({ block: 'nearest' }); // a sidebar taller than the window (large text) scrolls to it
  group[0].scrollIntoView({ block: 'nearest' });
  const first = !s.open;
  s.classList.toggle('still', first); // the first stop shows at once, no glide in from the corner
  if (first) s.showModal();
  placeSpot();
  void s.offsetWidth; // (that's where the next glide starts)
  s.classList.remove('still');
  $('#spotNext').focus();
}
// The bright hole around the group, and the popover beside it: right of it, left in Persian, under it where there's no
// room beside it (the narrow layout's sidebar on top). Always inside the window.
// ponytail: the narrow layout's wrapped rows make the hole the group's whole bounding box, other pages included.
function placeSpot() {
  const rs = spotGroup().map((k) => k.getBoundingClientRect()).filter((r) => r.width), pad = 6, gap = 14, m = 8;
  const left = Math.min(...rs.map((r) => r.left)) - pad, right = Math.max(...rs.map((r) => r.right)) + pad;
  const top = Math.min(...rs.map((r) => r.top)) - pad, bottom = Math.max(...rs.map((r) => r.bottom)) + pad;
  Object.assign($('.spot-hole').style, { left: px(left), top: px(top), width: px(right - left), height: px(bottom - top) });
  const pop = $('.spot-pop'), w = pop.offsetWidth, h = pop.offsetHeight;
  let x = FA ? left - gap - w : right + gap, y = top;
  if (x < m || x + w > innerWidth - m) [x, y] = [FA ? right - w : left, bottom + gap];
  Object.assign(pop.style, { left: px(Math.min(Math.max(m, x), innerWidth - w - m)), top: px(Math.min(Math.max(m, y), innerHeight - h - m)) });
}

function renderTour() {
  const W = S.panel.welcome, step = TOUR[tourStep], body = $('#tourBody'), h2 = (text) => el('h2', { textContent: text });
  $('main .connections').append(...connCards()); // home again (Connect takes them back)
  $('#tourDots').replaceChildren(...TOUR.map((s) => el('i', { className: s === step ? 'on' : '' })));
  $('#tourDots').ariaLabel = tpl(W.stepOf, { n: fd(tourStep + 1), total: fd(TOUR.length) });
  $('#tourNav').hidden = step === 'hello'; // its language buttons go on
  $('#tourSkip').hidden = step === 'done';
  $('#tourNext').textContent = step === 'done' ? W.finish : S.panel.next;
  body.className = `tour-body tour-${step}`;
  if (step === 'hello') {
    const say = (s) => el('div', { lang: s.lang, dir: s.dir }, h2(s.panel.welcome.hello), el('p', { textContent: s.panel.welcome.about }));
    const agreed = !mustAccept();
    const langs = [['en', 'English'], ['fa', 'فارسی']].map(([lang, name]) => el('button', { className: 'primary', lang, textContent: name, disabled: !agreed, onclick: async () => {
      if (mustAccept()) await acceptPrivacy(); // saved before a reload into the other language
      if (lang === S.lang) return tourTo(1);
      try { sessionStorage.setItem('jarchi.tour', '1'); } catch {}
      setLang(lang);
    } }));
    // "I have read and accept the Privacy Policy" in both languages, each one's link opening the policy in it.
    const agree = (s) => {
      const [a, b] = s.panel.privacyAgree.split('{policy}');
      return el('span', { lang: s.lang, dir: s.dir }, a, el('button', { className: 'link', textContent: s.panel.privacyPolicy, onclick: () => showPrivacy(s.lang) }), b);
    };
    const box = el('input', { type: 'checkbox', checked: agreed, onchange: () => langs.forEach((b) => (b.disabled = !box.checked)) });
    body.replaceChildren(el('img', { className: 'tour-logo', src: '/assets/brand/jarchi-logo-v2.png', alt: 'Jarchi' }), say(EN), say(faStrings),
      el('div', { className: 'tour-langs' }, ...langs), el('label', { className: 'tour-agree' }, box, el('span', { className: 'stack' }, agree(EN), agree(faStrings))));
  }
  if (step === 'connect') body.replaceChildren(h2(W.connectTitle), ...connCards(), el('p', { className: 'tip', textContent: W.profileNote }));
  if (step === 'obs') {
    body.replaceChildren(h2(W.obsTitle), el('small', { textContent: W.obsHint }),
      el('ul', { className: 'tour-links' }, ...widgetPages().filter(([id]) => widgetOn(id)).map(([id, name, url]) => el('li', {},
        el('span', { className: 'stack' }, el('b', { textContent: name }), el('code', { dir: 'ltr', textContent: url })),
        el('small', { dir: 'ltr', textContent: fd(obsSize(id).join(' × ')) }), copyBtn(name, url)))),
      el('ol', { className: 'steps' }, ...W.obsSteps.map((text, i) => el('li', { className: 'step' },
        el('span', { className: 'step-n', textContent: fd(i + 1) }), el('p', {}, ...rich(text))))));
  }
  if (step === 'done') {
    const test = $('#homeTest').cloneNode(true); // Home's "Send test alert": a random alert to OBS
    test.id = 'tourTest';
    test.onclick = () => $('#homeTest').click();
    body.replaceChildren(svgIn('tour-check', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'),
      h2(W.doneTitle), el('p', { textContent: W.doneHint }), test);
  }
}

function wireTour() {
  const d = $('#tour'), s = $('#spot'), W = S.panel.welcome;
  d.ariaLabel = W.title;
  $$('#tourSkip, #spotSkip').forEach((b) => (b.textContent = W.skip));
  $$('#tourBack, #spotBack').forEach((b) => (b.textContent = W.back));
  $('#spotNext').textContent = S.panel.next;
  $('#tourSkip').onclick = () => d.close();
  $('#tourBack').onclick = () => tourTo(tourStep - 1, SPOTS.length - 1); // from Done: Sidebar's last stop
  $('#tourNext').onclick = () => (tourStep < TOUR.length - 1 ? tourTo(tourStep + 1) : d.close());
  d.onclose = () => $('main .connections').append(...connCards());
  $('#spotSkip').onclick = () => s.close();
  $('#spotBack').onclick = () => (spot ? spotTo(spot - 1) : tourTo(SIDEBAR - 1));
  $('#spotNext').onclick = () => (spot < SPOTS.length - 1 ? spotTo(spot + 1) : tourTo(SIDEBAR + 1));
  const follow = () => s.open && placeSpot(); // the window resized, the page or the sidebar scrolled
  addEventListener('resize', follow);
  addEventListener('scroll', follow, true);
  $('#tourAgain').onclick = () => openTour();
}

// ---------- Build once ----------
function build() {
  document.documentElement.lang = S.lang;
  document.documentElement.dir = S.dir;
  document.title = S.panel.title;

  // Sidebar: the pages.
  $$('.nav-item').forEach((b) => (b.onclick = () => select(b.dataset.view)));

  // Alerts and Goals pages: their list (a goal goes in its platform's group). An alert's row also gets a swatch that
  // render() shows when it has its own theme, and the logo of its platform when it's from one platform only.
  for (const [v, items] of Object.entries(LISTS())) {
    for (const it of items) {
      const sw = el('input', { type: 'checkbox', onchange: () => it.toggle(sw.checked) });
      sw.setAttribute('aria-label', v === 'goal' ? goalName(it.key) : it.label);
      const row = el('li', { className: 'nav-row' },
        el('button', { className: 'nav-btn', onclick: () => select(v, it.key) }, v === 'goal' ? goalIcon(it.key) : typeIcon(it.key), el('span', { className: 'label', textContent: it.label }),
          ...(v === 'alert' ? [el('span', { className: 'swatch own', hidden: true }), platMarks(it.key)] : [])),
        el('label', { className: 'switch' }, sw, el('span')));
      row.dataset.key = it.key;
      if (v === 'goal') {
        row.dataset.goal = it.key; // its colour
        row.append(goalCountRow(it.key));
      }
      $(v === 'goal' ? `#goalList [data-platform=${goalPlatform(it.key)}]` : '#alertList').append(row);
    }
  }

  // Alerts page: the main theme (opens the theme page), with a swatch per theme (render() outlines the current one).
  $('#themeSwatches').append(...Object.entries(S.themes).map(([id, name]) => {
    const sw = el('span', { className: `swatch sw-${id}`, title: name });
    sw.dataset.theme = id;
    return sw;
  }));
  $('#themeRow').onclick = () => select('theme');
  $('#themeBack').onclick = () => select('alert');

  // Home: feed filters, View all (History, with the feed's filter), a test alert of any type, and the OBS links menu
  // (closes on a click elsewhere or Escape). History has the same filters.
  const filterChips = (box, pick) => box.append(...Object.keys(FEED_FILTERS).map((f) => {
    const b = el('button', { textContent: S.panel.feedFilters[f], onclick: () => pick(f) });
    b.dataset.filter = f;
    return b;
  }));
  filterChips($('#feedChips'), (f) => { feedFilter = f; renderHome(); });
  filterChips($('#histChips'), (f) => { hist.filter = f; hist.page = 0; renderHistory(); });
  $('#feedAll').onclick = () => { hist.filter = feedFilter; hist.page = 0; select('events'); };
  $('#homeTest').onclick = () => {
    const types = Object.keys(settings.alerts);
    api('POST', `/api/test/${types[Math.floor(Math.random() * types.length)]}`, { platform: $('#testAs').value }).then(() => toast(S.panel.testSent), (err) => toast(err.message, true));
  };
  $('#obsMenu').append(...widgetPages().map(([, name, url]) => {
    const b = el('button', { onclick: () => copyLink(url) }, el('span', { textContent: name }));
    b.insertAdjacentHTML('beforeend', COPY_ICON);
    return b;
  }));
  wireMenu($('#obsMenuBtn'), $('#obsMenu'));
  $('#widgetsManage').onclick = () => select('goal'); // the Widgets card shows only what's on: switch goals on or off there
  setInterval(() => view === 'home' && loadHome(), 30000); // "2 min ago", uptime, and today's numbers from 0 after midnight

  $('#connWarn').onclick = (e) => select(e.currentTarget.dataset.page);
  setInterval(renderConnWarn, 5000); // over 30 s now, and the time in it
  // Top bar: Kick / Twitch status opens Connections. Language (also on Appearance).
  $$('.plat').forEach((b) => (b.onclick = () => select('connections')));
  $$('.lang button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.lang === S.lang));
    b.onclick = () => setLang(b.dataset.lang);
  });
  $$('[name=lang]').forEach((r) => {
    r.checked = r.value === S.lang;
    r.onchange = () => setLang(r.value);
  });

  // Appearance: a card per color theme, with a mini panel in it, in that theme (applyLook()). Pointing at a card shows
  // the whole panel in its theme; only a click keeps it.
  $('#palettes').append(...PALETTES.map((id) => {
    const mini = el('span', { className: 'mini' }, el('i'), el('i'), el('i'));
    mini.dataset.id = id;
    if (id === 'system') mini.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>'); // a PC: Windows' color
    return el('label', { className: 'mode-card', onmouseenter: () => show(id), onmouseleave: () => show(palette()) },
      el('input', { type: 'radio', name: 'palette', value: id, onchange: () => (setLook('jarchi.palette', id), toast(S.panel.saved)) }),
      el('span', { className: 'mode-body' }, mini, el('span', { textContent: S.panel.palettes[id] }),
        ...(id === 'system' ? [el('small', { textContent: S.panel.systemHint })] : [])));
  }));
  applyLook();

  // Guide: one button per topic.
  $('#guideTopics').append(...Object.entries(S.guide.topics).map(([id, t]) => {
    const b = el('button', { textContent: t.title, onclick: () => {
      topic = id;
      renderGuide();
      const top = $('#guideBody').getBoundingClientRect().top;
      if (top < 60) scrollBy(0, top - 80); // scrolled down a long topic: back to the new topic's start (below the top bar)
    } });
    b.dataset.topic = id;
    return b;
  }));

  // Theme page: a card per theme. Hover (or focus) previews it muted; click selects it and plays it with sound.
  for (const [id, name] of Object.entries(S.themes)) {
    const frame = el('iframe', { src: '/widgets/alerts/?preview=tile', title: name, tabIndex: -1, onload: () => playTile(frame) });
    frame.dataset.theme = id;
    frame.setAttribute('aria-hidden', 'true');
    const tile = el('button', {
      className: 'theme-tile',
      onclick: () => { send('PATCH', '/api/settings', { theme: id }); playTile(frame, false); },
      onmouseenter: () => playTile(frame),
      onfocus: () => playTile(frame),
    },
    el('div', { className: 'preview' }, frame),
    el('div', { className: 'tile-foot' }, el('span', { className: `swatch sw-${id}` }), el('span', { className: 'tile-name', textContent: name }), el('span', { className: 'selected-label', textContent: S.panel.selected })));
    tile.dataset.theme = id;
    $('#themeGrid').append(tile);
  }

  // Goal style picker: a live thumbnail per style; clicking one starts the goal from that style's look.
  for (const [id, name] of Object.entries(S.goalStyles)) {
    const frame = el('iframe', { src: '/widgets/goal/subs?thumb', title: name, tabIndex: -1, onload: drawThumbs });
    frame.dataset.style = id;
    frame.setAttribute('aria-hidden', 'true');
    const tile = el('button', { className: 'style-tile goal-tile', onclick: () => patchGoal(curGoal, { style: id }) },
      el('div', { className: 'preview' }, frame), el('span', { className: 'tile-name', textContent: name }));
    tile.dataset.style = id;
    $('#styleGrid').append(tile);
  }
  $$('.preview').forEach((p) => fit.observe(p));

  // Alerts page: the main OBS link (every alert), and the selected alert's own (only that one; core/alerts.js).
  const obsUrl = `${location.origin}/widgets/alerts`;
  $('#obsUrl').value = obsUrl;
  $('#copy').title = $('#copyType').title = S.panel.copyObsHint;
  $('#copy').onclick = () => copyLink(obsUrl);
  $('#copyType').onclick = () => copyLink(`${obsUrl}/${cur}`);

  // Alert editor: every [data-f] input saves its field for the selected alert by itself, one save (and one "Saved") per
  // change: a slider when it's let go, typed text a moment after the last key (for the alert it was typed in) or when
  // the field is left (its change event). A value that's already saved isn't sent again.
  const editor = $('main [data-view=alert]');
  let typing;
  const saveField = (inp, type = cur) => {
    clearTimeout(typing);
    if (valueOf(inp) !== settings.alerts[type][inp.dataset.f]) patchAlert(type, { [inp.dataset.f]: valueOf(inp) });
  };
  $$('[data-f]', editor).forEach((inp) => inp.addEventListener('change', () => saveField(inp)));
  $$('input[type=text][data-f]', editor).forEach((inp) => inp.addEventListener('input', () => {
    const type = cur;
    clearTimeout(typing);
    typing = setTimeout(() => saveField(inp, type), 700);
  }));
  wireTabs(editor, 'jarchi.alertTab'); // Media, Sound, Text, Style
  wireBg($('#previewBox'), 'previewBg', 'jarchi.previewBg');
  $$('input[type=range][data-f]', editor).forEach((inp) => inp.addEventListener('input', () => showRange(inp)));
  // Name and message colors: Theme (null) or Custom, which starts from the color input's value.
  for (const f of ['nameColor', 'textColor']) {
    $$(`[name=${f}Mode]`).forEach((r) => (r.onchange = () => patchAlert(cur, { [f]: r.value === 'custom' ? $(`[data-f=${f}]`, editor).value : null })));
  }
  $('#resetText').onclick = () => send('POST', `/api/alerts/${cur}/reset-text`);
  // Alert size (Style tab): this alert's size, given to every alert in one save.
  $('#sizeAll').onclick = () => send('PATCH', '/api/settings', { alerts: Object.fromEntries(Object.keys(settings.alerts).map((t) => [t, { size: settings.alerts[cur].size }])) });
  // Font size: Auto (the biggest that fits) or Custom (the slider).
  $$('[name=alertSizeMode]').forEach((r) => (r.onchange = () => patchAlert(cur, { autoSize: r.value === 'auto' })));
  // Per-alert theme: "" = same as the main theme.
  $('#alertTheme').append(new Option('', ''), ...Object.entries(S.themes).map(([id, name]) => new Option(name, id)));
  $('#alertTheme').onchange = (e) => patchAlert(cur, { theme: e.target.value || null });
  $$('.file', editor).forEach((row) => wireFile(row, () => `/api/upload/${cur}/${row.dataset.kind}`, () => `/api/upload/${cur}/${row.dataset.kind}`));
  $('#play').onclick = () => preview();
  $('#previewAmount').onchange = () => preview();
  $('#test').onclick = () => api('POST', `/api/test/${cur}`, { platform: $('#testAs').value, amount: previewAmount() })
    .then(() => toast(S.panel.testSent), (err) => toast(err.message, true));
  $('#reset').onclick = () => send('POST', `/api/reset/${cur}`);
  $('#preview').onload = () => preview();

  // Goal editor: [data-f] inputs save the selected goal's settings; the count has its own buttons.
  const goalEd = $('main [data-view=goal]');
  $('#goalFont').append(...goalData.fonts.map((f) => new Option(f, f)));
  $$('[data-f]', goalEd).forEach((inp) => inp.addEventListener('change', () => patchGoal(curGoal, { [inp.dataset.f]: valueOf(inp) })));
  $$('input[type=range]', goalEd).forEach((inp) => inp.addEventListener('input', () => showRange(inp)));
  wireFile($('.file', goalEd), () => `/api/goals/${curGoal}/sound`, () => `/api/goals/${curGoal}/sound`);
  $('#goalTest').onclick = () => goalCount({ add: GOAL_STEP[curGoal] });
  $('#goalPlus').onclick = () => goalCount({ add: GOAL_STEP[curGoal] });
  $('#goalMinus').onclick = () => goalCount({ add: -GOAL_STEP[curGoal] });
  $('#goalCurrent').onchange = (e) => goalCount({ set: Math.max(0, Math.round(Number(e.target.value) || 0)) });
  twoClick($('#goalZero'), $('#goalZero'), S.panel.goalZero, S.panel.confirmZero, () => goalCount({ set: 0 }));
  $('#goalResetStyle').onclick = () => send('POST', `/api/goals/${curGoal}/reset-style`);
  $$('[name=goalSizeMode]').forEach((r) => (r.onchange = () => patchGoal(curGoal, { autoSize: r.value === 'auto' }))); // font size: Auto or Custom
  $('#kickSync').onchange = (e) => send('PATCH', '/api/settings', { kickGoalSync: e.target.checked });
  $$('.from-kick', goalEd).forEach((m) => (m.innerHTML = KICK_K)); // Target / Current: Kick's K (tooltip from data-title)
  $('#goalCopy').title = S.panel.goalCopyHint;
  $('#goalCopy').onclick = () => copyLink(`${location.origin}/widgets/goal/${curGoal}`, S.panel.goalCopied);
  // Counts and chat status change on their own (events, connections), so follow them live.
  const socket = io();
  socket.on('goals', (state) => {
    goalData.state = state;
    render();
  });
  socket.on('settings', (s) => { // also changed by the server itself (a connected account fills its chat channel)
    settings = s;
    render();
  });
  socket.on('chatStatus', (st) => {
    chatStatus = st;
    renderStatus();
    if (view === 'home') renderHome();
  });

  // Connections: the Twitch account. Connect shows Twitch's code until the streamer approves it on Twitch. Home's Twitch
  // tab shows the Twitch channel's goals.
  const twitchCall = (method, url, body) => api(method, url, body).then((t) => { twitch = t; render(); return t; }, (err) => toast(err.message, true));
  $('#twConnect').onclick = () => twitchCall('POST', '/api/twitch/connect');
  $('#twDisconnect').onclick = () => twitchCall('POST', '/api/twitch/disconnect');
  $('#twOpen').onclick = () => window.open(twitch.uri, '_blank', 'noopener');
  $('#twitchGoalsConnect').onclick = $('#twitchSyncConnect').onclick = () => select('connections');
  $('#twitchSync').onchange = (e) => send('PATCH', '/api/settings', { twitchGoalSync: e.target.checked });
  showGoalTab = wireTabs($('#goalList'), 'jarchi.goalTab');
  wireTabs($('#homeGoalsBox'), 'jarchi.homeGoalTab');
  socket.on('twitchAccount', (t) => {
    twitch = t;
    render(); // the Connections card, the Goals page's Twitch tab, Home's Twitch tab
  });
  // Connections: the Kick account. Connect opens Kick's login page in a new tab (Open Kick, if the browser blocked it);
  // after the login that tab comes back to Connections, and this one follows by socket.
  const kickCall = (method, url) => api(method, url).then((k) => { kick = k; renderKick(); return k; }, (err) => toast(err.message, true));
  $('#kcConnect').onclick = () => kickCall('POST', '/api/kick/connect').then((k) => k?.uri && window.open(k.uri, '_blank', 'noopener'));
  $('#kcDisconnect').onclick = () => kickCall('POST', '/api/kick/disconnect');
  $('#kcOpen').onclick = () => window.open(kick.uri, '_blank', 'noopener');
  socket.on('kickAccount', (k) => {
    kick = k;
    renderKick();
    renderProfile();
  });
  // Home: new events (also from the test buttons), today's chat count, widget pages opening and closing.
  socket.on('event', (ev) => {
    hist.list.unshift(ev);
    if (!ev.test) home.today.alerts++;
    if (view === 'home') renderHome();
    if (view === 'events') renderHistory();
  });
  socket.on('chat', (m) => { if (!m.test && m.kind !== 'event') $('#statChat').textContent = fmt(++home.today.chat); }); // Kicks / raid lines aren't messages
  socket.on('kickGoals', (list) => {
    home.kickGoals = list;
    if (view === 'home') renderHome();
  });
  socket.on('widgets', (o) => {
    open = o;
    if (view === 'home') renderHome();
  });
  socket.on('alertQueue', (q) => {
    queue = q;
    renderQueue();
  });
  $('#qPause').onclick = () => queueCall('POST', 'pause', { paused: !queue.paused });
  $('#qSkip').onclick = () => queueCall('POST', 'skip');
  twoClick($('#qClear'), $('#qClear span'), S.panel.qClear, S.panel.qConfirmClear, () => queueCall('POST', 'clear').then((q) => q && toast(S.panel.qCleared)));

  // Chat page: the settings in their tabs, and the style gallery (a live thumbnail per style; a click starts the chat
  // from that style's look). Bars get wide, low thumbnails.
  const chatEd = $('main [data-view=chat]');
  for (const [tab, boxes] of Object.entries(CHAT_TABS())) {
    $(`#pane-c-${tab}`).append(...boxes.map(([title, controls]) => el('div', { className: 'box' },
      el('h2', { textContent: S.panel[title] }), ...controls.map(([kind, f, o = {}]) => chatControl(kind, f, o)))));
  }
  wireTabs(chatEd, 'jarchi.chatTab');
  for (const [id, name] of Object.entries(S.chatStyles).filter(([id]) => chatStyles[id])) {
    const frame = el('iframe', { src: '/widgets/chat?thumb', title: name, tabIndex: -1, onload: drawChatThumbs });
    frame.dataset.style = id;
    frame.setAttribute('aria-hidden', 'true');
    const tile = el('button', { className: `style-tile chat-tile${chatStyles[id].layout === 'horizontal' ? ' bar' : ''}`, onclick: () => patchChat({ style: id }) },
      el('div', { className: 'preview' }, frame), el('span', { className: 'tile-name', textContent: name }));
    tile.dataset.style = id;
    $('#chatStyleGrid').append(tile);
    fit.observe(tile.querySelector('.preview'));
  }
  $$('[name=styleGroup]').forEach((r) => (r.onchange = () => showStyleGroup(r.value)));
  $$('[data-f]', chatEd).forEach((inp) => inp.addEventListener('change', () => patchChat({
    [inp.dataset.f]: inp.type === 'number' ? Math.max(0, Math.round(Number(inp.value) || 0)) : valueOf(inp), // amounts: whole numbers
  })));
  $$('input[type=range]', chatEd).forEach((inp) => inp.addEventListener('input', () => showRange(inp)));
  $$('[data-placeholder]').forEach((e) => (e.placeholder = S.panel[e.dataset.placeholder]));
  wireBg($('#chatPreviewBox'), 'chatPreviewBg', 'jarchi.chatPreviewBg');
  $('#chatReplay').onclick = () => $('#chatPreview').contentWindow?.postMessage({ replay: true }, location.origin);
  // Test messages. Effects and special lines that are off still get their message (Kicks and raids: none), just
  // without that look: say which ones. A sub is a special line, or with those off the usual line with its glow.
  const OFF = { first: 'fxFirst', vip: 'fxRainbowVip', mention: 'fxMention', combo: 'fxCombo', avatar: 'avatars', kicks: 'eventKicks', gift: 'eventGifts', bits: 'eventBits', raid: 'eventRaids' };
  const sendTest = (kind) => api('POST', '/api/chat/test', { kind }).then((r) => {
    const c = settings.chat;
    const off = [...r.effects, ...r.events].map((k) => (k === 'sub' ? !c.eventSubs && 'fxSubGlow' : OFF[k])).filter((f) => f && !c[f]);
    $('#chatFxHint').textContent = off.map((f) => S.panel.fxOff[f]).join(' · ');
    toast(S.panel.chatTestSent);
  }, (err) => toast(err.message, true));
  $('#chatTest').onclick = () => sendTest('sample');
  $('#chatBurst').onclick = () => sendTest('burst');
  $('#chatAllFx').onclick = () => sendTest('all');
  wireMenu($('#chatTestMore'), $('#chatTestMenu'));
  $('#chatResetStyle').onclick = () => send('POST', '/api/chat/reset-style');
  $('#chatCopy').title = S.panel.chatCopyHint;
  $('#chatCopy').onclick = () => copyLink(`${location.origin}/widgets/chat`, S.panel.chatCopied);
  new ResizeObserver(() => { if (view === 'chat') fitChat(); }).observe($('.chat-preview'));
  renderStatus();

  // Settings
  $('#showBadge').onchange = (e) => send('PATCH', '/api/settings', { showBadge: e.target.checked });
  for (const [id, name] of Object.entries(S.platforms)) $('#testAs').append(new Option(name, id));
  const patchGlobal = (fields) => send('PATCH', '/api/settings', fields);
  $('#alertGap').onchange = (e) => patchGlobal({ alertGap: Number(e.target.value) });
  $$('[name=proxyMode]').forEach((r) => (r.onchange = () => patchGlobal({ proxyMode: r.value }).then(() => {
    showProxyNow();
    $('#netResults').replaceChildren();
    $('#netUsing').textContent = '';
  })));
  $$('[name=proxyType]').forEach((r) => (r.onchange = () => patchGlobal({ proxyType: r.value })));
  $('#proxyHost').onchange = (e) => patchGlobal({ proxyHost: e.target.value.trim() });
  $('#proxyPort').onchange = (e) => patchGlobal({ proxyPort: Math.round(Number(e.target.value)) || 0 });
  $('#netTest').onclick = async () => {
    const btn = $('#netTest');
    btn.disabled = true;
    $('#netUsing').textContent = S.panel.netTesting;
    $('#netResults').replaceChildren();
    try {
      renderNet(await api('POST', '/api/net/test'));
    } catch (err) {
      $('#netUsing').textContent = '';
      toast(err.message, true);
    }
    btn.disabled = false;
  };
  twoClick($('#resetAll'), $('#resetAll'), S.panel.resetAll, S.panel.confirmResetAll, () => send('POST', '/api/reset'));
  wireProfile();
  wireTour();
  wireUpdate();
  wireUninstall();
  wireSupport();

  $$('[data-i18n]').forEach((e) => (e.textContent = S.panel[e.dataset.i18n]));
  const [madeA, madeB] = S.panel.madeWith.split('{heart}'); // About's "Made with ♥ by MamadPoker", the heart in gold
  $('#madeWith').append(madeA, el('span', { className: 'heart', textContent: '♥' }), madeB, ' ', el('b', { textContent: 'MamadPoker' }));
  $('#aboutPrivacy').onclick = () => showPrivacy();
  $$('input[name=privacyLang]').forEach((r) => (r.onchange = () => renderPrivacy(r.value)));
  $('#privacyCheck').onchange = (e) => ($('#privacyOk').disabled = !e.target.checked);
  $$('[data-title]').forEach((e) => e.setAttribute('aria-label', (e.title = S.panel[e.dataset.title])));
  $$('[data-aria]').forEach((e) => e.setAttribute('aria-label', S.panel[e.dataset.aria]));
  $$('[data-help]').forEach(addHelp); // after data-i18n, which sets the labels' text
  $$('input[type=text]:not([dir]), input[type=number]:not([dir])').forEach((i) => (i.dir = 'ltr')); // links, {user}, names, numbers
  wireHelp();
}

// Range sliders: filled track + value label (labels are per editor: both editors have e.g. "volume"). `f`: the field
// it shows, for a slider that isn't a [data-f] one.
function showRange(inp, f = inp.dataset.f) {
  inp.style.setProperty('--fill', `${((inp.value - inp.min) / (inp.max - inp.min)) * 100}%`);
  const out = $(`[data-out="${f}"]`, inp.closest('.view'));
  if (out) out.textContent = fd(FORMAT[f](inp.value));
}

// Put a config's values into an editor's [data-f] inputs.
function fill(root, cfg) {
  $$('[data-f]', root).forEach((inp) => {
    const val = cfg[inp.dataset.f];
    if (inp.type === 'checkbox') inp.checked = val;
    else if (inp.type === 'radio') inp.checked = inp.value === val;
    else if (inp.type === 'color') inp.value = val ?? '#ffffff';
    else if (inp !== document.activeElement || !['text', 'number'].includes(inp.type)) inp.value = val ?? ''; // never under the cursor
    if (inp.type === 'range') showRange(inp);
  });
}

// ---------- Sync UI from settings ----------
function render() {
  for (const [list, all, selected] of [['#alertList', settings.alerts, cur], ['#goalList', settings.goals, curGoal]]) {
    $$(`${list} .nav-row`).forEach((row) => {
      const cfg = all[row.dataset.key];
      row.classList.toggle('active', row.dataset.key === selected);
      row.classList.toggle('off', !cfg.enabled);
      $('input', row).checked = cfg.enabled;
      const count = $('.count-input', row); // goals: the count (never under the cursor), Kick's / Twitch's when synced
      if (count) {
        const st = goalData.state[row.dataset.key];
        if (count !== document.activeElement) count.value = st.current;
        count.readOnly = st.kick || st.twitch;
        $('.of', row).textContent = `/ ${fmt(st.target)}`;
        $('.zero', row).hidden = st.kick || st.twitch;
      }
      const own = $('.swatch.own', row);
      if (!own) return;
      own.hidden = !cfg.theme;
      own.className = `swatch own sw-${cfg.theme}`;
      own.title = cfg.theme ? tpl(S.panel.themeOf, { name: S.themes[cfg.theme] }) : '';
    });
  }

  $('#themeSwatch').className = `swatch sw-${settings.theme}`;
  $('#themeName').textContent = S.themes[settings.theme];
  $$('#themeSwatches .swatch').forEach((s) => s.classList.toggle('current', s.dataset.theme === settings.theme));
  $$('.theme-tile').forEach((t) => {
    t.classList.toggle('selected', t.dataset.theme === settings.theme);
    t.setAttribute('aria-pressed', String(t.dataset.theme === settings.theme));
  });

  // Goals page: "Sync from Kick" / "Sync from Twitch", and which goals each channel has.
  const setOn = (key) => Object.keys(settings.goals).filter((id) => goalData.state[id][key]).map((id) => S.goals[id].name).join(FA ? '، ' : ', ');
  $('#kickSync').checked = settings.kickGoalSync;
  $('#kickSyncHint').textContent = !settings.chat.kickChannel ? S.panel.kickSyncNoChannel
    : setOn('onKick') ? tpl(S.panel.kickSyncOnKick, { goals: setOn('onKick') }) : S.panel.kickSyncNone;
  $('#twitchSync').checked = settings.twitchGoalSync;
  $('#twitchSyncHint').textContent = twitch.state !== 'connected' ? S.panel.twitchSyncNoAccount
    : setOn('onTwitch') ? tpl(S.panel.twitchSyncOnTwitch, { goals: setOn('onTwitch') }) : S.panel.twitchGoalsNone;
  $('#twitchSyncConnect').hidden = twitch.state !== 'off';
  $('#twitchSyncRow').hidden = twitch.state === 'off'; // not connected: Connect instead of the switch

  renderTwitch();
  renderKick();
  renderProfile();
  artFaces();
  $('#showBadge').checked = settings.showBadge;
  if (view === 'settings') renderSettings();
  if (view === 'alert') renderAlert();
  if (view === 'goal') renderGoal();
  if (view === 'chat') renderChat();
  if (view === 'home') renderHome();
  if (view === 'events') renderHistory();
  renderSupport(); // also the sidebar's dot
}

function renderSettings() {
  const ed = $('main [data-view=settings]');
  const keep = (inp, v) => { if (inp !== document.activeElement) inp.value = v; }; // never under the cursor
  keep($('#alertGap'), settings.alertGap);
  keep($('#proxyHost'), settings.proxyHost);
  keep($('#proxyPort'), settings.proxyPort || '');
  $$('[name=proxyMode]').forEach((r) => (r.checked = r.value === settings.proxyMode));
  $$('[name=proxyType]').forEach((r) => (r.checked = r.value === settings.proxyType));
  const show = { proxySystem: settings.proxyMode === 'system', proxyManual: settings.proxyMode === 'manual' };
  $$('[data-only]', ed).forEach((e) => (e.hidden = !show[e.dataset.only]));
}

function renderChat() {
  const ed = $('main [data-view=chat]');
  const c = settings.chat;
  fill(ed, c);
  $$('.chat-tile').forEach((t) => t.classList.toggle('selected', t.dataset.style === c.style));
  const show = {
    off: !c.enabled, badges: c.showBadges, big: c.bigEmotes, nameCustom: c.nameColorMode === 'custom', bgColor: c.bg === 'color',
    borderOn: c.border, typewriter: c.typewriter, ticker: c.layout === 'horizontal', vertical: c.layout === 'vertical', fade: c.fade, bots: c.hideBots,
    nameOwn: c.nameColorMode === 'user', hat: c.ogHat, evKicks: c.eventKicks, evGifts: c.eventGifts, evBits: c.eventBits,
  };
  $$('[data-only]', ed).forEach((e) => (e.hidden = !show[e.dataset.only]));
  ed.dataset.layout = c.layout; // a bar's preview spans the page (panel.css .chat-page)
  fitChat();
}

function renderAlert() {
  const editor = $('main [data-view=alert]');
  const cfg = settings.alerts[cur];
  editor.dataset.key = cur; // the type's colour
  $('.title path', editor).setAttribute('d', TYPE_ICON[cur]);
  $('.name', editor).textContent = S.types[cur];
  $('#copyType span').textContent = tpl(S.panel.copyAlertLink, { alert: S.types[cur] });
  fill(editor, cfg);
  for (const f of ['nameColor', 'textColor']) $$(`[name=${f}Mode]`).forEach((r) => (r.checked = (r.value === 'custom') === (cfg[f] !== null)));
  $$('[name=alertSizeMode]').forEach((r) => (r.checked = (r.value === 'auto') === cfg.autoSize));
  $('#alertTheme').options[0].textContent = S.panel.sameAsMain.replace('{theme}', S.themes[settings.theme]);
  $('#alertTheme').value = cfg.theme ?? '';
  $('#alertThemeSwatch').className = `swatch sw-${cfg.theme ?? settings.theme}`;

  const show = {
    off: !cfg.enabled,
    minAmount: 'minAmount' in cfg,
    video: isVideo(cfg.image?.file),
    customSound: cfg.soundMode === 'custom',
    customFrame: cfg.frame === 'custom',
    customColor: cfg.textColor !== null,
    customName: cfg.nameColor !== null,
    customSize: !cfg.autoSize,
    amount: samples[cur].amount > 0,
    tiers: 'tiersOn' in cfg,
    tiersOn: cfg.tiersOn,
    look: 'look' in cfg,
    kickLook: kickLook(cur, cfg),
    themed: !kickLook(cur, cfg),
  };
  $$('[data-only]', editor).forEach((e) => (e.hidden = !show[e.dataset.only]));
  if (show.tiers) renderTiers(cfg);
  $('[name=soundMode][value=theme] + span', editor).textContent = S.panel[show.kickLook ? 'soundKick' : 'soundTheme']; // in the Kick look, the default sound is the Kick chime
  $$('.file', editor).forEach((row) => {
    const f = cfg[row.dataset.kind];
    const fname = $('.fname', row);
    fname.textContent = f ? f.name : row.dataset.kind === 'image' ? defaultMedia('image', kickLook(cur, cfg)) : S.panel[kickLook(cur, cfg) ? 'soundNoFileKick' : 'soundNoFile'];
    fname.classList.toggle('default', !f);
    $('.remove', row).hidden = !f;
  });
}

// The Connections page's Twitch card.
function renderTwitch() {
  const t = twitch, on = t.state !== 'off';
  const line = $('#twState');
  line.className = `status st-${!on ? (t.error ? 'error' : 'off') : t.state === 'connected' ? 'connected' : 'connecting'}`;
  line.textContent = [tpl(S.panel.twStates[t.state], { login: t.login }), t.error && S.panel.twErrors[t.error]].filter(Boolean).join(' · ');
  $('#twConnect').hidden = on;
  $('#twDisconnect').hidden = !on;
  $('#twDisconnect').textContent = S.panel[t.state === 'waiting' ? 'twCancel' : 'twDisconnect'];
  $('#twWait').hidden = t.state !== 'waiting';
  $('#twCode').textContent = t.code;
  renderConnWarn();
}

// The Connections page's Kick card.
function renderKick() {
  const k = kick, on = k.state !== 'off';
  const line = $('#kcState');
  line.className = `status st-${!on ? (k.error ? 'error' : 'off') : k.state === 'connected' ? 'connected' : 'connecting'}`;
  line.textContent = [tpl(S.panel.kcStates[k.state], { login: k.login }), k.error && S.panel.kcErrors[k.error]].filter(Boolean).join(' · ');
  $('#kcConnect').hidden = on;
  $('#kcDisconnect').hidden = !on;
  $('#kcDisconnect').textContent = S.panel[k.state === 'waiting' ? 'twCancel' : 'twDisconnect'];
  $('#kcWait').hidden = k.state !== 'waiting';
  renderConnWarn();
}

// ---------- Profile: the sidebar's chip and Edit profile ----------
// Name and picture from where the streamer picked (settings.profile). Kick / Twitch only while that account is connected
// (Connections); otherwise Kick's, else Twitch's, else their own: the name typed (or "Streamer"), the picture uploaded
// (or a plain avatar). `cropped`: a picture cropped in Edit profile, not sent yet.
function profileOf(p, cropped) {
  const acc = { kick, twitch };
  const from = (want, own) => [want, 'kick', 'twitch', own].find((s) => s === own || acc[s]?.login);
  const nameFrom = from(p.nameFrom, 'custom'), pictureFrom = from(p.pictureFrom, 'upload');
  const picture = pictureFrom === 'upload' ? cropped || (p.picture && `/uploads/${p.picture.file}`)
    : acc[pictureFrom].picture && `/remote?u=${encodeURIComponent(acc[pictureFrom].picture)}`;
  const name = nameFrom === 'custom' ? p.name.trim() || S.panel.profileDefault : acc[nameFrom].name || acc[nameFrom].login;
  return { nameFrom, pictureFrom, name, picture: picture || '' };
}
function paintChip(box, pr) {
  $('.profile-name', box).textContent = pr.name;
  const img = $('.avatar img', box);
  img.hidden = !pr.picture; // and when it doesn't load (onerror): the plain avatar
  if (pr.picture && img.getAttribute('src') !== pr.picture) img.src = pr.picture;
}
function renderProfile() {
  paintChip($('#profileChip'), profileOf(settings.profile));
  if ($('#profileDialog').open) renderProfileDialog();
}

// The desktop app's updates (electron/preload.js; nothing in a browser or with `npm run app`): { ready, installed }
// from electron/main.js. ready = a downloaded update { version, notes }: the banner (until its ✕), the sidebar button
// and About's dot. installed = the update Jarchi just came from: What's new, until "Got it".
let update = {}, updateClosed;
const short = (v) => v.replace(/\.0$/, ''); // 1.1.0 -> 1.1
// The notes are build/release-notes.md as written (the release's latest.yml), or GitHub's HTML of the release without
// it: shown as plain text either way, line by line (.notes).
function whatsNew({ version, notes }) {
  $('#whatsNewTitle').textContent = S.panel.whatsNewIn.replace('{version}', short(version));
  $('#whatsNewNotes').textContent = new DOMParser().parseFromString(notes, 'text/html').body.textContent.trim();
  $('#whatsNew').showModal();
}
function renderUpdate() {
  const { ready } = update;
  $('#updateBar').hidden = !ready || updateClosed === ready.version;
  $('#updateSide').hidden = $('#updateDot').hidden = !ready;
  if (ready) {
    $('#updateText').textContent = S.panel.updateReady.replace('{version}', short(ready.version));
    $('#updateSide b').textContent = S.panel.updateTo.replace('{version}', short(ready.version));
  }
  if (update.installed && !$('#whatsNew').open) whatsNew(update.installed);
}
function wireUpdate() {
  const app = window.jarchiApp;
  if (!app) return;
  $('#updateRestart').onclick = $('#updateSide').onclick = () => app.restart();
  $('#updateNotes').onclick = () => whatsNew(update.ready);
  $('#updateClose').onclick = () => {
    updateClosed = update.ready.version;
    renderUpdate();
  };
  $('#whatsNewOk').onclick = () => $('#whatsNew').close();
  $('#whatsNew').onclose = () => {
    if (!update.installed) return;
    update.installed = null;
    app.seen();
  };
  app.onUpdate((s) => {
    update = s;
    renderUpdate();
  });
}

// Settings > Uninstall Jarchi: only in the installed app (electron/main.js says whether its uninstaller is there; not
// with `npm run app`, and a browser has no window.jarchiApp). The uninstaller is told whether to keep the data.
function wireUninstall() {
  const app = window.jarchiApp, d = $('#uninstallDialog');
  if (!app) return;
  app.installed().then((on) => ($('#uninstall').hidden = !on));
  $('#uninstall').onclick = () => {
    $('#uninstallKeep').checked = true;
    $('#uninstallGo').disabled = false;
    d.showModal();
  };
  $('#uninstallCancel').onclick = () => d.close();
  $('#uninstallGo').onclick = (e) => {
    e.currentTarget.disabled = true; // Jarchi quits now
    app.uninstall($('#uninstallKeep').checked);
  };
}

let draft, crop; // Edit profile: the profile being edited, the picture being cropped { img, zoom, x, y, out, url }
function renderProfileDialog() {
  const d = $('#profileDialog'), pr = profileOf(draft, crop?.url), acc = { kick, twitch };
  paintChip($('#profilePreview'), pr);
  let off = false;
  $$('input[type=radio]', d).forEach((r) => {
    r.disabled = r.value in acc && !acc[r.value].login;
    off ||= r.disabled;
    r.checked = r.value === pr[r.name];
  });
  $('#profileHint').hidden = !off;
  $('#profileName').hidden = pr.nameFrom !== 'custom';
  $('#profileUpload').hidden = pr.pictureFrom !== 'upload';
  $('#cropBox').hidden = $('#cropZoom').hidden = $('#cropHint').hidden = !crop;
}

// The picture in the round frame: zoom 1 = it just covers the frame, and it can be dragged anywhere that still covers
// it. What's inside the circle is the picture (round, transparent corners).
function drawCrop() {
  const c = $('#cropCanvas'), n = c.width, { img } = crop;
  const s = (n / Math.min(img.naturalWidth, img.naturalHeight)) * crop.zoom, w = img.naturalWidth * s, h = img.naturalHeight * s;
  crop.x = Math.max((n - w) / 2, Math.min((w - n) / 2, crop.x));
  crop.y = Math.max((n - h) / 2, Math.min((h - n) / 2, crop.y));
  const g = c.getContext('2d');
  g.clearRect(0, 0, n, n);
  g.drawImage(img, (n - w) / 2 + crop.x, (n - h) / 2 + crop.y, w, h);
  const out = el('canvas', { width: n, height: n }), o = out.getContext('2d');
  o.beginPath();
  o.arc(n / 2, n / 2, n / 2, 0, 2 * Math.PI);
  o.clip();
  o.drawImage(c, 0, 0);
  Object.assign(crop, { out, url: out.toDataURL() });
  renderProfileDialog();
}

function wireProfile() {
  const d = $('#profileDialog'), canvas = $('#cropCanvas'), err = $('#profileErr');
  $$('.avatar img').forEach((img) => (img.onerror = () => (img.hidden = true)));
  $('#profileName').placeholder = S.panel.profileDefault;
  $('#profileChip').onclick = () => {
    draft = { ...settings.profile };
    crop = null;
    $('#profileName').value = draft.name;
    err.hidden = true;
    renderProfileDialog();
    d.showModal();
  };
  d.onclose = () => (crop = null);
  $('#profileCancel').onclick = () => d.close();
  $$('input[type=radio]', d).forEach((r) => (r.onchange = () => {
    draft[r.name] = r.value;
    renderProfileDialog();
  }));
  $('#profileName').oninput = (e) => {
    draft.name = e.target.value;
    draft.nameFrom = 'custom'; // shown because nothing is connected: typing picks it
    renderProfileDialog();
  };
  $('#profileChoose').onclick = () => $('#profileFile').click();
  $('#profileFile').onchange = (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      crop = { img, zoom: 1, x: 0, y: 0 };
      draft.pictureFrom = 'upload';
      $('#cropZoom').value = 1;
      err.hidden = true;
      drawCrop();
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      err.textContent = S.errors.bad_type;
      err.hidden = false;
    };
    img.src = URL.createObjectURL(f);
  };
  canvas.onpointerdown = (e) => {
    if (!crop) return;
    canvas.setPointerCapture(e.pointerId);
    const k = canvas.width / canvas.clientWidth, start = { x: e.clientX, y: e.clientY, cx: crop.x, cy: crop.y };
    canvas.onpointermove = (m) => {
      crop.x = start.cx + (m.clientX - start.x) * k;
      crop.y = start.cy + (m.clientY - start.y) * k;
      drawCrop();
    };
  };
  canvas.onpointerup = canvas.onpointercancel = () => (canvas.onpointermove = null);
  $('#cropZoom').oninput = (e) => {
    crop.zoom = Number(e.target.value);
    drawCrop();
  };
  // Save: the new picture first (it's selected then), then where the name and picture come from.
  $('#profileSave').onclick = async (e) => {
    e.currentTarget.disabled = true;
    try {
      if (crop && draft.pictureFrom === 'upload') {
        const png = await new Promise((r) => crop.out.toBlob(r, 'image/png'));
        await api('POST', '/api/profile/picture', png, { 'content-type': 'image/png', 'x-filename': 'profile.png' });
      }
      d.close();
      send('PATCH', '/api/settings', { profile: { nameFrom: draft.nameFrom, name: draft.name.trim(), pictureFrom: draft.pictureFrom } });
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
    $('#profileSave').disabled = false;
  };
}

function renderGoal() {
  const ed = $('main [data-view=goal]');
  const g = settings.goals[curGoal];
  ed.dataset.key = ed.dataset.goal = curGoal;
  $('.title .goal-icon', ed).innerHTML = GOAL_ICON[curGoal]; // fixed markup
  $('.name', ed).textContent = goalName(curGoal);
  $('#goalCounts').textContent = S.goals[curGoal].counts;
  $('#goalTest span').textContent = S.goals[curGoal].test;
  fill(ed, g);
  $$('[name=goalSizeMode]').forEach((r) => (r.checked = (r.value === 'auto') === g.autoSize));
  // Synced from Kick / Twitch: their count and target, read-only (no −, +, Test or Reset to 0).
  const st = goalData.state[curGoal], synced = st.kick || st.twitch, target = $('[data-f=target]', ed);
  if (synced) target.value = st.target;
  target.readOnly = $('#goalCurrent').readOnly = synced;
  $('#goalMinus').disabled = $('#goalPlus').disabled = $('#goalTest').disabled = synced;
  if (document.activeElement !== $('#goalCurrent')) $('#goalCurrent').value = st.current;
  $('#goalPlus').title = fd(`+${GOAL_STEP[curGoal]}`);
  $('#goalMinus').title = fd(`−${GOAL_STEP[curGoal]}`);
  $$('.goal-tile').forEach((t) => t.classList.toggle('selected', t.dataset.style === g.style));
  drawThumbs();

  const show = {
    off: !g.enabled,
    goalBox: g.style !== 'circle',
    bgColor: g.bg === 'color',
    box: g.bg !== 'off',
    borderOn: g.bg !== 'off' && g.border,
    goalCustomSound: g.celebrateSound === 'custom',
    customSize: !g.autoSize,
    fromKick: st.kick,
    fromTwitch: st.twitch,
    manual: !synced,
  };
  $$('[data-only]', ed).forEach((e) => (e.hidden = !show[e.dataset.only]));
  $('.more-grid', ed).classList.toggle('three', show.goalBox); // Circle: two cards, no empty third column
  const fname = $('.file .fname', ed);
  fname.textContent = g.sound ? g.sound.name : S.panel.soundNoFile;
  fname.classList.toggle('default', !g.sound);
  $('.file .remove', ed).hidden = !g.sound;
}

// ---------- Background art (Appearance; jarchi.art, on unless '0') ----------
// Outline icons in the theme's main color and gold, Kick's and Twitch's logos, and the streamer's profile pictures (a
// ring in the platform's color), faint and blurred behind the whole panel (#bgArt; panel.css draws them). Each drifts
// and turns a little, and moves out of the mouse's way. One requestAnimationFrame loop, only while it can be seen.
const ART_ICONS = [
  'M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0zM5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8', // mic
  'M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM16 10.5L22 7v10l-6-3.5', // camera
  'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z', // chat
  HEART, TYPE_ICON.sub, TYPE_ICON.gift_sub, // heart, star, gift
  'M3 11l18-5v12L3 14zM11.6 16.8a3 3 0 1 1-5.8-1.6', // megaphone
  'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z', // music note
];
const ART_RING = { kick: '#53fc18', twitch: '#9146ff' };
const STILL = matchMedia('(prefers-reduced-motion: reduce)');
const rnd = (a, b) => a + Math.random() * (b - a);
let art = [], artPics = [], artChannels, artMouse = null, artFrame = 0, artLast = 0, area;
// Where the items go: beside the sidebar (all the width on a narrow window, where the sidebar is a bar on top), below
// the top bar, a little in from the edges. Nothing behind the sidebar: it would barely show through.
function artArea() {
  const s = $('.side').getBoundingClientRect(), beside = s.bottom >= innerHeight - 1; // down to the bottom (under the app's title bar)
  const x = beside && s.left < innerWidth / 2 ? s.right : 0, w = beside ? innerWidth - s.width : innerWidth;
  area = { x: x + 24, y: 70, w: Math.max(1, w - 48), h: Math.max(1, innerHeight - 94) };
}
// Spots for the pictures and the logos, as shares of the area (mirrored in Persian, like the page), on one 4 x 4
// pattern where they take turns like a checkerboard, so the logos sit about 2 cells apart. Pictures: four on each half,
// near the corners and in the middle; the first in the bottom right, below the Home page's narrow column. Logos (their
// own files and colors): Kick also right and bottom, Twitch also left and top.
const FACE_SPOTS = [[0.9, 0.88], [0.1, 0.12], [0.37, 0.38], [0.63, 0.12], [0.9, 0.38], [0.1, 0.62], [0.37, 0.88], [0.63, 0.62]];
const LOGO_SPOTS = [['kick', [0.9, 0.12]], ['twitch', [0.37, 0.12]], ['kick', [0.9, 0.62]], ['twitch', [0.1, 0.38]],
  ['kick', [0.63, 0.88]], ['twitch', [0.63, 0.38]], ['kick', [0.37, 0.62]], ['twitch', [0.1, 0.88]]];
// pics: [[platform, url]...]. 8 logos, 8 pictures (none without a channel: 8 more icons then, so the page is as full and
// the logos keep their spacing) and outline icons, 34 in all. Spread evenly: rows across the area, the items shared out
// between them with no gaps (so corners and edges get some too), each somewhere in the middle of its cell. The logos,
// then the pictures, take the cells nearest their spots (a logo never within 1.4 cells of another); the icons the rest.
function buildArt(pics) {
  artPics = pics;
  const faces = pics.length ? Array.from({ length: 8 }, (_, k) => pics[k % pics.length]) : [];
  const icons = Array.from({ length: 26 - faces.length }, (_, i) => ART_ICONS[i % ART_ICONS.length]);
  const n = LOGO_SPOTS.length + faces.length + icons.length, rows = Math.max(1, Math.round(Math.sqrt((n * area.h) / area.w)));
  const cells = [];
  for (let r = 0; r < rows; r++) {
    const c = Math.floor(n / rows) + (r < n % rows ? 1 : 0);
    for (let i = 0; i < c; i++) cells.push([(i + rnd(0.3, 0.7)) / c, (r + rnd(0.3, 0.7)) / rows]);
  }
  const dist = ([u, v], [su, sv]) => Math.hypot((u - su) * area.w, (v - sv) * area.h);
  const apart = 1.4 * Math.sqrt((area.w * area.h) / n); // 1.4 cells
  const take = ([su, sv], away = []) => {
    const spot = [FA ? 1 - su : su, sv];
    const ok = cells.filter((c) => away.every((a) => dist(c, a) >= apart));
    const best = (ok.length ? ok : cells).reduce((b, c) => (dist(c, spot) < dist(b, spot) ? c : b));
    return cells.splice(cells.indexOf(best), 1)[0];
  };
  const logoCells = [];
  for (const [, spot] of LOGO_SPOTS) logoCells.push(take(spot, logoCells));
  const faceCells = faces.map((_, k) => take(FACE_SPOTS[k]));
  cells.sort(() => Math.random() - 0.5);
  const item = (e, [u, v], size, depth, filled) => {
    // depth 0..1: the bigger, the more blurred and the fainter. Filled shapes (logos, pictures) stay fainter than
    // outlines, so text over them still reads.
    const opacity = filled ? 0.2 - 0.05 * depth : 0.3 - 0.15 * depth;
    Object.assign(e.style, { width: px(size), height: px(size), opacity: opacity.toFixed(2), filter: `blur(${(1.2 + 1.8 * depth).toFixed(1)}px)` });
    return {
      e, size, u, v, ox: 0, oy: 0, rot: rnd(-15, 15), // u, v: the spot, as shares of the area
      ph: [rnd(0, 7), rnd(0, 7), rnd(0, 7)], sp: [rnd(1.2, 2.5) / 1e4, rnd(1.2, 2.5) / 1e4, rnd(1.2, 2.5) / 1e4], // slow: 25-50 s a swing
    };
  };
  art = [
    ...faces.map(([platform, url], k) => {
      const big = (k >> 1) % 2; // 36 and 54 px, half each
      const e = el('img', { className: 'pic', src: `/remote?u=${encodeURIComponent(url)}`, alt: '', onerror: () => (e.hidden = true) });
      e.style.borderColor = ART_RING[platform];
      return item(e, faceCells[k], big ? 54 : 36, big, true);
    }),
    ...LOGO_SPOTS.map(([logo], k) => {
      const size = rnd(44, 110);
      return item(el('img', { src: `/assets/platform-logos/${logo}.svg`, alt: '' }), logoCells[k], size, (size - 44) / 66, true);
    }),
    ...icons.map((icon, i) => {
      const size = rnd(44, 110), depth = (size - 44) / 66;
      const e = el('span', { className: (i + Math.floor(i / ART_ICONS.length)) % 2 ? 'gold' : 'main' }); // each kind once in each color
      e.innerHTML = `<svg viewBox="0 0 24 24"><path d="${icon}"/></svg>`; // fixed paths
      return item(e, cells[i], size, depth, false);
    }),
  ];
  $('#bgArt').replaceChildren(...art.map((a) => a.e));
  drawArt(performance.now());
}
// dt: ms since the last frame, so the items move out of the mouse's way equally fast at any frame rate (0: just redrawn).
function drawArt(t, dt = 0) {
  const ease = 1 - 0.94 ** (dt / 16.7);
  for (const a of art) {
    const x = area.x + a.u * area.w + 14 * Math.sin(t * a.sp[0] + a.ph[0]), y = area.y + a.v * area.h + 14 * Math.sin(t * a.sp[1] + a.ph[1]);
    let tx = 0, ty = 0; // out of the mouse's way: 70 px when it's right on top, less and less up to 170 px away
    if (artMouse) {
      const dx = x - artMouse.x, dy = y - artMouse.y, d = Math.hypot(dx, dy) || 1;
      if (d < 170) [tx, ty] = [(dx / d) * 70 * (1 - d / 170), (dy / d) * 70 * (1 - d / 170)];
    }
    a.ox += (tx - a.ox) * ease; // eases there, and back when the mouse goes
    a.oy += (ty - a.oy) * ease;
    a.e.style.transform = `translate(${(x + a.ox - a.size / 2).toFixed(1)}px, ${(y + a.oy - a.size / 2).toFixed(1)}px) rotate(${(a.rot + 8 * Math.sin(t * a.sp[2] + a.ph[2])).toFixed(1)}deg)`;
  }
}
// Drawn at most every 13 ms: every frame on a 60 Hz screen, every other one at 144 Hz, every 4th at 240 Hz. The art
// moves a few pixels a second, and each frame also re-blurs the see-through cards over it on the GPU.
function artLoop(t) {
  artFrame = requestAnimationFrame(artLoop);
  if (t - artLast < 13) return;
  drawArt(t, Math.min(t - artLast, 100));
  artLast = t;
}
// Moves only while the art is on, the tab (or the app's window) is shown and neither Reduce animations nor the system
// asks for less motion. Hidden, minimized or in the tray: no frames at all.
function artRun() {
  cancelAnimationFrame(artFrame);
  const de = document.documentElement;
  if (de.hasAttribute('data-art') && !de.hasAttribute('data-still') && !document.hidden && !STILL.matches) artFrame = requestAnimationFrame(artLoop);
}
// The streamer's pictures: looked up again when a channel changes (Chat page); Kick's first when both are set.
function artFaces() {
  const channels = `${settings.chat.kickChannel}/${settings.chat.twitchChannel}`;
  if (channels === artChannels) return;
  artChannels = channels;
  api('GET', '/api/streamer').then((r) => {
    const pics = Object.entries(r).filter(([, url]) => url);
    if (JSON.stringify(pics) !== JSON.stringify(artPics)) buildArt(pics);
  }, () => {});
}
addEventListener('pointermove', (e) => (artMouse = { x: e.clientX, y: e.clientY }), { passive: true });
document.documentElement.addEventListener('pointerleave', () => (artMouse = null));
const relayout = () => (artArea(), drawArt(performance.now())); // the window, or the sidebar (text size), changed size
addEventListener('resize', relayout);
new ResizeObserver(relayout).observe($('.side'));
document.addEventListener('visibilitychange', artRun);
STILL.addEventListener('change', artRun);
artArea();
buildArt([]);
artRun();

(async () => {
  EN = await (await fetch('/i18n/en.json')).json();
  S = FA ? await (await fetch('/i18n/fa.json')).json() : EN;
  try {
    [settings, samples, goalData, { styles: chatStyles, fonts: chatFonts }, chatStatus, home, hist.list, twitch, kick, privacy] = await Promise.all([
      api('GET', '/api/settings'), api('GET', '/api/samples'), api('GET', '/api/goals'), api('GET', '/api/chat/styles'), api('GET', '/api/chat/status'), api('GET', '/api/home'), api('GET', '/api/history'),
      api('GET', '/api/twitch'), api('GET', '/api/kick'), fetch('/i18n/privacy.json').then((r) => r.json()),
    ]);
  } catch (err) {
    return toast(err.message, true);
  }
  build();
  // Back from a language switch: open what was open.
  let back;
  try {
    back = JSON.parse(sessionStorage.getItem('jarchi.back'));
    sessionStorage.removeItem('jarchi.back');
  } catch {}
  const [v, key] = back ?? [location.hash.slice(1)]; // or a page in the address (/#connections: back from Kick's login)
  if (location.hash) history.replaceState(null, '', location.pathname);
  const ok = v === 'alert' ? key in settings.alerts : v === 'goal' ? key in settings.goals : v === 'theme' || $$('.nav-item').some((b) => b.dataset.view === v);
  select(ok ? v : 'home', ok ? key : undefined);
  // The welcome tour: the first run, or back from its language pick (at that step). Else a newer Privacy Policy than
  // the one accepted (also for those who had the tour before there was one).
  let tour;
  try {
    tour = sessionStorage.getItem('jarchi.tour');
    sessionStorage.removeItem('jarchi.tour');
  } catch {}
  if (tour || !settings.welcomed) openTour(Number(tour));
  else if (mustAccept()) showPrivacy(S.lang, true);
})();
