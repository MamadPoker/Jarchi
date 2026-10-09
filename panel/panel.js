// Settings panel. All visible text comes from /i18n/en.json.
// Layout: left column lists items in groups (GROUPS below); the right side shows the editor for the selected item.
// The preview is the real overlay (/widgets/alerts/?preview) in a scaled iframe, driven by postMessage.
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
let S, settings, samples;
let view = 'alert', cur = 'follow'; // what's selected: an alert type, or the settings view

const pct = (v) => `${Math.round(v * 100)}%`;
const px = (v) => `${v}px`;
const FORMAT = { volume: pct, frameOpacity: pct, frameRadius: px, fontSize: px };
const isVideo = (file) => /\.(webm|mp4)$/.test(file ?? '');
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};

// Left column groups. Each item opens `view` (a <section data-view>) for its key.
// A new group, e.g. { title: 'Widgets', items: [{ view: 'goal', key: 'goal', label: 'Goal' }] }, needs only a matching section.
const GROUPS = () => [
  { title: S.panel.groupAlerts, items: Object.keys(settings.alerts).map((t) => ({ view: 'alert', key: t, label: S.types[t], toggle: true })) },
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

// ---------- Preview ----------
const sample = (type, amount) => ({ ...samples[type], type, platform: $('#testAs').value, test: true, ...(amount !== undefined && { amount }) });
const previewAmount = () => (samples[cur].amount > 0 ? Number($('#previewAmount').value) || 0 : undefined);

function preview(s = settings, muted = !$('#previewSound').checked) {
  if (view !== 'alert') return;
  $('#preview').contentWindow?.postMessage({ strings: S, settings: s, event: sample(cur, previewAmount()), muted }, location.origin);
}

// Scale the 1920x1080 iframe down to its box.
new ResizeObserver(([e]) => e.target.style.setProperty('--k', e.contentRect.width / 1920)).observe($('.preview'));

function select(v, key) {
  view = v;
  if (v === 'alert') {
    cur = key;
    $('#previewAmount').value = samples[key].amount;
  }
  $$('main .view').forEach((s) => (s.hidden = s.dataset.view !== v));
  render();
  preview();
}

// ---------- Build once ----------
function build() {
  document.documentElement.lang = S.lang;
  document.documentElement.dir = S.dir;

  // Left column
  for (const g of GROUPS()) {
    const list = el('ul', { className: 'nav' });
    for (const it of g.items) {
      const row = el('li', { className: 'nav-row' });
      Object.assign(row.dataset, { view: it.view, key: it.key });
      row.append(el('button', { className: 'nav-btn', onclick: () => select(it.view, it.key) }, el('span', { className: 'dot' }), el('span', { textContent: it.label })));
      if (it.toggle) {
        const sw = el('input', { type: 'checkbox', onchange: () => patchAlert(it.key, { enabled: sw.checked }) });
        sw.setAttribute('aria-label', it.label);
        row.append(el('label', { className: 'switch' }, sw, el('span')));
      }
      list.append(row);
    }
    $('#groups').append(el('h2', { className: 'group-title', textContent: g.title }), list);
  }
  $('.side-foot .nav-btn').onclick = () => select('settings');

  // Top bar: theme dropdown (hovering an option previews it, muted) and the OBS link.
  const menu = $('#themeMenu');
  const close = () => {
    $('#themeList').hidden = true;
    $('#themeBtn').setAttribute('aria-expanded', 'false');
  };
  for (const [id, name] of Object.entries(S.themes)) {
    const opt = el('button', { className: 'dd-opt', onclick: () => { close(); send('PATCH', '/api/settings', { theme: id }); } },
      el('span', { className: `swatch sw-${id}` }), name);
    opt.setAttribute('role', 'option');
    opt.dataset.theme = id;
    opt.onmouseenter = opt.onfocus = () => preview({ ...settings, theme: id }, true);
    $('#themeList').append(el('li', {}, opt));
  }
  $('#themeBtn').onclick = () => {
    const open = $('#themeList').hidden;
    $('#themeList').hidden = !open;
    $('#themeBtn').setAttribute('aria-expanded', String(open));
    if (open) $('.dd-opt[aria-selected=true]')?.focus();
  };
  document.addEventListener('click', (e) => { if (!menu.contains(e.target)) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  const obsUrl = `${location.origin}/widgets/alerts`;
  $('#obsUrl').value = obsUrl;
  $('#copy').title = S.panel.copyObsHint;
  $('#copy').onclick = () => navigator.clipboard.writeText(obsUrl).then(() => toast(S.panel.copied));

  // Alert editor: every [data-f] input saves its field for the selected alert.
  const editor = $('main [data-view=alert]');
  $$('[data-f]', editor).forEach((inp) => inp.addEventListener('change', () => {
    const v = inp.type === 'checkbox' ? inp.checked : ['text', 'radio', 'color'].includes(inp.type) ? inp.value : Number(inp.value);
    patchAlert(cur, { [inp.dataset.f]: v });
  }));
  $$('input[type=range]', editor).forEach((inp) => inp.addEventListener('input', () => showRange(inp)));
  $$('[name=textColorMode]').forEach((r) => (r.onchange = () => patchAlert(cur, { textColor: r.value === 'custom' ? $('[data-f=textColor]').value : null })));
  $$('.file', editor).forEach((row) => {
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
  $('#play').onclick = () => preview();
  $('#previewAmount').onchange = () => preview();
  $('#test').onclick = () => api('POST', `/api/test/${cur}`, { platform: $('#testAs').value, amount: previewAmount() })
    .then(() => toast(S.panel.testSent), (err) => toast(err.message, true));
  $('#reset').onclick = () => send('POST', `/api/reset/${cur}`);
  $('#preview').onload = () => preview();

  // Settings
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

  $$('[data-i18n]').forEach((e) => (e.textContent = S.panel[e.dataset.i18n]));
}

// Range sliders: filled track + value label.
function showRange(inp) {
  inp.style.setProperty('--fill', `${((inp.value - inp.min) / (inp.max - inp.min)) * 100}%`);
  const out = $(`[data-out="${inp.dataset.f}"]`);
  if (out) out.textContent = FORMAT[inp.dataset.f](inp.value);
}

// ---------- Sync UI from settings ----------
function render() {
  $$('.nav-row').forEach((row) => {
    const { view: v, key } = row.dataset;
    row.classList.toggle('active', v === view && (v !== 'alert' || key === cur));
    if (v !== 'alert') return;
    row.classList.toggle('off', !settings.alerts[key].enabled);
    $('input', row).checked = settings.alerts[key].enabled;
  });

  $('#themeBtn .swatch').className = `swatch sw-${settings.theme}`;
  $('#themeBtn .dd-name').textContent = S.themes[settings.theme];
  $$('.dd-opt').forEach((o) => o.setAttribute('aria-selected', String(o.dataset.theme === settings.theme)));

  $('#showBadge').checked = settings.showBadge;
  $('#connectedList').textContent = settings.connected.map((p) => S.platforms[p]).join(', ') || S.panel.connectedNone;
  if (view !== 'alert') return;

  const editor = $('main [data-view=alert]');
  const cfg = settings.alerts[cur];
  editor.dataset.key = cur;
  $('.name', editor).textContent = S.types[cur];
  $$('[data-f]', editor).forEach((inp) => {
    const val = cfg[inp.dataset.f];
    if (inp.type === 'checkbox') inp.checked = val;
    else if (inp.type === 'radio') inp.checked = inp.value === val;
    else if (inp.type === 'color') inp.value = val ?? '#ffffff';
    else inp.value = val ?? '';
    if (inp.type === 'range') showRange(inp);
  });
  $$('[name=textColorMode]').forEach((r) => (r.checked = (r.value === 'custom') === (cfg.textColor !== null)));

  const show = {
    off: !cfg.enabled,
    minAmount: 'minAmount' in cfg,
    video: isVideo(cfg.image?.file),
    customSound: cfg.soundMode === 'custom',
    customFrame: cfg.frame === 'custom',
    customColor: cfg.textColor !== null,
    amount: samples[cur].amount > 0,
  };
  $$('[data-only]', editor).forEach((e) => (e.hidden = !show[e.dataset.only]));
  $$('.file', editor).forEach((row) => {
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
  select('alert', cur);
})();
