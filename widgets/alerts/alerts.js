// Alerts overlay.
// Live (OBS): the server's queue (core/alerts.js) sends each alert to every open overlay with the time it has left;
// the overlay just shows it. A refreshed overlay gets the alert that's on now. Socket.IO reconnects on its own.
// Preview (?preview, inside the panel): the panel posts { strings, settings, event, muted, hold }; each post replays at once.
// hold keeps it on screen until the next post (the theme cards, ?preview=tile).
const params = new URLSearchParams(location.search);
const stage = document.getElementById('stage');
const sounds = new Set();
let settings,
  S,
  gen = 0;
let onNow = null; // live: { id, end() } of the alert on screen, so the panel's Skip can end it
let onStage = null; // the alert element on screen, for fit()
let cssType = null; // the type of the alert on screen, whose Custom CSS is on
// The user's Custom CSS (Advanced box), after the page's own CSS so it wins. Set as text, so nothing in it is ever HTML
// (a "</style>" can't end it).
const userCss = document.head.appendChild(document.createElement('style'));

// Bigger events feel bigger: tier 0 (follow) ... 4 (raid). Amount-based types climb with the amount.
const STEPS = { gift_sub: [5, 20], kicks: [100, 1000], bits: [100, 1000] }; // same in core/alerts.js (how long alerts play)
const SCALE = [0.8, 1, 1.15, 1.3, 1.45];
const PARTICLES = [8, 18, 30, 44, 64];
const RINGS = [1, 1, 2, 3, 3];
const MOTION = { fun: 'fall', ice: 'fall', glass: 'rise', fire: 'rise', galaxy: 'twinkle' }; // everything else bursts
const tierOf = (ev) => (ev.type === 'follow' ? 0 : ev.type === 'raid' ? 4 : 1 + (STEPS[ev.type] ?? []).filter((n) => ev.amount >= n).length);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const h = (tag, props, ...kids) => {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...kids);
  return el;
};
const fill = (tpl, v) => tpl.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};
const isVideo = (file) => /\.(webm|mp4)$/.test(file);
// A font picked in the Text tab, as CSS; nothing for the theme's own ('theme', or settings from before it existed).
const fontOf = (f) => f && f !== 'theme' && `"${f}", "Segoe UI", system-ui, sans-serif`;
// The Kick/Twitch badge only means something when you stream to both, so it needs both accounts connected.
const badgeVisible = () => settings.showBadge && ['kick', 'twitch'].every((p) => settings.connected?.includes(p));

function applyStrings(s) {
  S = s;
  document.documentElement.lang = s.lang;
  document.documentElement.dir = s.dir;
}
function applySettings(s) {
  settings = s;
  if (cssType) {
    setCss(cssType); // typed in the panel while it's on screen
    fit();
  }
  for (const a of Object.values(s.alerts)) for (const f of [a.nameFont, a.textFont]) if (fontOf(f)) document.fonts.load(`16px "${f}"`); // ready before an alert needs it
  for (const f of s.crypto ? ['Vazirmatn', s.crypto.custom.font, ...s.crypto.tiers.map((t) => t.font)] : []) document.fonts.load(`16px "${f}"`); // and the crypto alerts' fonts
}

// The alert's Custom CSS while it's on screen (none: no alert).
function setCss(type) {
  cssType = type;
  userCss.textContent = type ? (settings.alerts[type].customCss ?? '') : '';
}

