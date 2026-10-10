// Settings panel. All visible text comes from /i18n/en.json.
// Layout: left column lists items in groups (GROUPS below); the right side shows the editor for the selected item.
// Previews are the real overlays in scaled iframes: alerts are driven by postMessage, the goal by its own live socket.
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
let S, settings, samples, goalData; // goalData = { state, styles, fonts } from /api/goals; state then follows the socket
let chatStyles, chatFonts, chatStatus; // chat style looks and fonts (/api/chat/styles), connection status (follows the socket)
let chatThumbs; // sample messages for the chat style thumbnails (/api/chat/thumbs: random viewers and badges each visit)
let view = 'alert', cur = 'follow', curGoal = 'subs'; // what's selected: an alert, a goal, or the theme / settings view
let queue = { paused: false, overlays: 0, waiting: 0, now: null }; // the alert queue (follows the socket)

const pct = (v) => `${Math.round(v * 100)}%`;
const px = (v) => `${v}px`;
const FORMAT = {
  volume: pct, frameOpacity: pct, frameRadius: px, fontSize: px, bgOpacity: pct, borderWidth: px, radius: px, scale: pct,
  emoteSize: px, bigEmoteSize: px, nameSize: px, padding: px, gap: px, width: px, height: px, fadeZone: px, blur: px,
  tickerSpeed: (v) => `${v} px/s`, maxMessages: (v) => String(v), hideAfter: (v) => (Number(v) ? `${v}s` : S.panel.never), animSpeed: (v) => `×${v}`,
};
const GOAL_STEP = { subs: 1, kicks: 100 }; // what "Test", "+" and "−" add
const GOAL_SAMPLE = { subs: { current: 32, target: 50 }, kicks: { current: 640, target: 1000 } }; // numbers on style thumbnails
const isVideo = (file) => /\.(webm|mp4)$/.test(file ?? '');
const tpl = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => v[k] ?? m);
const ACCEPT = { image: 'image/png,image/jpeg,image/gif,image/webp,video/webm,video/mp4,.webm,.mp4', sound: 'audio/mpeg,audio/wav,audio/ogg,.mp3,.wav,.ogg' };
const valueOf = (inp) => (inp.type === 'checkbox' ? inp.checked : ['number', 'range'].includes(inp.type) ? Number(inp.value) : inp.value);
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};

// Left column groups. Each item opens `view` (a <section data-view>) for its key.
// An item can bring its own `content` instead of the default dot + label, and a `toggle(on)` for its switch.
const GROUPS = () => [
  { title: S.panel.groupTheme, items: [{ view: 'theme', key: 'theme', content: themeRow }] },
  { title: S.panel.groupAlerts, items: Object.keys(settings.alerts).map((t) => ({ view: 'alert', key: t, label: S.types[t], toggle: (on) => patchAlert(t, { enabled: on }) })) },
  { title: S.panel.groupWidgets, items: [
    ...Object.keys(settings.goals).map((id) => ({ view: 'goal', key: id, label: S.goals[id].name, toggle: (on) => patchGoal(id, { enabled: on }) })),
    { view: 'chat', key: 'chat', label: S.panel.chatName, toggle: (on) => patchChat({ enabled: on }) },
  ] },
];

