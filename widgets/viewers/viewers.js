// Viewers widget: /widgets/viewers/<kick | twitch | total> (Kick's and Twitch's added up), a transparent page the
// count fills (fit()), like the goal. Live (OBS): settings and the counts (core/viewers.js, every 30 s) arrive over
// Socket.IO. ?preview: the panel's live preview, which also takes { test: true } (a made-up change of the count, to see
// its animation). ?thumb: no socket; the panel posts { cfg } to draw a style thumbnail with sample numbers.
const params = new URLSearchParams(location.search);
const source = location.pathname.split('/').filter(Boolean)[2] || 'total';
const root = document.getElementById('viewers');
// The user's Custom CSS (Advanced box), after the page's own CSS so it wins. Set as text, never as HTML.
const userCss = document.head.appendChild(document.createElement('style'));
const LOGOS = { kick: ['kick'], twitch: ['twitch'], total: ['kick', 'twitch'] };
// Icons, colored by viewers.css. Kick's and Twitch's are the shapes of their official logos (assets/platform-logos).
const ICONS = {
  people: '<svg class="outline" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/></svg>',
  eye: '<svg class="outline" viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  kick: '<svg class="kick" viewBox="0 0 26 26"><path fill-rule="evenodd" d="M1 0H9.76711V5.79452H12.589V2.82193H15.5616V0H24.1781V8.61645H21.3561V11.589H18.3836V14.411H21.3561V17.3836H24.1781V26H15.5616V23.1781H12.589V20.2055H9.76711V26H1V0Z"/></svg>',
  twitch: '<svg class="twitch" viewBox="0 0 2400 2800"><polygon class="i" points="2200,1300 1800,1700 1400,1700 1050,2050 1050,1700 600,1700 600,200 2200,200"/><path class="f" d="M500,0L0,500v1800h600v500l500-500h400l900-900V0H500z M2200,1300l-400,400h-400l-350,350v-350H600V200h1600V1300z"/><rect class="e" x="1700" y="550" width="200" height="600"/><rect class="e" x="1150" y="550" width="200" height="600"/></svg>',
};
const CHART = '<svg class="chart" viewBox="0 0 100 30" preserveAspectRatio="none"><path class="area"/><path class="line"/></svg>';
const SWITCH_MS = 4000; // the "Switch" icon: the next one this often
const SAMPLE = 1234; // thumbnails, and where Test starts while not live
// A made-up last 15 minutes ending at n, one point per 30 s.
const sampleHistory = (n, t = Date.now()) => Array.from({ length: 31 }, (_, i) => [t - (30 - i) * 30000, Math.max(0, n - (30 - i) * 7 + Math.round(35 * Math.sin((30 - i) / 1.6)))]);

let strings = {}, cfg, look = '', real = { kick: null, twitch: null, history: [] }, fake = null, text = '';

const h = (tag, props, ...kids) => {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...kids);
  return el;
};
const svg = (markup) => {
  const t = document.createElement('template');
  t.innerHTML = markup; // fixed markup only
  return t.content.firstChild;
};

if (params.has('thumb')) {
  document.body.classList.add('thumb');
  fake = { live: true, viewers: SAMPLE, history: sampleHistory(SAMPLE), until: Infinity };
  addEventListener('message', (e) => {
    if (e.origin !== location.origin || !e.data?.cfg) return;
    cfg = e.data.cfg;
    draw();
  });
} else {
  const socket = io();
  socket.on('connect', () => socket.emit('viewersJoin')); // the counts are asked while a viewers page is open
  socket.on('strings', (s) => {
    strings = s;
    update();
  });
  socket.on('settings', (s) => {
    const next = s.viewers;
    if (userCss.textContent !== next.customCss) {
      userCss.textContent = next.customCss;
      fit();
    }
    const now = JSON.stringify({ ...next, customCss: '' }); // the CSS alone needs no redraw
    if (now === look) return;
    look = now;
    cfg = next;
    draw();
  });
  socket.on('viewers', (st) => {
    real = st;
    update();
  });
  if (params.has('preview')) addEventListener('message', (e) => e.origin === location.origin && e.data?.test && test());
}

// This page's count: one platform's, or both added up (live while either is).
const total = (s) => {
  const on = [s.kick, s.twitch].filter((p) => p?.live);
  return { live: on.length > 0, viewers: on.reduce((n, p) => n + p.viewers, 0) };
};
const valueAt = (e) => (source === 'kick' ? e[1] : source === 'twitch' ? e[2] : e[1] === null && e[2] === null ? null : (e[1] ?? 0) + (e[2] ?? 0));
// What's shown: { live, viewers, history: [[time, count or null (not live)]] }. The real numbers, or made-up ones: a
// thumbnail's, or the Test's (for a minute after the last click).
function data() {
  if (fake && Date.now() < fake.until) return fake;
  const now = (source === 'total' ? total(real) : real[source]) ?? { live: false, viewers: 0 };
  return { ...now, history: real.history.map((e) => [e[0], valueAt(e)]) };
}

// Test (the panel's preview): the count goes up (sometimes down) a little, from the real one while live.
function test() {
  const d = data(), from = d.live ? d.viewers : SAMPLE;
  const step = Math.ceil(Math.random() * Math.max(5, from * 0.06)) * (Math.random() < 0.75 ? 1 : -1);
  const n = Math.max(0, from + step) === from ? from + 1 : Math.max(0, from + step);
  const history = d.live && d.history.length ? d.history : sampleHistory(from);
  const now = Date.now(); // the chart's newest point is now, the one before it from 30 s back, as if asked again
  fake = { live: true, viewers: n, history: [...history.filter((p) => p[0] < now - 25000), [now, n]], until: now + 60000 };
  update();
}

