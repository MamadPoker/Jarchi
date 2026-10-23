// Goal widget: /widgets/goal/<id> (Kick's subs | kicks | followers, Twitch's twitchSubs | bits | twitchFollowers), transparent page the goal fills (fit()).
// Live (OBS): settings and counts arrive over Socket.IO. ?preview: shown even when the goal is off (panel preview).
// ?thumb: no socket; the panel posts { strings, cfg, state } to draw a style thumbnail.
const params = new URLSearchParams(location.search);
const id = location.pathname.split('/').filter(Boolean)[2];
const root = document.getElementById('goal');
const BLOCKS = 10; // retro bar
const HIDDEN_SPOT = { pill: 'inside', circle: 'below' }; // where the numbers go when the title is hidden
const RING = 200; // goal.css .ring: the Circle style's unit
const WIDE = 1.75; // a source this many times wider than tall (16:9 too) gets the Circle's text beside the ring
let settings, cfg, look = '', state = { current: 0, reached: false }, shown = 0, tween;

const h = (tag, props, ...kids) => {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...kids);
  return el;
};
const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};

if (params.has('thumb')) {
  document.body.classList.add('thumb');
  addEventListener('message', (e) => {
    if (e.origin !== location.origin || !e.data?.cfg) return;
    cfg = e.data.cfg;
    state = e.data.state;
    draw();
  });
} else {
  const socket = io();
  if (!params.has('preview')) socket.on('connect', () => socket.emit('widgetJoin', id)); // the panel's Home: open in OBS
  socket.on('settings', (s) => {
    settings = s;
    const next = s.goals[id];
    if (JSON.stringify(next) === look) return;
    look = JSON.stringify(next);
    cfg = next;
    draw();
  });
  socket.on('goals', (all, reached) => {
    state = all[id];
    update(reached === id);
  });
}

// Build the goal for the current config (style, title position, colors...), then fill in the numbers.
function draw() {
  if (!cfg) return;
  root.hidden = !cfg.enabled && !params.has('preview') && !params.has('thumb');
  const spot = cfg.titlePos === 'hidden' ? HIDDEN_SPOT[cfg.style] ?? 'above' : cfg.titlePos;
  root.className = [
    'goal', `style-${cfg.style}`, `spot-${spot}`, `bg-${cfg.bg}`,
    cfg.border && 'bordered', cfg.titlePos === 'hidden' && 'no-title', !cfg.showNumbers && 'no-nums', !cfg.showPercent && 'no-pct',
  ].filter(Boolean).join(' ');
  const vars = {
    '--bar': cfg.barColor, '--bar-bg': cfg.barBg, '--text': cfg.textColor, '--full': cfg.fullColor,
    '--bg': rgba(cfg.bgColor, cfg.bgOpacity), '--bd': cfg.borderColor, '--bw': `${cfg.borderWidth}px`,
    '--radius': `${cfg.radius}px`, '--font': `"${cfg.font}", "Segoe UI", system-ui, sans-serif`,
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);

  const label = h('div', { className: 'label' }, h('span', { className: 'title', textContent: cfg.title }), h('span', { className: 'nums' }), h('span', { className: 'pct' }));
  let viz = null;
  if (cfg.style === 'circle') viz = ring();
  else if (cfg.style === 'retro') viz = h('div', { className: 'blocks' }, ...Array.from({ length: BLOCKS }, (_, i) => h('i', { style: `--i:${i}` })));
  else if (cfg.style !== 'text') viz = h('div', { className: 'track' }, h('div', { className: 'fill' }));
  if (viz && spot === 'inside') viz.append(label);
  const parts = !viz ? [label] : spot === 'inside' ? [viz] : spot === 'below' ? [viz, label] : [label, viz];
  root.replaceChildren(...parts, h('div', { className: 'fx' }));
  update(false, true);
  fit();
}

