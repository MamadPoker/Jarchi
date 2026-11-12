// ---------- Background art (Appearance; jarchi.art, on unless '0') ----------
// Outline icons in the theme's main color and gold, Kick's and Twitch's logos, and the streamer's profile pictures (a
// ring in the platform's color), faint and blurred behind the whole panel (#bgArt; panel.css draws them). Each drifts
// and turns a little, and moves out of the mouse's way. One requestAnimationFrame loop, only while it can be seen.
const ART_ICONS = [
  'M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0zM5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8', // mic
  'M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM16 10.5L22 7v10l-6-3.5', // camera
  'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z', // chat
  HEART,
  TYPE_ICON.sub,
  TYPE_ICON.gift_sub, // heart, star, gift
  'M3 11l18-5v12L3 14zM11.6 16.8a3 3 0 1 1-5.8-1.6', // megaphone
  'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z', // music note
];
const ART_RING = { kick: '#53fc18', twitch: '#9146ff' };
const STILL = matchMedia('(prefers-reduced-motion: reduce)');
const rnd = (a, b) => a + Math.random() * (b - a);
let art = [],
  artPics = [],
  artChannels,
  artMouse = null,
  artFrame = 0,
  artLast = 0,
  area;
// Where the items go: beside the sidebar (all the width on a narrow window, where the sidebar is a bar on top), below
// the top bar, a little in from the edges. Nothing behind the sidebar: it would barely show through.
function artArea() {
  const s = $('.side').getBoundingClientRect(),
    beside = s.bottom >= innerHeight - 1; // down to the bottom (under the app's title bar)
  const x = beside && s.left < innerWidth / 2 ? s.right : 0,
    w = beside ? innerWidth - s.width : innerWidth;
  area = { x: x + 24, y: 70, w: Math.max(1, w - 48), h: Math.max(1, innerHeight - 94) };
}
// Spots for the pictures and the logos, as shares of the area (mirrored in Persian, like the page), on one 4 x 4
// pattern where they take turns like a checkerboard, so the logos sit about 2 cells apart. Pictures: four on each half,
// near the corners and in the middle; the first in the bottom right, below the Home page's narrow column. Logos (their
// own files and colors): Kick also right and bottom, Twitch also left and top.
const FACE_SPOTS = [
  [0.9, 0.88],
  [0.1, 0.12],
  [0.37, 0.38],
  [0.63, 0.12],
  [0.9, 0.38],
  [0.1, 0.62],
  [0.37, 0.88],
  [0.63, 0.62],
];
const LOGO_SPOTS = [
  ['kick', [0.9, 0.12]],
  ['twitch', [0.37, 0.12]],
  ['kick', [0.9, 0.62]],
  ['twitch', [0.1, 0.38]],
  ['kick', [0.63, 0.88]],
  ['twitch', [0.63, 0.38]],
  ['kick', [0.37, 0.62]],
  ['twitch', [0.1, 0.88]],
];
// pics: [[platform, url]...]. 8 logos, 8 pictures (none without a channel: 8 more icons then, so the page is as full and
// the logos keep their spacing) and outline icons, 34 in all. Spread evenly: rows across the area, the items shared out
// between them with no gaps (so corners and edges get some too), each somewhere in the middle of its cell. The logos,
// then the pictures, take the cells nearest their spots (a logo never within 1.4 cells of another); the icons the rest.
function buildArt(pics) {
  artPics = pics;
  const faces = pics.length ? Array.from({ length: 8 }, (_, k) => pics[k % pics.length]) : [];
  const icons = Array.from({ length: 26 - faces.length }, (_, i) => ART_ICONS[i % ART_ICONS.length]);
  const n = LOGO_SPOTS.length + faces.length + icons.length,
    rows = Math.max(1, Math.round(Math.sqrt((n * area.h) / area.w)));
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
      e,
      size,
      u,
      v,
      ox: 0,
      oy: 0,
      rot: rnd(-15, 15), // u, v: the spot, as shares of the area
      ph: [rnd(0, 7), rnd(0, 7), rnd(0, 7)],
      sp: [rnd(1.2, 2.5) / 1e4, rnd(1.2, 2.5) / 1e4, rnd(1.2, 2.5) / 1e4], // slow: 25-50 s a swing
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
      const size = rnd(44, 110),
        depth = (size - 44) / 66;
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
    const x = area.x + a.u * area.w + 14 * Math.sin(t * a.sp[0] + a.ph[0]),
      y = area.y + a.v * area.h + 14 * Math.sin(t * a.sp[1] + a.ph[1]);
    let tx = 0,
      ty = 0; // out of the mouse's way: 70 px when it's right on top, less and less up to 170 px away
    if (artMouse) {
      const dx = x - artMouse.x,
        dy = y - artMouse.y,
        d = Math.hypot(dx, dy) || 1;
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
  api('GET', '/api/streamer').then(
    (r) => {
      const pics = Object.entries(r).filter(([, url]) => url);
      if (JSON.stringify(pics) !== JSON.stringify(artPics)) buildArt(pics);
    },
    () => {},
  );
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