// Build the widget for the current style, then fill in the count.
function draw() {
  if (!cfg) return;
  root.className = `viewers style-${cfg.style} src-${source} anim-${cfg.anim}`;
  const vars = { '--num': cfg.numberColor, '--bg': cfg.bgColor, '--accent': cfg.accentColor, '--font': `"${cfg.font}", "Segoe UI", system-ui, sans-serif` };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  const num = h('span', { className: 'num' });
  const icons = cfg.icon === 'switch' ? ['people', ...LOGOS[source]] : [cfg.icon];
  const parts = {
    gold: () => [h('div', { className: 'card' }, h('div', { className: 'icon' }, ...icons.map((i) => svg(ICONS[i]))), num)],
    chart: () => [h('div', { className: 'card' }, num, svg(CHART))],
    angled: () => [h('div', { className: 'block' }, svg(ICONS[source === 'total' ? 'people' : source])), h('div', { className: 'bar' }, num)],
    comic: () => [h('div', { className: 'bubble' }, svg(ICONS.eye), num)],
  }[cfg.style]();
  root.replaceChildren(...parts);
  root.querySelector('.icon > svg')?.classList.add('on');
  text = '';
  update();
}

// Show the latest count (or Offline / nothing while not live).
function update() {
  if (!cfg) return;
  const d = data();
  root.classList.toggle('offline', !d.live);
  root.hidden = !d.live && cfg.offline === 'hide' && !params.has('thumb');
  setNumber(d.live ? d.viewers.toLocaleString('en-US') : strings.viewersText?.offline ?? 'Offline');
  if (cfg.style === 'chart') drawChart(d);
  fit();
}

// The number changes with the chosen animation: Roll, Flip and Fade move only the digits that changed (Roll: up when
// the count goes up), Pop bounces the whole number. Offline <-> a count just changes.
function setNumber(next) {
  const num = root.querySelector('.num'), prev = text;
  if (next === prev) return;
  text = next;
  const count = (s) => /^[\d,]+$/.test(s);
  if (!count(prev) || !count(next)) return (num.textContent = next);
  if (cfg.anim === 'pop') {
    num.textContent = next;
    num.classList.remove('popping');
    void num.offsetWidth; // restart the animation
    return num.classList.add('popping');
  }
  const was = [...prev].reverse(), n = (s) => Number(s.replace(/,/g, ''));
  num.style.setProperty('--dir', n(next) > n(prev) ? 1 : -1);
  num.replaceChildren(...[...next].reverse().map((ch, i) => (ch === was[i] ? ch
    : h('span', { className: 'd' }, h('span', { className: 'now', textContent: ch }), ...(was[i] ? [h('span', { className: 'was', textContent: was[i] })] : [])))).reverse());
}

// Live chart: the count over the last 10 or 15 minutes, scaled to its lowest and highest there; a gap where it wasn't live.
function drawChart(d) {
  const span = cfg.chartMinutes * 60000, end = Date.now(), start = end - span;
  const pts = d.history.filter((p) => p[0] >= start);
  if (d.live) pts.push([end, d.viewers]); // the line reaches now
  const vals = pts.map((p) => p[1]).filter((v) => v !== null);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const x = (t) => (((t - start) / span) * 100).toFixed(2), y = (v) => (hi === lo ? 15 : 27 - ((v - lo) / (hi - lo)) * 24).toFixed(2);
  let line = '', area = '', run = [];
  const flush = () => {
    if (run.length > 1) {
      const path = run.map((p, i) => `${i ? 'L' : 'M'}${x(p[0])} ${y(p[1])}`).join('');
      line += path;
      area += `${path}L${x(run[run.length - 1][0])} 30L${x(run[0][0])} 30Z`;
    }
    run = [];
  };
  for (const p of pts) p[1] === null ? flush() : run.push(p);
  flush();
  root.querySelector('.chart .line').setAttribute('d', line);
  root.querySelector('.chart .area').setAttribute('d', area);
}

// The widget fills the Browser Source: drawn at its own size, then scaled the same both ways to the source, times Size
// (50%-100%). Again when the count gets wider, the source's size changes, a font has loaded, or a hidden preview shows.
function fit() {
  if (!cfg || root.hidden || !document.documentElement.offsetWidth || !innerHeight) return; // no layout yet: a hidden preview
  root.style.setProperty('--k', Math.min(innerWidth / root.offsetWidth, innerHeight / root.offsetHeight) * Math.min(cfg.size ?? 1, 1));
}
addEventListener('resize', fit);
document.fonts.addEventListener('loadingdone', fit);
new IntersectionObserver((seen) => seen.some((e) => e.isIntersecting) && fit()).observe(document.documentElement);

// "Switch": the people icon and the platform's logo (Total: both logos) take turns.
setInterval(() => {
  const icons = [...root.querySelectorAll('.icon > svg')];
  const i = icons.findIndex((s) => s.classList.contains('on'));
  if (icons.length < 2 || i < 0) return;
  icons[i].classList.remove('on');
  icons[(i + 1) % icons.length].classList.add('on');
}, SWITCH_MS);