// Chat "More options", built from this list: [group label, [[kind, field, options]...]].
// kind: toggle | range | seg | select | color | text. options.only: shown only when CHAT_ONLY[only] is true.
const CHAT_GROUPS = () => [
  ['chatShow', [['toggle', 'showPlatform'], ['toggle', 'showBadges'], ['toggle', 'badgeBroadcaster', { only: 'badges' }], ['toggle', 'badgeMod', { only: 'badges' }],
    ['toggle', 'badgeVip', { only: 'badges' }], ['toggle', 'badgeSub', { only: 'badges' }], ['toggle', 'badgeOther', { only: 'badges' }], ['toggle', 'showTime'], ['toggle', 'showColon']]],
  ['chatEmotes', [['toggle', 'emotesKick'], ['toggle', 'emotesTwitch'], ['toggle', 'emotes7tv'], ['toggle', 'emotesAnimated'], ['range', 'emoteSize', { min: 12, max: 112 }],
    ['toggle', 'bigEmotes'], ['range', 'bigEmoteSize', { min: 16, max: 160, only: 'big' }]]],
  ['chatText', [['select', 'font', { options: chatFonts.map((x) => [x, x]) }], ['range', 'fontSize', { min: 10, max: 72, label: 'messageSize' }], ['range', 'nameSize', { min: 10, max: 72 }],
    ['seg', 'nameColorMode', { label: 'nameColor', options: [['user', 'nameOwn'], ['style', 'nameStyle'], ['custom', 'nameCustom']] }], ['color', 'nameColor', { only: 'nameCustom' }],
    ['color', 'textColor', { label: 'messageColor' }], ['seg', 'namePos', { options: [['inline', 'nameInline'], ['above', 'nameAbove']] }], ['toggle', 'textShadow'],
    ['select', 'textDir', { options: [['auto', 'dirAuto'], ['ltr', 'dirLtr'], ['rtl', 'dirRtl']] }]]],
  ['chatBox', [['seg', 'bg', { label: 'bgMode', options: [['color', 'bgColor'], ['transparent', 'bgTransparent'], ['off', 'bgOff']] }], ['color', 'bgColor', { only: 'bgColor' }],
    ['range', 'bgOpacity', { min: 0, max: 1, step: 0.05, only: 'bgColor' }], ['toggle', 'bubbles', { label: 'bubblesOpt' }], ['toggle', 'border'],
    ['color', 'borderColor', { only: 'borderOn' }], ['range', 'borderWidth', { min: 1, max: 12, only: 'borderOn' }], ['range', 'radius', { min: 0, max: 40 }],
    ['range', 'padding', { min: 0, max: 60 }], ['range', 'gap', { min: 0, max: 40 }], ['range', 'width', { min: 200, max: 1920, step: 10, label: 'chatWidth' }],
    ['range', 'height', { min: 40, max: 1080, step: 10, label: 'chatHeight' }]]],
  ['chatMotion', [['seg', 'layout', { options: [['vertical', 'layoutVertical'], ['horizontal', 'layoutHorizontal']] }],
    ['seg', 'tickerDir', { options: [['rtl', 'dirRtlArrow'], ['ltr', 'dirLtrArrow']], only: 'ticker' }], ['range', 'tickerSpeed', { min: 20, max: 600, step: 10, only: 'ticker' }],
    ['toggle', 'tickerLoop', { only: 'ticker' }], ['seg', 'tickerPos', { options: [['top', 'posTop'], ['bottom', 'posBottom']], only: 'ticker' }],
    ['seg', 'newAt', { options: [['bottom', 'newBottom'], ['top', 'newTop']], only: 'vertical' }], ['range', 'maxMessages', { min: 1, max: 100 }],
    ['range', 'hideAfter', { min: 0, max: 600, step: 5 }], ['select', 'enterAnim', { options: [['slide', 'animSlide'], ['fade', 'animFade'], ['pop', 'animPop'], ['float', 'animFloat'], ['bounce', 'animBounce'], ['drop', 'animDrop'], ['none', 'animNone']] }],
    ['select', 'exitAnim', { options: [['fade', 'animFade'], ['slide', 'animSlide'], ['none', 'animNone']] }], ['range', 'animSpeed', { min: 0.25, max: 3, step: 0.25 }],
    ['toggle', 'fade'], ['range', 'fadeZone', { min: 0, max: 400, step: 5, only: 'fade' }], ['toggle', 'typewriter'], ['toggle', 'typeSound', { only: 'typewriter' }]]],
  ['chatFilters', [['toggle', 'hideCommands'], ['toggle', 'hideBots'], ['text', 'bots', { only: 'bots', hint: 'listHint' }], ['text', 'hiddenUsers', { hint: 'listHint' }],
    ['text', 'blockedWords', { hint: 'listHint' }], ['toggle', 'hideLinks'], ['select', 'source', { options: [['both', 'sourceBoth'], ['kick', 'sourceKick'], ['twitch', 'sourceTwitch']] }]]],
  ['chatFx', [['toggle', 'fxSubGlow'], ['toggle', 'fxFirst'], ['toggle', 'fxRainbowVip'], ['text', 'rainbowUsers', { hint: 'listHint' }], ['toggle', 'fxMention'], ['toggle', 'fxCombo'],
    ['toggle', 'avatars', { hint: 'avatarsHint' }], ['range', 'blur', { min: 0, max: 40 }]]],
];

// One "More options" control. Inputs carry data-f like the other editors, so fill() and the save handler just work.
function chatControl(kind, f, o) {
  const label = S.panel[o.label ?? f] ?? f;
  const input = (props) => {
    const i = el(props.tag ?? 'input', props.tag ? {} : props);
    i.dataset.f = f;
    return i;
  };
  let node;
  if (kind === 'toggle') {
    node = el('label', { className: 'row between toggle-row' }, el('span', { textContent: label }), el('span', { className: 'switch' }, input({ type: 'checkbox' }), el('span')));
  } else if (kind === 'range') {
    const out = el('b');
    out.dataset.out = f;
    node = el('label', { className: 'field' }, el('span', {}, el('span', { textContent: label }), ' ', out), input({ type: 'range', min: o.min, max: o.max, step: o.step ?? 1 }));
  } else if (kind === 'seg') {
    node = el('div', { className: 'field' }, el('span', { textContent: label }), el('div', { className: 'seg' }, ...o.options.map(([v, k]) => {
      const r = input({ type: 'radio', name: `chat-${f}`, value: v });
      return el('label', {}, r, el('span', { textContent: S.panel[k] ?? k }));
    })));
  } else if (kind === 'select') {
    const sel = input({ tag: 'select' });
    sel.append(...o.options.map(([v, k]) => new Option(S.panel[k] ?? k, v)));
    node = el('label', { className: 'field' }, el('span', { textContent: label }), sel);
  } else {
    node = el('label', { className: 'field' }, el('span', { textContent: label }), input({ type: kind === 'color' ? 'color' : 'text', maxLength: 1000 }), o.hint ? el('small', { textContent: S.panel[o.hint] }) : '');
  }
  if (o.only) node.dataset.only = o.only;
  return node;
}

