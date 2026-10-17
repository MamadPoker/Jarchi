// Settings panel. All visible text comes from /i18n/en.json, or /i18n/fa.json in Persian (the "فا | EN" switch).
// The language is the panel's only: overlays, and their previews here, always use en.json.
// Layout: a sidebar with one item per page (a <section data-view>), a top bar with the page's title. Alerts and Goals
// have their own list (LISTS below) next to the editor of the selected item. Previews are the real overlays in scaled iframes: alerts are driven by postMessage, the goal by its own live socket.
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
// Remembered in this browser: the language, the colors.
const remember = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};
const FA = remember.get('jarchi.lang') === 'fa';
document.documentElement.lang = FA ? 'fa' : 'en';
document.documentElement.dir = FA ? 'rtl' : 'ltr';
// Colors: Dark (default), Light, or Same as Windows (the server reads Windows' setting). The top bar switch is temporary, for testing.
const applyTheme = async () => {
  const mode = remember.get('jarchi.mode') || 'dark';
  const theme = mode !== 'windows' ? mode : (await fetch('/api/system-theme').then((r) => r.json()).catch(() => ({}))).theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  remember.set('jarchi.theme', theme); // index.html sets it before the first paint
  $$('.mode button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
};
$$('.mode button').forEach((b) => (b.onclick = () => (remember.set('jarchi.mode', b.dataset.mode), applyTheme())));
addEventListener('focus', () => remember.get('jarchi.mode') === 'windows' && applyTheme()); // Windows' setting may have changed meanwhile
applyTheme();
// Persian digits (and ٪ ٫) in labels; inputs keep theirs.
const fd = (v) => (FA ? String(v).replace(/(?<=\d)\.(?=\d)/g, '٫').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]).replace(/%/g, '٪') : String(v));
const fmt = (n) => n.toLocaleString(FA ? 'fa-IR' : undefined);
const ltr = (s) => (FA ? `\u2066${s}\u2069` : s); // an address inside a Persian sentence keeps its order
let S, EN, settings, samples, goalData; // S: the panel's strings, EN: English for the overlays. goalData = { state, styles, fonts } from /api/goals; state then follows the socket
let chatStyles, chatFonts, chatStatus; // chat style looks and fonts (/api/chat/styles), connection status (follows the socket)
let chatThumbs; // sample messages for the chat style thumbnails (/api/chat/thumbs: random viewers and badges each visit)
let view = 'home', cur = 'follow', curGoal = 'subs', topic = 'start'; // the open page, and the alert, goal and guide topic selected in theirs
let queue = { paused: false, overlays: 0, waiting: 0, now: null }; // the alert queue (follows the socket)
let home, open = {}, feedFilter = 'all'; // Home: { feed, today, started } (/api/home, then the socket), widget pages open now (socket)

const pct = (v) => `${Math.round(v * 100)}%`;
const px = (v) => `${v}px`;
const FORMAT = {
  volume: pct, frameOpacity: pct, frameRadius: px, fontSize: px, bgOpacity: pct, borderWidth: px, radius: px, scale: pct,
  emoteSize: px, bigEmoteSize: px, badgeSize: pct, nameSize: px, padding: px, gap: px, width: px, height: px, fadeZone: px, blur: px,
  tickerSpeed: (v) => `${v} px/s`, maxMessages: (v) => String(v), hideAfter: (v) => (Number(v) ? tpl(S.panel.seconds, { n: v }) : S.panel.never), animSpeed: (v) => `×${v}`,
};
const GOAL_STEP = { subs: 1, kicks: 100, followers: 1 }; // what "Test", "+" and "−" add
const GOAL_SAMPLE = { subs: { current: 32, target: 50 }, kicks: { current: 640, target: 1000 }, followers: { current: 374, target: 500 } }; // numbers on style thumbnails
const isVideo = (file) => /\.(webm|mp4)$/.test(file ?? '');
const tpl = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => v[k] ?? m);
const kickLook = (type, cfg) => type === 'kicks' && cfg.look === 'kick';
// What plays when there's no file: the theme's, or (Kicks in its Kick look) Kick's gift and the Kick chime; bits show Twitch's gem.
const defaultMedia = (kind, kick) => S.panel[kind === 'image' ? (kick ? 'mediaKickGift' : cur === 'bits' ? 'mediaTwitchGem' : 'mediaDefault') : (kick ? 'soundKickDefault' : 'tierNoSound')];
const ACCEPT = { image: 'image/png,image/jpeg,image/gif,image/webp,video/webm,video/mp4,.webm,.mp4', sound: 'audio/mpeg,audio/wav,audio/ogg,.mp3,.wav,.ogg' };
const valueOf = (inp) => (inp.type === 'checkbox' ? inp.checked : ['number', 'range'].includes(inp.type) ? Number(inp.value) : inp.value);
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};

// The lists inside the Alerts and Goals pages: a click opens the item, its switch turns it on or off.
const LISTS = () => ({
  alert: Object.keys(settings.alerts).map((t) => ({ key: t, label: S.types[t], toggle: (on) => patchAlert(t, { enabled: on }) })),
  goal: Object.keys(settings.goals).map((id) => ({ key: id, label: S.goals[id].name, toggle: (on) => patchGoal(id, { enabled: on }) })),
});