// The alert fills the Browser Source, whatever its size or shape: #stage is a page as big as the source, in units of an
// 800x600 one (so borders, shadows and effects keep their proportions), scaled onto it; the alert's own size (Style
// tab) shrinks it toward the middle. Inside, the picture gets a fixed square (an image fits in it whatever its own pixel
// size; an uploaded file wider than 1.2:1 gets the square's height and the width its shape needs, up to the whole width,
// while the effects stay on the square) and the text the rest, in the biggest font size that fits there (or the alert's
// own font size, if that fits).
// Runs again when the source changes size, a font finishes loading, or a preview drawn while its page was hidden in the
// panel comes into view.
const PAD = 16; // around the alert: room for the platform badge, the shake and a frame's shadow
function fit() {
  if (!document.documentElement.offsetWidth || !innerHeight) return; // no layout yet: a hidden preview
  const W = innerWidth,
    H = innerHeight,
    a = Math.min(onStage?.dataset.size ?? 1, 1),
    k = Math.min(W / 800, H / 600);
  const w = W / k,
    h = H / k;
  stage.style.cssText = `width:${w}px;height:${h}px;--f:${Math.min(w / 1920, h / 1080)};transform:translate(${(W * (1 - a)) / 2}px,${(H * (1 - a)) / 2}px) scale(${k * a})`;
  const el = onStage;
  if (!el) return;
  const iw = w - 2 * PAD,
    ih = h - 2 * PAD,
    over = el.classList.contains('pos-over');
  const pic = !el.classList.contains('no-media'),
    gap = pic ? ih * 0.04 : 0;
  const m = !pic ? 0 : Math.min(iw, over ? ih : ih * 0.58); // the picture's square; text on top of it gets a band across its middle
  el.style.setProperty('--m', `${m}px`);
  el.style.setProperty('--mw', `${Math.min(iw, m * (el.dataset.r > 1.2 ? el.dataset.r : 1))}px`); // an uploaded file's area: wider when it's wide
  el.style.setProperty('--gap', `${gap}px`);
  el.style.setProperty('--tw', `${iw}px`);
  if (el.dataset.s) el.style.setProperty('--s', (el.dataset.s * m) / 330); // a theme's emblem: a raid's fills most of the square
  sizeText(el, pic && over ? ih * 0.4 : ih - m - gap, Number(el.dataset.fs));
}
addEventListener('resize', fit);
document.fonts.addEventListener('loadingdone', fit);
new IntersectionObserver((seen) => seen.some((e) => e.isIntersecting) && fit()).observe(document.documentElement);

// The text's font size: the biggest that fits in th (height; the width is the box's max-width) with every word on one
// line, or `own` (px) when that fits. A name too long for its line gets a smaller font of its own instead. Layout sizes
// only (offset*): the words' entry animations scale them, which scroll sizes would count.
function sizeText(el, th, own) {
  const box = el.querySelector('.box, .kick-text'),
    text = box.querySelector('.text'),
    name = text.querySelector('[data-k=user]');
  const words = [...text.querySelectorAll('.w')];
  const fits = (fs) => {
    el.style.setProperty('--fs', `${fs}px`);
    if (name) {
      name.style.fontSize = '';
      if (name.offsetWidth > text.clientWidth) name.style.fontSize = `${text.clientWidth / name.offsetWidth}em`;
    }
    return box.offsetHeight <= th && words.every((w) => w.offsetWidth <= text.clientWidth + 1);
  };
  let lo = 6,
    hi = own || th;
  if (fits(hi)) return;
  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  fits(lo);
}

if (params.has('preview')) {
  addEventListener('message', (e) => {
    if (e.origin !== location.origin || !e.data?.event) return;
    applyStrings(e.data.strings);
    applySettings(e.data.settings);
    stopAll();
    show(e.data.event, { muted: e.data.muted, hold: e.data.hold }).catch(console.error);
  });
} else {
  // WebSocket first, like the chat widget: HTTP polling can wait behind other downloads from this PC (a browser opens
  // only 6 connections to it at a time). Polling stays as the fallback if WebSocket can't connect.
  const socket = io({ transports: ['websocket', 'polling'], tryAllTransports: true });
  socket.on('strings', applyStrings);
  socket.on('settings', applySettings);
  // Again after every reconnect. The type in the link (/widgets/alerts/sub): only that type's alerts; none: the main link.
  // In OBS also the Browser Source's size, and again when it changes: the panel's preview is that size.
  const size = () => window.obsstudio && socket.emit('obsSize', { w: innerWidth, h: innerHeight });
  socket.on('connect', () => {
    socket.emit('alertsJoin', location.pathname.split('/')[3]);
    size();
  });
  addEventListener('resize', size);
  addEventListener('pagehide', () => socket.disconnect()); // leaving: tell the queue now, not after a ping timeout
  // { id, ev, left, late }: late = this overlay (re)connected while it was already on; no sound again then.
  socket.on('alert', (a) => {
    if (!settings || !S) return;
    stopAll();
    show(a.ev, { ms: a.left, id: a.id, muted: a.late }).catch(console.error);
    // It's on the page now: for the server's alert timing line (not again when this overlay joined in the middle).
    if (!a.late) socket.emit('alertShown', { id: a.id, shown: Date.now(), where: window.obsstudio ? 'OBS' : 'browser' });
  });
  socket.on('alertSkip', (id) => {
    if (onNow?.id === id) onNow.end();
  });
}