// Each style's own look with sample messages; filters off so the samples always show.
function drawChatThumbs() {
  if (!chatThumbs) return;
  for (const f of $$('.chat-tile iframe')) {
    const style = f.dataset.style;
    const ticker = chatStyles[style].layout === 'horizontal';
    const cfg = { ...settings.chat, ...chatStyles[style], style, enabled: true, width: ticker ? 440 : 400, height: ticker ? 64 : 290, maxMessages: 6,
      hideCommands: false, hideBots: false, hiddenUsers: '', blockedWords: '', hideLinks: false, source: 'both', avatars: false, fxMention: false };
    f.contentWindow?.postMessage({ strings: S, cfg, messages: chatThumbs }, location.origin);
  }
}

// The chat preview iframe is as big as the chat (+ a margin), scaled down to fit and centered.
function fitChat() {
  const box = $('.chat-preview'), f = $('#chatPreview'), c = settings.chat;
  const W = c.width + 60, H = c.height + 60;
  const k = Math.min(box.clientWidth / W, box.clientHeight / H, 1);
  Object.assign(f.style, { width: `${W}px`, height: `${H}px`, transform: `translate(${(box.clientWidth - W * k) / 2}px, ${(box.clientHeight - H * k) / 2}px) scale(${k})` });
}

function renderStatus() {
  const names = { off: 'stOff', connecting: 'stConnecting', connected: 'stConnected', error: 'stError' };
  for (const p of ['kick', 'twitch']) {
    const st = chatStatus[p];
    const e = $(`#${p}Status`);
    e.className = `status st-${st.state}`;
    e.textContent = S.panel[names[st.state]] + (st.state === 'error' && st.detail ? ` · ${S.panel[`err_${st.detail}`] ?? st.detail}` : '');
  }
}

// THEME row: current theme + "Change", and a strip with every theme's swatch (render() outlines the current one).
const themeRow = () => [
  el('span', { className: 'theme-now' }, el('span', { className: 'swatch' }), el('span', { className: 'theme-name' }), el('span', { className: 'change', textContent: S.panel.change })),
  el('span', { className: 'swatches' }, ...Object.entries(S.themes).map(([id, name]) => {
    const sw = el('span', { className: `swatch sw-${id}`, title: name });
    sw.dataset.theme = id;
    return sw;
  })),
];

async function api(method, url, body, headers = {}) {
  const isFile = body instanceof Blob;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { 'x-jarchi': '1', ...(body && !isFile && { 'content-type': 'application/json' }), ...headers },
      body: isFile ? body : body && JSON.stringify(body),
    });
  } catch {
    throw new Error(S.errors.offline);
  }
  const data = await res.json().catch(() => ({ error: 'server_error' }));
  if (!res.ok) throw new Error(S.errors[data.error] || S.errors.server_error);
  return data;
}

let toastTimer;
function toast(msg, isError) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = isError ? 'show error' : 'show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), 2000);
}

// Any call that returns settings: store them, re-sync the UI (also reverts rejected values), replay the preview.
async function send(method, url, body, headers) {
  try {
    settings = await api(method, url, body, headers);
    toast(S.panel.saved);
    preview();
  } catch (err) {
    toast(err.message, true);
  }
  render();
}
const patchAlert = (type, fields) => send('PATCH', '/api/settings', { alerts: { [type]: fields } });
const patchGoal = (id, fields) => send('PATCH', '/api/settings', { goals: { [id]: fields } });
const patchChat = (fields) => send('PATCH', '/api/settings', { chat: fields });

// Change the selected goal's count: { add: n } or { set: n }.
async function goalCount(body) {
  try {
    goalData.state = await api('PATCH', `/api/goals/${curGoal}`, body);
  } catch (err) {
    toast(err.message, true);
  }
  render();
}

// ---------- Previews ----------
const sample = (type, amount) => ({ ...samples[type], type, platform: $('#testAs').value, test: true, ...(amount !== undefined && { amount }) });
const previewAmount = () => (samples[cur].amount > 0 ? Number($('#previewAmount').value) || 0 : undefined);

const post = (frame, s, event, muted, hold = false) => frame.contentWindow?.postMessage({ strings: S, settings: s, event, muted, hold }, location.origin);

function preview() {
  if (view === 'alert') post($('#preview'), settings, sample(cur, previewAmount()), !$('#previewSound').checked);
}

// Theme cards: the sub alert in that theme with its own look and sound; it stays on the card (hold) until the next play.
function playTile(frame, muted = true) {
  const sub = { ...settings.alerts.sub, theme: null, image: null, soundMode: 'theme', frame: 'theme', textColor: null, textPos: 'below', textAlign: 'center' };
  post(frame, { theme: frame.dataset.theme, alerts: { sub } }, sample('sub'), muted, true);
}

// Style thumbnails: each style's own look with this goal's title and sample numbers.
function drawThumbs() {
  const g = settings.goals[curGoal];
  const { current, target } = GOAL_SAMPLE[curGoal];
  for (const f of $$('.goal-tile iframe')) {
    const style = f.dataset.style;
    f.contentWindow?.postMessage({ cfg: { ...goalData.styles[style], style, title: g.title, target, enabled: true }, state: { current, reached: false } }, location.origin);
  }
}

// Scale each iframe (1920x1080 alerts, 1000x400 goals) down to its box.
const fit = new ResizeObserver((entries) => {
  for (const e of entries) e.target.style.setProperty('--k', e.contentRect.width / e.target.querySelector('iframe').offsetWidth);
});

