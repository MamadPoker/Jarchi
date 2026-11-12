// ---------- Connections: proxy ----------
// netState = the card's status dot: the last Test (off: not tested yet, connecting: testing, connected: all reached,
// error). help = core/vpn.js's state (the popup, the top bar's warning); 'broken' turns the dot red too.
let netState = 'off',
  help = { state: 'idle' };
const proxyLabel = (p) => ltr(`${p.host}:${p.port} (${p.type === 'socks5' ? 'SOCKS5' : 'HTTP'})`);
const proxyName = (p) => p.app ?? tpl(S.panel.proxyAt, { proxy: proxyLabel(p) }); // the VPN app, or its address
function showProxyNow() {
  // what Off means; the Windows proxy: what it is right now (Manual: its fields say it)
  api('GET', '/api/net/proxy').then(
    ({ mode, proxy }) => {
      $('#proxyNow').textContent =
        mode === 'off' ? S.net.offNow : mode === 'manual' ? '' : proxy ? tpl(S.net.autoWindows, { proxy: proxyLabel(proxy) }) : S.net.autoNone;
    },
    () => {},
  );
}
function renderNet({ proxy, results }) {
  const p = proxy && proxyLabel(proxy);
  $('#netUsing').textContent = p ? tpl(S.net.using, { proxy: p }) : S.net.direct;
  const lines = new Map(); // text -> ok; a dead proxy is one line, not one per service
  for (const [id, code] of Object.entries(results)) {
    // a proxy's own message only with a proxy to name (its {proxy}); without one, as any other unreachable service
    const key = p ? (code === 'timeout' || code === 'network' ? 'viaProxy' : code) : code.startsWith('proxy_') ? 'network' : code;
    lines.set(tpl(S.net[key] ?? S.net.network, { name: S.net.names[id], proxy: p }), code === 'ok');
  }
  $('#netResults').replaceChildren(...[...lines].map(([text, ok]) => el('li', { className: ok ? 'ok' : 'bad', textContent: text })));
  netState = Object.values(results).every((c) => c === 'ok') ? 'connected' : 'error';
  renderProxy();
}
async function testNet() {
  const btn = $('#netTest');
  btn.disabled = true;
  netState = 'connecting';
  renderProxy();
  $('#netUsing').textContent = S.panel.netTesting;
  $('#netResults').replaceChildren();
  try {
    renderNet(await api('POST', '/api/net/test'));
  } catch (err) {
    $('#netUsing').textContent = '';
    netState = 'off';
    renderProxy();
    toast(err.message, true);
  }
  btn.disabled = false;
}
function renderProxy() {
  const box = $('#proxyNow').closest('.box');
  const keep = (inp, v) => {
    if (inp !== document.activeElement) inp.value = v;
  }; // never under the cursor
  keep($('#proxyHost'), settings.proxyHost);
  keep($('#proxyPort'), settings.proxyPort || '');
  $$('[name=proxyMode]').forEach((r) => (r.checked = r.value === settings.proxyMode));
  $$('[name=proxyType]').forEach((r) => (r.checked = r.value === settings.proxyType));
  const show = { proxyAuto: settings.proxyMode === 'auto', proxyManual: settings.proxyMode === 'manual' };
  $$('[data-only]', box).forEach((e) => (e.hidden = !show[e.dataset.only]));
  const dot = help.state === 'broken' ? 'error' : netState;
  $('#proxyState').hidden = settings.proxyMode === 'off'; // no proxy to say "Working" or "Not working" about
  $('#proxyState').className = `status st-${dot}`;
  $('#proxyState').textContent = { off: S.panel.proxyUntested, connecting: S.panel.netTesting, connected: S.panel.proxyWorks, error: S.panel.proxyFails }[dot];
}

// core/vpn.js's state: the popup in the middle of the app (looking; offer: "VPN found: <app>. Use it for Jarchi?" Yes /
// No; checking: Yes is trying Kick and the relay through it; failed: they didn't answer, Try again; none: how to let
// Jarchi through the VPN app, with Jarchi's own path to copy, Try again and the proxy setting) and the top bar's warning
// (broken: a click looks again).
const lookForVpn = () =>
  api('POST', '/api/proxy/look').then(
    (h) => {
      help = h;
      renderProxyHelp();
    },
    (err) => toast(err.message, true),
  );