// Cut whatever is playing so the next alert starts right away.
function stopAll() {
  gen++;
  onNow = onStage = null;
  setCss(null);
  for (const s of sounds) s.pause();
  sounds.clear();
  stage.replaceChildren();
}

// Media by amount: the alert's own tier (the highest one at or below the amount) if it's on, else the closest lower
// tier that's on; a tier without a file uses the theme's. Tiers off, or none on below the amount: the alert's own media.
function mediaFor(cfg, ev) {
  const tier = cfg.tiersOn ? [...(cfg.tiers ?? [])].reverse().find((t) => t.on && t.amount <= ev.amount) : null; // not findLast: older OBS
  if (!tier) return { image: cfg.image, sound: cfg.soundMode === 'custom' ? cfg.sound : null };
  return { image: tier.image, sound: tier.sound };
}

// opts: muted, hold (preview: stay until the next post), ms (on-screen time, from the server), id.
async function show(ev, { muted = false, hold = false, ms, id } = {}) {
  if (ev.type === 'crypto') return showCrypto(ev, { muted, hold, ms, id });
  const my = gen;
  const cfg = settings.alerts[ev.type];
  const theme = cfg.theme || settings.theme; // an alert can override the main theme
  const tier = tierOf(ev);
  const grows = ev.type in STEPS;
  const v = { user: ev.user, amount: ev.amount.toLocaleString(), months: ev.months, platform: S.platforms[ev.platform] };
  const files = mediaFor(cfg, ev);
  const kickLook = ev.type === 'kicks' && cfg.look === 'kick';
  const { el, scope, video } = kickLook ? kickAlert(cfg, ev, v, files) : themed(cfg, ev, v, files, theme, tier, grows);
  textStyle(el, cfg);
  el.dataset.size = cfg.size ?? 1; // fit(): how much of the source it fills
  // The alert's own text size (Text tab, not Auto); amounts that grow get a bit more, like before.
  if (cfg.autoSize === false) el.dataset.fs = cfg.fontSize * (grows && !kickLook ? 1 + (tier - 1) * 0.1 : 1);
  // An uploaded file's shape, known before it's on the page (so no jump): fit() gives a wide one a wide area.
  const file = el.querySelector('.media.custom > img, .media.custom > video');
  if (file) {
    el.dataset.r = await shape(file);
    if (my !== gen) return; // the next alert came meanwhile
  }

  setCss(ev.type);
  stage.append(scope);
  onStage = el;
  fit();
  const sound = muted
    ? null
    : kickLook
      ? playSound(cfg, files.sound, 'kick_gift', 0, !!video, 'kick')
      : playSound(cfg, files.sound, ev.type, tier, !!video, theme);
  if (video) {
    video.muted = muted || cfg.videoSound === 'off';
    video.volume = cfg.volume;
    video.play().catch((err) => {
      if (err.name !== 'NotAllowedError') return;
      video.muted = true; // browser blocked sound: play silent rather than not at all
      video.play().catch(() => {});
    });
  }
  if (hold) return; // stays until stopAll() on the next preview

  // On screen for ms (Skip ends it early), then the exit animation.
  await new Promise((done) => {
    const t = setTimeout(done, ms ?? (cfg.duration + (grows ? (tier - 1) * 1.5 : 0)) * 1000);
    onNow = {
      id,
      end: () => {
        clearTimeout(t);
        done();
      },
    };
  });
  if (my !== gen) return;
  onNow = null;
  el.classList.add('out');
  await sleep(600);
  if (my !== gen) return;
  sound?.pause();
  sounds.delete(sound);
  scope.remove();
  onStage = null;
  setCss(null);
}