function select(v, key) {
  view = v;
  if (v === 'alert') {
    cur = key;
    $('#previewAmount').value = samples[key].amount;
  }
  if (v === 'goal') {
    curGoal = key;
    const src = `/widgets/goal/${key}?preview`;
    if ($('#goalPreview').getAttribute('src') !== src) $('#goalPreview').src = src;
  }
  if (v === 'chat' && !$('#chatPreview').getAttribute('src')) $('#chatPreview').src = '/widgets/chat?preview';
  if (v === 'settings') showProxyNow();
  $$('main .view').forEach((s) => (s.hidden = s.dataset.view !== v));
  render();
  preview();
  if (v === 'theme') $$('.theme-tile iframe').forEach((f) => playTile(f));
  if (v === 'chat') {
    fitChat();
    api('GET', '/api/chat/thumbs').then((m) => { chatThumbs = m; drawChatThumbs(); }, () => {});
  }
}

// ---------- Alert queue (top bar) ----------
function renderQueue() {
  const q = queue, n = q.now;
  const bar = $('.queue');
  bar.dataset.state = q.paused ? 'paused' : n ? 'playing' : 'idle';
  $('#qNow').textContent = n ? tpl(S.panel.qPlaying, { type: S.types[n.type], user: n.user }) + (n.amount ? ` · ${n.amount.toLocaleString()}` : '')
    : q.paused ? S.panel.qPausedLabel : S.panel.qIdle;
  $('#qWaiting').textContent = tpl(S.panel.qWaiting, { n: q.waiting });
  $('#qNoObs').hidden = q.overlays > 0;
  $('#qPause span').textContent = $('#qPause').title = q.paused ? S.panel.qResume : S.panel.qPause;
  $('#qSkip').disabled = !n;
  $('#qClear').disabled = !q.waiting;
}
const queueCall = (what, body) => api('POST', `/api/alerts/${what}`, body).then((q) => { queue = q; renderQueue(); return q; }, (err) => toast(err.message, true));

// ---------- Media by amount: one card per tier, rebuilt only when the tiers change ----------
let tiersDrawn = '';
function renderTiers(cfg) {
  const key = JSON.stringify([cur, cfg.tiers]);
  if (key === tiersDrawn) return;
  tiersDrawn = key;
  const unit = S.panel.tierUnit[cur];
  $('#tiers').replaceChildren(...cfg.tiers.map((t, i) => {
    const next = cfg.tiers[i + 1];
    const range = next && next.min > t.min
      ? tpl(S.panel.tierRange, { from: t.min.toLocaleString(), to: (next.min - 1).toLocaleString(), unit })
      : tpl(S.panel.tierRangeUp, { from: t.min.toLocaleString(), unit });
    const min = el('input', { type: 'number', min: 1, step: 1, value: t.min, onchange: () => send('PATCH', `/api/tiers/${cur}/${i}`, { min: Math.round(Number(min.value)) }) });
    return el('div', { className: 'tier' },
      el('div', { className: 'tier-head' },
        el('label', { className: 'tier-min' }, el('span', { textContent: S.panel.tierFrom }), min),
        el('span', { className: 'tier-range', textContent: range }),
        el('button', { textContent: S.panel.tierTest, onclick: () => testTier(t.min) }),
        el('button', { className: 'ghost', textContent: S.panel.tierRemove, onclick: () => send('DELETE', `/api/tiers/${cur}/${i}`) })),
      tierFiles(i, 'image', t.images), tierFiles(i, 'sound', t.sounds));
  }));
}

// A tier's images or sounds: a chip per file (× removes it), "+ Add" uploads one or more.
function tierFiles(i, kind, list) {
  const input = el('input', { type: 'file', hidden: true, multiple: true, accept: ACCEPT[kind] });
  input.onchange = async () => {
    const files = [...input.files];
    input.value = '';
    for (const f of files) await send('POST', `/api/tiers/${cur}/${i}/${kind}`, f, { 'content-type': f.type || 'application/octet-stream', 'x-filename': encodeURIComponent(f.name) });
  };
  const chips = list.length
    ? list.map((f, n) => el('span', { className: 'chip' }, el('span', { className: 'fname', textContent: f.name, title: f.name }),
      el('button', { className: 'x', textContent: '×', title: S.panel.remove, onclick: () => send('DELETE', `/api/tiers/${cur}/${i}/${kind}/${n}`) })))
    : [el('span', { className: 'fname default', textContent: S.panel[kind === 'image' ? 'tierNoImages' : 'tierNoSounds'] })];
  return el('div', { className: 'tier-files' },
    el('span', { className: 'tier-label', textContent: S.panel[kind === 'image' ? 'tierImages' : 'tierSounds'] }),
    el('div', { className: 'chips' }, ...chips, list.length < 10 ? el('button', { className: 'ghost add', textContent: `+ ${S.panel.tierAdd}`, title: S.panel.tierManyHint, onclick: () => input.click() }) : '', input));
}

// A tier's Test: plays it here in the preview and sends it to OBS, with the tier's lowest amount.
function testTier(amount) {
  $('#previewAmount').value = amount;
  preview();
  api('POST', `/api/test/${cur}`, { platform: $('#testAs').value, amount }).then(() => toast(S.panel.testSent), (err) => toast(err.message, true));
}

