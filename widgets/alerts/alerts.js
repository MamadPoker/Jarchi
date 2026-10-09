// Alerts overlay.
// Live (OBS): events arrive over Socket.IO and play one at a time. Socket.IO reconnects on its own.
// Preview (?preview, inside the panel): the panel posts { strings, settings, event, muted }; each post replays at once.
const params = new URLSearchParams(location.search);
const stage = document.getElementById('stage');
const queue = [];
const sounds = new Set();
let settings, S, busy = false, gen = 0;

// Bigger events feel bigger: tier 0 (follow) ... 4 (raid). Amount-based types climb with the amount.
const STEPS = { gift_sub: [5, 20], kicks: [100, 1000], bits: [100, 1000] };
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

function applyStrings(s) {
  S = s;
  document.documentElement.lang = s.lang;
  document.documentElement.dir = s.dir;
}
function applySettings(s) {
  settings = s;
  document.body.dataset.theme = s.theme;
}

if (params.has('preview')) {
  if (params.get('preview') === 'tile') document.body.classList.add('tile');
  addEventListener('message', (e) => {
    if (e.origin !== location.origin || !e.data?.event) return;
    applyStrings(e.data.strings);
    applySettings(e.data.settings);
    stopAll();
    show(e.data.event, e.data.muted).catch(console.error);
  });
} else {
  const socket = io();
  socket.on('strings', applyStrings);
  socket.on('settings', applySettings);
  socket.on('event', (ev) => {
    const cfg = settings?.alerts[ev.type];
    if (!cfg || !S) return;
    if (!ev.test && (!cfg.enabled || ev.amount < (cfg.minAmount ?? 0))) return; // test button always plays
    queue.push(ev);
    playNext();
  });
}

// ponytail: unbounded queue; cap or collapse it if a connector ever floods events
async function playNext() {
  if (busy || !queue.length) return;
  busy = true;
  try { await show(queue.shift()); } catch (err) { console.error(err); }
  busy = false;
  playNext();
}

// Preview only: cut whatever is playing so the new preview starts right away.
function stopAll() {
  gen++;
  for (const s of sounds) s.pause();
  sounds.clear();
  stage.replaceChildren();
}

async function show(ev, muted = false) {
  const my = gen;
  const cfg = settings.alerts[ev.type];
  const tier = tierOf(ev);
  const grows = ev.type in STEPS;
  const v = { user: ev.user, amount: ev.amount.toLocaleString(), months: ev.months, platform: S.platforms[ev.platform] };

  const media = mediaEl(cfg, fill(S.emblems[ev.type], v));
  const video = media.querySelector('video');
  media.append(particles(tier));
  for (let i = 0; i < RINGS[tier]; i++) media.append(h('b', { className: 'ring', style: `--delay:${0.1 + i * 0.22}s` }));
  if (tier >= 2) media.append(h('b', { className: 'glow' }));

  const box = h('div', { className: 'box' }, h('span', { className: 'badge', textContent: v.platform }), text(cfg.template, v));
  if (ev.message) box.append(h('div', { className: 'msg', textContent: ev.message }));
  if (tier === 4) box.append(h('b', { className: 'sweep' }));

  const el = h('div', { className: `alert tier-${tier} type-${ev.type} plat-${ev.platform} pos-${cfg.textPos} frame-${cfg.frame}${cfg.textColor ? ' tc' : ''}` },
    h('div', { className: 'inner' }, media, box));
  el.style.setProperty('--s', SCALE[tier]);
  el.style.setProperty('--fs', `${cfg.fontSize * (grows ? 1 + (tier - 1) * 0.1 : 1)}px`);
  if (cfg.textColor) el.style.setProperty('--tc', cfg.textColor);
  if (cfg.frame === 'custom') {
    el.style.setProperty('--fbg', rgba(cfg.frameBg, cfg.frameOpacity));
    el.style.setProperty('--fbd', cfg.frameBorder);
    el.style.setProperty('--frad', `${cfg.frameRadius}px`);
  }

  stage.append(el);
  const sound = muted ? null : playSound(cfg, ev.type, tier, !!video);
  if (video) {
    video.muted = muted || cfg.videoSound === 'off';
    video.volume = cfg.volume;
    video.play().catch((err) => {
      if (err.name !== 'NotAllowedError') return;
      video.muted = true; // browser blocked sound: play silent rather than not at all
      video.play().catch(() => {});
    });
  }

  await sleep((cfg.duration + (grows ? (tier - 1) * 1.5 : 0)) * 1000);
  if (my !== gen) return;
  el.classList.add('out');
  await sleep(600);
  sound?.pause();
  sounds.delete(sound);
  el.remove();
  await sleep(300);
}