// The alert's own text style (Text tab) over its look, the name's and the message's each: color, font, bold off,
// outline/shadow off. alerts.css: .nc .nf .nreg .nflat (name), .tc .tf .treg .flat (the rest).
function textStyle(el, cfg) {
  const vars = { '--nc': cfg.nameColor, '--nf': fontOf(cfg.nameFont), '--tc': cfg.textColor, '--tf': fontOf(cfg.textFont) };
  for (const [k, v] of Object.entries(vars)) {
    el.classList.toggle(k.slice(2), !!v);
    if (v) el.style.setProperty(k, v);
  }
  el.classList.toggle('nreg', cfg.nameBold === false);
  el.classList.toggle('treg', cfg.textBold === false);
  el.classList.toggle('nflat', cfg.nameShadow === false);
  el.classList.toggle('flat', cfg.textShadow === false);
}

// The theme look: media with the theme's particles, rings and glow, the text box, all inside a theme wrapper.
function themed(cfg, ev, v, files, theme, tier, grows) {
  // Bits without a file of their own: Twitch's gem for the amount (the bits tiers are Twitch's gem amounts).
  const gem = ev.type === 'bits' && !files.image && ([...cfg.tiers].reverse().find((t) => t.amount <= ev.amount) ?? cfg.tiers[0]).amount;
  const media = gem
    ? h('div', { className: 'media gem' }, h('img', { src: `/assets/twitch-bits/${gem}.gif`, alt: '' }))
    : mediaEl(files.image, fill(S.emblems[ev.type], v));
  const video = media.querySelector('video');
  media.append(particles(tier, theme));
  for (let i = 0; i < RINGS[tier]; i++) media.append(h('b', { className: 'ring', style: `--delay:${0.1 + i * 0.22}s` }));
  if (tier >= 2) media.append(h('b', { className: 'glow' }));

  const box = h('div', { className: 'box' }, text(cfg.template, v));
  if (badgeVisible()) box.prepend(h('span', { className: 'badge', textContent: v.platform }));
  if (ev.message) box.append(h('div', { className: 'msg', textContent: ev.message }));
  if (tier === 4) box.append(h('b', { className: 'sweep' }));

  // None draws no emblem of its own: without the user's picture (or bits' gem) the text has the whole box.
  const bare = theme === 'none' && !files.image && !gem;
  const el = h(
    'div',
    {
      className: `alert tier-${tier} type-${ev.type} plat-${ev.platform} pos-${cfg.textPos} align-${cfg.textAlign} frame-${cfg.frame}${bare ? ' no-media' : ''}`,
    },
    h('div', { className: 'inner' }, media, box),
  );
  // The theme CSS keys off [data-theme] on an ancestor, so each alert gets its own (layout-neutral) theme wrapper.
  const scope = h('div', { className: 'theme-scope' }, el);
  scope.dataset.theme = theme;
  el.dataset.s = SCALE[tier]; // fit() sizes the emblem by it, in the picture's square
  if (cfg.frame === 'custom') {
    el.style.setProperty('--fbg', rgba(cfg.frameBg, cfg.frameOpacity));
    el.style.setProperty('--fbd', cfg.frameBorder);
    el.style.setProperty('--frad', `${cfg.frameRadius}px`);
  }
  return { el, scope, video };
}

// The Kicks alert's own look (look: 'kick', the default): the gift that was sent, big (an uploaded file instead, if
// there is one), and "{user} sent {amount} Kicks" with the amount and the word after it in Kick's green. No theme,
// box or effects: alerts.css .kick-alert.
function kickAlert(cfg, ev, v, files) {
  const gift = [...cfg.tiers].reverse().find((t) => t.amount <= ev.amount)?.gift ?? cfg.tiers[0].gift; // Kick's gifts, by amount
  const media = files.image ? mediaEl(files.image) : h('div', { className: 'media' }, h('img', { src: `/assets/kick-gifts/${gift.id}.webp`, alt: '' }));
  const words = text(cfg.template, v);
  const amount = words.querySelector('[data-k=amount]');
  amount?.classList.add('green');
  if (amount?.nextElementSibling && !amount.nextElementSibling.classList.contains('hl')) amount.nextElementSibling.classList.add('green');
  const el = h(
    'div',
    { className: 'kick-alert' },
    media,
    h('div', { className: 'kick-text' }, words, ev.message ? h('div', { className: 'msg', textContent: ev.message }) : ''),
  );
  return { el, scope: el, video: media.querySelector('video') };
}

