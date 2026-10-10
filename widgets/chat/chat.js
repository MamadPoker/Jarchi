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
// Per style: name colors for "Style colors", and colors that messages take turns with (null = the box color option).
const STYLE_NAMES = { cyberpunk: ['#fcee0a', '#00f0ff'], comic: ['#e63946', '#1d4ed8', '#059669', '#9333ea', '#ea580c'], galaxy: ['#c9a8ff', '#8fb8ff', '#ff9ad5'], persian: ['#e9c46a', '#2ec4b6'], led: ['#ffb000', '#ff8c1a', '#ffd34d'] };
const STYLE_TURNS = { comic: [null, '#ffe14d', '#a5e4ff'], sticky: [null, '#ffb3c7', '#b8f2d0', '#a9d8ff', '#ffd59e'], pastel: [null, '#ffc6e0', '#bff0d8', '#ffd9b3', '#c5dcff'], popin: ['#ff4d9d', '#3ee8ff', '#ffd54d', '#7cff6b'], candy: ['#dccbff', '#ffc6e0', '#bff0d8', '#fff1a8'] };
const SEPARATOR = { pastel: ' ·' }; // instead of the colon
const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
let S, cfg, mainSettings, look = '', f = {};
const recent = []; // known messages, newest last (to rebuild when the look changes)
let rows = []; // on screen: { el, msg, timer, exiting, combo, count, at }
let tickerReady = 0; // ticker: when the next message may start (ms, performance.now())
let seq = 0; // message order, for styles whose messages take turns with colors
let seeded = false; // preview: showing sample messages until real ones arrive
let filling = false; // ticker: drawing the recent messages as if the bar had been running
let loopTimer, loopAt = 0; // ticker: looping the recent messages when chat is quiet