// Custom image/GIF/video, or the theme's CSS-only emblem (e1/e2 are spare layers the themes decorate).
function mediaEl(cfg, label) {
  if (!cfg.image) {
    return h('div', { className: 'media' },
      h('div', { className: 'emblem' }, h('i', { className: 'e1' }), h('i', { className: 'e2' }), h('span', { textContent: label })));
  }
  const src = '/uploads/' + encodeURIComponent(cfg.image.file);
  return h('div', { className: 'media custom' },
    isVideo(cfg.image.file) ? h('video', { muted: true, loop: true, playsInline: true, src }) : h('img', { src, alt: '' }));
}

// Template -> DOM, one span per word so themes can animate words in; variables get .hl. Text only, never innerHTML.
function text(tpl, v) {
  const el = h('div', { className: 'text' });
  let i = 0;
  for (const part of tpl.split(/(\{\w+\}|\s+)/)) {
    if (!part) continue;
    const k = part.slice(1, -1);
    if (!part.trim()) el.append(' ');
    else if (part.startsWith('{') && k in v) el.append(h('span', { className: 'w hl', textContent: v[k], style: `--i:${i++}` }));
    else el.append(h('span', { className: 'w', textContent: part, style: `--i:${i++}` }));
  }
  return el;
}

function playSound(cfg, type, tier, hasVideo) {
  if (cfg.soundMode === 'none' || (hasVideo && cfg.videoSound === 'video')) return null;
  let s;
  if (cfg.soundMode === 'custom' && cfg.sound) {
    s = new Audio('/uploads/' + encodeURIComponent(cfg.sound.file));
    s.volume = cfg.volume;
    s.play().catch(() => {});
  } else {
    s = JarchiSounds.play(settings.theme, type, tier, cfg.volume);
  }
  sounds.add(s);
  return s;
}

// Particles start/end positions (px, relative to the media center); each theme styles their look.
function particles(tier) {
  const fx = h('div', { className: 'fx' });
  const motion = MOTION[settings.theme] ?? 'burst';
  const count = PARTICLES[tier] * (settings.theme === 'minimal' ? 0.4 : 1);
  const r = (a, b) => a + Math.random() * (b - a);
  for (let i = 0; i < count; i++) {
    let sx = 0, sy = 0, ex, ey;
    if (motion === 'burst') {
      const a = r(0, 2 * Math.PI), d = r(120, 380) * SCALE[tier];
      ex = Math.cos(a) * d;
      ey = Math.sin(a) * d;
    } else if (motion === 'fall') {
      sx = r(-760, 760); sy = r(-420, -160); ex = sx + r(-140, 140); ey = sy + r(650, 950);
    } else if (motion === 'rise') {
      sx = r(-540, 540); sy = r(40, 260); ex = sx + r(-100, 100); ey = sy - r(420, 760);
    } else {
      sx = ex = r(-820, 820); sy = ey = r(-200, 460);
    }
    const delay = r(0, 0.6) + (tier === 4 && i % 2 ? 1.2 : 0); // raid fires a second wave
    fx.append(h('i', { style: `--sx:${sx}px;--sy:${sy}px;--ex:${ex}px;--ey:${ey}px;--r:${r(-540, 540)}deg;--z:${r(0.5, 1.3)};--d:${r(1.2, 2.4)}s;--delay:${delay}s;--pc:var(--c${1 + (i % 3)})` }));
  }
  return fx;
}