function renderProxyHelp() {
  const d = $('#proxyHelp'),
    h = help,
    P = S.panel,
    w = $('#proxyWarn');
  w.hidden = h.state !== 'broken';
  if (h.state === 'broken') {
    $('span', w).textContent = tpl(P.proxyBroken, { app: proxyName(h.proxy) });
    w.title = P.proxyBrokenHint;
  }
  renderConnWarn(); // hidden while this one shows
  renderProxy();
  if (!['offer', 'none', 'looking', 'checking', 'failed'].includes(h.state)) return d.open && d.close();
  const app = h.found && proxyName(h.found),
    service = h.service && P.proxyServices[h.service];
  $('#proxyHelpTitle').textContent = {
    looking: P.proxyLookingTitle,
    offer: tpl(P.proxyFoundTitle, { app }),
    checking: tpl(P.proxyChecking, { app }),
    failed: tpl(P.proxyFailedTitle, { app }),
    none: service ? tpl(P.proxyCantReach, { service }) : P.proxyNoneTitle,
  }[h.state];
  $('#proxyHelpText').textContent = {
    looking: P.proxyLookingText,
    offer: P.proxyFoundAsk,
    checking: P.proxyCheckingText,
    failed: P.proxyFailedText,
    none: `${h.system ? `${tpl(P.proxySplitTunnel, { app: h.system })} ` : ''}${P.proxyNoneText}`,
  }[h.state];
  // The guide: Jarchi on the VPN app's own list (its path, to copy), TUN mode, or the proxy typed in.
  $('#proxyHelpSteps').replaceChildren(
    ...(h.state === 'none'
      ? P.proxySteps.map((s, i) =>
          el(
            'li',
            {},
            s,
            i || !h.exe
              ? ''
              : el(
                  'div',
                  { className: 'copy-row' },
                  el('code', { dir: 'ltr', textContent: h.exe, title: h.exe }),
                  el('button', { className: 'primary', textContent: S.panel.copy, onclick: () => copyLink(h.exe, P.proxyExeCopied) }),
                ),
          ),
        )
      : []),
  );
  $('#proxyHelpNote').hidden = h.state !== 'offer';
  $('#proxyNo').hidden = h.state === 'checking';
  $('#proxyNo').textContent = h.state === 'offer' ? P.proxyNo : P.updateClose;
  $('#proxyAgain').hidden = !['none', 'failed'].includes(h.state);
  $('#proxyYes').hidden = !['offer', 'none'].includes(h.state);
  $('#proxyYes').textContent = h.state === 'offer' ? P.proxyYes : P.proxyOpenSettings;
  if (!d.open) d.showModal();
}
function wireProxy() {
  const patch = (fields) =>
    send('PATCH', '/api/settings', fields).then(() => {
      showProxyNow();
      testNet(); // the dot follows the new setting
    });
  $$('[name=proxyMode]').forEach((r) => (r.onchange = () => patch({ proxyMode: r.value })));
  $$('[name=proxyType]').forEach((r) => (r.onchange = () => patch({ proxyType: r.value })));
  $('#proxyHost').onchange = (e) => patch({ proxyHost: e.target.value.trim() });
  $('#proxyPort').onchange = (e) => patch({ proxyPort: Math.round(Number(e.target.value)) || 0 });
  $('#netTest').onclick = testNet;
  $('#proxyLook').onclick = $('#proxyWarn').onclick = $('#proxyAgain').onclick = lookForVpn;
  const d = $('#proxyHelp');
  d.onclose = () => {
    // No, Close, Escape
    if (['offer', 'none'].includes(help.state)) api('POST', '/api/proxy/dismiss').catch(() => {});
  };
  $('#proxyNo').onclick = () => d.close();
  $('#proxyYes').onclick = () => {
    if (help.state !== 'offer') {
      // nothing found: to the setting, to type it in
      d.close();
      select('connections');
      return $('#proxyNow').closest('.box').scrollIntoView({ block: 'center' });
    }
    // Kick and the relay are tried through it first ('proxyHelp' checking, then idle, or failed with Try again); then
    // Jarchi's proxy is Manual with it.
    const app = proxyName(help.found);
    api('POST', '/api/proxy/accept').then(
      ({ settings: s }) => {
        if (!s) return;
        settings = s;
        render();
        showProxyNow();
        testNet();
        toast(tpl(S.panel.proxyConnected, { app }));
      },
      () => {},
    );
  };
}

// A .file row's Upload, Paste a link and Remove. A link: Jarchi downloads the file once and keeps it like an upload
// (the x-link header; the same 10 MB limit and shrinking, core/media.js). A file over 10 MB isn't even sent.
const MAX_FILE = 10 * 1024 * 1024;
function wireFile(row, upload, remove) {
  const input = $('input[type=file]', row),
    up = $('.upload', row);
  up.onclick = () => input.click();
  input.onchange = () => {
    const f = input.files[0];
    input.value = '';
    if (!f) return;
    if (f.size > MAX_FILE) return toast(S.errors.too_large, true);
    send('POST', upload(), f, { 'content-type': f.type || 'application/octet-stream', 'x-filename': encodeURIComponent(f.name) });
  };
  $('.remove', row).onclick = () => send('DELETE', remove());
  // Paste a link: a field under the buttons. "giphy.com/…" without https:// is fine too.
  const field = el('input', { type: 'text', inputMode: 'url', dir: 'ltr', placeholder: 'https://', spellcheck: false });
  field.setAttribute('aria-label', S.panel.pasteLink);
  const form = el(
    'form',
    { className: 'link-row', hidden: true },
    field,
    el('button', { className: 'primary', textContent: S.panel.linkAdd }),
    el('button', { type: 'button', className: 'ghost', textContent: S.panel.twCancel, onclick: () => (form.hidden = true) }),
  );
  form.onsubmit = (e) => {
    e.preventDefault();
    const text = field.value.trim();
    let link;
    try {
      link = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`).href;
    } catch {
      return toast(S.errors.bad_link, true);
    }
    form.hidden = true;
    field.value = '';
    toast(S.panel.linkLoading);
    send('POST', upload(), null, { 'x-link': link });
  };
  up.after(
    el('button', {
      className: up.className.replace('upload', 'link'),
      textContent: S.panel.pasteLink,
      onclick: () => {
        form.hidden = !form.hidden;
        if (!form.hidden) field.focus();
      },
    }),
  );
  up.parentElement.append(form);
}