// ---------- Settings: proxy ----------
const proxyLabel = (p) => `${p.host}:${p.port} (${p.type === 'socks5' ? 'SOCKS5' : 'HTTP'})`;
function showProxyNow() {
  api('GET', '/api/net/proxy').then(({ proxy }) => {
    $('#proxyNow').textContent = proxy ? tpl(S.net.systemNow, { proxy: proxyLabel(proxy) }) : S.net.systemNone;
  }, () => {});
}
function renderNet({ proxy, results }) {
  const p = proxy && proxyLabel(proxy);
  $('#netUsing').textContent = p ? tpl(S.net.using, { proxy: p }) : S.net.direct;
  const lines = new Map(); // text -> ok; a dead proxy is one line, not one per service
  for (const [id, code] of Object.entries(results)) {
    const key = code !== 'ok' && p && (code === 'timeout' || code === 'network') ? 'viaProxy' : code;
    lines.set(tpl(S.net[key] ?? S.net.network, { name: S.net.names[id], proxy: p }), code === 'ok');
  }
  $('#netResults').replaceChildren(...[...lines].map(([text, ok]) => el('li', { className: ok ? 'ok' : 'bad', textContent: text })));
}

// Upload / remove buttons of a .file row.
function wireFile(row, upload, remove) {
  const input = $('input', row);
  $('.upload', row).onclick = () => input.click();
  input.onchange = () => {
    const f = input.files[0];
    input.value = '';
    if (f) send('POST', upload(), f, { 'content-type': f.type || 'application/octet-stream', 'x-filename': encodeURIComponent(f.name) });
  };
  $('.remove', row).onclick = () => send('DELETE', remove());
}

