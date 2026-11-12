// ---------- Panel banner maker (the Donation page tab) ----------
// A picture for the streamer's Kick / Twitch channel panels, linking to the donation page: the coin, "دونیت کریپتو" /
// CRYPTO DONATE / WALLET TO WALLET, USDT on BEP20 and TRC20, and the streamer's own link. Drawn on a canvas in CSS
// pixels times k (the preview 2, Download PNG 3: 1920 wide). 8 colors: [accent, light accent, second color, two backgrounds].
const BANNER_COLORS = [
  ['#e8bd55', '#fff2b8', '#4fd1bf', '#173a33', '#0c1514'],
  ['#53fc18', '#d6ffc4', '#e8bd55', '#11341a', '#07130a'],
  ['#a970ff', '#e6d6ff', '#4fd1bf', '#2a1a4a', '#0e0918'],
  ['#ff4d5e', '#ffd1d6', '#ffc94d', '#3a1216', '#14070a'],
  ['#3fa9ff', '#d4ecff', '#7ef2d8', '#0f2a44', '#071220'],
  ['#ff5fb1', '#ffd3ea', '#ffd166', '#3d1230', '#150712'],
  ['#ff8a3d', '#ffe0c7', '#4fd1bf', '#3d2210', '#140b05'],
  ['#e9eef0', '#ffffff', '#4fd1bf', '#2a3032', '#101314'],
];
const BANNER_SIZE = { wide: [640, 220], square: [640, 640] };
let bannerColor = 0,
  bannerShape = 'wide',
  bannerSeq = 0,
  coinPic;
const alpha = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};
const coinImage = () =>
  (coinPic ??= new Promise((ok, no) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = no;
    img.src = '/assets/brand/jarchi-pay-coin.webp';
  }));
