// Settings panel. All visible text comes from /i18n/en.json.
const $ = (sel, root = document) => root.querySelector(sel);
let S, settings;

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

// Any call that returns settings: store them, re-sync the UI (also reverts rejected values).
async function send(method, url, body, headers) {
  try {
    settings = await api(method, url, body, headers);
    toast(S.panel.saved);
  } catch (err) {
    toast(err.message, true);
  }
  render();
}

function build() {
  document.documentElement.lang = S.lang;
  document.documentElement.dir = S.dir;
  $('#obsUrl').value = `${location.origin}/widgets/alerts`;
  $('#copy').onclick = () => navigator.clipboard.writeText($('#obsUrl').value).then(() => toast(S.panel.copied));

  for (const [id, name] of Object.entries(S.themes)) {
    const b = document.createElement('button');
    b.className = 'theme';
    b.dataset.theme = id;
    b.append(Object.assign(document.createElement('div'), { className: `swatch ${id}` }), name);
    b.onclick = () => send('PATCH', '/api/settings', { theme: id });
    $('#themes').append(b);
  }
  for (const [id, name] of Object.entries(S.platforms)) $('#testAs').append(new Option(name, id));

  for (const type of Object.keys(settings.alerts)) {
    const box = $('#alertTpl').content.firstElementChild.cloneNode(true);
    box.dataset.type = type;
    $('.name', box).textContent = S.types[type];

    box.querySelectorAll('[data-f]').forEach((inp) => inp.addEventListener('change', () => {
      const v = inp.type === 'checkbox' ? inp.checked : inp.type === 'text' ? inp.value : Number(inp.value);
      send('PATCH', '/api/settings', { alerts: { [type]: { [inp.dataset.f]: v } } });
    }));
    $('[data-f=volume]', box).addEventListener('input', (e) => ($('.vol', box).textContent = `${Math.round(e.target.value * 100)}%`));

    box.querySelectorAll('.file').forEach((row) => {
      const kind = row.dataset.kind;
      const input = $('input', row);
      $('.upload', row).onclick = () => input.click();
      input.onchange = () => {
        const f = input.files[0];
        input.value = '';
        if (f) send('POST', `/api/upload/${type}/${kind}`, f, { 'content-type': f.type || 'application/octet-stream', 'x-filename': encodeURIComponent(f.name) });
      };
      $('.remove', row).onclick = () => send('DELETE', `/api/upload/${type}/${kind}`);
    });

    $('.test', box).onclick = () => api('POST', `/api/test/${type}`, { platform: $('#testAs').value })
      .then(() => toast(S.panel.testSent), (err) => toast(err.message, true));
    $('.reset', box).onclick = () => send('POST', `/api/reset/${type}`);
    $('#alerts').append(box);
  }

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

  document.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = S.panel[el.dataset.i18n]));
}

function render() {
  document.querySelectorAll('.theme').forEach((b) => b.classList.toggle('active', b.dataset.theme === settings.theme));
  for (const box of document.querySelectorAll('.alert-box')) {
    const cfg = settings.alerts[box.dataset.type];
    box.classList.toggle('off', !cfg.enabled);
    box.querySelectorAll('[data-f]').forEach((inp) => {
      if (inp.type === 'checkbox') inp.checked = cfg[inp.dataset.f];
      else inp.value = cfg[inp.dataset.f] ?? '';
    });
    $('.min', box).hidden = !('minAmount' in cfg);
    $('.vol', box).textContent = `${Math.round(cfg.volume * 100)}%`;
    box.querySelectorAll('.file').forEach((row) => {
      const f = cfg[row.dataset.kind];
      $('.fname', row).textContent = f ? f.name : S.panel.default;
      $('.fname', row).classList.toggle('default', !f);
      $('.remove', row).hidden = !f;
    });
  }
}

(async () => {
  S = await (await fetch('/i18n/en.json')).json();
  try {
    settings = await api('GET', '/api/settings');
  } catch (err) {
    return toast(err.message, true);
  }
  build();
  render();
})();