// ---------- Build once ----------
function build() {
  document.documentElement.lang = S.lang;
  document.documentElement.dir = S.dir;

  // Left column
  for (const g of GROUPS()) {
    const list = el('ul', { className: 'nav' });
    for (const it of g.items) {
      const row = el('li', { className: `nav-row row-${it.view}` });
      Object.assign(row.dataset, { view: it.view, key: it.key });
      // Default row: dot, label, and a swatch that render() shows when an alert has its own theme.
      const content = it.content ? it.content() : [el('span', { className: 'dot' }), el('span', { textContent: it.label }), el('span', { className: 'swatch mini', hidden: true })];
      row.append(el('button', { className: 'nav-btn', onclick: () => select(it.view, it.key) }, ...content));
      if (it.toggle) {
        const sw = el('input', { type: 'checkbox', onchange: () => it.toggle(sw.checked) });
        sw.setAttribute('aria-label', it.label);
        row.append(el('label', { className: 'switch' }, sw, el('span')));
      }
      list.append(row);
    }
    $('#groups').append(el('h2', { className: 'group-title', textContent: g.title }), list);
  }
  $('.side-foot .nav-btn').onclick = () => select('settings');

  // Theme page: a card per theme. Hover (or focus) previews it muted; click selects it and plays it with sound.
  for (const [id, name] of Object.entries(S.themes)) {
    const frame = el('iframe', { src: '/widgets/alerts/?preview=tile', title: name, tabIndex: -1, onload: () => playTile(frame) });
    frame.dataset.theme = id;
    frame.setAttribute('aria-hidden', 'true');
    const tile = el('button', {
      className: 'theme-tile',
      onclick: () => { send('PATCH', '/api/settings', { theme: id }); playTile(frame, false); },
      onmouseenter: () => playTile(frame),
      onfocus: () => playTile(frame),
    },
    el('div', { className: 'preview' }, frame),
    el('div', { className: 'tile-foot' }, el('span', { className: `swatch sw-${id}` }), el('span', { className: 'tile-name', textContent: name }), el('span', { className: 'selected-label', textContent: S.panel.selected })));
    tile.dataset.theme = id;
    $('#themeGrid').append(tile);
  }

  // Goal style picker: a live thumbnail per style; clicking one starts the goal from that style's look.
  for (const [id, name] of Object.entries(S.goalStyles)) {
    const frame = el('iframe', { src: '/widgets/goal/subs?thumb', title: name, tabIndex: -1, onload: drawThumbs });
    frame.dataset.style = id;
    frame.setAttribute('aria-hidden', 'true');
    const tile = el('button', { className: 'style-tile goal-tile', onclick: () => patchGoal(curGoal, { style: id }) },
      el('div', { className: 'preview' }, frame), el('span', { className: 'tile-name', textContent: name }));
    tile.dataset.style = id;
    $('#styleGrid').append(tile);
  }
  $$('.preview').forEach((p) => fit.observe(p));

  // Top bar: OBS link.
  const obsUrl = `${location.origin}/widgets/alerts`;
  $('#obsUrl').value = obsUrl;
  $('#copy').title = S.panel.copyObsHint;
  $('#copy').onclick = () => navigator.clipboard.writeText(obsUrl).then(() => toast(S.panel.copied));

  // Alert editor: every [data-f] input saves its field for the selected alert.
  const editor = $('main [data-view=alert]');
  $$('[data-f]', editor).forEach((inp) => inp.addEventListener('change', () => patchAlert(cur, { [inp.dataset.f]: valueOf(inp) })));
  $$('input[type=range]', editor).forEach((inp) => inp.addEventListener('input', () => showRange(inp)));
  $$('[name=textColorMode]').forEach((r) => (r.onchange = () => patchAlert(cur, { textColor: r.value === 'custom' ? $('[data-f=textColor]', editor).value : null })));
  // Per-alert theme: "" = same as the main theme.
  $('#alertTheme').append(new Option('', ''), ...Object.entries(S.themes).map(([id, name]) => new Option(name, id)));
  $('#alertTheme').onchange = (e) => patchAlert(cur, { theme: e.target.value || null });
  $$('.file', editor).forEach((row) => wireFile(row, () => `/api/upload/${cur}/${row.dataset.kind}`, () => `/api/upload/${cur}/${row.dataset.kind}`));
  $('#play').onclick = () => preview();
  $('#previewAmount').onchange = () => preview();
  $('#test').onclick = () => api('POST', `/api/test/${cur}`, { platform: $('#testAs').value, amount: previewAmount() })
    .then(() => toast(S.panel.testSent), (err) => toast(err.message, true));
  $('#reset').onclick = () => send('POST', `/api/reset/${cur}`);
  $('#preview').onload = () => preview();

  // Goal editor: [data-f] inputs save the selected goal's settings; the count has its own buttons.
  const goalEd = $('main [data-view=goal]');
  $('#goalFont').append(...goalData.fonts.map((f) => new Option(f, f)));
  $$('[data-f]', goalEd).forEach((inp) => inp.addEventListener('change', () => patchGoal(curGoal, { [inp.dataset.f]: valueOf(inp) })));
  $$('input[type=range]', goalEd).forEach((inp) => inp.addEventListener('input', () => showRange(inp)));
  wireFile($('.file', goalEd), () => `/api/goals/${curGoal}/sound`, () => `/api/goals/${curGoal}/sound`);
  $('#goalTest').onclick = () => goalCount({ add: GOAL_STEP[curGoal] });
  $('#goalPlus').onclick = () => goalCount({ add: GOAL_STEP[curGoal] });
  $('#goalMinus').onclick = () => goalCount({ add: -GOAL_STEP[curGoal] });
  $('#goalCurrent').onchange = (e) => goalCount({ set: Math.max(0, Math.round(Number(e.target.value) || 0)) });
  $('#goalZero').onclick = () => goalCount({ set: 0 });
  $('#goalResetStyle').onclick = () => send('POST', `/api/goals/${curGoal}/reset-style`);
  $('#goalCopy').title = S.panel.goalCopyHint;
  $('#goalCopy').onclick = () => navigator.clipboard.writeText(`${location.origin}/widgets/goal/${curGoal}`).then(() => toast(S.panel.goalCopied));
  // Counts and chat status change on their own (events, connections), so follow them live.
  const socket = io();
  socket.on('goals', (state) => {
    goalData.state = state;
    render();
  });
  socket.on('chatStatus', (st) => {
    chatStatus = st;
    renderStatus();
  });
  socket.on('alertQueue', (q) => {
    queue = q;
    renderQueue();
  });
  $('#qSkip').title = S.panel.qSkip;
  $('#qClear').title = S.panel.qClear;
  $('#qPause').onclick = () => queueCall('pause', { paused: !queue.paused });
  $('#qSkip').onclick = () => queueCall('skip');
  $('#qClear').onclick = () => queueCall('clear').then((q) => q && toast(S.panel.qCleared));
  $('#addTier').onclick = () => send('POST', `/api/tiers/${cur}`);

  // Chat editor
  for (const [title, controls] of CHAT_GROUPS()) {
    $('#chatMore').append(el('div', { className: 'box' }, el('h3', { textContent: S.panel[title] }), ...controls.map(([kind, f, o = {}]) => chatControl(kind, f, o))));
  }
  for (const layout of ['vertical', 'horizontal']) { // the style picker, in two groups
    $('#chatStyleGrid').append(el('h3', { className: 'grid-head', textContent: S.panel[layout === 'vertical' ? 'stylesVertical' : 'stylesHorizontal'] }));
    for (const [id, name] of Object.entries(S.chatStyles).filter(([id]) => chatStyles[id]?.layout === layout)) {
      const frame = el('iframe', { src: '/widgets/chat?thumb', title: name, tabIndex: -1, onload: drawChatThumbs });
      frame.dataset.style = id;
      frame.setAttribute('aria-hidden', 'true');
      const tile = el('button', { className: 'style-tile chat-tile', onclick: () => patchChat({ style: id }) },
        el('div', { className: 'preview' }, frame), el('span', { className: 'tile-name', textContent: name }));
      tile.dataset.style = id;
      $('#chatStyleGrid').append(tile);
      fit.observe(tile.querySelector('.preview'));
    }
  }
  const chatEd = $('main [data-view=chat]');
  $$('[data-f]', chatEd).forEach((inp) => inp.addEventListener('change', () => patchChat({ [inp.dataset.f]: valueOf(inp) })));
  $$('input[type=range]', chatEd).forEach((inp) => inp.addEventListener('input', () => showRange(inp)));
  $$('[data-placeholder]').forEach((e) => (e.placeholder = S.panel[e.dataset.placeholder]));
  // Test messages. Effects that are off still get their message, just without the effect: say which ones.
  const FX_SETTING = { sub: 'fxSubGlow', first: 'fxFirst', vip: 'fxRainbowVip', mention: 'fxMention', combo: 'fxCombo', avatar: 'avatars' };
  const sendTest = (kind) => api('POST', '/api/chat/test', { kind }).then((r) => {
    $('#chatFxHint').textContent = r.effects.map((k) => FX_SETTING[k]).filter((f) => !settings.chat[f]).map((f) => S.panel.fxOff[f]).join(' · ');
    toast(S.panel.chatTestSent);
  }, (err) => toast(err.message, true));
  $('#chatTest').onclick = () => sendTest('sample');
  $('#chatBurst').onclick = () => sendTest('burst');
  $('#chatAllFx').onclick = () => sendTest('all');
  $('#chatResetStyle').onclick = () => send('POST', '/api/chat/reset-style');
  $('#chatCopy').title = S.panel.chatCopyHint;
  $('#chatCopy').onclick = () => navigator.clipboard.writeText(`${location.origin}/widgets/chat`).then(() => toast(S.panel.chatCopied));
  new ResizeObserver(() => { if (view === 'chat') fitChat(); }).observe($('.chat-preview'));
  renderStatus();

  // Settings
  $('#showBadge').onchange = (e) => send('PATCH', '/api/settings', { showBadge: e.target.checked });
  for (const [id, name] of Object.entries(S.platforms)) $('#testAs').append(new Option(name, id));
  const patchGlobal = (fields) => send('PATCH', '/api/settings', fields);
  $('#alertGap').onchange = (e) => patchGlobal({ alertGap: Number(e.target.value) });
  $$('[name=proxyMode]').forEach((r) => (r.onchange = () => patchGlobal({ proxyMode: r.value }).then(() => {
    showProxyNow();
    $('#netResults').replaceChildren();
    $('#netUsing').textContent = '';
  })));
  $$('[name=proxyType]').forEach((r) => (r.onchange = () => patchGlobal({ proxyType: r.value })));
  $('#proxyHost').onchange = (e) => patchGlobal({ proxyHost: e.target.value.trim() });
  $('#proxyPort').onchange = (e) => patchGlobal({ proxyPort: Math.round(Number(e.target.value)) || 0 });
  $('#netTest').onclick = async () => {
    const btn = $('#netTest');
    btn.disabled = true;
    $('#netUsing').textContent = S.panel.netTesting;
    $('#netResults').replaceChildren();
    try {
      renderNet(await api('POST', '/api/net/test'));
    } catch (err) {
      $('#netUsing').textContent = '';
      toast(err.message, true);
    }
    btn.disabled = false;
  };
  // Two-click confirm instead of confirm(): no blocking dialog.
  const resetAll = $('#resetAll');
  let armed;
  const disarm = () => {
    clearTimeout(armed);
    armed = null;
    resetAll.textContent = S.panel.resetAll;
    resetAll.classList.remove('armed');
  };
  resetAll.onclick = () => {
    if (armed) return disarm(), send('POST', '/api/reset');
    armed = setTimeout(disarm, 3000);
    resetAll.classList.add('armed');
    resetAll.textContent = S.panel.confirmResetAll;
  };

  $$('[data-i18n]').forEach((e) => (e.textContent = S.panel[e.dataset.i18n]));
}