// Chat "More options", built from this list: [group label, [[kind, field, options]...]].
// kind: toggle | range | seg | select | color | text. options.only: shown only when CHAT_ONLY[only] is true.
const CHAT_GROUPS = () => [
  ['chatShow', [['toggle', 'showPlatform'], ['toggle', 'showBadges'], ['seg', 'badgeMode', { options: [['important', 'badgesImportant'], ['all', 'badgesAll']], only: 'badges' }],
    ['range', 'badgeSize', { min: 0.5, max: 2, step: 0.05, only: 'badges' }],
    ['seg', 'badgeBg', { options: [['auto', 'badgeBgAuto'], ['always', 'badgeBgAlways'], ['off', 'badgeBgOff']], only: 'badges' }], ['toggle', 'badgeBroadcaster', { only: 'badges' }], ['toggle', 'badgeMod', { only: 'badges' }],
    ['toggle', 'badgeVip', { only: 'badges' }], ['toggle', 'badgeSub', { only: 'badges' }], ['toggle', 'badgeOther', { only: 'badges' }], ['toggle', 'showTime'], ['toggle', 'showColon'],
    ['toggle', 'ogHat'], ['seg', 'hatStyle', { options: [['cap', 'hatCap'], ['beanie', 'hatBeanie'], ['fedora', 'hatFedora']], only: 'hat' }],
    ['select', 'hatPos', { options: [['first', 'hatFirst'], ['last', 'hatLast'], ['badge', 'hatBadge'], ['avatar', 'hatAvatar']], only: 'hat' }]]],
  ['chatEmotes', [['toggle', 'emotesKick'], ['toggle', 'emotesTwitch'], ['toggle', 'emotes7tv'], ['toggle', 'emotesAnimated'], ['range', 'emoteSize', { min: 12, max: 112 }],
    ['toggle', 'bigEmotes'], ['range', 'bigEmoteSize', { min: 16, max: 160, only: 'big' }]]],
  ['chatText', [['select', 'font', { options: chatFonts.map((x) => [x, x]) }], ['range', 'fontSize', { min: 10, max: 72, label: 'messageSize' }], ['range', 'nameSize', { min: 10, max: 72 }],
    ['seg', 'nameColorMode', { label: 'nameColor', options: [['user', 'nameOwn'], ['style', 'nameStyle'], ['custom', 'nameCustom']] }], ['color', 'nameColor', { only: 'nameCustom' }],
    ['toggle', 'readableNames', { only: 'nameOwn' }],
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
    ['text', 'blockedWords', { hint: 'listHint', dir: 'auto' }], ['toggle', 'hideLinks'], ['select', 'source', { options: [['both', 'sourceBoth'], ['kick', 'sourceKick'], ['twitch', 'sourceTwitch']] }]]],
  ['chatFx', [['toggle', 'fxSubGlow'], ['toggle', 'fxFirst'], ['toggle', 'fxRainbowVip'], ['text', 'rainbowUsers', { hint: 'listHint' }], ['toggle', 'fxMention'], ['toggle', 'fxCombo'],
    ['toggle', 'avatars', { hint: 'avatarsHint' }], ['range', 'blur', { min: 0, max: 40 }]]],
  ['chatDebug', [['toggle', 'showTiming']]],
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
    node = el('label', { className: 'field' }, el('span', { textContent: label }), input({ type: kind === 'color' ? 'color' : 'text', maxLength: 1000, ...(o.dir && { dir: o.dir }) }), o.hint ? el('small', { textContent: S.panel[o.hint] }) : '');
  }
  node.firstChild.dataset.help = `chat.${f}`; // the label: build() adds its "?"
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
    f.contentWindow?.postMessage({ strings: EN, cfg, messages: chatThumbs }, location.origin);
  }
}

// The chat preview iframe is as big as the chat (+ a margin), scaled down to fit and centered.
function fitChat() {
  const box = $('.chat-preview'), f = $('#chatPreview'), c = settings.chat;
  const W = c.width + 60, H = c.height + 60;
  const k = Math.min(box.clientWidth / W, box.clientHeight / H, 1);
  Object.assign(f.style, { width: `${W}px`, height: `${H}px`, transform: `translate(${(box.clientWidth - W * k) / 2}px, ${(box.clientHeight - H * k) / 2}px) scale(${k})` });
}

// Chat page status lines, and the top bar's Kick / Twitch pills (green dot = connected).
function renderStatus() {
  const names = { off: 'stOff', connecting: 'stConnecting', connected: 'stConnected', error: 'stError' };
  for (const p of ['kick', 'twitch']) {
    const st = chatStatus[p];
    const e = $(`#${p}Status`);
    e.className = `status st-${st.state}`;
    e.textContent = S.panel[names[st.state]] + (st.state === 'error' && st.detail ? ` · ${S.panel[`err_${st.detail}`] ?? st.detail}` : '');
    const pill = $(`.plat[data-p="${p}"]`);
    pill.classList.toggle('on', st.state === 'connected');
    pill.setAttribute('aria-label', (pill.title = `${S.platforms[p]}: ${e.textContent}`));
  }
}

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

// Change a goal's count (the selected one's by default): { add: n } or { set: n }.
async function goalCount(body, id = curGoal) {
  try {
    goalData.state = await api('PATCH', `/api/goals/${id}`, body);
  } catch (err) {
    toast(err.message, true);
  }
  render();
}

// A goal's row in the Goals list: its count (click it and type another), "/ target", and Reset to 0 (click twice).
function goalCountRow(id) {
  const input = el('input', { type: 'number', min: 0, step: 1, className: 'count-input', onchange: () => goalCount({ set: Math.max(0, Math.round(Number(input.value) || 0)) }, id) });
  input.setAttribute('aria-label', `${S.goals[id].name}: ${S.panel.goalCurrent}`);
  const zero = el('button', { className: 'ghost zero', textContent: S.panel.goalZero });
  twoClick(zero, zero, S.panel.goalZero, S.panel.confirmZero, () => goalCount({ set: 0 }, id));
  // Synced from Kick: Kick's count, read-only, with Kick's K instead of Reset to 0.
  const mark = kickMark();
  mark.hidden = true;
  return el('div', { className: 'goal-count' }, input, el('small', { className: 'of' }), mark, zero);
}

// ---------- Previews ----------
const sample = (type, amount) => ({ ...samples[type], type, platform: $('#testAs').value, test: true, ...(amount !== undefined && { amount }) });
const previewAmount = () => (samples[cur].amount > 0 ? Number($('#previewAmount').value) || 0 : undefined);

const post = (frame, s, event, muted, hold = false) => frame.contentWindow?.postMessage({ strings: EN, settings: s, event, muted, hold }, location.origin);

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

