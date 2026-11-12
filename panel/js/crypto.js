// ---------- Crypto (Jarchi Pay, core/pay.js) ----------
// Not active: the coin, what the gateway is, and Request (pending: waiting for Jarchi; rejected: until when). Active: the
// donation page's link, the totals and the donations, newest first; a wallet step until an address is set (BEP20, TRC20
// or both: null = that network isn't used), and a warning with Cancel while a wallet change waits. The state: GET /api/crypto when the page opens or the window comes
// back (from the browser, where the request and the wallets are done), and by socket when it changes (an approval opens
// the active page by itself). The list again every 30 s while the page is in view. The first time it's active: the
// welcome and the page's tour (cryptoHello, below).
let pay = { state: 'none' },
  donations = { list: [], next: null, totals: null, pages: 0 },
  payLink;
const DAY_MS = 86400000,
  NEW_MS = 15 * 60 * 1000;
const days = new Intl.NumberFormat(FA ? 'fa' : 'en', { style: 'unit', unit: 'day', unitDisplay: 'long' });
const TX = { bep20: ['BEP20', 'https://bscscan.com/tx/'], trc20: ['TRC20', 'https://tronscan.org/#/transaction/'] };
const marked = (s, tag) => s.split('*').map((part, i) => (i % 2 ? el(tag, { textContent: part }) : part)); // *these words* in <tag>
const usdt = (a) => el('bdi', { textContent: `${a} USDT` });
const loadCrypto = () => api('GET', '/api/crypto').then(gotCrypto, () => {});
function gotCrypto(st) {
  const was = pay.state;
  pay = st;
  if (st.state === 'active' && was !== 'active') {
    if (!settings.cryptoWelcomed) cryptoHello();
    else if (was === 'pending' && view !== 'donations') toast(S.panel.cryptoApproved); // approved again (lost)
    donations = { list: [], next: null, totals: null, pages: 0 };
    loadDonations();
  }
  if (view === 'donations') renderCrypto();
}

// Start of today and of this week (from Saturday, as Jarchi Pay counts it) on this PC's clock: the totals.
function bounds() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const week = new Date(today);
  week.setDate(today.getDate() - ((today.getDay() + 1) % 7));
  return { today: today.getTime(), week: week.getTime() };
}
let listSeq = 0;
function loadDonations(more) {
  const seq = ++listSeq;
  const q = new URLSearchParams({ ...bounds(), ...(more && { cursor: donations.next }) });
  return api('GET', `/api/crypto/donations?${q}`).then(
    (r) => {
      if (seq !== listSeq) return;
      donations = { totals: r.totals, next: r.next, list: more ? [...donations.list, ...r.donations] : r.donations, pages: more ? donations.pages + 1 : 1 };
      if (view === 'donations') renderDonations();
    },
    (err) => more && toast(err.message, true),
  );
}
// ponytail: the 30 s refresh skips a list with more pages open (it would drop them); merge by id if that's missed.
const refreshDonations = () => pay.state === 'active' && donations.pages <= 1 && loadDonations(); // pages 0: the last load failed
setInterval(() => view === 'donations' && !document.hidden && refreshDonations(), 30000);