// Draws one banner on ctx (already scaled by k; shadows aren't, so they get k themselves).
function paintBanner(x, k, shape, [a, a2, b, bg1, bg2], coin, page) {
  const [W, H] = BANNER_SIZE[shape],
    wide = shape === 'wide';
  const shadow = (ox, oy, blur, color) => Object.assign(x, { shadowOffsetX: ox * k, shadowOffsetY: oy * k, shadowBlur: blur * k, shadowColor: color });
  const text = (s, px, py, font, fill, { align = wide ? 'right' : 'center', spacing = 0, dir = 'ltr' } = {}) => {
    x.save();
    Object.assign(x, { font, fillStyle: fill, textAlign: align, textBaseline: 'middle', direction: dir, letterSpacing: `${spacing}px` });
    x.fillText(s, px, py);
    x.restore();
  };
  const radial = (cx, cy, r, stops) => {
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    for (const [at, c] of stops) g.addColorStop(at, c);
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
  };
  x.save();
  if (wide) {
    x.beginPath();
    x.roundRect(0, 0, W, H, 18);
    x.clip();
    const d = (((W + H) * Math.SQRT1_2) / 2) * Math.SQRT1_2,
      g = x.createLinearGradient(W / 2 - d, H / 2 - d, W / 2 + d, H / 2 + d); // 135deg
    g.addColorStop(0, bg1);
    g.addColorStop(0.6, bg2);
    g.addColorStop(1, bg2);
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
    radial(0.18 * W, H / 2, Math.hypot(0.82 * W, H / 2), [
      [0, alpha(a, 0.3)],
      [0.45, alpha(a, 0)],
    ]);
    x.fillStyle = alpha(b, 0.06); // scan lines
    for (let y = H - 2; y > -2; y -= 5) x.fillRect(0, y, W, 2);
  } else {
    x.fillStyle = bg2;
    x.fillRect(0, 0, W, H);
    x.fillStyle = alpha(a, 0.16); // rays from the coin
    for (let i = 0; i < 24; i++) {
      const from = -Math.PI / 2 + (i * Math.PI) / 12;
      x.beginPath();
      x.moveTo(W / 2, H * 0.4);
      x.arc(W / 2, H * 0.4, 1000, from, from + Math.PI / 24);
      x.fill();
    }
    radial(W / 2, H * 0.4, Math.hypot(W / 2, H * 0.6), [
      [0, alpha(a, 0.35)],
      [0.38, alpha(a, 0)],
    ]);
    radial(W / 2, H * 0.45, Math.hypot(W / 2, H * 0.55), [
      [0.45, 'rgba(6,12,11,0)'],
      [1, 'rgba(6,12,11,0.85)'],
    ]);
  }
  x.restore();
  if (wide) {
    x.strokeStyle = alpha(a, 0.7);
    x.lineWidth = 2;
    x.beginPath();
    x.roundRect(1, 1, W - 2, H - 2, 17);
    x.stroke();
  }
  // The coin, with its glow
  const [cx, cy, r] = wide ? [108, 110, 80] : [W / 2, 185, 155];
  for (const s of wide
    ? [[0, 0, 40, alpha(a, 0.55)]]
    : [
        [0, 18, 40, 'rgba(0,0,0,0.55)'],
        [0, 0, 60, alpha(a, 0.55)],
      ]) {
    x.save();
    shadow(...s);
    x.fillStyle = bg2;
    x.beginPath();
    x.arc(cx, cy, r, 0, 2 * Math.PI);
    x.fill();
    x.restore();
  }
  x.save();
  x.beginPath();
  x.arc(cx, cy, r, 0, 2 * Math.PI);
  x.clip();
  x.drawImage(coin, cx - r, cy - r, 2 * r, 2 * r);
  x.restore();
  // The words: right-aligned beside the coin (wide), centered under it (square)
  const tx = wide ? W - 24 : W / 2,
    from = wide ? 214 : 0,
    L = 'Manrope, "Segoe UI", sans-serif';
  const [fa, en, wt, chips, url] = wide
    ? [
        [40, 41],
        [20, 81.5],
        [13, 110],
        [15, 142],
        [15, 192],
      ]
    : [
        [62, 392],
        [24, 448],
        [17, 482],
        [19, 521],
        [19, 611],
      ];
  x.save();
  if (!wide) shadow(0, 4, 0, 'rgba(0,0,0,0.35)');
  text('دونیت کریپتو', tx, fa[1], `800 ${fa[0]}px Vazirmatn, Tahoma, sans-serif`, '#fff', { dir: 'rtl' });
  x.restore();
  const g = x.createLinearGradient(from, 0, W - (wide ? 24 : 0), 0);
  g.addColorStop(0, a2);
  g.addColorStop(1, a);
  text('CRYPTO DONATE', tx, en[1], `800 ${en[0]}px ${L}`, g, { spacing: en[0] * (wide ? 0.22 : 0.26) });
  text('WALLET TO WALLET', tx, wt[1], `800 ${wt[0]}px ${L}`, b, { spacing: wt[0] * 0.3 });
  // USDT · BEP20 · TRC20, in pills
  x.font = `700 ${chips[0]}px ${L}`;
  const padX = wide ? 12 : 16,
    ph = chips[0] * 1.36 + (wide ? 8 : 10),
    names = ['USDT', 'BEP20', 'TRC20'];
  const widths = names.map((n) => x.measureText(n).width + 2 * padX),
    all = widths.reduce((s, w) => s + w, 0) + 8 * 2;
  let px = wide ? tx - all : tx - all / 2;
  names.forEach((n, i) => {
    x.fillStyle = i ? b : a;
    x.beginPath();
    x.roundRect(px, chips[1] - ph / 2, widths[i], ph, ph / 2);
    x.fill();
    text(n, px + widths[i] / 2, chips[1], x.font, '#0c1514', { align: 'center' });
    px += widths[i] + 8;
  });
  // The streamer's own link, the channel in the accent color
  const u = new URL(page),
    host = `${u.host}/`,
    channel = decodeURIComponent(u.pathname.slice(1));
  const mono = (w) => `${w} ${url[0]}px Consolas, ui-monospace, monospace`;
  x.font = mono(600);
  const hw = x.measureText(host).width;
  x.font = mono(800);
  const cw = x.measureText(channel).width,
    ux = wide ? tx - hw - cw : tx - (hw + cw) / 2;
  text(host, ux, url[1], mono(600), '#c9d8d5', { align: 'left' });
  text(channel, ux + hw, url[1], mono(800), a, { align: 'left' });
}
async function bannerCanvas(k, canvas = document.createElement('canvas')) {
  const [W, H] = BANNER_SIZE[bannerShape];
  await Promise.all(['800 40px Vazirmatn', '800 20px Manrope', '700 15px Manrope'].map((f) => document.fonts.load(f).catch(() => {})));
  const coin = await coinImage();
  Object.assign(canvas, { width: W * k, height: H * k });
  const x = canvas.getContext('2d');
  x.scale(k, k);
  paintBanner(x, k, bannerShape, BANNER_COLORS[bannerColor], coin, pay.page);
  return canvas;
}
// The preview (only while its tab is on screen, the gateway active).
function drawBanner() {
  if (pay.state !== 'active' || $('#cryptoPageTab').hidden) return;
  const seq = ++bannerSeq,
    live = $('#bannerCanvas');
  $('.banner-maker').dataset.shape = bannerShape;
  $$('#bannerColors button').forEach((s, i) => s.setAttribute('aria-checked', String(i === bannerColor)));
  $('.banner-maker .copy-row code').textContent = pay.page;
  bannerCanvas(2).then(
    (c) => {
      if (seq !== bannerSeq) return; // a newer pick meanwhile
      Object.assign(live, { width: c.width, height: c.height });
      live.style.width = `${c.width / 2}px`;
      live.getContext('2d').drawImage(c, 0, 0);
    },
    () => {},
  );
}
function wireBanner() {
  $('#bannerColors').append(
    ...S.panel.bannerColors.map((name, i) => {
      const [a, , , , bg2] = BANNER_COLORS[i];
      return el('button', {
        role: 'radio',
        title: name,
        ariaLabel: name,
        style: `background: linear-gradient(135deg, ${a}, ${bg2})`,
        onclick: () => ((bannerColor = i), drawBanner()),
      });
    }),
  );
  $$('[name=bannerShape]').forEach((r) => (r.onchange = () => ((bannerShape = r.value), drawBanner())));
  $('#bannerSteps').append(...S.panel.bannerSteps.map((t) => el('li', {}, ...marked(t, 'b'))));
  $('#bannerSteps li:last-child').append(
    el(
      'div',
      { className: 'copy-row' },
      el('code', { dir: 'ltr' }),
      el('button', { className: 'primary', textContent: S.panel.copy, onclick: () => copyLink(pay.page, S.panel.cryptoLinkCopied) }),
    ),
  );
  $('#bannerDownload').onclick = () =>
    bannerCanvas(3).then(
      (c) =>
        c.toBlob((blob) => {
          const a = el('a', { href: URL.createObjectURL(blob), download: `jarchi-donate-${bannerShape}.png` });
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 60000);
        }, 'image/png'),
      (err) => toast(err.message, true),
    );
}

