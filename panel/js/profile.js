// ---------- Profile: the sidebar's chip and Edit profile ----------
// Name and picture from where the streamer picked (settings.profile). Kick / Twitch only while that account is connected
// (Connections); otherwise Kick's, else Twitch's, else their own: the name typed (or "Streamer"), the picture uploaded
// (or a plain avatar). `cropped`: a picture cropped in Edit profile, not sent yet.
function profileOf(p, cropped) {
  const acc = { kick, twitch };
  const from = (want, own) => [want, 'kick', 'twitch', own].find((s) => s === own || acc[s]?.login);
  const nameFrom = from(p.nameFrom, 'custom'),
    pictureFrom = from(p.pictureFrom, 'upload');
  const picture =
    pictureFrom === 'upload'
      ? cropped || (p.picture && `/uploads/${p.picture.file}`)
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
// from electron/main.js. ready = a downloaded update { version, notes }: the banner (until its ✕ or Restart now, once
// per version: remembered under jarchi.updateClosed), the profile chip's gold dot and its menu's Restart. installed =
// the update Jarchi just came from: What's new opens by itself, once. check (the installed app only): what About's
// Check for updates came to, shown next to it; a downloaded update puts its Restart there instead.
let update = {};
const closeUpdateBar = () => remember.set('jarchi.updateClosed', update.ready.version);
function renderUpdate() {
  const { ready, check } = update;
  $('#updateBar').hidden = !ready || remember.get('jarchi.updateClosed') === ready.version;
  $('#updateDot').hidden = $('#menuUpdate').hidden = $('#aboutRestart').hidden = !ready;
  if (ready) {
    $('#updateText').textContent = tpl(S.panel.updateReady, { version: ready.version });
    $('#menuUpdate span').textContent = $('#aboutRestart').textContent = tpl(S.panel.updateTo, { version: ready.version });
  }
  $('#aboutUpdate').hidden = !check;
  $('#aboutCheck').hidden = !!ready;
  $('#aboutCheck').disabled = check === 'checking' || check === 'downloading';
  $('#aboutCheckText').textContent = (!ready && S.panel[`aboutCheck_${check}`]) || '';
  if (view === 'news') renderNews();
}
function wireUpdate() {
  const app = window.jarchiApp;
  api('GET', '/api/version').then(
    ({ version }) => ($('#menuVersion').textContent = tpl(S.panel.appVersion, { version })),
    () => {},
  );
  $('#updateNotes').onclick = $('#menuNews').onclick = () => select('news');
  if (!app) return;
  $('#updateRestart').onclick =
    $('#menuUpdate').onclick =
    $('#aboutRestart').onclick =
      () => {
        closeUpdateBar();
        app.restart();
      };
  $('#aboutCheck').onclick = () => app.check();
  $('#updateClose').onclick = () => {
    closeUpdateBar();
    renderUpdate();
  };
}
// A dev run (npm start, npm run app) doesn't update itself: core/release.js says when a newer Jarchi is out
// ({ version, url }, by socket). Its ✕ closes it for this session only (sessionStorage): every start shows it again
// until the copy is updated. The installed app never gets one.
let devUpdate = null;
const DEV_CLOSED = 'jarchi.devUpdateClosed';
function renderDevUpdate() {
  let closed = null;
  try {
    closed = sessionStorage.getItem(DEV_CLOSED);
  } catch {}
  $('#devUpdateBar').hidden = !devUpdate || closed === devUpdate.version;
  if (devUpdate) $('#devUpdateText').textContent = tpl(S.panel.devUpdateText, { version: devUpdate.version });
}
function wireDevUpdate() {
  $('#devUpdateDownload').onclick = () => window.open(devUpdate.url, '_blank', 'noopener');
  $('#devUpdateClose').onclick = () => {
    try {
      sessionStorage.setItem(DEV_CLOSED, devUpdate.version);
    } catch {}
    renderDevUpdate();
  };
}

// From the startup, once its first page is open (that would replace What's new).
function followUpdates() {
  const app = window.jarchiApp;
  app?.onUpdate((s) => {
    update = s;
    if (s.installed) {
      select('news');
      app.seen();
    }
    renderUpdate();
  });
}

// ---------- What's new ----------
// Its own page: every version's changes, newest first, from i18n/changelog.json (this copy's), under a downloaded
// update's own (its release notes) until Restart installs it. In the panel's language first; the switch shows the
// other, Persian right to left. Each line has its type's icon (changelog.json's types, the same for both languages); a
// line without one (older notes, a downloaded update's) has a small dot.
const NEWS_ICON = {
  feature:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5c.7 4.3 2.7 6.3 7 7-4.3.7-6.3 2.7-7 7-.7-4.3-2.7-6.3-7-7 4.3-.7 6.3-2.7 7-7z"/><path d="M18.5 2.5v5M16 5h5"/></svg>',
  improve:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/></svg>',
  fix: CAT_ICON.bug,
  security:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z"/><path d="M8.8 12.2l2.2 2.2 4.2-4.4"/></svg>',
};
const newsIcon = (t, P) =>
  NEWS_ICON[t]
    ? Object.assign(svgIn(`nt nt-${t}`, NEWS_ICON[t]), { role: 'img', title: P[`news_${t}`], ariaLabel: P[`news_${t}`] })
    : el('span', { className: 'nt' });
let changelog, newsLang;
async function renderNews(lang = newsLang) {
  newsLang = lang;
  const P = (await stringsOf(lang)).panel,
    { ready } = update,
    box = $('#newsList');
  const list =
    ready && !changelog.some((c) => c.version === ready.version) ? [{ ...ready.notes, version: ready.version, ready: true }, ...changelog] : changelog;
  $$('input[name=newsLang]').forEach((r) => (r.checked = r.value === lang));
  Object.assign(box, { lang, dir: lang === 'fa' ? 'rtl' : 'ltr' });
  box.replaceChildren(
    ...list.map((c) =>
      el(
        'article',
        { className: 'box news-item' },
        el(
          'div',
          { className: 'row' },
          el('h2', { textContent: `v${c.version}` }),
          c.ready ? el('span', { className: 'pill news-ready', textContent: P.updateInstall }) : '',
        ),
        el('ul', {}, ...c[lang].map((s, i) => el('li', {}, newsIcon(c.types?.[i], P), el('span', { textContent: s })))),
      ),
    ),
  );
}