// Open a page (and in Alerts / Goals / Guide, an item of it: without `key`, the one selected before).
function select(v, key) {
  view = v;
  if (v === 'alert') {
    cur = key ?? cur;
    $('#previewAmount').value = samples[cur].amount;
  }
  if (v === 'goal') {
    curGoal = key ?? curGoal;
    const src = `/widgets/goal/${curGoal}?preview`;
    if ($('#goalPreview').getAttribute('src') !== src) $('#goalPreview').src = src;
  }
  if (v === 'chat' && !$('#chatPreview').getAttribute('src')) $('#chatPreview').src = '/widgets/chat?preview';
  if (v === 'home') loadHome(); // today's numbers may have started again at midnight
  if (v === 'settings') showProxyNow();
  if (v === 'guide') {
    if (S.guide.topics[key]) topic = key;
    renderGuide();
  }
  $$('main .view').forEach((s) => (s.hidden = !s.dataset.view.split(' ').includes(v)));
  const page = v === 'theme' ? 'alert' : v; // the theme page is part of Alerts
  $$('.nav-item').forEach((b) => b.setAttribute('aria-current', b.dataset.view === page ? 'page' : 'false'));
  $('#pageTitle').textContent = $(`.nav-item[data-view="${page}"] [data-i18n]`).textContent;
  render();
  preview();
  if (v === 'theme') $$('.theme-tile iframe').forEach((f) => playTile(f));
  if (v === 'chat') {
    fitChat();
    api('GET', '/api/chat/thumbs').then((m) => { chatThumbs = m; drawChatThumbs(); }, () => {});
  }
}

// ---------- Alert queue (its own page) ----------
// One line icon per alert type, in the type's own color (the --dot colors).
const TYPE_ICON = {
  follow: 'M15 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M8.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19 8v6M22 11h-6',
  sub: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  resub: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  gift_sub: 'M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-1-3-5-3-5-1s3 1 5 1zM12 7c1-3 5-3 5-1s-3 1-5 1z',
  kicks: 'M13 2L4 14h7l-1 8 9-12h-7z',
  bits: 'M12 2l8 5v10l-8 5-8-5V7z',
  raid: 'M17 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M21 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8',
};
function typeIcon(type) {
  const i = el('span', { className: 'q-icon', title: S.types[type] });
  i.dataset.key = type;
  i.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${TYPE_ICON[type]}"/></svg>`; // fixed paths, no user text
  return i;
}
// "Rich · Gifted subs · 10": icon, name, type, and the amount (or a resub's months).
function alertRow(a, action) {
  const amount = a.type === 'resub' && a.months ? tpl(S.panel.qMonths, { n: fmt(a.months) }) : a.amount ? fmt(a.amount) : '';
  return el('li', { className: 'q-item' }, typeIcon(a.type),
    el('span', { className: 'q-who' }, el('b', { textContent: a.user, title: a.user, dir: 'auto' }), el('small', { textContent: S.types[a.type] })),
    el('span', { className: 'q-amt', textContent: amount }), action ?? '');
}

function renderQueue() {
  const q = queue, n = q.now;
  for (const c of $$('#qCount, #qNavCount')) c.textContent = fd(q.waiting);
  $('#qNavCount').hidden = !q.waiting; // in the sidebar: only when alerts are waiting
  $('#qPaused').hidden = !q.paused;
  $('#queue').dataset.state = q.paused ? 'paused' : n ? 'playing' : 'idle';
  $('#qNow').replaceChildren(n ? alertRow(n) : el('p', { className: 'q-empty', textContent: S.panel.qIdle }));
  // Progress bar: from where the alert is now to the end, in the time it has left.
  const bar = $('#qBar');
  bar.style.transition = 'none';
  bar.style.width = n ? `${(1 - n.left / n.ms) * 100}%` : '0';
  if (n) {
    bar.getBoundingClientRect(); // start the transition from that width
    bar.style.transition = `width ${n.left}ms linear`;
    bar.style.width = '100%';
  }
  $('#qPause span').textContent = q.paused ? S.panel.qResume : S.panel.qPause;
  $('#qPause').title = q.paused ? S.panel.qResumeHint : S.panel.qPauseHint;
  $('#qSkip').disabled = !n;
  $('#qClear').disabled = !q.waiting;
  $('#qList').replaceChildren(...q.list.map((a) => alertRow(a, el('button', {
    className: 'x', textContent: '×', title: S.panel.qRemove, ariaLabel: S.panel.qRemove, onclick: () => queueCall('DELETE', `queue/${encodeURIComponent(a.id)}`),
  }))));
  $('#qEmpty').hidden = q.list.length > 0;
  $('#qHistory').replaceChildren(...q.history.map((a) => alertRow(a, el('button', {
    className: 'replay', textContent: S.panel.qReplay, onclick: () => queueCall('POST', `replay/${encodeURIComponent(a.id)}`).then((r) => r && toast(S.panel.qReplayed)),
  }))));
  $('#qNoHistory').hidden = q.history.length > 0;
  $('#qNoObs').hidden = q.overlays > 0;
}
const queueCall = (method, what, body) => api(method, `/api/alerts/${what}`, body).then((q) => { queue = q; renderQueue(); return q; }, (err) => toast(err.message, true));

// ---------- Goal marks (panel only): an icon per goal in its colour (CSS [data-goal]), Kick's K for "From Kick" ----------
// Kick's own logo shape (assets/platform-logos/kick.svg), drawn in currentColor so light mode can use a darker green.
const KICK_K = '<svg class="kick-k" viewBox="0 0 26 26" aria-hidden="true"><path fill-rule="evenodd" d="M1 0H9.76711V5.79452H12.589V2.82193H15.5616V0H24.1781V8.61645H21.3561V11.589H18.3836V14.411H21.3561V17.3836H24.1781V26H15.5616V23.1781H12.589V20.2055H9.76711V26H1V0Z"/></svg>';
const GOAL_ICON = {
  subs: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${TYPE_ICON.sub}"/></svg>`, // star
  kicks: KICK_K,
  followers: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.6-4.5-9.4-9.2C1.4 8.1 3.5 4.7 7 4.7c2 0 3.6 1.1 5 2.9 1.4-1.8 3-2.9 5-2.9 3.5 0 5.6 3.4 4.4 6.6-1.8 4.7-9.4 9.2-9.4 9.2z"/></svg>', // heart
};
const svgIn = (cls, markup) => { // fixed markup only
  const s = el('span', { className: cls });
  s.innerHTML = markup;
  return s;
};
const goalIcon = (id) => svgIn('goal-icon', GOAL_ICON[id]);
// "From Kick": the K, with the words as its tooltip and for screen readers.
function kickMark() {
  const s = svgIn('from-kick', KICK_K);
  s.title = S.panel.fromKick;
  s.setAttribute('role', 'img');
  s.setAttribute('aria-label', S.panel.fromKick);
  return s;
}