function renderCrypto() {
  const active = pay.state === 'active';
  $('#cryptoHero').hidden = active;
  $('#cryptoActive').hidden = !active;
  if (!active) {
    const wait = pay.state === 'rejected' && pay.retryAt > Date.now();
    $('#cryptoRequest').disabled = pay.state === 'pending' || wait;
    const why = [
      pay.state === 'pending' && S.panel.cryptoPending,
      wait && tpl(S.panel.cryptoRejected, { time: days.format(Math.ceil((pay.retryAt - Date.now()) / DAY_MS)) }),
      wait && pay.reason && tpl(S.panel.cryptoReason, { reason: pay.reason }),
      pay.lost && S.panel.cryptoLost,
      pay.error && (S.errors[pay.error] ?? S.errors.crypto_failed),
    ].filter(Boolean);
    $('#cryptoWhy').replaceChildren(...why.flatMap((t, i) => (i ? [el('br'), t] : [t])));
    $('#cryptoWhy').hidden = !why.length;
    coinRun();
    return;
  }
  $('#cryptoUrl').textContent = pay.page.replace(/^https?:\/\//, '');
  hint('#cryptoError', pay.error && (S.errors[pay.error] ?? S.errors.crypto_failed));
  const w = pay.wallets; // null: not asked yet (offline)
  $('#cryptoWallet').hidden = !w || !!(w.bep20 || w.trc20);
  $('#cryptoChange').hidden = !w?.pending;
  if (w?.pending) {
    $('#cryptoChangeText').textContent = tpl(S.panel.cryptoChange, { date: dateTime(w.pending.effectiveAt) });
    $('#cryptoChangeTo').textContent = changeLines(w);
  }
  renderDonations();
  showCryptoTab(cryptoTab);
}
// A waiting wallet change, a line per network: its new address, "adding" one where that network isn't used now, or
// "removing" where the change leaves it out (null). Not used now or after: no line.
function changeLines(w) {
  return ['bep20', 'trc20']
    .flatMap((n) => {
      const now = w[n],
        next = w.pending[n],
        what = next === null ? now && S.panel.cryptoChangeRemoving : next && (now ? next : `${S.panel.cryptoChangeAdding} ${next}`);
      return what ? [`${n.toUpperCase()}: ${what}`] : [];
    })
    .join('\n');
}

function renderDonations() {
  const t = donations.totals;
  for (const k of ['today', 'week', 'all']) {
    const box = $(`[data-total="${k}"]`),
      n = t?.[k].count;
    $('b', box).textContent = t ? Number(t[k].amount).toLocaleString('en', { maximumFractionDigits: 2 }) : '–';
    $('em', box).textContent = t ? (n === 1 ? S.panel.cryptoCountOne : tpl(S.panel.cryptoCount, { n: fmt(n) })) : '';
  }
  $('#cryptoList').replaceChildren(
    ...(!t ? [] : donations.list.length ? donations.list.map(donationRow) : [el('li', { className: 'crypto-empty', textContent: S.panel.cryptoEmpty })]),
  );
  $('#cryptoMore').hidden = !donations.next;
}
// One donation: who (or Anonymous) with the platform they signed in with, when, how much on which network, the message
// (a private one: for the streamer only, never read on stream), the transaction, and Replay (its alert again, in the
// queue; the server leaves a private message out).
function donationRow(d) {
  const [net, explorer] = TX[d.network] ?? [d.network ?? '', null];
  const isNew = Date.now() - d.paidAt < NEW_MS;
  const logo = ['kick', 'twitch'].includes(d.platform)
    ? el('img', { className: 'don-logo', src: `/assets/platform-logos/${d.platform}.svg`, alt: S.platforms[d.platform], title: S.platforms[d.platform] })
    : el('span', { className: 'don-logo' });
  return el(
    'li',
    { className: `donation${isNew ? ' new' : ''}` },
    el(
      'div',
      { className: 'don-top' },
      logo,
      el(
        'span',
        { className: 'don-who' },
        el(
          'b',
          {},
          el('bdi', { textContent: d.name ?? S.panel.cryptoAnon }),
          isNew ? el('span', { className: 'don-new', textContent: S.panel.cryptoNew }) : '',
        ),
        el('small', { textContent: ago(d.paidAt), title: dateTime(d.paidAt) }),
      ),
      el('span', { className: 'don-amt' }, el('b', {}, usdt(d.amount)), el('small', { className: 'don-net', textContent: net })),
    ),
    d.message
      ? el(
          'div',
          { className: 'don-msg', dir: 'auto' },
          d.private ? el('span', { className: 'don-private', textContent: `🔒 ${S.panel.cryptoPrivate}` }) : '',
          d.message,
        )
      : '',
    el(
      'div',
      { className: 'don-foot' },
      d.txHash && explorer
        ? el('a', {
            href: explorer + encodeURIComponent(d.txHash),
            target: '_blank',
            rel: 'noopener',
            title: S.panel.cryptoTx,
            dir: 'ltr',
            textContent: `${d.txHash.slice(0, 6)}…${d.txHash.slice(-4)} ↗`,
          })
        : el('span'),
      el('button', {
        className: 'ghost',
        textContent: `↻ ${S.panel.cryptoReplay}`,
        onclick: () =>
          api('POST', '/api/crypto/replay', d).then(
            () => toast(S.panel.qReplayed),
            (err) => toast(err.message, true),
          ),
      }),
    ),
  );
}

// The coin: it turns by itself (not with Reduce animations: then it rests face on), a drag turns it, and a quick drag
// sets it spinning, slowing down to its own pace. Drawn only while it's in view.
const coin = { ay: 0, ax: -6, vel: 60, drag: false, lx: 0, ly: 0, lt: 0, sv: 0, last: 0, raf: 0 };
const coinOn = () => view === 'donations' && !$('#cryptoHero').hidden && !document.hidden;
function coinFrame(t) {
  const dt = coin.last ? Math.min(0.05, (t - coin.last) / 1000) : 0;
  coin.last = t;
  if (!coin.drag) {
    const pace = calm() ? 0 : 60;
    coin.vel += (pace - coin.vel) * Math.min(1, dt * (Math.abs(coin.vel) > 90 ? 0.9 : 2.5));
    coin.ay += coin.vel * dt;
    if (calm() && Math.abs(coin.vel) < 5) coin.ay += (Math.round(coin.ay / 180) * 180 - coin.ay) * Math.min(1, dt * 3);
    coin.ax += (-6 - coin.ax) * Math.min(1, dt * 3);
  }
  $('#coin').style.transform = `rotateX(${coin.ax}deg) rotateY(${coin.ay}deg)`;
  coin.raf = coinOn() ? requestAnimationFrame(coinFrame) : 0;
}
function coinRun() {
  if (!coinOn() || coin.raf) return;
  coin.last = 0;
  coin.raf = requestAnimationFrame(coinFrame);
}
function wireCoin() {
  const c = $('#coin');
  for (let z = -8; z <= 8; z++) c.append(el('i', { className: 'edge', style: `transform: translateZ(${z}px) scale(.985)` }));
  c.append(
    el('i', { className: 'face', style: 'transform: translateZ(9px)' }),
    el('i', { className: 'face', style: 'transform: rotateY(180deg) translateZ(9px)' }),
  );
  c.onpointerdown = (e) => {
    Object.assign(coin, { drag: true, lx: e.clientX, ly: e.clientY, lt: performance.now(), sv: 0 });
    c.classList.add('grab');
    c.setPointerCapture(e.pointerId);
  };
  c.onpointermove = (e) => {
    if (!coin.drag) return;
    const t = performance.now(),
      dx = e.clientX - coin.lx,
      dy = e.clientY - coin.ly,
      ms = Math.max(1, t - coin.lt);
    coin.ay += dx * 0.6;
    coin.ax = Math.max(-35, Math.min(35, coin.ax - dy * 0.4));
    coin.sv = coin.sv * 0.5 + ((dx * 0.6) / ms) * 1000 * 0.5;
    Object.assign(coin, { lx: e.clientX, ly: e.clientY, lt: t });
  };
  c.onpointerup = c.onpointercancel = () => {
    if (!coin.drag) return;
    coin.drag = false;
    c.classList.remove('grab');
    coin.vel = performance.now() - coin.lt > 120 ? 0 : Math.max(-2500, Math.min(2500, coin.sv)); // held still before letting go: no spin
  };
  document.addEventListener('visibilitychange', coinRun);
}

// Request: the connected Kick / Twitch accounts (none: Connections first), the terms and "I accept", then Send: Jarchi
// Pay's one-time link opens in the browser, where signing in with the channel sends the request.
function openCryptoAsk() {
  const accounts = [
    ['kick', kick],
    ['twitch', twitch],
  ].filter(([, a]) => a?.state === 'connected' && a.login);
  $('#cryptoForm').hidden = !accounts.length;
  $('#cryptoNoChannel').hidden = !!accounts.length;
  $('#cryptoSent').hidden = true;
  $('#cryptoChannels').replaceChildren(
    ...accounts.map(([p, a]) =>
      el(
        'div',
        { className: 'crypto-channel' },
        el('img', { src: `/assets/platform-logos/${p}.svg`, alt: '' }),
        el('b', {}, el('bdi', { textContent: a.login })),
        el('small', { textContent: tpl(S.panel.cryptoConnected, { platform: S.platforms[p] }) }),
      ),
    ),
  );
  $('#cryptoAgree').checked = false;
  $('#cryptoSend').disabled = true;
  $('#cryptoAsk').showModal();
}
function wireCrypto() {
  wireCoin();
  $('#cryptoHeroText').append(...marked(S.panel.cryptoHeroText, 'b'));
  $('#cryptoTerms').append(...S.panel.cryptoTerms.map((t) => el('li', {}, ...marked(t, 'u'))));
  $('#cryptoRequest').onclick = openCryptoAsk;
  $('#cryptoAgree').onchange = (e) => ($('#cryptoSend').disabled = !e.target.checked);
  $$('#cryptoAsk [data-close]').forEach((b) => (b.onclick = () => $('#cryptoAsk').close()));
  $('#cryptoGoConn').onclick = () => {
    $('#cryptoAsk').close();
    select('connections');
  };
  $('#cryptoSend').onclick = async () => {
    $('#cryptoSend').disabled = true;
    try {
      ({ url: payLink } = await api('POST', '/api/crypto/request', { accept: $('#cryptoAgree').checked }));
    } catch (err) {
      toast(err.message, true);
      $('#cryptoSend').disabled = !$('#cryptoAgree').checked;
      return loadCrypto(); // already pending, or waiting after a rejection: the page says so
    }
    window.open(payLink, '_blank', 'noopener');
    $('#cryptoForm').hidden = true;
    $('#cryptoSent').hidden = false;
  };
  $('#cryptoOpenAgain').onclick = () => window.open(payLink, '_blank', 'noopener');
  $('#cryptoCopy').onclick = () => copyLink(pay.page, S.panel.cryptoLinkCopied);
  $('#cryptoPop').title = S.panel.cryptoPopOutHint;
  $('#cryptoPop').onclick = () => window.open('/crypto-popout.html', 'jarchiDonations', 'popup,width=380,height=600');
  $('#cryptoMore').onclick = () => loadDonations(true);
  $('#cryptoWalletSet').onclick = $('#cryptoWalletChange').onclick = () =>
    api('POST', '/api/crypto/wallets/link').then(
      ({ url }) => window.open(url, '_blank', 'noopener'),
      (err) => toast(err.message, true),
    );
  $('#cryptoChangeCancel').onclick = () =>
    api('POST', '/api/crypto/wallets/cancel').then(
      (st) => {
        gotCrypto(st);
        toast(S.panel.cryptoChangeCancelled);
      },
      (err) => (toast(err.message, true), loadCrypto()),
    );
  addEventListener('focus', () => view === 'donations' && loadCrypto()); // back from the browser: the request sent, the wallets set
  wireCryptoAlerts();
  wireCryptoPage();
  wireCryptoHello();
}

// ---------- The gateway approved: a welcome and a tour, once ----------
// The first time the gateway is active (settings.cryptoWelcomed; also for one approved before there was a welcome): a
// gold note on top and a dot on Crypto. Either opens the rules, whose tick waits until they're read to the end; Let's
// go saves that they were shown and opens the Crypto page with its tour. Closed before that (Escape): the dot stays,
// and the next start shows the note again.
const RED_RULES = [1, 2, 6]; // where money can be lost: the address, the network, what Jarchi can't do
const cryptoNav = () => $('.nav-item[data-view="donations"]');
function cryptoHello() {
  if (POP || $('.crypto-dot')) return;
  cryptoNav().classList.add('crypto-hl');
  cryptoNav().append(el('span', { className: 'crypto-dot' }));
  setTimeout(() => $('#cryptoToast').classList.add('on'), 400);
}
function openCryptoHello() {
  $('#cryptoToast').classList.remove('on');
  if (!$('#cryptoHelloCoin').childElementCount) helloCoinFaces();
  const page = pay.page?.replace(/^https?:\/\//, '') ?? '';
  $('#cryptoHelloRules').replaceChildren(
    ...S.panel.cryptoHelloRules.map(([title, text], i) =>
      el(
        'li',
        { className: RED_RULES.includes(i) ? 'red' : '', style: `animation-delay: ${0.05 + i * 0.07}s` },
        el('span', { className: 'n', textContent: fd(i + 1) }),
        el('div', {}, el('b', { textContent: title }), el('span', {}, ...rich(tpl(text, { page })))),
      ),
    ),
  );
  Object.assign($('#cryptoHelloAgree'), { checked: false, disabled: true });
  $('#cryptoHelloGo').disabled = true;
  $('#cryptoHelloRead').textContent = S.panel.cryptoHelloRead;
  $('#cryptoHello').showModal();
  $('#cryptoHelloRules').scrollTop = 0;
  helloRead();
  requestAnimationFrame(helloCoin);
}
// How far the rules are read: the bar, and the tick once they're read to the end (on a tall window, at once). Also
// when the rules finish coming in: until then they're a little lower.
function helloRead() {
  const b = $('#cryptoHelloRules'),
    p = Math.min(1, (b.scrollTop + b.clientHeight) / b.scrollHeight);
  $('#cryptoHelloBar').style.width = pct(p);
  if (p <= 0.98 || !$('#cryptoHelloAgree').disabled) return;
  $('#cryptoHelloAgree').disabled = false;
  $('#cryptoHelloRead').textContent = '';
}
// The welcome's coin: Jarchi Pay's (the Luck page's faces, with its own words), turning and bobbing while the rules are
// open. Reduce animations: it rests face on.
function helloCoinFaces() {
  const c = $('#cryptoHelloCoin'),
    font = 'Manrope,Arial,sans-serif';
  for (let z = -5; z <= 5; z++) c.append(el('div', { className: 'edge', style: `transform: translateZ(${z}px) scale(.985)` }));
  c.append(
    el('div', {
      className: 'face',
      style: 'transform: translateZ(5.3px)',
      innerHTML: `<svg viewBox="0 0 200 200">${LK_FACE_DEFS('pa')}${lkArc('pa', 'JARCHI PAY', 'aT', 12.5, 5, font)}${lkArc('pa', 'CRYPTO · DONATE', 'aB', 9, 3.2, font)}</svg><img class="lk-clogo" src="/assets/brand/jarchi-coin-logo.webp" alt="" />${LK_SHINE}`,
    }),
    el('div', {
      className: 'face',
      style: 'transform: rotateY(180deg) translateZ(5.3px)',
      innerHTML: `<svg viewBox="0 0 200 200">${LK_FACE_DEFS('pb')}<g filter="url(#empb)" fill="#9a6c0e" font-family="${font}" text-anchor="middle"><text x="100" y="96" font-size="27" font-weight="800" letter-spacing="2">JARCHI</text><text x="100" y="124" font-size="17" font-weight="800" letter-spacing="9">PAY</text><path d="M58 106 h22 M120 106 h22" stroke="#9a6c0e" stroke-width="1.4"/><text x="100" y="150" font-size="9" font-weight="700" letter-spacing="3">EST · 2026</text></g></svg>${LK_SHINE}`,
    }),
  );
}
function helloCoin(t) {
  const c = $('#cryptoHelloCoin'),
    still = calm(),
    ay = still ? 0 : t * 0.06; // 60° a second
  c.style.transform = `translateY(${still ? 0 : Math.sin(t / 700) * 4}px) rotateX(-8deg) rotateY(${ay}deg)`;
  lkShine(c, ay);
  if (!still && $('#cryptoHello').open) requestAnimationFrame(helloCoin);
}

// The tour: five stops, each a tab of the page and the part of it in the spotlight (with Pop out, for the donations).
// A modal like the welcome tour's Sidebar step (#spot), so the page can't be clicked meanwhile. Skip, Escape or the
// last stop end it on the Donation page tab, where the wallets are entered.
const CRYPTO_TOUR = [
  ['page', () => [$('#cryptoWalletChange').closest('.box')]],
  ['alerts', () => [$('#cryptoAlertsTab .crypto-cards')]],
  ['alerts', () => [$('#cryptoTestBtn').closest('.box')]],
  ['page', () => [$('#cryptoBio').closest('.box')]],
  ['donations', () => [$('#cryptoPop'), $('#cryptoDonations')]],
];
let cryptoStop = 0;
function cryptoTourTo(i) {
  const d = $('#cryptoTour'),
    [tab, parts] = CRYPTO_TOUR[i],
    [title, text] = S.panel.cryptoTourSteps[i],
    n = CRYPTO_TOUR.length;
  cryptoStop = i;
  showCryptoTab(tab);
  $('#cryptoTourStep').textContent = tpl(S.panel.cryptoTourStep, { n: fd(i + 1), total: fd(n) });
  $('#cryptoTourTitle').textContent = title;
  $('#cryptoTourText').textContent = text;
  $('#cryptoTourNext').textContent = i < n - 1 ? S.panel.next : S.panel.cryptoTourStart;
  $('#cryptoTourDots').replaceChildren(...CRYPTO_TOUR.map((_, k) => el('i', { className: k === i ? 'on' : '' })));
  const first = !d.open;
  d.classList.toggle('still', first); // the first stop shows at once, no glide in from the corner
  if (first) d.showModal();
  const ps = parts();
  ps.at(-1).scrollIntoView({ block: 'nearest' });
  ps[0].scrollIntoView({ block: 'nearest' });
  placeCryptoTour();
  void d.offsetWidth; // (that's where the next glide starts)
  d.classList.remove('still');
  $('#cryptoTourNext').focus();
}
// The bright hole around the stop's parts, and the tip under it (over it when there's no room below), its arrow at the
// middle of the hole. Both always inside the window.
function placeCryptoTour() {
  const rs = CRYPTO_TOUR[cryptoStop][1]()
      .map((e) => e.getBoundingClientRect())
      .filter((r) => r.width),
    pad = 8,
    m = 20;
  if (!rs.length) return;
  const left = Math.min(...rs.map((r) => r.left)) - pad,
    right = Math.max(...rs.map((r) => r.right)) + pad,
    top = Math.min(...rs.map((r) => r.top)) - pad,
    bottom = Math.max(...rs.map((r) => r.bottom)) + pad;
  Object.assign($('#cryptoTour .spot-hole').style, { left: px(left), top: px(top), width: px(right - left), height: px(bottom - top) });
  const tip = $('.crypto-tip'),
    w = tip.offsetWidth,
    h = tip.offsetHeight,
    mid = (left + right) / 2,
    below = bottom + 18 + h < innerHeight,
    x = Math.max(m, Math.min(innerWidth - w - m, mid - w / 2));
  tip.classList.toggle('above', !below);
  Object.assign(tip.style, { left: px(x), top: px(Math.max(8, Math.min(innerHeight - h - 8, below ? bottom + 16 : top - 16 - h))) });
  $('.crypto-arr').style.left = px(Math.max(16, Math.min(w - 30, mid - x - 7)));
}

function wireCryptoHello() {
  $('#cryptoToast').onclick = openCryptoHello;
  cryptoNav().addEventListener('click', () => $('.crypto-dot') && openCryptoHello());
  $('#cryptoHelloRules').onscroll = $('#cryptoHelloRules').onanimationend = helloRead;
  $('#cryptoHelloAgree').onchange = (e) => ($('#cryptoHelloGo').disabled = !e.target.checked);
  $('#cryptoHelloGo').onclick = () => {
    settings.cryptoWelcomed = true;
    api('PATCH', '/api/settings', { cryptoWelcomed: true }).then(
      (s) => (settings = s),
      () => {},
    );
    $('#cryptoHello').close();
    $('.crypto-dot')?.remove();
    cryptoNav().classList.remove('crypto-hl');
    select('donations');
    if (pay.state === 'active') cryptoTourTo(0);
  };
  $('#cryptoTourNext').onclick = () => (cryptoStop < CRYPTO_TOUR.length - 1 ? cryptoTourTo(cryptoStop + 1) : $('#cryptoTour').close());
  $('#cryptoTourSkip').onclick = () => $('#cryptoTour').close();
  $('#cryptoTour').onclose = () => showCryptoTab('page');
  const follow = () => $('#cryptoTour').open && placeCryptoTour();
  addEventListener('resize', () => {
    if ($('#cryptoHello').open) helloRead();
    follow();
  });
  addEventListener('scroll', follow, true); // the page scrolled under it
  new ResizeObserver(follow).observe($('.view.crypto')); // the state, the wallets or the donations came in under it
}

// ---------- The donation page (the Crypto page's Donation page tab) ----------
// The wallets, read only (pay.wallets: they're changed on Jarchi Pay's site), the banner and picture, the line under the
// name and the links. Asked from Jarchi Pay when the tab opens (once each time the Crypto page does), so what's typed
// stays while the state changes; Save sends the line and every link, and Jarchi Pay's answer fills them in again.
// Each link: the start that stays (the platform's own site, or https:// for Website), then the id or the address.
const PAGE_LINKS = {
  kick: ['kick.com/'],
  twitch: ['twitch.tv/'],
  youtube: ['youtube.com/@'],
  instagram: ['instagram.com/'],
  telegram: ['t.me/', 'telegram.me/'],
  discord: ['discord.gg/', 'discord.com/invite/', 'discordapp.com/invite/'],
  website: ['https://'],
};
const LINK_NAMES = { kick: 'Kick', twitch: 'Twitch', youtube: 'YouTube', instagram: 'Instagram', telegram: 'Telegram', discord: 'Discord' };
let cryptoPage = null,
  pageAsk = null; // Jarchi Pay's { bio, socials, links, avatar, banner }; null: not here (yet)
// What a link's field keeps: a link pasted from the platform's own site (www. or m. in front is fine) gives its id, an
// @ in front goes; Website keeps the address without https://. Jarchi Pay checks them all again.
function linkId(k, v) {
  const bare = v.trim().replace(/^https?:\/\//i, '');
  if (k === 'website') return bare.replace(/^([^/?#]+)\/$/, '$1');
  const at = bare.replace(/^(www|m)\./i, ''),
    from = PAGE_LINKS[k].find((f) => at.toLowerCase().startsWith(f));
  if (!from) return v.trim().replace(/^@/, '');
  try {
    return decodeURIComponent(at.slice(from.length).split(/[/?#]/)[0]);
  } catch {
    return v.trim();
  }
}
const loadCryptoPage = () =>
  (pageAsk ??= api('GET', '/api/crypto/page')
    .then(
      (r) => {
        cryptoPage = r;
        fillCryptoPage();
      },
      (err) => toast(err.message, true),
    )
    .finally(() => {
      pageAsk = null;
      renderCryptoPage();
    }));
function fillCryptoPage() {
  $('#cryptoBio').value = cryptoPage.bio ?? '';
  for (const inp of $$('#cryptoLinks input')) inp.value = linkId(inp.dataset.link, cryptoPage.socials[inp.dataset.link] ?? '');
  $$('#cryptoPageTab [aria-invalid]').forEach((i) => i.removeAttribute('aria-invalid'));
}
function renderCryptoPage() {
  const w = pay.wallets,
    p = cryptoPage,
    set = w?.bep20 || w?.trc20; // one is enough: the other is then "not used"
  for (const net of ['bep20', 'trc20']) {
    const row = $(`#cryptoPageTab [data-net="${net}"]`),
      a = w?.[net];
    Object.assign($('code', row), { textContent: a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '', title: a ?? '' });
    Object.assign($('.crypto-ok', row), {
      textContent: a ? `✓ ${S.panel.cryptoWalletOn}` : set ? S.panel.cryptoWalletUnused : S.panel.cryptoWalletOff,
      className: `crypto-ok${a ? '' : ' off'}`,
    });
  }
  $('#cryptoWalletChange').textContent = set ? S.panel.cryptoWalletChange : S.panel.cryptoWalletSet;
  $('#cryptoPageSave').disabled = !p;
  for (const box of $$('#cryptoPageTab [data-kind]')) {
    const pic = p?.[box.dataset.kind];
    (box.dataset.kind === 'banner' ? box : $('.pic', box)).style.backgroundImage = pic?.url ? `url("/remote?u=${encodeURIComponent(pic.url)}")` : '';
    $('.from', box).textContent = !p ? '…' : pic.custom ? S.panel.cryptoPicYours : pic.url ? S.panel.cryptoPicChannel : S.panel.cryptoPicNone;
    $('.upload', box).disabled = !p;
    $('.remove', box).hidden = !pic?.custom;
  }
  $('#cryptoAvatar .pic').textContent = p?.avatar.url ? '' : (pay.channel || '?')[0].toUpperCase();
}
async function saveCryptoPage() {
  const socials = {};
  for (const inp of $$('#cryptoLinks input')) {
    const k = inp.dataset.link,
      v = (inp.value = linkId(k, inp.value));
    if (v) socials[k] = k === 'website' ? `https://${v}` : v;
  }
  $('#cryptoPageSave').disabled = true;
  try {
    cryptoPage = await api('PUT', '/api/crypto/page', { bio: $('#cryptoBio').value.trim(), socials });
    fillCryptoPage();
    toast(S.panel.cryptoPageSaved);
  } catch (err) {
    const bad = err.field === 'bio' ? $('#cryptoBio') : $$('#cryptoLinks input').find((i) => err.field === `socials.${i.dataset.link}`);
    bad?.setAttribute('aria-invalid', 'true');
    bad?.focus();
    toast(bad?.dataset.link ? tpl(S.panel.cryptoBadLink, { name: bad.getAttribute('aria-label') }) : err.message, true);
  } finally {
    renderCryptoPage();
  }
}
