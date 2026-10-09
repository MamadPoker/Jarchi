// Alerts overlay: receives normalized events, queues them, plays one at a time. Socket.IO reconnects on its own.
const socket = io();
const stage = document.getElementById('stage');
const queue = [];
let settings, S, busy = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const h = (tag, props, ...kids) => {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...kids);
  return el;
};
const fill = (tpl, v) => tpl.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));

socket.on('strings', (s) => {
  S = s;
  document.documentElement.lang = s.lang;
  document.documentElement.dir = s.dir;
});
socket.on('settings', (s) => {
  settings = s;
  document.body.dataset.theme = s.theme;
});
socket.on('event', (ev) => {
  const cfg = settings?.alerts[ev.type];
  if (!cfg || !S) return;
  if (!ev.test && (!cfg.enabled || ev.amount < (cfg.minAmount ?? 0))) return; // test button always plays
  queue.push(ev);
  playNext();
});

// ponytail: unbounded queue; cap or collapse it if a connector ever floods events
async function playNext() {
  if (busy || !queue.length) return;
  busy = true;
  try { await show(queue.shift()); } catch (err) { console.error(err); }
  busy = false;
  playNext();
}

async function show(ev) {
  const cfg = settings.alerts[ev.type];
  const v = { user: ev.user, amount: ev.amount.toLocaleString(), months: ev.months, platform: S.platforms[ev.platform] };

  const el = h('div', { className: `alert plat-${ev.platform}` },
    media(cfg, fill(S.emblems[ev.type], v)),
    h('div', { className: 'box' },
      h('span', { className: 'badge', textContent: S.platforms[ev.platform] }),
      text(cfg.template, v),
      ...(ev.message ? [h('div', { className: 'msg', textContent: ev.message })] : [])));
  if (settings.theme === 'fun' && !cfg.image) el.append(confetti());

  stage.append(el);
  const audio = playSound(cfg, ev.type);
  await sleep(cfg.duration * 1000);
  el.classList.add('out');
  await sleep(600);
  audio?.pause();
  el.remove();
  await sleep(300);
}

// Custom image/GIF/webm, or the theme's CSS-only emblem.
function media(cfg, label) {
  if (!cfg.image) return h('div', { className: 'media' }, h('div', { className: 'emblem' }, h('span', { textContent: label })));
  const src = '/uploads/' + encodeURIComponent(cfg.image.file);
  const m = cfg.image.file.endsWith('.webm')
    ? h('video', { muted: true, autoplay: true, loop: true, playsInline: true, src })
    : h('img', { src, alt: '' });
  return h('div', { className: 'media custom' }, m);
}

// Template -> DOM with variables wrapped in highlight spans. Text only, never innerHTML.
function text(tpl, v) {
  const el = h('div', { className: 'text' });
  for (const part of tpl.split(/(\{\w+\})/)) {
    const k = part.slice(1, -1);
    el.append(part.startsWith('{') && k in v ? h('span', { className: 'hl', textContent: v[k] }) : part);
  }
  return el;
}

function playSound(cfg, type) {
  if (!cfg.sound) return JarchiSounds.play(settings.theme, type, cfg.volume);
  const a = new Audio('/uploads/' + encodeURIComponent(cfg.sound.file));
  a.volume = cfg.volume;
  a.play().catch(() => {});
  return a;
}

function confetti() {
  const colors = ['#ff5fa2', '#ffd93d', '#4fd1ff', '#7dff6b', '#a46bff'];
  const box = h('div', { className: 'confetti' });
  for (let i = 0; i < 48; i++) {
    const p = h('i');
    p.style.cssText = `--x:${Math.random() * 100}%;--c:${colors[i % colors.length]};--d:${1.6 + Math.random() * 1.6}s;--delay:${Math.random() * 0.8}s;--r:${Math.random() * 360}deg`;
    box.append(p);
  }
  return box;
}