// ---------- Home ----------
const COPY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>';
const copyLink = (url, msg = S.panel.copied) => navigator.clipboard.writeText(url).then(() => toast(msg));
// The widget pages: [id the server counts them by, name, OBS link].
const widgetPages = () => [
  ['alerts', S.panel.groupAlerts, `${location.origin}/widgets/alerts`],
  ['chat', S.panel.chatName, `${location.origin}/widgets/chat`],
  ...Object.keys(settings.goals).map((id) => [id, S.goals[id].name, `${location.origin}/widgets/goal/${id}`]),
];
const FEED_FILTERS = { all: null, subs: ['sub', 'resub', 'gift_sub'], kicks: ['kicks'], raids: ['raid'], follows: ['follow'] };

// What's missing before going live: [text, the page (and item) that fixes it]. Widgets switched off aren't needed.
function issues() {
  const out = ['kick', 'twitch'].filter((p) => chatStatus[p].state !== 'connected')
    .map((p) => [tpl(S.panel.issuePlatform, { platform: S.platforms[p] }), ['chat']]); // the channel names are on the Chat page for now
  if (!open.alerts) out.push([S.panel.issueAlerts, ['alert']]);
  if (settings.chat.enabled && !open.chat) out.push([S.panel.issueChat, ['chat']]);
  for (const [id, g] of Object.entries(settings.goals)) if (g.enabled && !open[id]) out.push([tpl(S.panel.issueGoal, { goal: S.goals[id].name }), ['goal', id]]);
  return out;
}

// "gifted 5 subs", "sent 100 Kicks"; feedDidOne for 1 (and a resub without its months).
function did(ev) {
  const n = ev.type === 'resub' ? ev.months : ev.amount;
  const one = S.panel.feedDidOne[ev.type];
  return one && (n === 1 || (ev.type === 'resub' && !n)) ? one : tpl(S.panel.feedDid[ev.type], { n: fmt(n) });
}
const since = new Intl.RelativeTimeFormat(FA ? 'fa' : 'en', { numeric: 'auto', style: 'short' });
function ago(t) {
  const s = (Date.now() - t) / 1000;
  return s < 60 ? since.format(0, 'second') : s < 3600 ? since.format(-Math.floor(s / 60), 'minute')
    : s < 86400 ? since.format(-Math.floor(s / 3600), 'hour') : since.format(-Math.floor(s / 86400), 'day');
}
function uptime() {
  const m = Math.floor((Date.now() - home.started) / 60000);
  return fd(tpl(S.panel[m < 60 ? 'uptimeM' : 'uptimeHM'], { h: Math.floor(m / 60), m: m % 60 }));
}

const loadHome = () => api('GET', '/api/home').then((h) => { home = h; if (view === 'home') renderHome(); }, () => {});

