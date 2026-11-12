// ---------- Media by amount: one card per fixed tier, rebuilt only when the tiers change ----------
let tiersDrawn = '';
function renderTiers(cfg) {
  const key = JSON.stringify([cur, cfg.tiers, cfg.look]);
  if (key === tiersDrawn) return;
  tiersDrawn = key;
  $('#tiers').replaceChildren(
    ...cfg.tiers.map((t) => {
      const on = el('input', { type: 'checkbox', checked: t.on, onchange: () => send('PATCH', `/api/tiers/${cur}/${t.amount}`, { on: on.checked }) });
      on.setAttribute('aria-label', S.panel.tierOn);
      const amount = tpl(S.panel.tierAmount[cur][t.amount === 1 ? 'one' : 'many'], { n: fmt(t.amount) });
      const name = t.gift // Kicks: Kick's own gift, its icon and name
        ? [
            el('img', { className: 'gift-icon', alt: '', src: `/assets/kick-gifts/${t.gift.id}.webp` }),
            el('b', { textContent: S.kickGifts[t.gift.id] ?? t.gift.id }),
            el('small', { textContent: amount }),
          ]
        : cur === 'bits'
          ? [el('img', { className: 'gift-icon', alt: '', src: `/assets/twitch-bits/${t.amount}.gif` }), el('b', { textContent: amount })] // Twitch's gem
          : [el('b', { textContent: amount })];
      return el(
        'div',
        { className: `tier${t.on ? '' : ' off'}` },
        el(
          'div',
          { className: 'tier-head' },
          el('label', { className: 'switch' }, on, el('span')),
          el('span', { className: 'tier-name' }, ...name),
          el('button', { textContent: S.panel.tierTest, onclick: () => testTier(t.amount) }),
        ),
        tierFile(t, 'image', kickLook(cur, cfg)),
        tierFile(t, 'sound', kickLook(cur, cfg)),
      );
    }),
  );
}

// A tier's image or sound: the file's name (or the theme's), Upload (replaces it), Remove. Wired like the alert's own .file rows.
function tierFile(t, kind, kick) {
  const f = t[kind];
  const row = el(
    'div',
    { className: 'tier-files' },
    el('span', { className: 'tier-label', textContent: S.panel[kind === 'image' ? 'mediaTitle' : 'soundTitle'] }),
    el(
      'div',
      { className: 'chips' },
      el('span', { className: `fname${f ? '' : ' default'}`, textContent: f ? f.name : defaultMedia(kind, kick), title: f?.name ?? '' }),
      el('button', { className: 'ghost add upload', textContent: S.panel.upload }),
      el('button', { className: 'ghost add remove', textContent: S.panel.remove, hidden: !f }),
      el('input', { type: 'file', hidden: true, accept: ACCEPT[kind] }),
    ),
  );
  const url = () => `/api/tiers/${cur}/${t.amount}/${kind}`;
  wireFile(row, url, url);
  return row;
}

// A tier's Test: plays it here in the preview and sends it to OBS, with the tier's amount.
function testTier(amount) {
  $('#previewAmount').value = amount;
  preview();
  api('POST', `/api/test/${cur}`, { platform: $('#testAs').value, amount }).then(
    () => toast(S.panel.testSent),
    (err) => toast(err.message, true),
  );
}