// Custom image/GIF/video, or the theme's CSS-only emblem (e1/e2 are spare layers the themes decorate).
function mediaEl(image, label) {
  if (!image) {
    return h(
      'div',
      { className: 'media' },
      h('div', { className: 'emblem' }, h('i', { className: 'e1' }), h('i', { className: 'e2' }), h('span', { textContent: label })),
    );
  }
  const src = '/uploads/' + encodeURIComponent(image.file);
  return h(
    'div',
    { className: 'media custom' },
    isVideo(image.file) ? h('video', { muted: true, loop: true, playsInline: true, src }) : h('img', { src, alt: '' }),
  );
}

// An image's or video's width / height, as soon as it's known (it loads before it's on the page); 1 (square) for a
// broken file or one that takes over a second to tell.
function shape(file) {
  const r = () => {
    const w = file.videoWidth || file.naturalWidth,
      h = file.videoHeight || file.naturalHeight;
    return w && h ? w / h : 0;
  };
  return new Promise((done) => {
    if (r()) return done(r());
    file.addEventListener(file.tagName === 'VIDEO' ? 'loadedmetadata' : 'load', () => done(r() || 1));
    file.addEventListener('error', () => done(1));
    setTimeout(() => done(1), 1000);
  });
}

// Template -> DOM, one span per word so themes can animate words in; variables get .hl. Text only, never innerHTML.
function text(tpl, v) {
  const el = h('div', { className: 'text' });
  let i = 0;
  for (const part of tpl.split(/(\{\w+\}|\s+)/)) {
    if (!part) continue;
    const k = part.slice(1, -1);
    if (!part.trim()) el.append(' ');
    else if (part.startsWith('{') && k in v) {
      const w = h('span', { className: 'w hl', textContent: v[k], style: `--i:${i++}` });
      w.dataset.k = k;
      el.append(w);
    } else el.append(h('span', { className: 'w', textContent: part, style: `--i:${i++}` }));
  }
  return el;
}

// ---------- Crypto alerts (Jarchi Pay donations; settings.crypto = the Crypto page's Alert settings) ----------
// ev: { user ('' = anonymous: the donor hid the name; ev.anonymous: that word in the panel's language), amount (USDT, as paid), network, message (never a private one:
// the server leaves those out), txHash, look }. look: 'coin' | 'hologram' (Jarchi's two designs), 'custom' or an amount
// alert's id (the streamer's own: an image and the text by it); one that's gone meanwhile: the card picked. Each one
// opens with Jarchi's signature sound (sounds.js crypto), then the alert's own sound.
const NETWORK = { bep20: 'BEP20', trc20: 'TRC20' };
const CRYPTO_FONT = {
  Lalezar: '"Lalezar", "Vazirmatn", Tahoma, sans-serif',
  Vazirmatn: '"Vazirmatn", Tahoma, sans-serif',
  Bangers: '"Bangers", Impact, Arial, sans-serif',
};