function renderHome() {
  const missing = issues();
  $('#banner').classList.toggle('ready', !missing.length);
  $('#bannerTitle').textContent = S.panel[missing.length ? 'notReadyTitle' : 'readyTitle'];
  $('#bannerHint').hidden = missing.length > 0;
  $('#issues').replaceChildren(...missing.map(([text, page]) => el('li', {}, el('span', { textContent: text }),
    el('button', { textContent: S.panel.fix, onclick: () => select(...page) }))));

  // Live feed: newest first; a test button's alert says so.
  $$('#feedChips button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === feedFilter)));
  const types = FEED_FILTERS[feedFilter];
  const rows = home.feed.filter((ev) => !types || types.includes(ev.type));
  $('#feedList').replaceChildren(...rows.map((ev) => el('li', { className: 'feed-row' },
    ev.platform === 'test' ? typeIcon(ev.type) : el('img', { className: 'feed-logo', src: `/assets/platform-logos/${ev.platform}.svg`, alt: S.platforms[ev.platform], title: S.platforms[ev.platform] }),
    el('span', { className: 'feed-what' }, el('b', { textContent: ev.user, dir: 'auto' }), ` ${did(ev)}`, ev.test ? el('span', { className: 'pill', textContent: S.platforms.test }) : ''),
    el('small', { textContent: ago(ev.time) }),
    el('button', { className: 'replay', textContent: S.panel.qReplay, onclick: () => queueCall('POST', `replay/${encodeURIComponent(ev.id)}`).then((q) => q && toast(S.panel.qReplayed)) }))));
  $('#feedEmpty').hidden = rows.length > 0;

  // Widgets: green when a page of it is open (in OBS) right now.
  $('#widgetList').replaceChildren(...widgetPages().map(([id, name, url]) => {
    const copy = el('button', { className: 'icon-btn', title: S.panel.copyObs, ariaLabel: `${S.panel.copyObs}: ${name}`, onclick: () => copyLink(url) });
    copy.innerHTML = COPY_ICON; // fixed markup
    return el('li', { className: `widget-row${open[id] ? ' on' : ''}` }, el('i', { className: 'state-dot' }),
      el('span', { className: 'stack' }, el('b', { textContent: name }), el('small', { textContent: S.panel[open[id] ? 'widgetOpen' : 'widgetClosed'] })), copy);
  }));

  // Goals: count / target (Kick's when synced) and a bar. They move by themselves; a count is fixed by hand on the Goals page.
  $('#homeGoals').replaceChildren(...Object.keys(settings.goals).map((id) => {
    const { current, target, kick } = goalData.state[id];
    const bar = el('i');
    bar.style.width = `${Math.min(100, (current / target) * 100)}%`;
    const row = el('div', { className: 'home-goal' },
      el('div', { className: 'row' }, goalIcon(id), el('b', { textContent: S.goals[id].name }), el('small', { textContent: `${fmt(current)} / ${fmt(target)}` }), kick ? kickMark() : ''),
      el('div', { className: 'goal-bar' }, bar));
    row.dataset.goal = id; // its colour
    return row;
  }));

  $('#statAlerts').textContent = fmt(home.today.alerts);
  $('#statChat').textContent = fmt(home.today.chat);
  $('#statUptime').textContent = uptime();
}

// Two clicks instead of confirm(): no blocking dialog. The first click arms the button for 3 seconds.
function twoClick(btn, label, idle, confirm, action) {
  let armed;
  const disarm = () => {
    clearTimeout(armed);
    armed = null;
    label.textContent = idle;
    btn.classList.remove('armed');
  };
  btn.onclick = () => {
    if (armed) return disarm(), action();
    armed = setTimeout(disarm, 3000);
    btn.classList.add('armed');
    label.textContent = confirm;
  };
}

// ---------- Media by amount: one card per fixed tier, rebuilt only when the tiers change ----------
let tiersDrawn = '';
function renderTiers(cfg) {
  const key = JSON.stringify([cur, cfg.tiers, cfg.look]);
  if (key === tiersDrawn) return;
  tiersDrawn = key;
  $('#tiers').replaceChildren(...cfg.tiers.map((t) => {
    const on = el('input', { type: 'checkbox', checked: t.on, onchange: () => send('PATCH', `/api/tiers/${cur}/${t.amount}`, { on: on.checked }) });
    on.setAttribute('aria-label', S.panel.tierOn);
    const amount = tpl(S.panel.tierAmount[cur][t.amount === 1 ? 'one' : 'many'], { n: fmt(t.amount) });
    const name = t.gift // Kicks: Kick's own gift, its icon and name
      ? [el('img', { className: 'gift-icon', alt: '', src: `/assets/kick-gifts/${t.gift.id}.webp` }),
        el('b', { textContent: S.kickGifts[t.gift.id] ?? t.gift.id }), el('small', { textContent: amount })]
      : cur === 'bits' ? [el('img', { className: 'gift-icon', alt: '', src: `/assets/twitch-bits/${t.amount}.gif` }), el('b', { textContent: amount })] // Twitch's gem
      : [el('b', { textContent: amount })];
    return el('div', { className: `tier${t.on ? '' : ' off'}` },
      el('div', { className: 'tier-head' },
        el('label', { className: 'switch' }, on, el('span')),
        el('span', { className: 'tier-name' }, ...name),
        el('button', { textContent: S.panel.tierTest, onclick: () => testTier(t.amount) })),
      tierFile(t, 'image', kickLook(cur, cfg)), tierFile(t, 'sound', kickLook(cur, cfg)));
  }));
}

// A tier's image or sound: the file's name (or the theme's), Upload (replaces it), Remove. Wired like the alert's own .file rows.
function tierFile(t, kind, kick) {
  const f = t[kind];
  const row = el('div', { className: 'tier-files' },
    el('span', { className: 'tier-label', textContent: S.panel[kind === 'image' ? 'mediaTitle' : 'soundTitle'] }),
    el('div', { className: 'chips' },
      el('span', { className: `fname${f ? '' : ' default'}`, textContent: f ? f.name : defaultMedia(kind, kick), title: f?.name ?? '' }),
      el('button', { className: 'ghost add upload', textContent: S.panel.upload }),
      el('button', { className: 'ghost add remove', textContent: S.panel.remove, hidden: !f }),
      el('input', { type: 'file', hidden: true, accept: ACCEPT[kind] })));
  const url = () => `/api/tiers/${cur}/${t.amount}/${kind}`;
  wireFile(row, url, url);
  return row;
}

// A tier's Test: plays it here in the preview and sends it to OBS, with the tier's amount.
function testTier(amount) {
  $('#previewAmount').value = amount;
  preview();
  api('POST', `/api/test/${cur}`, { platform: $('#testAs').value, amount }).then(() => toast(S.panel.testSent), (err) => toast(err.message, true));
}

// ---------- Settings: proxy ----------
const proxyLabel = (p) => ltr(`${p.host}:${p.port} (${p.type === 'socks5' ? 'SOCKS5' : 'HTTP'})`);
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

// ---------- Help ("?") and Guide text ----------
// `code` stays left to right (links, {user}), **bold** names a button; {alertsUrl}-style names become this PC's links.
const LINKS = {
  panelUrl: location.origin, alertsUrl: `${location.origin}/widgets/alerts`, chatUrl: `${location.origin}/widgets/chat`,
  goalSubsUrl: `${location.origin}/widgets/goal/subs`, goalKicksUrl: `${location.origin}/widgets/goal/kicks`,
};
const rich = (s) => tpl(s, LINKS).replace(/ × /g, '\u00a0×\u00a0').split('`').flatMap((part, i) => (i % 2 // "420 × 600" stays on one line
  ? [el('code', { dir: 'ltr', textContent: part })]
  : part.split('**').map((t, j) => (j % 2 ? el('b', { textContent: t }) : t))));
const helpText = (key) => key.split('.').reduce((o, k) => o?.[k], S.help);

// A "?" after a setting's label (data-help="alert.volume" -> S.help.alert.volume). Its text is the "?"'s
// description for screen readers, and one shared tooltip shows it while the mouse is on the "?", on keyboard focus or a tap.
// The "?" is a <span role="button">, not a <button>: a <label> belongs to its first <button> or <input>, so a <button>
// "?" would take the row's clicks (and focus) away from the row's own switch or field.
let helpCount = 0;
function addHelp(host) {
  const text = helpText(host.dataset.help);
  if (!text) return;
  const desc = el('span', { id: `help-${++helpCount}`, hidden: true, textContent: tpl(text, LINKS).replace(/`|\*\*/g, '') });
  const q = el('span', { className: 'help', tabIndex: 0, textContent: S.panel.helpMark }, desc);
  q.dataset.tip = text;
  q.setAttribute('role', 'button');
  q.setAttribute('aria-label', S.panel.help);
  q.setAttribute('aria-describedby', desc.id);
  host.append(q);
}
// To the side of the "?" (left in English, right in Persian), on the other side if there's no room, inside the window.
function showTip(q) {
  const tip = $('#tip'), gap = 8;
  tip.replaceChildren(...rich(q.dataset.tip));
  Object.assign(tip.style, { left: '0px', top: '0px' }); // measured at full width, not squeezed by where it was last
  tip.hidden = false;
  const r = q.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
  const left = r.left - gap - w, right = r.right + gap;
  const fitsLeft = left >= gap, fitsRight = right + w <= innerWidth - gap;
  const x = FA ? (fitsRight || !fitsLeft ? right : left) : (fitsLeft || !fitsRight ? left : right);
  Object.assign(tip.style, {
    left: `${Math.min(Math.max(gap, x), innerWidth - w - gap)}px`,
    top: `${Math.min(Math.max(gap, r.top + r.height / 2 - h / 2), innerHeight - h - gap)}px`,
  });
}
const hideTip = () => ($('#tip').hidden = true);
function wireHelp() {
  const helpOf = (e) => e.target.closest?.('.help');
  addEventListener('mouseover', (e) => helpOf(e) && showTip(helpOf(e)));
  addEventListener('mouseout', (e) => { if (helpOf(e) && !helpOf(e).contains(e.relatedTarget)) hideTip(); }); // left the "?"
  addEventListener('focusin', (e) => helpOf(e) && showTip(helpOf(e)));
  addEventListener('focusout', (e) => helpOf(e) && hideTip());
  addEventListener('click', (e) => {
    if (!helpOf(e)) return hideTip(); // a tap anywhere else closes it
    e.preventDefault(); // inside a <label>: don't flip its switch
    showTip(helpOf(e));
  });
  addEventListener('scroll', hideTip, true);
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideTip();
    if (helpOf(e) && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); showTip(helpOf(e)); } // a role="button": Space doesn't scroll
  });
}

// Guide page: the topic list, then the topic: intro, numbered step cards, a tip, and questions that open their answers.
function renderGuide() {
  $$('#guideTopics button').forEach((b) => b.setAttribute('aria-current', String(b.dataset.topic === topic)));
  const t = S.guide.topics[topic];
  $('#guideBody').replaceChildren(
    el('h2', { textContent: t.title }),
    el('p', { className: 'guide-intro' }, ...rich(t.intro)),
    t.steps.length ? el('ol', { className: 'steps' }, ...t.steps.map(([title, text], i) => el('li', { className: 'step' },
      el('span', { className: 'step-n', textContent: fd(i + 1) }),
      el('div', {}, el('b', { textContent: title }), el('p', {}, ...rich(text)))))) : '',
    t.tip ? el('aside', { className: 'tip' }, el('b', { textContent: S.guide.tip }), el('p', {}, ...rich(t.tip))) : '',
    ...(t.faq ?? []).map(({ q, a }) => el('details', { className: 'faq' },
      el('summary', { textContent: q }), el('ul', {}, ...a.map((line) => el('li', {}, ...rich(line)))))),
  );
}

// ---------- Build once ----------
function build() {
  document.documentElement.lang = S.lang;
  document.documentElement.dir = S.dir;
  document.title = S.panel.title;

  // Sidebar: the brand (a gold first letter; in Persian, zero-width joiners keep it joined to the next one) and the pages.
  const [first, ...rest] = S.panel.title, zwj = FA ? String.fromCharCode(0x200d) : '';
  $('#brand').append(el('span', { className: 'j', textContent: first + zwj }), zwj + rest.join(''));
  $$('.nav-item').forEach((b) => (b.onclick = () => select(b.dataset.view)));

  // Alerts and Goals pages: their list. An alert's row also gets a swatch that render() shows when it has its own theme.
  for (const [v, items] of Object.entries(LISTS())) {
    $(`#${v}List`).append(...items.map((it) => {
      const sw = el('input', { type: 'checkbox', onchange: () => it.toggle(sw.checked) });
      sw.setAttribute('aria-label', it.label);
      const row = el('li', { className: 'nav-row' },
        el('button', { className: 'nav-btn', onclick: () => select(v, it.key) }, v === 'goal' ? goalIcon(it.key) : '', el('span', { textContent: it.label }), v === 'alert' ? el('span', { className: 'swatch mini', hidden: true }) : ''),
        el('label', { className: 'switch' }, sw, el('span')));
      row.dataset.key = it.key;
      if (v === 'goal') {
        row.dataset.goal = it.key; // its colour
        row.append(goalCountRow(it.key));
      }
      return row;
    }));
  }

  // Alerts page: the main theme (opens the theme page), with a swatch per theme (render() outlines the current one).
  $('#themeSwatches').append(...Object.entries(S.themes).map(([id, name]) => {
    const sw = el('span', { className: `swatch sw-${id}`, title: name });
    sw.dataset.theme = id;
    return sw;
  }));
  $('#themeRow').onclick = () => select('theme');

  // Home: feed filters, a test alert of any type, and the OBS links menu (closes on a click elsewhere or Escape).
  $('#feedChips').append(...Object.keys(FEED_FILTERS).map((f) => {
    const b = el('button', { textContent: S.panel.feedFilters[f], onclick: () => { feedFilter = f; renderHome(); } });
    b.dataset.filter = f;
    return b;
  }));
  $('#homeTest').onclick = () => {
    const types = Object.keys(settings.alerts);
    api('POST', `/api/test/${types[Math.floor(Math.random() * types.length)]}`, { platform: $('#testAs').value }).then(() => toast(S.panel.testSent), (err) => toast(err.message, true));
  };
  const showMenu = (on) => {
    $('#obsMenu').hidden = !on;
    $('#obsMenuBtn').setAttribute('aria-expanded', String(on));
  };
  $('#obsMenu').append(...widgetPages().map(([, name, url]) => {
    const b = el('button', { onclick: () => { showMenu(false); copyLink(url); } }, el('span', { textContent: name }));
    b.insertAdjacentHTML('beforeend', COPY_ICON);
    return b;
  }));
  $('#obsMenuBtn').onclick = () => showMenu($('#obsMenu').hidden);
  addEventListener('click', (e) => { if (!e.target.closest?.('.menu')) showMenu(false); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') showMenu(false); });
  setInterval(() => view === 'home' && loadHome(), 30000); // "2 min ago", uptime, and today's numbers from 0 after midnight

  // Top bar: Kick / Twitch status opens Connections. Language: the page reloads in the other language and comes back to what was open.
  $$('.plat').forEach((b) => (b.onclick = () => select('connections')));
  $$('.lang button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.lang === S.lang));
    b.onclick = () => {
      if (b.dataset.lang === S.lang) return;
      remember.set('jarchi.lang', b.dataset.lang);
      try { sessionStorage.setItem('jarchi.back', JSON.stringify([view, { alert: cur, goal: curGoal, guide: topic }[view]])); } catch {}
      location.reload();
    };
  });

  // Guide: one button per topic.
  $('#guideTopics').append(...Object.entries(S.guide.topics).map(([id, t]) => {
    const b = el('button', { textContent: t.title, onclick: () => {
      topic = id;
      renderGuide();
      const top = $('#guideBody').getBoundingClientRect().top;
      if (top < 60) scrollBy(0, top - 80); // scrolled down a long topic: back to the new topic's start (below the top bar)
    } });
    b.dataset.topic = id;
    return b;
  }));

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

  // Alerts page: OBS link.
  const obsUrl = `${location.origin}/widgets/alerts`;
  $('#obsUrl').value = obsUrl;
  $('#copy').title = S.panel.copyObsHint;
  $('#copy').onclick = () => copyLink(obsUrl);

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
  twoClick($('#goalZero'), $('#goalZero'), S.panel.goalZero, S.panel.confirmZero, () => goalCount({ set: 0 }));
  $('#goalResetStyle').onclick = () => send('POST', `/api/goals/${curGoal}/reset-style`);
  $('#kickSync').onchange = (e) => send('PATCH', '/api/settings', { kickGoalSync: e.target.checked });
  $$('.from-kick', goalEd).forEach((m) => (m.innerHTML = KICK_K)); // Target / Current: Kick's K (tooltip from data-title)
  $('#goalCopy').title = S.panel.goalCopyHint;
  $('#goalCopy').onclick = () => copyLink(`${location.origin}/widgets/goal/${curGoal}`, S.panel.goalCopied);
  // Counts and chat status change on their own (events, connections), so follow them live.
  const socket = io();
  socket.on('goals', (state) => {
    goalData.state = state;
    render();
  });
  socket.on('chatStatus', (st) => {
    chatStatus = st;
    renderStatus();
    if (view === 'home') renderHome();
  });
  // Home: new events (also from the test buttons), today's chat count, widget pages opening and closing.
  socket.on('event', (ev) => {
    home.feed.unshift(ev);
    home.feed.length = Math.min(home.feed.length, 20);
    if (!ev.test) home.today.alerts++;
    if (view === 'home') renderHome();
  });
  socket.on('chat', (m) => { if (!m.test) $('#statChat').textContent = fmt(++home.today.chat); });
  socket.on('widgets', (o) => {
    open = o;
    if (view === 'home') renderHome();
  });
  socket.on('alertQueue', (q) => {
    queue = q;
    renderQueue();
  });
  $('#qPause').onclick = () => queueCall('POST', 'pause', { paused: !queue.paused });
  $('#qSkip').onclick = () => queueCall('POST', 'skip');
  twoClick($('#qClear'), $('#qClear span'), S.panel.qClear, S.panel.qConfirmClear, () => queueCall('POST', 'clear').then((q) => q && toast(S.panel.qCleared)));

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
  $('#chatCopy').onclick = () => copyLink(`${location.origin}/widgets/chat`, S.panel.chatCopied);
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
  twoClick($('#resetAll'), $('#resetAll'), S.panel.resetAll, S.panel.confirmResetAll, () => send('POST', '/api/reset'));

  $$('[data-i18n]').forEach((e) => (e.textContent = S.panel[e.dataset.i18n]));
  $$('[data-title]').forEach((e) => e.setAttribute('aria-label', (e.title = S.panel[e.dataset.title])));
  $$('[data-aria]').forEach((e) => e.setAttribute('aria-label', S.panel[e.dataset.aria]));
  $$('[data-help]').forEach(addHelp); // after data-i18n, which sets the labels' text
  $$('input[type=text]:not([dir]), input[type=number]:not([dir])').forEach((i) => (i.dir = 'ltr')); // links, {user}, names, numbers
  wireHelp();
}

// Range sliders: filled track + value label (labels are per editor: both editors have e.g. "volume").
function showRange(inp) {
  inp.style.setProperty('--fill', `${((inp.value - inp.min) / (inp.max - inp.min)) * 100}%`);
  const out = $(`[data-out="${inp.dataset.f}"]`, inp.closest('.view'));
  if (out) out.textContent = fd(FORMAT[inp.dataset.f](inp.value));
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
  for (const [list, all, selected] of [['#alertList', settings.alerts, cur], ['#goalList', settings.goals, curGoal]]) {
    $$(`${list} .nav-row`).forEach((row) => {
      const cfg = all[row.dataset.key];
      row.classList.toggle('active', row.dataset.key === selected);
      row.classList.toggle('off', !cfg.enabled);
      $('input', row).checked = cfg.enabled;
      const count = $('.count-input', row); // goals: the count (never under the cursor), Kick's when synced
      if (count) {
        const st = goalData.state[row.dataset.key];
        if (count !== document.activeElement) count.value = st.current;
        count.readOnly = st.kick;
        $('.of', row).textContent = `/ ${fmt(st.target)}`;
        $('.from-kick', row).hidden = !st.kick;
        $('.zero', row).hidden = st.kick;
      }
      const own = $('.swatch.mini', row);
      if (!own) return;
      own.hidden = !cfg.theme;
      own.className = `swatch mini sw-${cfg.theme}`;
      own.title = cfg.theme ? S.themes[cfg.theme] : '';
    });
  }

  $('#themeSwatch').className = `swatch sw-${settings.theme}`;
  $('#themeName').textContent = S.themes[settings.theme];
  $$('#themeSwatches .swatch').forEach((s) => s.classList.toggle('current', s.dataset.theme === settings.theme));
  $$('.theme-tile').forEach((t) => {
    t.classList.toggle('selected', t.dataset.theme === settings.theme);
    t.setAttribute('aria-pressed', String(t.dataset.theme === settings.theme));
  });

  // Goals page: "Sync from Kick", and which goals the Kick channel has.
  $('#kickSync').checked = settings.kickGoalSync;
  const onKick = Object.keys(settings.goals).filter((id) => goalData.state[id].onKick).map((id) => S.goals[id].name);
  $('#kickSyncHint').textContent = !settings.chat.kickChannel ? S.panel.kickSyncNoChannel
    : onKick.length ? tpl(S.panel.kickSyncOnKick, { goals: onKick.join(FA ? '، ' : ', ') }) : S.panel.kickSyncNone;

  $('#showBadge').checked = settings.showBadge;
  $('#connectedList').textContent = settings.connected.map((p) => S.platforms[p]).join(FA ? '، ' : ', ') || S.panel.connectedNone;
  if (view === 'settings') renderSettings();
  if (view === 'alert') renderAlert();
  if (view === 'goal') renderGoal();
  if (view === 'chat') renderChat();
  if (view === 'home') renderHome();
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
    nameOwn: c.nameColorMode === 'user', hat: c.ogHat,
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
    look: 'look' in cfg,
    kickLook: kickLook(cur, cfg),
    themed: !kickLook(cur, cfg),
  };
  $$('[data-only]', editor).forEach((e) => (e.hidden = !show[e.dataset.only]));
  if (show.tiers) renderTiers(cfg);
  $('[name=soundMode][value=theme] + span', editor).textContent = S.panel[show.kickLook ? 'soundKick' : 'soundTheme']; // in the Kick look, the default sound is the Kick chime
  $$('.file', editor).forEach((row) => {
    const f = cfg[row.dataset.kind];
    const fname = $('.fname', row);
    fname.textContent = f ? f.name : row.dataset.kind === 'image' ? defaultMedia('image', kickLook(cur, cfg)) : S.panel[kickLook(cur, cfg) ? 'soundNoFileKick' : 'soundNoFile'];
    fname.classList.toggle('default', !f);
    $('.remove', row).hidden = !f;
  });
}

