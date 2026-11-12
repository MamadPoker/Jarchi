// Settings panel. All visible text comes from /i18n/en.json, or /i18n/fa.json in Persian (the "فا | EN" switch).
// The language is the panel's only: overlays, and their previews here, always use en.json.
// Layout: a sidebar with one item per page (a <section data-view>), a top bar with the page's title. Alerts and Goals
// have their own list (LISTS below) next to the editor of the selected item. Previews are the real overlays in scaled iframes: alerts are driven by postMessage, the goal by its own live socket.
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
// Remembered in this browser: the language, the colors.
const remember = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
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
let accent = (() => {
  try {
    return JSON.parse(remember.get('jarchi.accent'));
  } catch {
    return null;
  }
})();
const hslRgb = (h, s, l) => {
  // 0-360, 0-100, 0-100 -> sRGB 0-1
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  return [0, 8, 4].map((n) => {
    const k = (n + h / 30) % 12;
    return l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  });
};
const luminance = (rgb) => rgb.reduce((t, c, i) => t + [0.2126, 0.7152, 0.0722][i] * (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4), 0);
function accentVars(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
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
const readAccent = () =>
  fetch('/api/accent')
    .then((r) => r.json())
    .then((r) => {
      const next = r.accent ? accentVars(r.accent) : null;
      if (JSON.stringify(next) === JSON.stringify(accent)) return;
      accent = next;
      remember.set('jarchi.accent', JSON.stringify(accent));
      applyLook();
    })
    .catch(() => {});
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
const fd = (v, fa = FA) =>
  fa
    ? String(v)
        .replace(/(?<=\d)\.(?=\d)/g, '٫')
        .replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d])
        .replace(/%/g, '٪')
    : String(v);
const fmt = (n) => n.toLocaleString(FA ? 'fa-IR' : undefined);
const ltr = (s) => (FA ? `\u2066${s}\u2069` : s); // an address inside a Persian sentence keeps its order