async function showCrypto(ev, { muted, hold, ms, id }) {
  const my = gen,
    c = settings.crypto;
  const own = ev.look === 'custom' ? c.custom : c.tiers.find((t) => t.id === ev.look);
  const design = own ? null : ['coin', 'hologram'].includes(ev.look) ? ev.look : c.design === 'custom' ? null : c.design;
  const look = own ?? (design ? null : c.custom);
  const name = ev.user || ev.anonymous || S.crypto.anonymous,
    amount = `${ev.amount} USDT`,
    net = NETWORK[ev.network] ?? '';
  const el = design === 'coin' ? coinCard(ev, name, amount, net) : design === 'hologram' ? hologram(ev, name, amount, net) : ownAlert(look, ev, name, amount);
  const scope = h('div', { className: 'crypto-scope' }, el);
  stage.append(scope);
  fit();
  // The two designs: their own sound, or the one uploaded for them. The streamer's own: its sound, else the hologram's.
  const file = design ? c.sound : look.sound;
  const sound = muted ? null : cryptoSound(file ? null : (design ?? 'hologram'), file);
  el.querySelector('video')
    ?.play()
    .catch(() => {});
  if (hold) return; // a preview: stays until the next one

  await new Promise((done) => {
    const t = setTimeout(done, ms ?? (look ? look.duration : c.duration) * 1000);
    onNow = {
      id,
      end: () => {
        clearTimeout(t);
        done();
      },
    };
  });
  if (my !== gen) return;
  onNow = null;
  el.classList.add('out');
  await sleep(600);
  if (my !== gen) return;
  sound?.pause();
  sounds.delete(sound);
  scope.remove();
}

// The signature now, then (at +0.75 s) the design's sound or the uploaded file.
function cryptoSound(design, file) {
  const synth = JarchiSounds.crypto(design);
  let audio;
  const later =
    file &&
    setTimeout(() => {
      audio = new Audio('/uploads/' + encodeURIComponent(file.file));
      audio.volume = 0.7;
      audio.play().catch(() => {});
    }, 750);
  const handle = {
    pause: () => {
      clearTimeout(later);
      audio?.pause();
      synth.pause();
    },
  };
  sounds.add(handle);
  return handle;
}

// A 3D coin: Jarchi Pay's face on both sides of a reeded edge (stacked discs).
function coin3() {
  const c = h('div', { className: 'coin3' });
  for (let z = -6; z <= 6; z++) c.append(h('i', { className: 'e', style: `transform:translateZ(${z}px) scale(.985)` }));
  c.append(h('i', { className: 'f', style: 'transform:translateZ(7px)' }), h('i', { className: 'f', style: 'transform:rotateY(180deg) translateZ(7px)' }));
  return c;
}

// Design 1, coin and card: the coin drops in spinning, sparks fly, the card swings open beside it.
function coinCard(ev, name, amount, net) {
  const my = gen,
    cw = h('div', { className: 'cw' }, coin3());
  const el = h(
    'div',
    { className: 'crypto-alert d1' },
    cw,
    h(
      'div',
      { className: 'card' },
      h('i', { className: 'sh' }),
      h('div', { className: 'nm' }, h('span', { textContent: name })),
      h('div', { className: 'am' }, net ? h('i', { textContent: net }) : '', h('b', { textContent: amount })),
      ev.message ? h('div', { className: 'cmsg', textContent: ev.message }) : '',
    ),
  );
  setTimeout(() => {
    if (my !== gen) return;
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2,
        r = 80 + Math.random() * 120;
      const s = h('i', { className: 'spark', style: `--x:${Math.cos(a) * r}px;--y:${Math.sin(a) * r}px` });
      cw.append(s);
      setTimeout(() => s.remove(), 1700);
    }
  }, 1150);
  return el;
}

// Design 2, cipher hologram: a glitching card, the coin flying in, and the transaction, name and amount decoding.
function hologram(ev, name, amount, net) {
  const hx = h('div', { className: 'hx' }),
    nm = h('span'),
    am = h('b');
  const el = h(
    'div',
    { className: 'crypto-alert d3' },
    h('div', { className: 'glow3' }),
    h('div', { className: 'cw' }, coin3()),
    h(
      'div',
      { className: 'hc' },
      h('i', { className: 'crn a' }),
      h('i', { className: 'crn b' }),
      hx,
      h('div', { className: 'nm' }, nm),
      h('div', { className: 'am' }, net ? h('i', { textContent: net }) : '', am),
      ev.message ? h('div', { className: 'cmsg', textContent: ev.message }) : '',
    ),
  );
  const tx = ev.txHash ? `${ev.txHash.slice(0, 6)}…${ev.txHash.slice(-4)}` : 'TEST';
  decode(hx, `TX ${tx} · CONFIRMED`, 500, 700);
  decode(nm, name, 800, 500);
  decode(am, amount, 1000, 700);
  return el;
}
// Text that comes out of random signs, letter by letter, after `wait` ms, over `ms`.
function decode(el, txt, wait, ms) {
  const signs = '0123456789ABCDEF#@$%&*',
    letters = [...txt],
    t0 = performance.now() + wait,
    my = gen;
  (function frame(now) {
    if (my !== gen) return;
    const k = (now - t0) / ms;
    el.textContent =
      k < 0 ? '' : k >= 1 ? txt : letters.map((ch, i) => (ch === ' ' || i / letters.length < k ? ch : signs[(Math.random() * signs.length) | 0])).join('');
    if (k < 1) requestAnimationFrame(frame);
  })(performance.now());
}

