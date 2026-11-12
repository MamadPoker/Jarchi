// ---------- Previews ----------
const sample = (type, amount) => ({ ...samples[type], type, platform: $('#testAs').value, test: true, ...(amount !== undefined && { amount }) });
const previewAmount = () => (samples[cur].amount > 0 ? Number($('#previewAmount').value) || 0 : undefined);

const post = (frame, s, event, muted, hold = false) => frame.contentWindow?.postMessage({ strings: EN, settings: s, event, muted, hold }, location.origin);

function preview() {
  if (view === 'alert') post($('#preview'), settings, sample(cur, previewAmount()), !$('#previewSound').checked);
}

// Theme cards: the sub alert in that theme with its own look and sound; it stays on the card (hold) until the next play.
const THEME_TEXT = {
  nameColor: null,
  nameFont: 'theme',
  nameBold: true,
  nameShadow: true,
  textColor: null,
  textFont: 'theme',
  textBold: true,
  textShadow: true,
  autoSize: true,
};
function playTile(frame, muted = true) {
  const sub = {
    ...settings.alerts.sub,
    ...THEME_TEXT,
    size: 1,
    theme: null,
    image: null,
    soundMode: 'theme',
    frame: 'theme',
    textPos: 'below',
    textAlign: 'center',
  };
  post(frame, { theme: frame.dataset.theme, alerts: { sub } }, sample('sub'), muted, true);
}

// Style thumbnails: each style's own look with this goal's title and sample numbers.
function drawThumbs() {
  const g = settings.goals[curGoal];
  const { current, target } = GOAL_SAMPLE[curGoal];
  for (const f of $$('.goal-tile iframe')) {
    const style = f.dataset.style;
    f.contentWindow?.postMessage(
      { cfg: { ...goalData.styles[style], style, title: g.title, target, enabled: true }, state: { current, reached: false } },
      location.origin,
    );
  }
}

// Scale each iframe (the alert editor's: fitPreview(); the theme cards' 1920x1080, goals' 1000x400) down to its box.
const fit = new ResizeObserver((entries) => {
  for (const e of entries) {
    if (e.target.id === 'previewBox') fitPreview();
    else e.target.style.setProperty('--k', e.contentRect.width / e.target.querySelector('iframe').offsetWidth);
  }
});

// The alert editor's preview is the alerts overlay as in its OBS Browser Source: the iframe that size (the overlay
// tells the server; 800x600 until it's been in OBS), the box that shape, the iframe scaled into it with a margin all
// round, so the alert never touches the box's edges.
let sourceSize = { w: 800, h: 600 };
const PREVIEW_MARGIN = 12;
function fitPreview() {
  const box = $('#previewBox'),
    f = $('#preview'),
    { w, h } = sourceSize;
  f.style.width = `${w}px`;
  f.style.height = `${h}px`;
  box.style.setProperty('--ar', w / h);
  if (box.clientWidth) box.style.setProperty('--k', Math.min((box.clientWidth - 2 * PREVIEW_MARGIN) / w, (box.clientHeight - 2 * PREVIEW_MARGIN) / h));
}

// Sidebar pages new in a version: a soft gold frame and a NEW tag until the streamer opens the page once, then never
// again (settings.seenNew). Add a version's new pages here; one already opened stays plain.
const NEW_PAGES = { '1.0.7': ['donations'] };
const newPages = () => Object.values(NEW_PAGES).flat();
function renderNew() {
  for (const p of newPages()) {
    const b = $(`.nav-item[data-view="${p}"]`),
      on = !settings.seenNew.includes(p);
    b.classList.toggle('is-new', on);
    if (on !== !!$('.nav-new', b)) on ? b.append(el('span', { className: 'nav-new', textContent: S.panel.navNew })) : $('.nav-new', b).remove();
  }
}
function seenPage(v) {
  if (!newPages().includes(v) || settings.seenNew.includes(v)) return;
  settings.seenNew = [...settings.seenNew, v]; // plain at once (render below), saved for good
  api('PATCH', '/api/settings', { seenNew: settings.seenNew }).then(
    (s) => (settings = s),
    () => {},
  );
}