// Range sliders: filled track + value label (labels are per editor: both editors have e.g. "volume").
function showRange(inp) {
  inp.style.setProperty('--fill', `${((inp.value - inp.min) / (inp.max - inp.min)) * 100}%`);
  const out = $(`[data-out="${inp.dataset.f}"]`, inp.closest('.view'));
  if (out) out.textContent = FORMAT[inp.dataset.f](inp.value);
}

// Put a config's values into an editor's [data-f] inputs.
function fill(root, cfg) {
  $$('[data-f]', root).forEach((inp) => {
    const val = cfg[inp.dataset.f];
    if (inp.type === 'checkbox') inp.checked = val;
    else if (inp.type === 'radio') inp.checked = inp.value === val;
    else if (inp.type === 'color') inp.value = val ?? '#ffffff';
    else if (inp !== document.activeElement || !['text', 'number'].includes(inp.type)) inp.value = val ?? ''; // never under the cursor
    if (inp.type === 'range') showRange(inp);
  });
}

// ---------- Sync UI from settings ----------
function render() {
  $$('.nav-row').forEach((row) => {
    const { view: v, key } = row.dataset;
    row.classList.toggle('active', v === view && (v === 'alert' ? key === cur : v === 'goal' ? key === curGoal : true));
    if (v === 'goal' || v === 'chat') {
      const on = v === 'goal' ? settings.goals[key].enabled : settings.chat.enabled;
      row.classList.toggle('off', !on);
      $('input', row).checked = on;
    }
    if (v !== 'alert') return;
    const a = settings.alerts[key];
    row.classList.toggle('off', !a.enabled);
    $('input', row).checked = a.enabled;
    const own = $('.swatch.mini', row);
    own.hidden = !a.theme;
    own.className = `swatch mini sw-${a.theme}`;
    own.title = a.theme ? S.themes[a.theme] : '';
  });

  $('.theme-now .swatch').className = `swatch sw-${settings.theme}`;
  $('.theme-now .theme-name').textContent = S.themes[settings.theme];
  $$('.swatches .swatch').forEach((s) => s.classList.toggle('current', s.dataset.theme === settings.theme));
  $$('.theme-tile').forEach((t) => {
    t.classList.toggle('selected', t.dataset.theme === settings.theme);
    t.setAttribute('aria-pressed', String(t.dataset.theme === settings.theme));
  });

  $('#showBadge').checked = settings.showBadge;
  $('#connectedList').textContent = settings.connected.map((p) => S.platforms[p]).join(', ') || S.panel.connectedNone;
  if (view === 'settings') renderSettings();
  if (view === 'alert') renderAlert();
  if (view === 'goal') renderGoal();
  if (view === 'chat') renderChat();
}