// The streamer's own: their image, GIF or video (none: Jarchi Pay's coin) with the name, amount and message above,
// below or beside it, in their font.
function ownAlert(look, ev, name, amount) {
  const f = look.image,
    src = f && '/uploads/' + encodeURIComponent(f.file);
  const pic = !f
    ? h('img', { src: '/assets/brand/jarchi-pay-coin.webp', alt: '' })
    : isVideo(f.file)
      ? h('video', { muted: true, loop: true, playsInline: true, src })
      : h('img', { src, alt: '' });
  const el = h(
    'div',
    { className: `crypto-alert own pos-${look.pos}` },
    h('div', { className: 'img' }, pic),
    h(
      'div',
      { className: 'tx' },
      h('div', { className: 't1' }, h('span', { textContent: name })),
      h('div', { className: 't2', textContent: amount }),
      ev.message ? h('div', { className: 't3', textContent: ev.message }) : '',
    ),
  );
  el.style.fontFamily = CRYPTO_FONT[look.font] ?? CRYPTO_FONT.Lalezar;
  return el;
}

// file: the sound to play (from mediaFor), else the theme's.
function playSound(cfg, file, type, tier, hasVideo, theme) {
  if (cfg.soundMode === 'none' || (hasVideo && cfg.videoSound === 'video')) return null;
  let s;
  if (file) {
    s = new Audio('/uploads/' + encodeURIComponent(file.file));
    s.volume = cfg.volume;
    s.play().catch(() => {});
  } else {
    s = JarchiSounds.play(theme, type, tier, cfg.volume);
  }
  sounds.add(s);
  return s;
}

// Particles start/end positions (px, relative to the media center); each theme styles their look.
function particles(tier, theme) {
  const fx = h('div', { className: 'fx' });
  const motion = MOTION[theme] ?? 'burst';
  const count = PARTICLES[tier] * (theme === 'minimal' ? 0.4 : 1);
  const r = (a, b) => a + Math.random() * (b - a);
  for (let i = 0; i < count; i++) {
    let sx = 0,
      sy = 0,
      ex,
      ey;
    if (motion === 'burst') {
      const a = r(0, 2 * Math.PI),
        d = r(120, 380) * SCALE[tier];
      ex = Math.cos(a) * d;
      ey = Math.sin(a) * d;
    } else if (motion === 'fall') {
      sx = r(-760, 760);
      sy = r(-420, -160);
      ex = sx + r(-140, 140);
      ey = sy + r(650, 950);
    } else if (motion === 'rise') {
      sx = r(-540, 540);
      sy = r(40, 260);
      ex = sx + r(-100, 100);
      ey = sy - r(420, 760);
    } else {
      sx = ex = r(-820, 820);
      sy = ey = r(-200, 460);
    }
    const delay = r(0, 0.6) + (tier === 4 && i % 2 ? 1.2 : 0); // raid fires a second wave
    fx.append(
      h('i', {
        style: `--sx:${sx}px;--sy:${sy}px;--ex:${ex}px;--ey:${ey}px;--r:${r(-540, 540)}deg;--z:${r(0.5, 1.3)};--d:${r(1.2, 2.4)}s;--delay:${delay}s;--pc:var(--c${1 + (i % 3)})`,
      }),
    );
  }
  return fx;
}