// Emotes, badges and pictures come through Jarchi (/remote), so they follow its proxy setting.
const remote = (u) => (u?.startsWith('https://') ? `/remote?u=${encodeURIComponent(u)}` : u);
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
    // Vertical thumbnails are still; horizontal ones scroll and loop, like the real bar.
    if (cfg.layout === 'horizontal') cfg = { ...cfg, tickerLoop: true };
    apply(cfg.layout !== 'horizontal');
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
  socket.on('chatHistory', async (msgs) => {
    // The panel preview always shows the style: sample messages until real or test ones come in.
    if (!msgs.length && params.has('preview')) {
      msgs = await fetch('/api/chat/thumbs').then((r) => r.json()).catch(() => []);
      seeded = true;
    }
    recent.splice(0, recent.length, ...msgs.slice(-KEEP));
    if (cfg) rebuild();
  });
  socket.on('chat', (m) => {
    if (seeded) {
      seeded = false;
      recent.length = 0;
      if (cfg) rebuild();
    }
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
  const n = parseInt(cfg.bgColor.slice(1), 16);
  const light = cfg.bg === 'color' && cfg.bgOpacity >= 0.5 && (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.6;
  root.className = [
    'chat', `style-${cfg.style}`, `layout-${cfg.layout}`, `new-${cfg.newAt}`, `bg-${cfg.bg}`,
    cfg.bubbles && 'bubbles', boxed && 'boxed', cfg.border && 'bordered', cfg.fade && cfg.fadeZone > 0 && 'fade',
    cfg.textShadow && 'shadow', cfg.namePos === 'above' && 'name-above', still && 'still',
    light && 'light', cfg.nameColorMode === 'user' && 'names-own', // light boxes darken viewers' own name colors to stay readable
  ].filter(Boolean).join(' ');
  const vars = {
    '--w': `${cfg.width}px`, '--h': `${cfg.height}px`, '--font': `"${cfg.font}", "Segoe UI", system-ui, sans-serif`,
    '--fs': `${cfg.fontSize}px`, '--ns': `${cfg.nameSize}px`, '--text': cfg.textColor, '--bg': rgba(cfg.bgColor, cfg.bgOpacity),
    '--bd': cfg.borderColor, '--bw': `${cfg.borderWidth}px`, '--radius': `${cfg.radius}px`, '--pad': `${cfg.padding}px`, '--gap': `${cfg.gap}px`,
    '--emote': `${cfg.emoteSize}px`, '--emote-big': `${cfg.bigEmoteSize}px`, '--fade': `${cfg.fadeZone}px`, '--blur': `${cfg.blur}px`,
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.querySelector('.bar-title').textContent = S.chatText[cfg.style === 'news' ? 'liveLabel' : 'windowTitle'];
  document.body.classList.toggle('bar-bottom', cfg.layout === 'horizontal' && cfg.tickerPos === 'bottom' && !params.has('preview') && !params.has('thumb'));
  f = {
    bots: new Set(words(cfg.bots)), hidden: new Set(words(cfg.hiddenUsers)), blocked: words(cfg.blockedWords), rainbow: new Set(words(cfg.rainbowUsers)),
    streamer: [mainSettings?.chat?.kickChannel ?? cfg.kickChannel, mainSettings?.chat?.twitchChannel ?? cfg.twitchChannel].filter(Boolean).map((n) => n.toLowerCase()),
  };
  rebuild(still);
}

// Redraw from memory, without animation (look changed, or (re)connected).
function rebuild(still = false) {
  typing?.finish();
  for (const r of rows) clearTimeout(r.timer);
  rows = [];
  clearTimeout(loopTimer);
  loopAt = 0;
  list.replaceChildren();
  const keep = recent.filter(shown).slice(-cfg.maxMessages);
  // Ticker: the oldest kept message starts at the far edge, so the bar is already full instead of starting empty.
  tickerReady = vertical() || still ? 0 : performance.now() - (viewport.clientWidth / cfg.tickerSpeed) * 1000;
  filling = true;
  for (const m of keep) add(m, false, still);
  filling = false;
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

const hash = (s) => {
  let n = 0;
  for (const c of s) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  return n;
};
function nameColor(m) {
  if (cfg.nameColorMode === 'custom') return cfg.nameColor;
  if (cfg.nameColorMode === 'style') {
    const colors = STYLE_NAMES[cfg.style] ?? PALETTE;
    return colors[hash(m.user.login) % colors.length];
  }
  return m.user.color ?? PALETTE[hash(m.user.login) % PALETTE.length];
}

function avatarEl(m) {
  if (m.user.avatar) return h('img', { className: 'avatar', src: remote(m.user.avatar), alt: '' });
  return h('span', { className: 'avatar letter', textContent: (m.user.name || '?').slice(0, 1).toUpperCase(), style: `background:${nameColor(m)}` });
}

function badgesEl(m) {
  if (!cfg.showBadges) return null;
  const out = m.user.badges.filter((b) => cfg[BADGE_KEY[b.type] ?? 'badgeOther']).map((b) => (b.img
    ? h('img', { className: 'badge', src: remote(b.img), alt: b.title, title: b.title })
    : h('span', { className: `badge-text bt-${b.type}`, textContent: S.chatText.badges[b.name] ?? b.title })));
  return out.length ? h('span', { className: 'badges' }, ...out) : null;
}

function bodyEl(m) {
  const big = cfg.bigEmotes && onlyEmotes(m);
  const body = h('span', { className: `body${big ? ' big' : ''}`, dir: cfg.textDir });
  for (const p of m.parts) {
    if (p.t === 'text') body.append(p.v);
    else if (emoteOn(p)) body.append(h('img', { className: 'emote', src: remote(cfg.emotesAnimated ? p.src : p.still || p.src), alt: p.name, title: p.name }));
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
    cfg.showColon && m.kind === 'message' && !m.action && h('span', { className: 'colon', textContent: SEPARATOR[cfg.style] ?? ':' }));
  const hasText = m.parts.some((p) => p.t === 'emote' || p.v.trim());
  const el = h('div', { className: ['msg', m.kind === 'sub' && 'kind-sub', glow && 'glow', first && 'first', mention && 'mention', m.action && 'action'].filter(Boolean).join(' ') },
    tags.length ? h('div', { className: 'tags' }, ...tags) : null,
    m.kind === 'sub' && m.system ? h('div', { className: 'system', dir: cfg.textDir, textContent: m.system }) : null,
    m.kind === 'message' || hasText ? h('div', { className: 'line' }, cfg.avatars && avatarEl(m), meta, bodyEl(m)) : null);
  // For the styles: the message's turn color, a small tilt (same each time it's drawn) and its text direction.
  m.seq ??= ++seq;
  const turns = STYLE_TURNS[cfg.style];
  if (turns) el.style.setProperty('--turn', rgba(turns[m.seq % turns.length] ?? cfg.bgColor, cfg.bgOpacity));
  el.style.setProperty('--tilt', `${(hash(m.id) % 61) / 10 - 3}deg`);
  el.dataset.dir = cfg.textDir !== 'auto' ? cfg.textDir : RTL.test(m.text.match(/\p{L}/u)?.[0] ?? '') ? 'rtl' : 'ltr';
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
  if (!key || !last || last.exiting || last.repeat || last.combo !== key || Date.now() - last.at > 20000) return false;
  last.count++;
  last.at = Date.now();
  let badge = last.el.querySelector('.combo');
  if (!badge) last.el.querySelector('.body')?.after((badge = h('span', { className: 'combo' })));
  badge.textContent = `x${last.count}`;
  badge.animate([{ transform: 'scale(1.6)' }, { transform: 'scale(1)' }], { duration: 300, easing: 'cubic-bezier(.3,1.6,.5,1)' });
  return true;
}

const SMOOTH = 'cubic-bezier(.2,.8,.2,1)';
// Enter animations: [keyframes, duration (ms), easing].
const ENTER = {
  slide: [[{ opacity: 0, transform: 'translateX(-28px)' }, { opacity: 1, transform: 'none' }], 380],
  fade: [[{ opacity: 0 }, { opacity: 1 }], 380],
  pop: [[{ opacity: 0, transform: 'scale(.5)' }, { opacity: 1, transform: 'scale(1.08)', offset: 0.6 }, { transform: 'scale(.97)', offset: 0.82 }, { opacity: 1, transform: 'none' }], 560, 'ease-out'],
  float: [[{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], 750, 'cubic-bezier(.2,.7,.3,1)'],
  bounce: [[{ opacity: 0, transform: 'translateY(18px) scale(.92)' }, { opacity: 1, transform: 'translateY(-5px) scale(1.02)', offset: 0.55 }, { transform: 'translateY(2px)', offset: 0.8 }, { opacity: 1, transform: 'none' }], 650, 'ease-out'],
  drop: [[{ opacity: 0, transform: 'translateY(-46px) rotate(-7deg) scale(1.08)' }, { opacity: 1, transform: 'translateY(3px) scale(.97, 1.02)', offset: 0.6 }, { transform: 'scale(1.01, .99)', offset: 0.8 }, { opacity: 1, transform: 'none' }], 560, 'cubic-bezier(.3,.9,.4,1)'],
};
const EXIT = {
  fade: [{ opacity: 1 }, { opacity: 0 }],
  slide: [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(-40px)' }],
};

// Animate a message that may have its own CSS transform (a tilted sticky note): the motion goes on top of it.
function animate(el, frames, opts) {
  const own = getComputedStyle(el).transform;
  if (own !== 'none') frames = frames.map((k) => (k.transform ? { ...k, transform: k.transform === 'none' ? own : `${k.transform} ${own}` } : k));
  return el.animate(frames, opts);
}

// A new message arrives: its enter animation, the style's arrival effect (CSS: .arrive), the typewriter.
function arrive(el, msg) {
  const enter = ENTER[cfg.enterAnim];
  if (enter) animate(msg, enter[0], { duration: ms(enter[1]), easing: enter[2] ?? SMOOTH });
  el.classList.add('arrive');
  if (cfg.typewriter) typeOut(msg);
}

// Typewriter: the newest message's text appears letter by letter. The rest is already laid out (invisible), so the
// message never changes size while it types. A newer message finishes the previous one at once.
let typing = null;
function typeOut(msg) {
  typing?.finish();
  const body = msg.querySelector('.body');
  if (!body?.firstChild) return;
  const shown = h('span'), rest = h('span', { className: 'unshown' }, ...body.childNodes);
  body.replaceChildren(shown, rest);
  msg.classList.add('typing');
  const total = rest.textContent.length + rest.querySelectorAll('img').length;
  const perTick = Math.ceil(total / 80); // long messages type faster: at most ~80 steps
  let ticks = 0;
  const timer = setInterval(() => {
    for (let i = 0; i < perTick && rest.firstChild; i++) {
      const node = rest.firstChild;
      if (node.nodeType === Node.TEXT_NODE && node.data.length > 1) {
        const ch = String.fromCodePoint(node.data.codePointAt(0));
        node.data = node.data.slice(ch.length);
        if (shown.lastChild?.nodeType === Node.TEXT_NODE) shown.lastChild.appendData(ch);
        else shown.append(ch);
      } else shown.append(node); // an emote, or the last letter of a text
    }
    if (cfg.typeSound && ticks++ % 2 === 0) blip();
    if (!rest.firstChild) finish();
  }, ms(32));
  function finish() {
    clearInterval(timer);
    shown.append(...rest.childNodes);
    rest.remove();
    msg.classList.remove('typing');
    typing = null;
  }
  typing = { finish };
}

// A soft blip for the typewriter (off by default).
let audio;
function blip() {
  try {
    audio ??= new AudioContext();
    const t = audio.currentTime, osc = audio.createOscillator(), gain = audio.createGain();
    osc.type = 'triangle';
    osc.frequency.value = 520 + Math.random() * 60;
    gain.gain.setValueAtTime(0.05, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.06);
  } catch {}
}

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
    const size = fullSize(el); // taller messages (a sub, a big note) grow a little longer, so nothing moves too fast
    el.animate([collapsed, size], { duration: ms(Math.min(650, 280 + parseFloat(size.height) * 1.5)), easing: SMOOTH }).onfinish = () => (el.style.overflow = '');
    arrive(el, el.firstChild);
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
  const out = EXIT[cfg.exitAnim] && animate(r.el.firstChild, EXIT[cfg.exitAnim], { duration: ms(360), easing: 'ease-in', fill: 'forwards' });
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
// repeat: a looped message (no arrival effects). Returns false when skipped.
// Messages wait for their images (emotes, badges) before they're measured, so a late image never makes one wider
// than the space it was given; they still go in order.
let tickChain = Promise.resolve();
function addTick(m, still, repeat = false) {
  const el = h('div', { className: 'tick' }, msgEl(m));
  const r = { el, msg: m, combo: comboKey(m), count: 1, at: Date.now(), repeat };
  if (still) { // thumbnail: lay them side by side
    el.style.left = `${rows.reduce((x, o) => x + o.el.offsetWidth + cfg.gap + 24, 0)}px`;
    list.append(el);
    rows.push(r);
    return true;
  }
  if (rows.length >= cfg.maxMessages) return false;
  el.style.visibility = 'hidden';
  list.append(el);
  rows.push(r);
  const fill = filling;
  tickChain = tickChain.then(() => imagesReady(el)).then(() => place(r, fill));
  return true;
}
const imagesReady = (el) => Promise.race([
  Promise.all([...el.querySelectorAll('img')].map((i) => (i.complete ? null : new Promise((ok) => { i.onload = i.onerror = ok; })))),
  new Promise((ok) => setTimeout(ok, 1500)),
]);

// Give a message its slot: it starts when the one before has moved past by the gap.
function place(r, fill) {
  const { el, msg: m } = r;
  if (!el.isConnected) return; // redrawn meanwhile
  const now = performance.now();
  // Chat faster than the ticker: skip, so it stays close to live (test messages may wait longer: they show every effect).
  if (!fill && tickerReady - now > (m.test ? 60000 : 8000)) return drop(r);
  const W = viewport.clientWidth, w = el.offsetWidth, v = cfg.tickerSpeed;
  const start = fill ? tickerReady : Math.max(now, tickerReady); // when filling, it may have started already
  const duration = ((W + w) / v) * 1000;
  tickerReady = start + ((w + cfg.gap + 24) / v) * 1000;
  if (start + duration <= now) return drop(r); // would already be gone
  const [from, to] = cfg.tickerDir === 'rtl' ? [W, -w] : [-w, W];
  el.animate([{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }], { duration, delay: start - now, fill: 'both' }).onfinish = () => drop(r);
  el.style.visibility = '';
  if (!fill && !r.repeat) {
    setTimeout(() => {
      el.classList.add('arrive');
      if (cfg.typewriter && el.isConnected) typeOut(el.firstChild);
    }, start - now);
  }
  scheduleLoop();
}

// Keep looping: when the bar has room and no new message is waiting, the recent messages come around again.
function scheduleLoop() {
  clearTimeout(loopTimer);
  if (!cfg.tickerLoop || vertical()) return;
  loopTimer = setTimeout(() => {
    const pool = recent.filter(shown).slice(-cfg.maxMessages);
    if (pool.length && !addTick(pool[loopAt++ % pool.length], false, true)) loopTimer = setTimeout(scheduleLoop, 500);
  }, Math.max(0, tickerReady - performance.now()));
}
