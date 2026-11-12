// ---------- Crypto alerts (the Crypto page's Alert settings tab) ----------
// The card that plays (Jarchi's two designs, drawn by the real overlay in each card, or Your own alert), the two
// designs' sound (theirs or an upload) and duration, a test, and the amount alerts (the highest a donation reaches plays
// instead). Your own alert and each amount alert are looks, edited in #cryptoLook with a live preview. Every change is
// saved at once (send()), files like the other alerts' (wireFile).
const CRYPTO_SECONDS = [6, 8, 10, 15];
let cryptoTab = ['alerts', 'page'].includes(remember.get('jarchi.cryptoTab')) ? remember.get('jarchi.cryptoTab') : 'donations',
  lookOpen = null; // lookOpen: 'custom' | an amount alert's id
const cryptoEvent = (look, amount = '25.0000') => ({
  type: 'crypto',
  id: 'preview',
  user: 'Jarchi',
  amount,
  network: 'bep20',
  message: EN.test.message,
  txHash: `0x${'8f3a'.repeat(15)}c21d`,
  look,
});
const cryptoTest = (look) =>
  api('POST', '/api/crypto/test', { look }).then(
    () => toast(S.panel.testSent),
    (err) => toast(err.message, true),
  );
const lookOf = (id) => (id === 'custom' ? settings.crypto.custom : settings.crypto.tiers.find((t) => t.id === id));
const upFile = (f) => `/uploads/${encodeURIComponent(f.file)}`;
function fileRow(row, f, none) {
  const name = $('.fname', row);
  name.textContent = f ? f.name : none;
  name.classList.toggle('default', !f);
  $('.remove', row).hidden = !f;
}
const seconds = (sel, v) =>
  sel.replaceChildren(...[...new Set([...CRYPTO_SECONDS, v])].sort((a, b) => a - b).map((n) => new Option(fd(tpl(S.panel.seconds, { n })), n, false, n === v)));