function renderSettings() {
  const ed = $('main [data-view=settings]');
  const keep = (inp, v) => { if (inp !== document.activeElement) inp.value = v; }; // never under the cursor
  keep($('#alertGap'), settings.alertGap);
  keep($('#proxyHost'), settings.proxyHost);
  keep($('#proxyPort'), settings.proxyPort || '');
  $$('[name=proxyMode]').forEach((r) => (r.checked = r.value === settings.proxyMode));
  $$('[name=proxyType]').forEach((r) => (r.checked = r.value === settings.proxyType));
  const show = { proxySystem: settings.proxyMode === 'system', proxyManual: settings.proxyMode === 'manual' };
  $$('[data-only]', ed).forEach((e) => (e.hidden = !show[e.dataset.only]));
}

function renderChat() {
  const ed = $('main [data-view=chat]');
  const c = settings.chat;
  fill(ed, c);
  $$('.chat-tile').forEach((t) => t.classList.toggle('selected', t.dataset.style === c.style));
  const show = {
    off: !c.enabled, badges: c.showBadges, big: c.bigEmotes, nameCustom: c.nameColorMode === 'custom', bgColor: c.bg === 'color',
    borderOn: c.border, typewriter: c.typewriter, ticker: c.layout === 'horizontal', vertical: c.layout === 'vertical', fade: c.fade, bots: c.hideBots,
  };
  $$('[data-only]', ed).forEach((e) => (e.hidden = !show[e.dataset.only]));
  fitChat();
}

function renderAlert() {
  const editor = $('main [data-view=alert]');
  const cfg = settings.alerts[cur];
  editor.dataset.key = cur;
  $('.name', editor).textContent = S.types[cur];
  fill(editor, cfg);
  $$('[name=textColorMode]').forEach((r) => (r.checked = (r.value === 'custom') === (cfg.textColor !== null)));
  $('#alertTheme').options[0].textContent = S.panel.sameAsMain.replace('{theme}', S.themes[settings.theme]);
  $('#alertTheme').value = cfg.theme ?? '';
  $('#alertThemeSwatch').className = `swatch sw-${cfg.theme ?? settings.theme}`;

  const show = {
    off: !cfg.enabled,
    minAmount: 'minAmount' in cfg,
    video: isVideo(cfg.image?.file),
    customSound: cfg.soundMode === 'custom',
    customFrame: cfg.frame === 'custom',
    customColor: cfg.textColor !== null,
    amount: samples[cur].amount > 0,
    tiers: 'tiersOn' in cfg,
    tiersOn: cfg.tiersOn,
  };
  $$('[data-only]', editor).forEach((e) => (e.hidden = !show[e.dataset.only]));
  if (show.tiers) renderTiers(cfg);
  $$('.file', editor).forEach((row) => {
    const f = cfg[row.dataset.kind];
    const fname = $('.fname', row);
    fname.textContent = f ? f.name : row.dataset.kind === 'image' ? S.panel.mediaDefault : S.panel.soundNoFile;
    fname.classList.toggle('default', !f);
    $('.remove', row).hidden = !f;
  });
}

function renderGoal() {
  const ed = $('main [data-view=goal]');
  const g = settings.goals[curGoal];
  ed.dataset.key = curGoal;
  $('.name', ed).textContent = S.goals[curGoal].name;
  $('#goalCounts').textContent = S.goals[curGoal].counts;
  $('#goalTest span').textContent = S.goals[curGoal].test;
  fill(ed, g);
  if (document.activeElement !== $('#goalCurrent')) $('#goalCurrent').value = goalData.state[curGoal].current;
  $('#goalPlus').title = `+${GOAL_STEP[curGoal]}`;
  $('#goalMinus').title = `−${GOAL_STEP[curGoal]}`;
  $$('.goal-tile').forEach((t) => t.classList.toggle('selected', t.dataset.style === g.style));
  drawThumbs();

  const show = {
    off: !g.enabled,
    bgColor: g.bg === 'color',
    box: g.bg !== 'off',
    borderOn: g.bg !== 'off' && g.border,
    goalCustomSound: g.celebrateSound === 'custom',
  };
  $$('[data-only]', ed).forEach((e) => (e.hidden = !show[e.dataset.only]));
  const fname = $('.file .fname', ed);
  fname.textContent = g.sound ? g.sound.name : S.panel.soundNoFile;
  fname.classList.toggle('default', !g.sound);
  $('.file .remove', ed).hidden = !g.sound;
}

(async () => {
  S = await (await fetch('/i18n/en.json')).json();
  try {
    [settings, samples, goalData, { styles: chatStyles, fonts: chatFonts }, chatStatus] = await Promise.all([
      api('GET', '/api/settings'), api('GET', '/api/samples'), api('GET', '/api/goals'), api('GET', '/api/chat/styles'), api('GET', '/api/chat/status'),
    ]);
  } catch (err) {
    return toast(err.message, true);
  }
  build();
  select('alert', cur);
})();