function wireCryptoPage() {
  wireBanner();
  $('#cryptoView').onclick = () => window.open(pay.page, '_blank', 'noopener');
  $('#cryptoPageSave').onclick = saveCryptoPage;
  $('#cryptoBio').placeholder = S.panel.cryptoBioDefault; // Jarchi Pay's own line, without one
  $('#cryptoBio').oninput = () => $('#cryptoBio').removeAttribute('aria-invalid');
  $('#cryptoLinks').replaceChildren(
    ...Object.entries(PAGE_LINKS).map(([k, [start]]) => {
      const name = LINK_NAMES[k] ?? S.panel.cryptoWebsite;
      const inp = el('input', { type: 'text', dir: 'ltr', spellcheck: false, autocomplete: 'off', maxLength: 300 });
      inp.dataset.link = k;
      inp.setAttribute('aria-label', name);
      inp.oninput = (e) => {
        inp.removeAttribute('aria-invalid');
        if (e.inputType === 'insertFromPaste') inp.value = linkId(k, inp.value); // a whole link pasted: its id
      };
      inp.onchange = () => (inp.value = linkId(k, inp.value));
      return el(
        'label',
        { className: 'crypto-link' },
        el('span', { textContent: name }),
        el('span', { className: 'crypto-pfx' }, el('em', { textContent: start }), inp),
      );
    }),
  );
  // A picture: an upload (Jarchi Pay checks it), or Reset = the channel's own again. Either answer is the whole page.
  for (const box of $$('#cryptoPageTab [data-kind]')) {
    const kind = box.dataset.kind,
      file = $('input[type=file]', box),
      up = $('.upload', box);
    const after = (ask) =>
      ask
        .then(
          (r) => (cryptoPage = r),
          (err) => toast(err.message, true),
        )
        .finally(renderCryptoPage);
    up.onclick = () => file.click();
    file.onchange = () => {
      const f = file.files[0];
      file.value = '';
      if (!f) return;
      up.disabled = true;
      after(api('PUT', `/api/crypto/page/${kind}`, f));
    };
    $('.remove', box).onclick = () => after(api('DELETE', `/api/crypto/page/${kind}`));
  }
}
