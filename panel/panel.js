// Settings panel. All visible text comes from /i18n/en.json.
// Sections are plain <section id> elements picked by the URL hash: #alerts, #alerts/<type>, #themes, #settings.
// The preview and the theme tiles are the real overlay (/widgets/alerts/?preview) in scaled iframes, driven by postMessage.
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
let S, settings, samples, cur = null; // cur = the alert type being edited, or null on the list

const pct = (v) => `${Math.round(v * 100)}%`;
const px = (v) => `${v}px`;
const FORMAT = { volume: pct, frameOpacity: pct, frameRadius: px, fontSize: px };
const isVideo = (file) => /\.(webm|mp4)$/.test(file ?? '');

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

// ---------- Preview ----------
const sample = (type, amount) => ({ ...samples[type], type, platform: $('#testAs').value, test: true, ...(amount !== undefined && { amount }) });
const post = (frame, s, event, muted) => frame.contentWindow?.postMessage({ strings: S, settings: s, event, muted }, location.origin);
const previewAmount = () => (samples[cur].amount > 0 ? Number($('#previewAmount').value) || 0 : undefined);

function preview() {
  if (cur) post($('#preview'), settings, sample(cur, previewAmount()), !$('#previewSound').checked);
}

// Theme tiles loop the sub alert in their own theme: no custom media, muted, short.
function playTile(frame) {
  const sub = { ...settings.alerts.sub, image: null, frame: 'theme', textColor: null, textPos: 'below', duration: 2.6 };
  post(frame, { theme: frame.dataset.theme, alerts: { sub } }, sample('sub'), true);
}

// Scale each 1920x1080 iframe down to its box.
const fit = new ResizeObserver((entries) => {
  for (const e of entries) e.target.style.setProperty('--k', e.contentRect.width / 1920);
});

// ---------- Navigation ----------
function route() {
  const [section, type] = location.hash.slice(1).split('/');
  const id = $$('main > section').some((s) => s.id === section) ? section : 'alerts';
  $$('main > section').forEach((s) => (s.hidden = s.id !== id));
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.hash === `#${id}`));
  cur = id === 'alerts' && type in settings.alerts ? type : null;
  $('#list').hidden = !!cur;
  $('#detail').hidden = !cur;
  if (cur) {
    $('#previewAmount').value = samples[cur].amount;
    scrollTo(0, 0);
    preview();
  }
  if (id === 'themes') $$('.theme iframe').forEach(playTile);
  render();
}

// ---------- Build once ----------
function build() {
  document.documentElement.lang = S.lang;
  document.documentElement.dir = S.dir;

  // Alert list: one row per type with its own on/off switch.
  for (const type of Object.keys(settings.alerts)) {
    const row = $('#rowTpl').content.firstElementChild.cloneNode(true);
    row.dataset.type = type;
    $('.item-link', row).href = `#alerts/${type}`;
    $('.item-name', row).textContent = S.types[type];
    const sw = $('input', row);
    sw.setAttribute('aria-label', S.types[type]);
    sw.onchange = () => patchAlert(type, { enabled: sw.checked });
    $('#rows').append(row);
  }

  // Alert settings: every [data-f] input saves its field for the alert being edited.
  $$('#detail [data-f]').forEach((inp) => inp.addEventListener('change', () => {
    const v = inp.type === 'checkbox' ? inp.checked : ['text', 'radio', 'color'].includes(inp.type) ? inp.value : Number(inp.value);
    patchAlert(cur, { [inp.dataset.f]: v });
  }));
  $$('#detail input[type=range]').forEach((inp) => inp.addEventListener('input', () => showRange(inp)));
  $$('[name=textColorMode]').forEach((r) => (r.onchange = () => patchAlert(cur, { textColor: r.value === 'custom' ? $('[data-f=textColor]').value : null })));
  $$('#detail .file').forEach((row) => {
    const kind = row.dataset.kind;
    const input = $('input', row);
    $('.upload', row).onclick = () => input.click();
    input.onchange = () => {
      const f = input.files[0];
      input.value = '';
      if (f) send('POST', `/api/upload/${cur}/${kind}`, f, { 'content-type': f.type || 'application/octet-stream', 'x-filename': encodeURIComponent(f.name) });
    };
    $('.remove', row).onclick = () => send('DELETE', `/api/upload/${cur}/${kind}`);
  });
  $('#play').onclick = preview;
  $('#previewAmount').onchange = preview;
  $('#test').onclick = () => api('POST', `/api/test/${cur}`, { platform: $('#testAs').value, amount: previewAmount() })
    .then(() => toast(S.panel.testSent), (err) => toast(err.message, true));
  $('#reset').onclick = () => send('POST', `/api/reset/${cur}`);
  $('#preview').onload = preview;

  // Themes: each tile is the real overlay, looping a sample in that theme.
  for (const [id, name] of Object.entries(S.themes)) {
    const frame = Object.assign(document.createElement('iframe'), { src: '/widgets/alerts/?preview=tile', title: name, tabIndex: -1 });
    frame.dataset.theme = id;
    frame.setAttribute('aria-hidden', 'true');
    frame.onload = () => playTile(frame);
    const box = Object.assign(document.createElement('div'), { className: 'preview' });
    box.append(frame);
    const b = Object.assign(document.createElement('button'), { className: 'theme' });
    b.dataset.theme = id;
    b.append(box, name);
    b.onclick = () => send('PATCH', '/api/settings', { theme: id });
    $('#themeGrid').append(b);
  }
  setInterval(() => { if (!$('#themes').hidden) $$('.theme iframe').forEach(playTile); }, 4000);

  // Settings
  $('#obsUrl').value = `${location.origin}/widgets/alerts`;
  $('#copy').onclick = () => navigator.clipboard.writeText($('#obsUrl').value).then(() => toast(S.panel.copied));
  $('#showBadge').onchange = (e) => send('PATCH', '/api/settings', { showBadge: e.target.checked });
  for (const [id, name] of Object.entries(S.platforms)) $('#testAs').append(new Option(name, id));
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

  $$('.preview').forEach((el) => fit.observe(el));
  $$('[data-i18n]').forEach((el) => (el.textContent = S.panel[el.dataset.i18n]));
  addEventListener('hashchange', route);
}