function renderGoal() {
  const ed = $('main [data-view=goal]');
  const g = settings.goals[curGoal];
  ed.dataset.key = ed.dataset.goal = curGoal;
  $('.title .goal-icon', ed).innerHTML = GOAL_ICON[curGoal]; // fixed markup
  $('.name', ed).textContent = S.goals[curGoal].name;
  $('#goalCounts').textContent = S.goals[curGoal].counts;
  $('#goalTest span').textContent = S.goals[curGoal].test;
  fill(ed, g);
  // Synced from Kick: Kick's count and target, read-only (no −, +, Test or Reset to 0).
  const st = goalData.state[curGoal], target = $('[data-f=target]', ed);
  if (st.kick) target.value = st.target;
  target.readOnly = $('#goalCurrent').readOnly = st.kick;
  $('#goalMinus').disabled = $('#goalPlus').disabled = $('#goalTest').disabled = st.kick;
  if (document.activeElement !== $('#goalCurrent')) $('#goalCurrent').value = st.current;
  $('#goalPlus').title = fd(`+${GOAL_STEP[curGoal]}`);
  $('#goalMinus').title = fd(`−${GOAL_STEP[curGoal]}`);
  $$('.goal-tile').forEach((t) => t.classList.toggle('selected', t.dataset.style === g.style));
  drawThumbs();

  const show = {
    off: !g.enabled,
    bgColor: g.bg === 'color',
    box: g.bg !== 'off',
    borderOn: g.bg !== 'off' && g.border,
    goalCustomSound: g.celebrateSound === 'custom',
    subsGoal: curGoal === 'subs', // "Also count Twitch subs": the Kicks goal is Kick's only
    fromKick: st.kick,
    manual: !st.kick,
  };
  $$('[data-only]', ed).forEach((e) => (e.hidden = !show[e.dataset.only]));
  const fname = $('.file .fname', ed);
  fname.textContent = g.sound ? g.sound.name : S.panel.soundNoFile;
  fname.classList.toggle('default', !g.sound);
  $('.file .remove', ed).hidden = !g.sound;
}

(async () => {
  EN = await (await fetch('/i18n/en.json')).json();
  S = FA ? await (await fetch('/i18n/fa.json')).json() : EN;
  try {
    [settings, samples, goalData, { styles: chatStyles, fonts: chatFonts }, chatStatus, home] = await Promise.all([
      api('GET', '/api/settings'), api('GET', '/api/samples'), api('GET', '/api/goals'), api('GET', '/api/chat/styles'), api('GET', '/api/chat/status'), api('GET', '/api/home'),
    ]);
  } catch (err) {
    return toast(err.message, true);
  }
  build();
  // Back from a language switch: open what was open.
  let back;
  try {
    back = JSON.parse(sessionStorage.getItem('jarchi.back'));
    sessionStorage.removeItem('jarchi.back');
  } catch {}
  const [v, key] = back ?? [];
  const ok = v === 'alert' ? key in settings.alerts : v === 'goal' ? key in settings.goals : v === 'theme' || $$('.nav-item').some((b) => b.dataset.view === v);
  select(ok ? v : 'home', ok ? key : undefined);
})();