// The goal fills the Browser Source: drawn at its own width, its text the biggest size that fits (Auto: the goal is
// then as tall as the source's shape allows, and no text spills out of its bar or ring), or the style's own size when
// that fits; then scaled the same both ways to the source, times Size (50%-100%). Again when the numbers change (below:
// the source's size, fonts, a hidden preview showing).
function fit() {
  if (!cfg || root.hidden || !document.documentElement.offsetWidth || !innerHeight) return; // no layout yet: a hidden preview
  // Circle: the ring is the unit and the text keeps its size to it (Auto: a fifth of the ring), smaller only where it
  // wouldn't fit. A wide source: the ring at its full height, the text beside it no taller; else under it, at most half.
  const shape = innerWidth / innerHeight, circle = cfg.style === 'circle';
  const wide = circle && shape >= WIDE && !root.classList.contains('spot-inside');
  root.classList.toggle('wide', wide);
  root.style.width = circle ? `${RING * (wide ? shape : Math.max(shape, 1))}px` : '';
  const room = !circle ? root.offsetWidth / shape : wide ? RING : RING * 1.5;
  const fits = (fs) => {
    root.style.setProperty('--fs', `${fs}px`);
    return root.offsetHeight <= room + 0.5 && [...root.querySelectorAll('.label, .ring-pct')].every((e) => e.scrollWidth <= e.clientWidth + 1 && e.scrollHeight <= e.clientHeight + 1);
  };
  let lo = 8, hi = cfg.autoSize === false ? cfg.fontSize : circle ? RING / 5 : 200;
  if (!fits(hi)) {
    while (hi - lo > 0.5) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    fits(lo);
  }
  root.style.setProperty('--k', Math.min(innerWidth / root.offsetWidth, innerHeight / root.offsetHeight) * Math.min(cfg.scale ?? 1, 1));
}
// Fit again when the source (or the panel's preview) changes size, when a font has loaded (text measured in the stand-in
// font is off), and when a preview drawn while its page was hidden in the panel comes into view.
addEventListener('resize', fit);
document.fonts.addEventListener('loadingdone', fit);
new IntersectionObserver((seen) => seen.some((e) => e.isIntersecting) && fit()).observe(document.documentElement);

function ring() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  for (const cls of ['ring-bg', 'ring-fill']) {
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', 60);
    c.setAttribute('cy', 60);
    c.setAttribute('r', 52);
    c.setAttribute('pathLength', 100);
    c.setAttribute('class', cls);
    svg.append(c);
  }
  return h('div', { className: 'ring' }, svg, h('div', { className: 'ring-pct' }));
}

// The server's target (Kick's, for a goal synced from Kick), else the goal's own (thumbnails).
const target = () => state.target || cfg.target;

// Show the latest count: bar/ring/blocks via --fill (CSS transitions), numbers count up, celebrate on a fresh hit.
function update(reached = false, instant = false) {
  if (!cfg) return;
  const fill = state.reached ? 1 : Math.min(state.current / target(), 1);
  root.classList.toggle('full', state.reached);
  root.style.setProperty('--fill', fill);
  root.querySelectorAll('.blocks i').forEach((b, i) => b.classList.toggle('on', i < Math.floor(fill * BLOCKS + 1e-9)));
  countTo(state.current, instant);
  if (reached) celebrate();
}

function countTo(to, instant) {
  cancelAnimationFrame(tween);
  const from = shown, start = performance.now(), ms = instant ? 0 : 700;
  const step = (now) => {
    const t = ms ? Math.min((now - start) / ms, 1) : 1;
    shown = Math.round(from + (to - from) * (1 - (1 - t) ** 3));
    writeNumbers(shown);
    if (t < 1) tween = requestAnimationFrame(step);
    else if (!instant) fit(); // a new number can be wider (draw() fits after an instant one)
  };
  step(start);
}

function writeNumbers(n) {
  const nums = `${n.toLocaleString()} / ${target().toLocaleString()}`;
  const pct = `${Math.floor((n / target()) * 100)}%`; // can pass 100% when the count goes over the target
  root.querySelectorAll('.nums').forEach((e) => (e.textContent = nums));
  root.querySelectorAll('.pct, .ring-pct').forEach((e) => (e.textContent = pct));
}

function celebrate() {
  if (cfg.celebrate) {
    root.classList.remove('celebrate');
    void root.offsetWidth; // restart the glow animation
    root.classList.add('celebrate');
    const fx = root.querySelector('.fx');
    const colors = [cfg.fullColor, cfg.barColor, '#ffffff'];
    for (let i = 0; i < 40; i++) {
      const p = h('i');
      p.style.cssText = `--x:${Math.random() * 100}%;--c:${colors[i % 3]};--d:${1.4 + Math.random() * 1.2}s;--delay:${Math.random() * 0.4}s;--r:${Math.random() * 720 - 360}deg`;
      fx.append(p);
    }
    setTimeout(() => fx.replaceChildren(), 3200);
  }
  if (cfg.celebrateSound === 'custom' && cfg.sound) {
    const a = new Audio('/uploads/' + encodeURIComponent(cfg.sound.file));
    a.volume = cfg.volume;
    a.play().catch(() => {});
  } else if (cfg.celebrateSound !== 'none') {
    JarchiSounds.play(settings.theme, 'resub', 3, cfg.volume); // the main theme's sound, as a big moment
  }
}
