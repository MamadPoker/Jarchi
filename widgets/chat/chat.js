// Chat widget (/widgets/chat): Kick + Twitch chat in one box, transparent page, chat at the top-left.
// Live (OBS): settings, messages and removals arrive over Socket.IO. ?preview: shown even when the chat is off (panel).
// ?thumb: no socket; the panel posts { strings, cfg, messages } to draw a still style thumbnail.
//
// Motion (vertical): the list is pinned to the bottom (or top) of the viewport. A new row grows from 0 to its height,
// which slides the older rows up smoothly; a CSS mask fades them out in a soft zone at the far edge. Rows that leave
// (max messages, hide-after, moderation) fade out first, then their height closes, so nothing ever jumps.
const params = new URLSearchParams(location.search);
const root = document.getElementById('chat');
const viewport = root.querySelector('.viewport');
const list = root.querySelector('.list');
const KEEP = 100; // messages kept in memory
const LINK = /(https?:\/\/|www\.)\S+|\b[\w-]+\.(com|net|org|tv|gg|io|me|ly|be|co|app|xyz|ir)\b/i;
const PALETTE = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#38d9a9', '#4dabf7', '#748ffc', '#da77f2', '#f783ac'];
const BADGE_KEY = { broadcaster: 'badgeBroadcaster', moderator: 'badgeMod', vip: 'badgeVip', subscriber: 'badgeSub', other: 'badgeOther' };
let S, cfg, mainSettings, look = '', f = {};
const recent = []; // known messages, newest last (to rebuild when the look changes)
let rows = []; // on screen: { el, msg, timer, exiting, combo, count, at }
let tickerReady = 0; // ticker: when the next message may start (ms, performance.now())

const h = (tag, props, ...kids) => {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...kids.filter((k) => k !== null && k !== undefined && k !== false));
  return el;
};
const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};
const words = (s) => (s || '').toLowerCase().split(/[,\n]+/).map((w) => w.trim()).filter(Boolean);
const ms = (base) => base / (cfg.animSpeed || 1);
const vertical = () => cfg.layout !== 'horizontal';

// ---------- Inputs ----------
if (params.has('thumb')) {
  document.body.classList.add('thumb');
  addEventListener('message', (e) => {
    if (e.origin !== location.origin || !e.data?.cfg || !Array.isArray(e.data.messages)) return;
    S = e.data.strings;
    cfg = e.data.cfg;
    recent.splice(0, recent.length, ...e.data.messages);
    apply(true);
  });
} else {
  if (params.has('preview')) document.body.classList.add('preview');
  const socket = io();
  socket.on('strings', (s) => (S = s));
  socket.on('settings', (s) => {
    mainSettings = s;
    if (JSON.stringify(s.chat) === look) return;
    look = JSON.stringify(s.chat);
    cfg = s.chat;
    apply();
  });
  socket.on('chatHistory', (msgs) => {
    recent.splice(0, recent.length, ...msgs.slice(-KEEP));
    if (cfg) rebuild();
  });
  socket.on('chat', (m) => {
    recent.push(m);
    if (recent.length > KEEP) recent.shift();
    if (cfg && S && shown(m)) add(m, true);
  });
  socket.on('chatClear', (c) => {
    const hit = (m) => m.platform === c.platform && (c.messageId ? m.id === c.messageId : c.userId ? m.user.id === c.userId : true);
    for (let i = recent.length - 1; i >= 0; i--) if (hit(recent[i])) recent.splice(i, 1);
    for (const r of rows) if (hit(r.msg)) leave(r);
  });
  socket.on('chatAvatar', (a) => {
    for (const m of recent) if (m.platform === a.platform && m.user.login === a.login) m.user.avatar = a.avatar;
    for (const r of rows) if (r.msg.platform === a.platform && r.msg.user.login === a.login) r.el.querySelector('.avatar')?.replaceWith(avatarEl(r.msg));
  });
}