// Range sliders: filled track + value label.
function showRange(inp) {
  inp.style.setProperty('--fill', `${((inp.value - inp.min) / (inp.max - inp.min)) * 100}%`);
  const out = $(`[data-out="${inp.dataset.f}"]`);
  if (out) out.textContent = FORMAT[inp.dataset.f](inp.value);
}

// One-line summary for the alert list, e.g. "kick-emote.gif · theme sound".
function summary(cfg) {
  const media = cfg.image ? cfg.image.name : S.panel.mediaDefault;
  const sound = cfg.soundMode === 'none' ? S.panel.soundNone : cfg.soundMode === 'custom' && cfg.sound ? cfg.sound.name : S.panel.summaryThemeSound;
  return `${media} · ${sound}`;
}

// ---------- Sync UI from settings ----------
function render() {
  $$('#rows .item').forEach((row) => {
    const cfg = settings.alerts[row.dataset.type];
    $('input', row).checked = cfg.enabled;
    $('.item-sum', row).textContent = summary(cfg);
    row.classList.toggle('off', !cfg.enabled);
  });
  $$('.theme').forEach((b) => b.classList.toggle('active', b.dataset.theme === settings.theme));
  $('#showBadge').checked = settings.showBadge;
  $('#connectedList').textContent = settings.connected.map((p) => S.platforms[p]).join(', ') || S.panel.connectedNone;
  if (!cur) return;

  const cfg = settings.alerts[cur];
  $('#detail .name').textContent = S.types[cur];
  $('#detail').classList.toggle('off', !cfg.enabled);
  $$('#detail [data-f]').forEach((inp) => {
    const val = cfg[inp.dataset.f];
    if (inp.type === 'checkbox') inp.checked = val;
    else if (inp.type === 'radio') inp.checked = inp.value === val;
    else if (inp.type === 'color') inp.value = val ?? '#ffffff';
    else inp.value = val ?? '';
    if (inp.type === 'range') showRange(inp);
  });
  $$('[name=textColorMode]').forEach((r) => (r.checked = (r.value === 'custom') === (cfg.textColor !== null)));

  const show = {
    minAmount: 'minAmount' in cfg,
    video: isVideo(cfg.image?.file),
    customSound: cfg.soundMode === 'custom',
    customFrame: cfg.frame === 'custom',
    customColor: cfg.textColor !== null,
    amount: samples[cur].amount > 0,
  };
  $$('#detail [data-only]').forEach((el) => (el.hidden = !show[el.dataset.only]));
  $$('#detail .file').forEach((row) => {
    const f = cfg[row.dataset.kind];
    const fname = $('.fname', row);
    fname.textContent = f ? f.name : row.dataset.kind === 'image' ? S.panel.mediaDefault : S.panel.soundNoFile;
    fname.classList.toggle('default', !f);
    $('.remove', row).hidden = !f;
  });
}

(async () => {
  S = await (await fetch('/i18n/en.json')).json();
  try {
    [settings, samples] = await Promise.all([api('GET', '/api/settings'), api('GET', '/api/samples')]);
  } catch (err) {
    return toast(err.message, true);
  }
  build();
  route();
})();