function showCryptoTab(tab) {
  cryptoTab = tab;
  remember.set('jarchi.cryptoTab', tab);
  $$('.crypto-tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  $('#cryptoDonations').hidden = tab !== 'donations';
  $('#cryptoPop').hidden = tab !== 'donations';
  $('#cryptoView').hidden = tab !== 'page';
  $('#cryptoAlertsTab').hidden = tab !== 'alerts';
  $('#cryptoPageTab').hidden = tab !== 'page';
  if (tab === 'page') {
    if (!cryptoPage) loadCryptoPage();
    renderCryptoPage();
    drawBanner();
  }
  if (tab !== 'alerts') return;
  $$('.crypto-mini iframe').forEach((f) => f.src || (f.src = '/widgets/alerts/?preview=tile')); // loaded once: onload draws the design
  renderCryptoAlerts();
}

function renderCryptoAlerts() {
  const c = settings.crypto,
    own = c.design === 'custom';
  $$('[name=cryptoDesign]').forEach((r) => (r.checked = r.value === c.design));
  $$('#cryptoAlertsTab [data-only]').forEach((e) => (e.hidden = (e.dataset.only === 'own') !== own));
  fileRow($('#cryptoSoundRow'), c.sound, S.panel.cryptoSoundDesign);
  seconds($('#cryptoDur'), c.duration);
  $('#cryptoTiers').replaceChildren(
    ...c.tiers.map((t) =>
      el(
        'li',
        { className: 'crypto-tier' },
        lookThumb(t),
        el(
          'span',
          { className: 'stack' },
          el('b', { textContent: tpl(S.panel.cryptoTierFrom, { amount: t.min }) }),
          el('small', { textContent: lookSummary(t) }),
        ),
        el('button', { className: 'ghost', textContent: '▶', title: S.panel.testObs, ariaLabel: S.panel.testObs, onclick: () => cryptoTest(t.id) }),
        el('button', { className: 'ghost', textContent: S.panel.cryptoEdit, onclick: () => openLook(t.id) }),
      ),
    ),
  );
  if (lookOpen) renderLook();
}
const lookSummary = (l) =>
  [
    l.image ? S.panel.cryptoImageYours : S.panel.cryptoImageCoin,
    l.sound ? S.panel.cryptoSoundYours : S.panel.cryptoSoundDefault,
    tpl(S.panel.cryptoFontIs, { font: l.font }),
  ].join(' · ');
const lookThumb = (l) =>
  el(
    'span',
    { className: 'crypto-thumb' },
    !l.image
      ? el('img', { src: '/assets/brand/jarchi-pay-coin.webp', alt: '' })
      : isVideo(l.image.file)
        ? el('video', { muted: true, src: upFile(l.image) })
        : el('img', { src: upFile(l.image), alt: '' }),
  );

// The editor: a look's fields and files, and its preview (the real overlay, held on screen; Play preview with sound).
function openLook(id) {
  lookOpen = id;
  const d = $('#cryptoLook');
  if (!d.open) d.showModal();
  renderLook();
}
function renderLook() {
  const l = lookOf(lookOpen);
  if (!l) return $('#cryptoLook').close(); // deleted (an undo, another window)
  const tier = lookOpen !== 'custom';
  $('#cryptoLookTitle').textContent = tier ? tpl(S.panel.cryptoEditTier, { amount: l.min }) : S.panel.cryptoEditOwn;
  $$('#cryptoLook [data-only=tier]').forEach((e) => (e.hidden = !tier));
  if ($('#cryptoLookMin') !== document.activeElement) $('#cryptoLookMin').value = l.min ?? '';
  fileRow($('#cryptoLook .file[data-kind=image]'), l.image, S.panel.cryptoImageCoin);
  fileRow($('#cryptoLook .file[data-kind=sound]'), l.sound, S.panel.cryptoSoundDefault);
  $$('[name=cryptoPos]').forEach((r) => (r.checked = r.value === l.pos));
  $$('[name=cryptoFont]').forEach((r) => (r.checked = r.value === l.font));
  seconds($('#cryptoLookDur'), l.duration);
  playLook(true);
}
function playLook(muted) {
  const f = $('#cryptoLookPreview'),
    go = () => post(f, settings, cryptoEvent(lookOpen, String(lookOf(lookOpen)?.min ?? '25.0000')), muted, true);
  if (f.src) go();
  else {
    f.onload = go;
    f.src = '/widgets/alerts/?preview';
  }
}
const patchLook = (fields) => send('PATCH', `/api/crypto/looks/${lookOpen}`, fields);

function wireCryptoAlerts() {
  $$('.crypto-tabs button').forEach((b) => (b.onclick = () => showCryptoTab(b.dataset.tab)));
  $$('.crypto-mini iframe').forEach((f) => (f.onload = () => post(f, settings, cryptoEvent(f.dataset.look), true, true)));
  $$('[name=cryptoDesign]').forEach((r) => (r.onchange = () => send('PATCH', '/api/settings', { crypto: { design: r.value } })));
  $('#cryptoOwnCard').onclick = () => openLook('custom'); // picking Your own alert opens it, and so does a click once it's picked
  $('#cryptoOwnEdit').onclick = () => openLook('custom');
  $('#cryptoDur').onchange = (e) => send('PATCH', '/api/settings', { crypto: { duration: Number(e.target.value) } });
  $('#cryptoTestBtn').onclick = () => cryptoTest(settings.crypto.design);
  $('#cryptoTierAdd').onclick = () =>
    api('POST', '/api/crypto/tiers', { min: (settings.crypto.tiers.at(-1)?.min ?? 25) * 2 }).then(
      ({ settings: s, id }) => {
        settings = s;
        render();
        openLook(id);
      },
      (err) => toast(err.message, true),
    );
  $('#cryptoSoundRow input[type=file]').accept = ACCEPT.sound;
  wireFile(
    $('#cryptoSoundRow'),
    () => '/api/crypto/files/main/sound',
    () => '/api/crypto/files/main/sound',
  );

  const d = $('#cryptoLook');
  for (const row of $$('.file', d)) {
    $('input[type=file]', row).accept = ACCEPT[row.dataset.kind];
    wireFile(
      row,
      () => `/api/crypto/files/${lookOpen}/${row.dataset.kind}`,
      () => `/api/crypto/files/${lookOpen}/${row.dataset.kind}`,
    );
  }
  $('#cryptoLookMin').onchange = (e) => {
    const min = Math.round(Number(e.target.value) * 100) / 100;
    if (min >= 0.01) patchLook({ min });
    else renderLook();
  };
  $$('[name=cryptoPos]').forEach((r) => (r.onchange = () => patchLook({ pos: r.value })));
  $$('[name=cryptoFont]').forEach((r) => (r.onchange = () => patchLook({ font: r.value })));
  $('#cryptoLookDur').onchange = (e) => patchLook({ duration: Number(e.target.value) });
  $('#cryptoLookPlay').onclick = () => playLook(false);
  $('#cryptoLookTest').onclick = () => cryptoTest(lookOpen);
  twoClick($('#cryptoLookDelete'), $('#cryptoLookDelete'), S.panel.cryptoTierDelete, S.panel.confirmResetAll, () => {
    const id = lookOpen;
    d.close();
    send('DELETE', `/api/crypto/tiers/${id}`);
  });
  $('#cryptoLookDone').onclick = () => d.close();
  d.addEventListener('close', () => {
    lookOpen = null;
    const f = $('#cryptoLookPreview');
    if (f.src) f.src = f.src; // eslint-disable-line no-self-assign -- a long sound of the last preview stops
  });
}

// Settings > Uninstall Jarchi: only in the installed app (electron/main.js says whether its uninstaller is there; not
// with `npm run app`, and a browser has no window.jarchiApp). The uninstaller is told whether to keep the data.
function wireUninstall() {
  const app = window.jarchiApp,
    d = $('#uninstallDialog');
  if (!app) return;
  app.installed().then((on) => ($('#uninstall').hidden = !on));
  $('#uninstall').onclick = () => {
    $('#uninstallKeep').checked = true;
    $('#uninstallGo').disabled = false;
    d.showModal();
  };
  $('#uninstallCancel').onclick = () => d.close();
  $('#uninstallGo').onclick = (e) => {
    e.currentTarget.disabled = true; // Jarchi quits now
    app.uninstall($('#uninstallKeep').checked);
  };
}

// Settings > Developer: only in dev runs (/api/version's dev; the server has no such route otherwise). "Test as if Kick
// were blocked": the VPN help (core/vpn.js) runs as if Kick couldn't be reached; its popup comes by socket as usual.
function wireDev() {
  api('GET', '/api/version').then(
    ({ dev }) => ($('#devBox').hidden = !dev),
    () => {},
  );
  $('#devKickBlocked').onclick = () => api('POST', '/api/dev/kick-blocked').catch((err) => toast(err.message, true));
}

let draft, crop; // Edit profile: the profile being edited, the picture being cropped { img, zoom, x, y, out, url }
function renderProfileDialog() {
  const d = $('#profileDialog'),
    pr = profileOf(draft, crop?.url),
    acc = { kick, twitch };
  paintChip($('#profilePreview'), pr);
  let off = false;
  $$('input[type=radio]', d).forEach((r) => {
    r.disabled = r.value in acc && !acc[r.value].login;
    off ||= r.disabled;
    r.checked = r.value === pr[r.name];
  });
  $('#profileHint').hidden = !off;
  $('#profileName').hidden = pr.nameFrom !== 'custom';
  $('#profileUpload').hidden = pr.pictureFrom !== 'upload';
  $('#cropBox').hidden = $('#cropZoom').hidden = $('#cropHint').hidden = !crop;
}

// The picture in the round frame: zoom 1 = it just covers the frame, and it can be dragged anywhere that still covers
// it. What's inside the circle is the picture (round, transparent corners).
function drawCrop() {
  const c = $('#cropCanvas'),
    n = c.width,
    { img } = crop;
  const s = (n / Math.min(img.naturalWidth, img.naturalHeight)) * crop.zoom,
    w = img.naturalWidth * s,
    h = img.naturalHeight * s;
  crop.x = Math.max((n - w) / 2, Math.min((w - n) / 2, crop.x));
  crop.y = Math.max((n - h) / 2, Math.min((h - n) / 2, crop.y));
  const g = c.getContext('2d');
  g.clearRect(0, 0, n, n);
  g.drawImage(img, (n - w) / 2 + crop.x, (n - h) / 2 + crop.y, w, h);
  const out = el('canvas', { width: n, height: n }),
    o = out.getContext('2d');
  o.beginPath();
  o.arc(n / 2, n / 2, n / 2, 0, 2 * Math.PI);
  o.clip();
  o.drawImage(c, 0, 0);
  Object.assign(crop, { out, url: out.toDataURL() });
  renderProfileDialog();
}

function wireProfile() {
  const d = $('#profileDialog'),
    canvas = $('#cropCanvas'),
    err = $('#profileErr');
  $$('.avatar img').forEach((img) => (img.onerror = () => (img.hidden = true)));
  $('#profileName').placeholder = S.panel.profileDefault;
  wireMenu($('#profileChip'), $('#profileMenu')); // its other items: wireUpdate
  $('#menuProfile').onclick = () => {
    draft = { ...settings.profile };
    crop = null;
    $('#profileName').value = draft.name;
    err.hidden = true;
    renderProfileDialog();
    d.showModal();
  };
  d.onclose = () => (crop = null);
  $('#profileCancel').onclick = () => d.close();
  $$('input[type=radio]', d).forEach(
    (r) =>
      (r.onchange = () => {
        draft[r.name] = r.value;
        renderProfileDialog();
      }),
  );
  $('#profileName').oninput = (e) => {
    draft.name = e.target.value;
    draft.nameFrom = 'custom'; // shown because nothing is connected: typing picks it
    renderProfileDialog();
  };
  $('#profileChoose').onclick = () => $('#profileFile').click();
  $('#profileFile').onchange = (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      crop = { img, zoom: 1, x: 0, y: 0 };
      draft.pictureFrom = 'upload';
      $('#cropZoom').value = 1;
      err.hidden = true;
      drawCrop();
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      err.textContent = S.errors.bad_type;
      err.hidden = false;
    };
    img.src = URL.createObjectURL(f);
  };
  canvas.onpointerdown = (e) => {
    if (!crop) return;
    canvas.setPointerCapture(e.pointerId);
    const k = canvas.width / canvas.clientWidth,
      start = { x: e.clientX, y: e.clientY, cx: crop.x, cy: crop.y };
    canvas.onpointermove = (m) => {
      crop.x = start.cx + (m.clientX - start.x) * k;
      crop.y = start.cy + (m.clientY - start.y) * k;
      drawCrop();
    };
  };
  canvas.onpointerup = canvas.onpointercancel = () => (canvas.onpointermove = null);
  $('#cropZoom').oninput = (e) => {
    crop.zoom = Number(e.target.value);
    drawCrop();
  };
  // Save: the new picture first (it's selected then), then where the name and picture come from.
  $('#profileSave').onclick = async (e) => {
    e.currentTarget.disabled = true;
    try {
      if (crop && draft.pictureFrom === 'upload') {
        const png = await new Promise((r) => crop.out.toBlob(r, 'image/png'));
        await api('POST', '/api/profile/picture', png, { 'content-type': 'image/png', 'x-filename': 'profile.png' });
      }
      d.close();
      send('PATCH', '/api/settings', { profile: { nameFrom: draft.nameFrom, name: draft.name.trim(), pictureFrom: draft.pictureFrom } });
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
    $('#profileSave').disabled = false;
  };
}

function renderGoal() {
  const ed = $('main [data-view=goal]');
  const g = settings.goals[curGoal];
  ed.dataset.key = ed.dataset.goal = curGoal;
  $('.title .goal-icon', ed).innerHTML = GOAL_ICON[curGoal]; // fixed markup
  $('.name', ed).textContent = goalName(curGoal);
  $('#goalCounts').textContent = S.goals[curGoal].counts;
  $('#goalTest span').textContent = S.goals[curGoal].test;
  fill(ed, g);
  $$('[name=goalSizeMode]').forEach((r) => (r.checked = (r.value === 'auto') === g.autoSize));
  // Synced from Kick / Twitch: their count and target, read-only (no −, +, Test or Reset to 0).
  const st = goalData.state[curGoal],
    synced = st.kick || st.twitch,
    target = $('[data-f=target]', ed);
  if (synced) target.value = st.target;
  target.readOnly = $('#goalCurrent').readOnly = synced;
  $('#goalMinus').disabled = $('#goalPlus').disabled = $('#goalTest').disabled = synced;
  if (document.activeElement !== $('#goalCurrent')) $('#goalCurrent').value = st.current;
  $('#goalPlus').title = fd(`+${GOAL_STEP[curGoal]}`);
  $('#goalMinus').title = fd(`−${GOAL_STEP[curGoal]}`);
  $$('.goal-tile').forEach((t) => t.classList.toggle('selected', t.dataset.style === g.style));
  drawThumbs();

  const show = {
    off: !g.enabled,
    goalBox: g.style !== 'circle',
    bgColor: g.bg === 'color',
    box: g.bg !== 'off',
    borderOn: g.bg !== 'off' && g.border,
    goalCustomSound: g.celebrateSound === 'custom',
    customSize: !g.autoSize,
    fromKick: st.kick,
    fromTwitch: st.twitch,
    manual: !synced,
  };
  $$('[data-only]', ed).forEach((e) => (e.hidden = !show[e.dataset.only]));
  $('.more-grid', ed).classList.toggle('three', show.goalBox); // Circle: two cards, no empty third column
  const fname = $('.file .fname', ed);
  fname.textContent = g.sound ? g.sound.name : S.panel.soundNoFile;
  fname.classList.toggle('default', !g.sound);
  $('.file .remove', ed).hidden = !g.sound;
}

// The Viewers page. Its links: a hint and Connect while that account isn't connected (Total: while neither is).
function renderViewers() {
  const ed = $('main [data-view=viewers]'),
    v = settings.viewers;
  fill(ed, v);
  $$('.viewers-tile').forEach((t) => t.classList.toggle('selected', t.dataset.style === v.style));
  // Jarchi gold: Jarchi's own colors, no pickers. Angled bar has no border or line.
  const show = { icon: v.style === 'gold', colors: v.style !== 'gold', chart: v.style === 'chart', accent: v.style !== 'angled' };
  $$('[data-only]', ed).forEach((e) => (e.hidden = !show[e.dataset.only]));
  $('#viewersHidden').hidden = v.offline !== 'hide';
  const on = { kick: !!kick.login, twitch: !!twitch.login };
  for (const row of $$('#viewersLinks li')) {
    const p = row.dataset.source,
      off = p === 'total' ? !on.kick && !on.twitch : !on[p];
    const note = $('small', row);
    note.textContent = off && p !== 'total' ? tpl(S.panel.viewersNoAccount, { platform: S.platforms[p] }) : p === 'total' ? S.panel.viewersTotalHint : '';
    note.classList.toggle('warn', off && p !== 'total');
    $('.connect', row).hidden = !off || p === 'total';
  }
  drawViewerThumbs();
}
// Style thumbnails: each style's own look with this widget's other settings, sample numbers.
function drawViewerThumbs() {
  for (const f of $$('.viewers-tile iframe')) {
    const style = f.dataset.style;
    f.contentWindow?.postMessage({ cfg: { ...settings.viewers, ...viewerData.styles[style], style, size: 1, customCss: '' } }, location.origin);
  }
}