// ---------- Look ----------
function apply(still = false) {
  if (!cfg || !S) return;
  root.hidden = !cfg.enabled && !params.has('preview') && !params.has('thumb');
  const boxed = cfg.bg !== 'off' && !cfg.bubbles;
  root.className = [
    'chat', `style-${cfg.style}`, `layout-${cfg.layout}`, `new-${cfg.newAt}`, `bg-${cfg.bg}`,
    cfg.bubbles && 'bubbles', boxed && 'boxed', cfg.border && 'bordered', cfg.fade && cfg.fadeZone > 0 && 'fade',
    cfg.textShadow && 'shadow', cfg.namePos === 'above' && 'name-above', still && 'still',
  ].filter(Boolean).join(' ');
  const vars = {
    '--w': `${cfg.width}px`, '--h': `${cfg.height}px`, '--font': `"${cfg.font}", "Segoe UI", system-ui, sans-serif`,
    '--fs': `${cfg.fontSize}px`, '--ns': `${cfg.nameSize}px`, '--text': cfg.textColor, '--bg': rgba(cfg.bgColor, cfg.bgOpacity),
    '--bd': cfg.borderColor, '--bw': `${cfg.borderWidth}px`, '--radius': `${cfg.radius}px`, '--pad': `${cfg.padding}px`, '--gap': `${cfg.gap}px`,
    '--emote': `${cfg.emoteSize}px`, '--emote-big': `${cfg.bigEmoteSize}px`, '--fade': `${cfg.fadeZone}px`, '--blur': `${cfg.blur}px`,
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.querySelector('.bar-title').textContent = S.chatText.windowTitle;
  f = {
    bots: new Set(words(cfg.bots)), hidden: new Set(words(cfg.hiddenUsers)), blocked: words(cfg.blockedWords), rainbow: new Set(words(cfg.rainbowUsers)),
    streamer: [mainSettings?.chat?.kickChannel ?? cfg.kickChannel, mainSettings?.chat?.twitchChannel ?? cfg.twitchChannel].filter(Boolean).map((n) => n.toLowerCase()),
  };
  rebuild(still);
}

// Redraw from memory, without animation (look changed, or (re)connected).
function rebuild(still = false) {
  for (const r of rows) clearTimeout(r.timer);
  rows = [];
  tickerReady = 0;
  list.replaceChildren();
  const keep = recent.filter(shown).slice(-cfg.maxMessages);
  for (const m of keep) add(m, false, still);
}

// ---------- Filters ----------
function shown(m) {
  if (cfg.source !== 'both' && m.platform !== cfg.source) return false;
  const login = m.user.login;
  if (cfg.hideBots && f.bots.has(login)) return false;
  if (f.hidden.has(login) || f.hidden.has(m.user.name.toLowerCase())) return false;
  if (m.kind === 'message') {
    const text = m.text.trim();
    if (cfg.hideCommands && text.startsWith('!')) return false;
    if (cfg.hideLinks && LINK.test(text)) return false;
    if (f.blocked.length) {
      const lower = text.toLowerCase();
      const tokens = new Set(lower.split(/[^\p{L}\p{N}_]+/u));
      if (f.blocked.some((w) => (w.includes(' ') ? lower.includes(w) : tokens.has(w)))) return false;
    }
  }
  return true;
}

// ---------- One message ----------
const emoteOn = (p) => ({ twitch: cfg.emotesTwitch, kick: cfg.emotesKick, '7tv': cfg.emotes7tv })[p.provider];
const onlyEmotes = (m) => m.parts.some((p) => p.t === 'emote' && emoteOn(p)) && m.parts.every((p) => (p.t === 'emote' ? emoteOn(p) : !p.v.trim()));
// A message that is just one emote (once or repeated) -> its name, for the combo counter.
function comboKey(m) {
  if (!onlyEmotes(m)) return null;
  const names = new Set(m.parts.filter((p) => p.t === 'emote').map((p) => p.name));
  return names.size === 1 ? [...names][0] : null;
}

function nameColor(m) {
  if (cfg.nameColorMode === 'custom') return cfg.nameColor;
  if (m.user.color) return m.user.color;
  let n = 0;
  for (const c of m.user.login) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[n % PALETTE.length];
}

function avatarEl(m) {
  if (m.user.avatar) return h('img', { className: 'avatar', src: m.user.avatar, alt: '' });
  return h('span', { className: 'avatar letter', textContent: (m.user.name || '?').slice(0, 1).toUpperCase(), style: `background:${nameColor(m)}` });
}

function badgesEl(m) {
  if (!cfg.showBadges) return null;
  const out = m.user.badges.filter((b) => cfg[BADGE_KEY[b.type] ?? 'badgeOther']).map((b) => (b.img
    ? h('img', { className: 'badge', src: b.img, alt: b.title, title: b.title })
    : h('span', { className: `badge-text bt-${b.type}`, textContent: S.chatText.badges[b.name] ?? b.title })));
  return out.length ? h('span', { className: 'badges' }, ...out) : null;
}

function bodyEl(m) {
  const big = cfg.bigEmotes && onlyEmotes(m);
  const body = h('span', { className: `body${big ? ' big' : ''}`, dir: cfg.textDir });
  for (const p of m.parts) {
    if (p.t === 'text') body.append(p.v);
    else if (emoteOn(p)) body.append(h('img', { className: 'emote', src: cfg.emotesAnimated ? p.src : p.still || p.src, alt: p.name, title: p.name }));
    else body.append(p.name);
  }
  return body;
}

function msgEl(m) {
  const vip = m.user.badges.some((b) => b.type === 'vip');
  const rainbow = (cfg.fxRainbowVip && vip) || f.rainbow.has(m.user.login) || f.rainbow.has(m.user.name.toLowerCase());
  const mention = cfg.fxMention && [...f.streamer, ...(m.test ? ['streamer'] : [])].some((s) => new RegExp(`(^|[^\\w])@?${s}\\b`, 'i').test(m.text));
  const glow = m.kind === 'sub' && cfg.fxSubGlow;
  const first = m.first && cfg.fxFirst;
  const tags = [glow && h('span', { className: 'tag tag-sub', textContent: S.chatText.subTag }), first && h('span', { className: 'tag tag-first', textContent: S.chatText.firstTag })].filter(Boolean);
  const time = new Date(m.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const meta = h('span', { className: 'meta' },
    cfg.showTime && h('time', { textContent: time }),
    cfg.showPlatform && h('img', { className: 'platform', src: `/assets/platform-logos/${m.platform}.svg`, alt: m.platform }),
    badgesEl(m),
    h('span', { className: `name${rainbow ? ' rainbow' : ''}`, textContent: m.user.name, style: `color:${nameColor(m)}` }),
    cfg.showColon && m.kind === 'message' && !m.action && h('span', { className: 'colon', textContent: ':' }));
  const hasText = m.parts.some((p) => p.t === 'emote' || p.v.trim());
  const el = h('div', { className: ['msg', m.kind === 'sub' && 'kind-sub', glow && 'glow', first && 'first', mention && 'mention', m.action && 'action'].filter(Boolean).join(' ') },
    tags.length ? h('div', { className: 'tags' }, ...tags) : null,
    m.kind === 'sub' && m.system ? h('div', { className: 'system', dir: cfg.textDir, textContent: m.system }) : null,
    m.kind === 'message' || hasText ? h('div', { className: 'line' }, cfg.avatars && avatarEl(m), meta, bodyEl(m)) : null);
  return el;
}

// ---------- Add / remove ----------
function add(m, animate, still = false) {
  if (cfg.fxCombo && animate && combo(m)) return;
  vertical() ? addRow(m, animate) : addTick(m, still);
}

// Same single emote as the newest message (within 20 s): count it there ("x12") instead of adding a row.
function combo(m) {
  const key = comboKey(m);
  const last = rows[rows.length - 1];
  if (!key || !last || last.exiting || last.combo !== key || Date.now() - last.at > 20000) return false;
  last.count++;
  last.at = Date.now();
  let badge = last.el.querySelector('.combo');
  if (!badge) last.el.querySelector('.body')?.after((badge = h('span', { className: 'combo' })));
  badge.textContent = `x${last.count}`;
  badge.animate([{ transform: 'scale(1.6)' }, { transform: 'scale(1)' }], { duration: 300, easing: 'cubic-bezier(.3,1.6,.5,1)' });
  return true;
}

const ENTER = {
  slide: [{ opacity: 0, transform: 'translateX(-28px)' }, { opacity: 1, transform: 'none' }],
  fade: [{ opacity: 0 }, { opacity: 1 }],
  pop: [{ opacity: 0, transform: 'scale(.55)' }, { opacity: 1, transform: 'scale(1.06)', offset: 0.7 }, { opacity: 1, transform: 'none' }],
};
const EXIT = {
  fade: [{ opacity: 1 }, { opacity: 0 }],
  slide: [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(-40px)' }],
};

// A row's gap is its padding, so it grows and closes together with the height (rows are border-box).
const collapsed = { height: '0px', paddingTop: '0px', paddingBottom: '0px' };
const fullSize = (el) => {
  const cs = getComputedStyle(el);
  return { height: `${el.getBoundingClientRect().height}px`, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom }; // exact, not rounded
};

function addRow(m, animate) {
  const el = h('div', { className: 'row' }, msgEl(m));
  const r = { el, msg: m, combo: comboKey(m), count: 1, at: Date.now() };
  rows.push(r);
  if (cfg.newAt === 'top') list.prepend(el);
  else list.append(el);
  if (animate) {
    // Grow the new row from 0 to its height: the older rows glide away instead of jumping.
    el.style.overflow = 'hidden';
    el.animate([collapsed, fullSize(el)], { duration: ms(320), easing: 'cubic-bezier(.2,.8,.2,1)' }).onfinish = () => (el.style.overflow = '');
    if (ENTER[cfg.enterAnim]) el.firstChild.animate(ENTER[cfg.enterAnim], { duration: ms(cfg.enterAnim === 'pop' ? 520 : 380), easing: cfg.enterAnim === 'pop' ? 'cubic-bezier(.3,1.5,.5,1)' : 'cubic-bezier(.2,.8,.2,1)' });
  }
  if (cfg.hideAfter > 0) r.timer = setTimeout(() => leave(r), cfg.hideAfter * 1000);
  const live = rows.filter((x) => !x.exiting);
  for (const old of live.slice(0, Math.max(0, live.length - cfg.maxMessages))) leave(old);
  prune();
}

// Fade out, then close the gap smoothly. For the oldest row nothing else moves: the list is pinned to the other side.
function leave(r) {
  if (r.exiting) return;
  r.exiting = true;
  clearTimeout(r.timer);
  if (!vertical()) {
    r.el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms(300), fill: 'forwards' }).onfinish = () => drop(r);
    return;
  }
  const close = () => {
    r.el.style.overflow = 'hidden';
    r.el.animate([fullSize(r.el), collapsed], { duration: ms(260), easing: 'ease-in', fill: 'forwards' }).onfinish = () => drop(r);
  };
  const out = EXIT[cfg.exitAnim] && r.el.firstChild.animate(EXIT[cfg.exitAnim], { duration: ms(360), easing: 'ease-in', fill: 'forwards' });
  if (out) out.onfinish = close;
  else close();
}
function drop(r) {
  r.el.remove();
  rows = rows.filter((x) => x !== r);
}

// Rows that slid completely out of view (past the fade zone) are invisible: remove them to keep OBS light.
function prune() {
  const box = viewport.getBoundingClientRect();
  for (const r of rows) {
    if (r.exiting) continue;
    const b = r.el.getBoundingClientRect();
    if (cfg.newAt === 'top' ? b.top >= box.bottom : b.bottom <= box.top) { clearTimeout(r.timer); drop(r); }
  }
}

// Ticker: each message slides across; the next one starts when there is room, so they never overlap.
function addTick(m, still) {
  const el = h('div', { className: 'tick' }, msgEl(m));
  const r = { el, msg: m, combo: comboKey(m), count: 1, at: Date.now() };
  if (still) { // thumbnail: lay them side by side
    el.style.left = `${rows.reduce((x, o) => x + o.el.offsetWidth + cfg.gap + 24, 0)}px`;
    list.append(el);
    rows.push(r);
    return;
  }
  const now = performance.now();
  if (tickerReady - now > 8000 || rows.length >= cfg.maxMessages) return; // chat is faster than the ticker: skip
  list.append(el);
  rows.push(r);
  const W = viewport.clientWidth, w = el.offsetWidth, v = cfg.tickerSpeed;
  const start = Math.max(now, tickerReady);
  tickerReady = start + ((w + cfg.gap + 24) / v) * 1000;
  const [from, to] = cfg.tickerDir === 'rtl' ? [W, -w] : [-w, W];
  el.animate([{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }], { duration: ((W + w) / v) * 1000, delay: start - now, fill: 'both' }).onfinish = () => drop(r);
}