// Open a page (and in Alerts / Goals / Guide, an item of it: without `key`, the one selected before).
function select(v, key) {
  view = v;
  seenPage(v);
  if (v === 'alert') {
    cur = key ?? cur;
    $('#previewAmount').value = samples[cur].amount;
  }
  if (v === 'goal') {
    curGoal = key ?? curGoal;
    if (key) showGoalTab(goalPlatform(key)); // e.g. Home's Fix for a Twitch goal: the Twitch tab
    const src = `/widgets/goal/${curGoal}?preview`;
    if ($('#goalPreview').getAttribute('src') !== src) $('#goalPreview').src = src;
  }
  if (v === 'viewers') {
    const src = `/widgets/viewers/${viewerSource()}?preview`;
    if ($('#viewersPreview').getAttribute('src') !== src) $('#viewersPreview').src = src;
  }
  if (v === 'chat' && key) {
    // one of the chats (its tab, Home's Fix, an undo)
    curChat = key;
    remember.set('jarchi.chat', key);
    $('#chatFxHint').textContent = ''; // about the other chat's test
  }
  if (v === 'home') loadHome(); // today's numbers may have started again at midnight
  if (v === 'events') loadHistory();
  if (v === 'support') loadTickets();
  if (v === 'connections') showProxyNow();
  if (v === 'about')
    api('GET', '/api/version').then(
      ({ version }) => ($('#aboutVersion').textContent = S.panel.version.replace('{version}', version)),
      () => {},
    );
  if (v === 'donations') {
    cryptoPage = null; // the Donation page tab asks again
    renderCrypto();
    loadCrypto();
    refreshDonations();
  }
  if (v === 'news') renderNews(S.lang);
  if (v === 'guide') {
    if (S.guide.topics[key]) topic = key;
    renderGuide();
  }
  $$('main .view').forEach((s) => (s.hidden = !s.dataset.view.split(' ').includes(v)));
  renderConnWarn(); // Home has its own card instead of the top bar's warning
  const page = v === 'theme' ? 'alert' : v; // the theme page is part of Alerts; What's new has no sidebar item
  $$('.nav-item').forEach((b) => b.setAttribute('aria-current', b.dataset.view === page ? 'page' : 'false'));
  $('#pageTitle').textContent = v === 'news' ? S.panel.updateNotes : $(`.nav-item[data-view="${page}"] [data-i18n]`).textContent;
  render();
  preview();
  if (v === 'theme') $$('.theme-tile iframe').forEach((f) => playTile(f));
  if (v === 'chat') {
    fitChat();
    if (!styleGroup || key) showStyleGroup(chatStyles[chatCfg().style].layout);
    api('GET', `/api/chat/thumbs?chat=${curChat}`).then(
      (m) => {
        chatThumbs = m;
        drawChatThumbs();
      },
      () => {},
    );
  }
}

// A page's tabs (Alerts, Chat): the open one stays open from item to item, and next time (remembered under `key`).
// Arrow keys move between them.
function wireTabs(root, key) {
  const tabs = $$('.tabs [role=tab]', root);
  const showTab = (t) => {
    remember.set(key, t);
    tabs.forEach((b) => {
      b.setAttribute('aria-selected', String(b.dataset.tab === t));
      b.tabIndex = b.dataset.tab === t ? 0 : -1;
    });
    $$('.pane', root).forEach((p) => (p.hidden = p.dataset.tab !== t));
  };
  tabs.forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
  showTab(tabs.some((b) => b.dataset.tab === remember.get(key)) ? remember.get(key) : tabs[0].dataset.tab);
  $('.tabs', root).onkeydown = (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key] * (FA ? -1 : 1),
      i = tabs.indexOf(e.target);
    if (!step || i < 0) return;
    const next = tabs[(i + step + tabs.length) % tabs.length];
    showTab(next.dataset.tab);
    next.focus();
  };
  return showTab;
}

// A preview's background: dark, light or checkered (radios name=`name`, remembered in this browser under `key`).
function wireBg(box, name, key) {
  const bg = ['dark', 'light', 'checker'].includes(remember.get(key)) ? remember.get(key) : 'checker';
  box.dataset.bg = bg;
  $$(`[name=${name}]`).forEach((r) => {
    r.checked = r.value === bg;
    r.onchange = () => remember.set(key, (box.dataset.bg = r.value));
  });
}

// A button that opens a small menu under it (the Home page's OBS links, the Chat page's other tests; the profile chip's
// opens above it). A pick, a click anywhere else or Escape closes it.
function wireMenu(btn, pop) {
  const show = (on) => {
    pop.hidden = !on;
    btn.setAttribute('aria-expanded', String(on));
  };
  btn.onclick = () => show(pop.hidden);
  pop.addEventListener('click', () => show(false));
  addEventListener('click', (e) => {
    if (!btn.parentNode.contains(e.target)) show(false);
  });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') show(false);
  });
}
