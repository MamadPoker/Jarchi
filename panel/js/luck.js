// ---------- Luck (core/luck.js): a prize wheel, a giveaway from Kick and Twitch chat, and a coin flip ----------
// One tab each (remembered). The wheels, the giveaway's options and the coin's score are saved in data/luck.json: a
// change goes half a second after the last one, and it's all read again when the window comes back to the front (the
// pop-out may have changed it). The giveaway itself is the server's (who joined, from chat): it comes by socket, to this
// window and the pop-out alike. Space spins the wheel, flips the coin, or shows the next name; never while typing.
let luck, // the saved part: { wheels, wheel, perSlice, tick, removeWinner, spins, gw, coin } (GET /api/luck)
  lkLive = { status: 'idle', endsAt: null, entrants: [] }, // the giveaway now (socket 'giveaway', 'giveawayJoin')
  lkTab = 'wheel';
const LK_TABS = ['wheel', 'gw', 'coin'];
const LK_CHANCES = [0.25, 0.5, 1, 2]; // core/luck.js's: very low, low, normal, high (S.panel.luckChances)
// Each slice takes the next of Jarchi's colors; text on the light ones is dark.
const LK_COLORS = ['#1d817c', '#e8bd55', '#2a5c58', '#c9973a', '#4fd1bf', '#7a5a1c', '#16504c', '#f1d17d'];
const LK_LIGHT = ['#e8bd55', '#4fd1bf', '#f1d17d', '#c9973a'];
const LK_ENTRANTS = 300; // ponytail: the list shows the newest 300 (the count is all of them); page it if a giveaway gets bigger
const TAU = Math.PI * 2;
const lkId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const lkKey = (e) => `${e.platform}:${e.login}`;
const lkOn = () => view === 'luck' && !document.hidden;

// ---------- Saving ----------
const lkDirty = new Set();
let lkSaveTimer;
function lkSave(...keys) {
  keys.forEach((k) => lkDirty.add(k));
  clearTimeout(lkSaveTimer);
  lkSaveTimer = setTimeout(lkFlush, 500);
}
function lkFlush() {
  clearTimeout(lkSaveTimer);
  if (!lkDirty.size) return Promise.resolve();
  const body = Object.fromEntries([...lkDirty].map((k) => [k, luck[k]]));
  lkDirty.clear();
  return api('PATCH', '/api/luck', body).then(
    () => {},
    (err) => toast(err.message, true),
  );
}
// The first run: Jarchi's sample wheels, in the panel's language. Again from the server: drawn only if it changed.
function gotLuck(d) {
  if (!d.wheels.length) {
    d.wheels = S.panel.luckSamples.map((w) => ({ id: lkId(), name: w.name, slices: w.slices.map(([text, chance]) => ({ text, chance })) }));
    lkDirty.add('wheels').add('wheel');
  }
  if (!d.wheels.some((w) => w.id === d.wheel)) d.wheel = d.wheels[0].id;
  if (luck && JSON.stringify(d) === JSON.stringify(luck)) return;
  luck = d;
  if (lkDirty.size) lkFlush();
  renderLuck();
}
const loadLuck = () => !lkDirty.size && !lkSpinning && !lkFlipping && !lkRun && api('GET', '/api/luck').then(gotLuck, () => {});

// ---------- Sounds (the design's: soft, made here) ----------
let lkAudio;
const lkAc = () => (lkAudio ??= new AudioContext());
// The wheel's and the reel's ticks and chimes; Tick sound off: none.
function lkTick(f = 1800, d = 0.03, v = 0.05) {
  if (!luck?.tick) return;
  try {
    const ac = lkAc(),
      o = ac.createOscillator(),
      g = ac.createGain();
    o.type = 'triangle';
    o.frequency.value = f;
    g.gain.setValueAtTime(v, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + d);
    o.connect(g).connect(ac.destination);
    o.start();
    o.stop(ac.currentTime + d + 0.02);
  } catch {}
}
// The coin: a ring of metal (a few partials), and the air it spins through.
function lkMetal(at = 0, v = 0.12, base = 2200) {
  try {
    const ac = lkAc(),
      t0 = ac.currentTime + at;
    for (const [m, a] of [
      [1, 1],
      [2.76, 0.5],
      [5.4, 0.28],
      [8.93, 0.16],
    ]) {
      const o = ac.createOscillator(),
        g = ac.createGain();
      o.type = 'sine';
      o.frequency.value = base * m * (1 + Math.random() * 0.01);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(v * a, t0 + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5 / m + 0.15);
      o.connect(g).connect(ac.destination);
      o.start(t0);
      o.stop(t0 + 0.8);
    }
  } catch {}
}
function lkWhoosh(dur) {
  try {
    const ac = lkAc(),
      n = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate),
      d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.5;
    const s = ac.createBufferSource(),
      f = ac.createBiquadFilter(),
      g = ac.createGain(),
      t0 = ac.currentTime;
    s.buffer = n;
    f.type = 'bandpass';
    f.Q.value = 3;
    for (let k = 0; k < dur * 12; k++) f.frequency.setValueAtTime(700 + (k % 2 ? 900 : 300), t0 + k / 12);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.05, t0 + 0.15);
    g.gain.linearRampToValueAtTime(0.03, t0 + dur * 0.7);
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    s.connect(f).connect(g).connect(ac.destination);
    s.start();
  } catch {}
}

// ---------- Tabs, and the one animation loop (only while the page is in view) ----------
function showLuckTab(t) {
  lkTab = t;
  remember.set('jarchi.luckTab', t);
  $$('.lk-tabs [role=tab]').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.tab === t));
    b.tabIndex = b.dataset.tab === t ? 0 : -1;
  });
  $$('.lk-pane').forEach((p) => (p.hidden = p.dataset.tab !== t));
  lkLoop();
}
let lkRaf = 0,
  lkLast = 0;
function lkFrame(now) {
  const dt = lkLast ? Math.min(0.05, (now - lkLast) / 1000) : 0;
  lkLast = now;
  if (luck && (lkTab === 'wheel' || lkSpinning)) wheelFrame(now);
  if (luck && (lkTab === 'coin' || lkFlipping)) coinFrame2(now, dt);
  lkRaf = lkOn() && (lkTab !== 'gw' || lkSpinning || lkFlipping) ? requestAnimationFrame(lkFrame) : 0;
}
function lkLoop() {
  if (!lkOn() || lkRaf) return;
  lkLast = 0;
  lkDrawn = null;
  lkRaf = requestAnimationFrame(lkFrame);
}
// The page opened (select): what changed in the pop-out meanwhile, and its animations.
function showLuck() {
  loadLuck();
  lkLoop();
  if (luck) renderLuckTimes();
}

// ---------- Wheel ----------
let lkRot = 0,
  lkSpinning = null, // the spin on screen: { t0, start, end, win, wheel, last }
  lkHL = -1, // the slice that won, lit until the wheel changes
  lkDrawn; // what the canvas shows (redrawn only when that changes)
const lkWheel = () => luck.wheels.find((w) => w.id === luck.wheel) ?? luck.wheels[0];
const lkWeight = (s) => (luck.perSlice ? s.chance : 1);
function lkArcs(slices) {
  const tot = slices.reduce((a, s) => a + lkWeight(s), 0);
  let a = 0;
  return slices.map((s) => {
    const w = (lkWeight(s) / tot) * TAU;
    return [a, (a += w)];
  });
}
// The slice under the pointer (on top) at a turn of r.
function lkAt(r, slices) {
  const p = (((-Math.PI / 2 - r) % TAU) + TAU) % TAU;
  return lkArcs(slices).findIndex(([a0, a1]) => p >= a0 && p < a1);
}
function drawWheel(now) {
  const cx = $('#lkCanvas').getContext('2d'),
    slices = lkWheel().slices,
    R = 440,
    A = lkArcs(slices),
    t = calm() ? 0 : now;
  cx.clearRect(0, 0, 880, 880);
  cx.save();
  cx.translate(440, 440);
  cx.rotate(lkRot);
  A.forEach(([a0, a1], i) => {
    const col = LK_COLORS[i % LK_COLORS.length];
    cx.beginPath();
    cx.moveTo(0, 0);
    cx.arc(0, 0, R - 14, a0, a1);
    cx.closePath();
    cx.fillStyle = col;
    cx.fill();
    if (lkHL >= 0 && i !== lkHL) {
      cx.fillStyle = 'rgba(5,12,11,.55)';
      cx.fill();
    }
    if (i === lkHL) {
      cx.fillStyle = `rgba(255,240,190,${0.12 + 0.12 * Math.sin(t / 180)})`;
      cx.fill();
    }
    cx.strokeStyle = '#0b1716';
    cx.lineWidth = 4;
    cx.stroke();
    cx.save();
    cx.rotate((a0 + a1) / 2);
    cx.textAlign = 'right';
    cx.textBaseline = 'middle';
    cx.fillStyle = LK_LIGHT.includes(col) ? '#2e2510' : '#fff';
    cx.font = '800 30px Manrope, Vazirmatn, sans-serif';
    const chars = [...slices[i].text],
      text = chars.length > 16 ? `${chars.slice(0, 15).join('')}…` : slices[i].text;
    cx.direction = /\p{Script=Arabic}/u.test(text) ? 'rtl' : 'ltr';
    cx.fillText(text, R - 50, 0);
    cx.restore();
  });
  if (lkHL >= 0 && A[lkHL]) {
    const [a0, a1] = A[lkHL];
    cx.beginPath();
    cx.arc(0, 0, R - 14, a0, a1);
    cx.arc(0, 0, 40, a1, a0, true);
    cx.closePath();
    cx.lineWidth = 7;
    cx.strokeStyle = `rgba(255,230,150,${0.6 + 0.4 * Math.sin(t / 160)})`;
    cx.stroke();
  }
  cx.beginPath();
  cx.arc(0, 0, R - 8, 0, TAU);
  cx.lineWidth = 16;
  cx.strokeStyle = '#0b1716';
  cx.stroke();
  // The rim's lights: running while it spins, slowly taking turns when it rests.
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * TAU,
      on = lkSpinning ? (i + Math.floor(t / 70)) % 3 === 0 : (i + Math.floor(t / 400)) % 2 === 0;
    cx.beginPath();
    cx.arc(Math.cos(a) * (R - 8), Math.sin(a) * (R - 8), on ? 6 : 4.5, 0, 7);
    cx.fillStyle = on ? '#fff3c4' : '#a07a28';
    cx.fill();
  }
  cx.restore();
}
const WIND_MS = 380,
  SPIN_MS = 5400,
  WIND_BACK = 0.22;
function wheelFrame(now) {
  const s = lkSpinning;
  if (s) {
    const ms = now - s.t0;
    if (ms < WIND_MS)
      lkRot = s.start - WIND_BACK * Math.sin(((ms / WIND_MS) * Math.PI) / 2); // a short wind-up backwards
    else {
      const p = Math.min(1, (ms - WIND_MS) / SPIN_MS);
      lkRot = s.start - WIND_BACK + (s.end - (s.start - WIND_BACK)) * (1 - Math.pow(1 - p, 4));
    }
    const k = lkAt(lkRot, s.wheel.slices);
    if (k !== s.last) {
      s.last = k;
      lkTick();
      const ptr = $('#lkPtr');
      ptr.classList.remove('tick');
      void ptr.offsetWidth; // the pointer bounces again
      ptr.classList.add('tick');
    }
    if (ms >= WIND_MS + SPIN_MS) spinDone();
  }
  // Resting: the lights change every 400 ms (never with Reduce animations); a lit winner pulses.
  const key = s || (lkHL >= 0 && !calm()) ? now : calm() ? 0 : Math.floor(now / 400);
  if (key !== lkDrawn) {
    lkDrawn = key;
    drawWheel(now);
  }
}
function spinWheel() {
  if (lkSpinning || !luck) return;
  const wheel = lkWheel(),
    slices = wheel.slices;
  let r = Math.random() * slices.reduce((a, s) => a + lkWeight(s), 0),
    win = 0;
  for (; win < slices.length - 1; win++) if ((r -= lkWeight(slices[win])) < 0) break;
  const [a0, a1] = lkArcs(slices)[win],
    target = a0 + (a1 - a0) * (0.2 + Math.random() * 0.6);
  let end = -Math.PI / 2 - target;
  while (end < lkRot + TAU * 6) end += TAU; // six turns or more
  lkHL = -1;
  $('#lkWres').replaceChildren();
  $('#lkWh').classList.add('glow');
  $('#lkHub').classList.add('spin');
  lkSpinning = { t0: performance.now(), start: lkRot, end, win, wheel, last: lkAt(lkRot, slices) };
  lkLoop();
}
function spinDone() {
  const { win, wheel } = lkSpinning,
    slice = wheel.slices[win];
  lkSpinning = null;
  lkRot = ((lkRot % TAU) + TAU) % TAU;
  lkHL = wheel === lkWheel() ? win : -1;
  $('#lkWh').classList.remove('glow');
  $('#lkHub').classList.remove('spin');
  $('#lkWres').replaceChildren(
    el('div', { className: 'lk-rcard' }, el('small', { textContent: S.panel.luckResult }), el('b', { textContent: slice.text, dir: 'auto' })),
  );
  lkTick(1300, 0.25, 0.08);
  setTimeout(() => lkTick(1750, 0.35, 0.07), 120);
  luck.spins = [{ text: slice.text, at: Date.now() }, ...luck.spins].slice(0, 5);
  lkSave('spins');
  renderLuckTimes();
  // Remove the winner after: once the result has been seen.
  if (luck.removeWinner && wheel.slices.length > 2)
    setTimeout(() => {
      const i = wheel.slices.indexOf(slice);
      if (lkSpinning || i < 0 || wheel.slices.length <= 2) return;
      wheel.slices.splice(i, 1);
      lkSave('wheels');
      if (wheel === lkWheel()) renderSlices();
    }, 2200);
}

function renderWheels() {
  const w = lkWheel();
  $('#lkWheels').replaceChildren(
    ...luck.wheels.map((x) => {
      const chip = el('button', { className: `lk-chip${x === w ? ' on' : ''}`, textContent: x.name || S.panel.luckNewWheelName, dir: 'auto' });
      chip.setAttribute('aria-pressed', String(x === w));
      chip.onclick = () => pickWheel(x.id);
      return chip;
    }),
    el('button', { className: 'lk-chip add', textContent: S.panel.luckNewWheel, disabled: luck.wheels.length >= 30, onclick: addWheel }),
  );
  if ($('#lkWheelName') !== document.activeElement) $('#lkWheelName').value = w.name;
  $('#lkWheelDel').disabled = luck.wheels.length < 2;
}
function pickWheel(id) {
  if (lkSpinning || id === luck.wheel) return;
  luck.wheel = id;
  lkSave('wheel');
  $('#lkWres').replaceChildren();
  renderWheels();
  renderSlices();
}
function addWheel() {
  if (lkSpinning) return;
  const w = { id: lkId(), name: S.panel.luckNewWheelName, slices: [1, 2].map((n) => ({ text: `${S.panel.luckNewSlice} ${fd(n)}`, chance: 1 })) };
  luck.wheels.push(w);
  luck.wheel = w.id;
  lkSave('wheels', 'wheel');
  $('#lkWres').replaceChildren();
  renderWheels();
  renderSlices();
  $('#lkWheelName').focus();
  $('#lkWheelName').select();
}
// The open wheel's slices: text, chance (with Separate chance per slice), and ✕ (a wheel keeps 2 at least).
function renderSlices() {
  const w = lkWheel();
  lkHL = -1;
  lkDrawn = null;
  $('#lkSlices').replaceChildren(
    ...w.slices.map((s, i) => {
      const text = el('input', { type: 'text', value: s.text, maxLength: 80, dir: 'auto' });
      text.setAttribute('aria-label', S.panel.luckSliceText);
      text.oninput = () => {
        s.text = text.value;
        lkDrawn = null;
        lkSave('wheels');
      };
      const pick = el('select', {}, ...[3, 2, 1, 0].map((k) => el('option', { value: String(LK_CHANCES[k]), textContent: S.panel.luckChances[k] })));
      pick.value = String(s.chance);
      pick.setAttribute('aria-label', S.panel.luckSliceChance);
      pick.onchange = () => {
        s.chance = Number(pick.value);
        lkDrawn = null;
        lkSave('wheels');
      };
      const x = el('button', { className: 'lk-x', textContent: '✕', disabled: w.slices.length <= 2 });
      x.setAttribute('aria-label', S.panel.luckRemoveSlice);
      x.onclick = () => {
        if (lkSpinning || w.slices.length <= 2) return;
        w.slices.splice(w.slices.indexOf(s), 1);
        lkSave('wheels');
        renderSlices();
      };
      return el(
        'div',
        { className: `lk-sl${luck.perSlice ? '' : ' nochance'}` },
        el('span', { className: 'lk-dot', style: `background:${LK_COLORS[i % LK_COLORS.length]}` }),
        text,
        pick,
        x,
      );
    }),
  );
  $('#lkAddSlice').disabled = w.slices.length >= 60;
}
// "Recent spins" / "Recent flips": what came, and when (or none yet).
const lkHist = (rows, none) =>
  rows.length
    ? rows.map(([what, at]) => el('div', {}, el('b', { textContent: what, dir: 'auto' }), el('span', { textContent: ago(at) })))
    : [el('div', {}, el('b', { textContent: none }), el('span', { textContent: '—' }))];
function renderLuckTimes() {
  $('#lkWhist').replaceChildren(
    ...lkHist(
      luck.spins.map((s) => [s.text, s.at]),
      S.panel.luckNoSpins,
    ),
  );
  $('#lkChist').replaceChildren(
    ...lkHist(
      luck.coin.flips.map((f) => [S.panel[f.heads ? 'luckHeads' : 'luckTails'], f.at]),
      S.panel.luckNoFlips,
    ),
  );
}

// ---------- Giveaway ----------
let lkRun = null; // the draw on screen: { stop, wake } (stop: its window closed; wake: go on to the next name)
const lkIco = (p) => el('span', { className: 'lk-ico' }, el('img', { src: `/assets/platform-logos/${p}.svg`, alt: S.platforms[p], title: S.platforms[p] }));
const lkEntrant = (e) =>
  el(
    'div',
    {},
    lkIco(e.platform),
    el('bdi', { textContent: e.name }),
    e.sub && luck.gw.subLuck ? el('span', { className: 'lk-x2', textContent: S.panel.luckSubX2 }) : '',
  );
function renderEntrants() {
  $('#lkEnt').replaceChildren(...lkLive.entrants.slice(-LK_ENTRANTS).reverse().map(lkEntrant));
  $('#lkCount').textContent = fd(lkLive.entrants.length);
}
function renderGw() {
  const st = lkLive.status;
  $('#lkGst').className = `lk-pill ${st}`;
  $('#lkGst').textContent = S.panel[{ idle: 'luckIdle', open: 'luckOpen', closed: 'luckClosed' }[st]];
  $('#lkGopen').disabled = st === 'open' || !!lkRun;
  $('#lkGclose').disabled = st !== 'open';
  $('#lkGdraw').disabled = !lkLive.entrants.length || st === 'idle' || !!lkRun;
  $('#lkRnm').textContent = st === 'open' ? tpl(S.panel.luckRollOpen, { word: luck.gw.keyword }) : S.panel[st === 'closed' ? 'luckRollClosed' : 'luckRollIdle'];
  renderGwTime();
}
function renderGwTime() {
  const s = lkLive.endsAt ? Math.max(0, Math.ceil((lkLive.endsAt - Date.now()) / 1000)) : null;
  $('#lkGtime').textContent = s === null ? '' : tpl(S.panel.luckLeft, { time: fd(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`) });
}
// The options, as saved (the entry word never under the cursor).
function renderGwOptions() {
  const g = luck.gw;
  if ($('#lkKeyword') !== document.activeElement) $('#lkKeyword').value = g.keyword;
  for (const [name, v] of [
    ['lkWho', g.subsOnly ? 'subs' : 'all'],
    ['lkTimer', String(g.timer)],
    ['lkSpinTime', String(g.spin)],
    ['lkOrder', g.order],
    ['lkFlow', g.flow],
  ])
    $$(`[name=${name}]`).forEach((r) => (r.checked = r.value === v));
  $('#lkSubLuck').checked = g.subLuck;
  $('#lkNoRepeat').checked = g.noRepeat;
  $$('.lk-num').forEach((n) => ($('b', n).textContent = fd(g[n.dataset.n])));
}
async function startGiveaway() {
  await lkFlush(); // the entry word just typed
  try {
    lkLive = await api('POST', '/api/luck/giveaway/start');
  } catch (err) {
    return toast(err.message, true);
  }
  $('#lkGout').replaceChildren();
  renderEntrants();
  renderGw();
}

// The draw: the server picks (core/luck.js plan); here each name in turn on the reel, then the results.
const LK_ROW = 68; // one name on the reel
async function drawGiveaway() {
  if (lkRun) return;
  await lkFlush();
  let r;
  try {
    r = await api('POST', '/api/luck/giveaway/draw');
  } catch (err) {
    return toast(err.message, true);
  }
  const run = (lkRun = { stop: false, wake: null }),
    g = luck.gw,
    dlg = $('#lkDraw');
  lkWatch.clear();
  renderGw();
  $('#lkNext').hidden = $('#lkWin').hidden = $('#lkAgainRow').hidden = true;
  $('#lkChats').replaceChildren();
  $('#lkOout').replaceChildren();
  $('#lkGout').replaceChildren();
  if (!dlg.open) dlg.showModal();
  let pool = r.pool;
  for (let s = 0; s < r.seq.length; s++) {
    const { win, who } = r.seq[s];
    $('#lkStep').textContent = tpl(S.panel.luckStep, { n: fd(s + 1), total: fd(r.seq.length) });
    $('#lkLeft').textContent = tpl(S.panel.luckPeople, { n: fd(pool.length) });
    const names = pool.flatMap((p) => (g.subLuck && p.sub ? [p, p] : [p])); // what rolls past: subs twice, as they count
    await lkReel(run, names, who, win, win ? g.spin * 1000 : Math.max(2200, g.spin * 600));
    pool = pool.filter((p) => lkKey(p) !== lkKey(who));
    if (win) lkWinner(who);
    if (s < r.seq.length - 1) await (g.flow === 'pause' ? lkWaitNext(run) : lkPause(run, 1200));
  }
  $('#lkStep').textContent = S.panel.luckDone;
  $('#lkLeft').textContent = tpl(S.panel.luckPeople, { n: fd(pool.length) });
  $('#lkAgainRow').hidden = false;
  lkRun = null;
  renderGw();
}
// One name: the reel rolls past others and slows to a stop on it, red (eliminated) or gold (a winner). Its window closed
// meanwhile: straight to the end, silently.
function lkReel(run, names, pick, win, ms) {
  return new Promise((done) => {
    const strip = $('#lkStrip'),
      band = $('#lkBand'),
      tag = $('#lkBtag'),
      kind = win ? 'W' : 'L',
      N = Math.max(46, Math.round(ms / 90) + 10),
      T = N - 5, // the one it stops on, with names after it still in view
      y1 = -(T - 2) * LK_ROW,
      t0 = performance.now();
    band.className = 'lk-band';
    tag.className = 'lk-btag';
    strip.replaceChildren(
      ...Array.from({ length: N }, (_, i) => (i === T ? pick : names[Math.floor(Math.random() * names.length)])).map((p) =>
        el('div', { className: 'lk-it' }, lkIco(p.platform), el('bdi', { textContent: p.name })),
      ),
    );
    let last = 0;
    const stop = () => {
      strip.style.transform = `translateY(${y1}px)`;
      strip.children[T].classList.add('hit', kind);
      band.classList.add(kind);
      tag.textContent = win ? `🏆 ${S.panel.luckWinner}` : `✕ ${S.panel.luckOut}`;
      tag.classList.add('on', kind);
      if (!run.stop && win) {
        lkTick(1300, 0.25, 0.08);
        setTimeout(() => lkTick(1760, 0.4, 0.08), 130);
      } else if (!run.stop) lkTick(300, 0.18, 0.06);
      const row = () =>
        el(
          'div',
          { className: kind },
          lkIco(pick.platform),
          el('bdi', { textContent: pick.name }),
          el('span', { className: 'b', textContent: S.panel[win ? 'luckWinner' : 'luckOut'] }),
        );
      $('#lkOout').append(row());
      $('#lkGout').append(row());
      done();
    };
    const frame = (t) => {
      if (run.stop) return stop();
      const p = Math.min(1, (t - t0) / ms),
        y = y1 * (1 - Math.pow(1 - p, 3.4));
      strip.style.transform = `translateY(${y}px)`;
      const at = Math.floor(-y / LK_ROW + 0.5);
      if (at !== last) {
        last = at;
        lkTick(1500 + Math.random() * 300, 0.02, 0.035);
      }
      if (p < 1) requestAnimationFrame(frame);
      else stop();
    };
    strip.style.transform = 'translateY(0)';
    if (run.stop) stop();
    else requestAnimationFrame(frame);
  });
}
// After a name: wait for Next name (or Space), or a short bar and on.
function lkWaitNext(run) {
  return new Promise((go) => {
    const b = $('#lkNext');
    b.hidden = false;
    b.classList.remove('lk-bump');
    void b.offsetWidth;
    b.classList.add('lk-bump');
    run.wake = () => {
      run.wake = null;
      b.hidden = true;
      go();
    };
    if (run.stop) run.wake();
  });
}
function lkPause(run, ms) {
  return new Promise((go) => {
    const bar = $('#lkNbar');
    $('#lkNextl').textContent = S.panel.luckNextSoon;
    bar.style.transition = 'none';
    bar.style.width = '0';
    void bar.offsetWidth;
    bar.style.transition = `width ${ms}ms linear`;
    bar.style.width = '100%';
    const end = () => {
      clearTimeout(timer);
      run.wake = null;
      $('#lkNextl').textContent = '';
      bar.style.transition = 'none';
      bar.style.width = '0';
      go();
    };
    const timer = setTimeout(end, ms);
    run.wake = end;
    if (run.stop) end();
  });
}
// A winner's box: their next chat messages (the last 5), so you can tell they're watching.
const lkWatch = new Map(); // 'platform:login' -> the box
function lkWinner(w) {
  $('#lkWin').hidden = false;
  const box = el(
    'div',
    { className: 'lk-chat' },
    el('div', { className: 'lk-ch' }, lkIco(w.platform), el('bdi', { textContent: w.name }), el('span', { className: 'w', textContent: S.panel.luckWinner })),
    el('div', { className: 'lk-mini lk-wait', textContent: S.panel.luckWaiting }),
  );
  $('#lkChats').append(box);
  lkWatch.set(lkKey(w), box);
}
function luckChat(m) {
  const box = lkWatch.get(`${m.platform}:${m.user.login}`);
  if (!box || m.kind !== 'message' || m.test) return;
  $('.lk-wait', box)?.remove();
  box.append(el('div', { className: 'lk-m' }, el('b', {}, el('bdi', { textContent: m.user.name })), el('bdi', { textContent: m.text })));
  const msgs = $$('.lk-m', box);
  if (msgs.length > 5) msgs[0].remove();
}

// ---------- Coin flip ----------
// Jarchi Pay's coin: heads the logo, tails how many tails so far; its words in the panel's language. It turns slowly by
// itself (not with Reduce animations: then it rests face on), a drag turns it, a quick drag spins it. A flip jumps,
// spins and lands on the side drawn.
const lkCoin = { ay: 0, ax: -8, vel: 45, cy: 0, hold: 0, drag: false, lx: 0, ly: 0, lt: 0, sv: 0 };
let lkFlipping = null; // { t0, dur, a0, a1, done }
const LK_FACE_DEFS = (
  k,
) => `<defs><radialGradient id="fd${k}" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#ffefa8"/><stop offset=".45" stop-color="#eec24c"/><stop offset=".85" stop-color="#c2901c"/><stop offset="1" stop-color="#9a6d10"/></radialGradient>
<linearGradient id="rm${k}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff6cc"/><stop offset=".35" stop-color="#e8b93f"/><stop offset=".7" stop-color="#9c6e10"/><stop offset="1" stop-color="#5e4005"/></linearGradient>
<linearGradient id="ri${k}" x1="1" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#fff2b8"/><stop offset=".5" stop-color="#d9a832"/><stop offset="1" stop-color="#6e4c06"/></linearGradient>
<pattern id="ln${k}" width="200" height="200" patternUnits="userSpaceOnUse"><g fill="none" stroke="#7a5508" stroke-opacity=".06">${Array.from({ length: 40 }, (_, i) => `<circle cx="100" cy="100" r="${2 + i * 2}"/>`).join('')}</g></pattern>
<filter id="em${k}"><feOffset dx=".7" dy=".9" in="SourceAlpha" result="o"/><feFlood flood-color="#4a3204"/><feComposite in2="o" operator="in" result="s"/><feOffset dx="-.6" dy="-.6" in="SourceAlpha" result="o2"/><feFlood flood-color="#fff6cf"/><feComposite in2="o2" operator="in" result="h"/><feMerge><feMergeNode in="h"/><feMergeNode in="s"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<path id="aT${k}" d="M30 100 A70 70 0 0 1 170 100"/><path id="aB${k}" d="M36 100 A64 64 0 0 0 164 100"/></defs>
<circle cx="100" cy="100" r="100" fill="url(#rm${k})"/><circle cx="100" cy="100" r="91" fill="url(#ri${k})"/><circle cx="100" cy="100" r="88" fill="url(#fd${k})"/><circle cx="100" cy="100" r="88" fill="url(#ln${k})"/>
<g fill="#b8861a" stroke="#fff3c0" stroke-width=".35">${Array.from({ length: 72 }, (_, i) => {
  const a = (i / 72) * TAU;
  return `<circle cx="${(100 + 84 * Math.cos(a)).toFixed(2)}" cy="${(100 + 84 * Math.sin(a)).toFixed(2)}" r="1.15"/>`;
}).join('')}</g>`;
const LK_FONT = FA ? 'Vazirmatn,Tahoma,sans-serif' : 'Manrope,Arial,sans-serif';
// Words on an arc of the face (aT: over the top, aB: under the bottom).
const lkArc = (k, text, arc, size, spacing) =>
  `<text filter="url(#em${k})" font-family="${LK_FONT}" font-size="${size}" font-weight="800" letter-spacing="${spacing}" fill="#9a6c0e"><textPath href="#${arc}${k}" startOffset="50%" text-anchor="middle">${text}</textPath></text>`;
const lkName = (k) => (FA ? lkArc(k, S.panel.luckCoinName, 'aT', 17, 1) : lkArc(k, S.panel.luckCoinName, 'aT', 13, 7));
const LK_SHINE = '<div class="lk-shine"></div>';
const lkHeads = () =>
  `<svg viewBox="0 0 200 200">${LK_FACE_DEFS('h')}${lkName('h')}${
    FA
      ? `<text filter="url(#emh)" x="100" y="170" text-anchor="middle" font-family="${LK_FONT}" font-size="12" font-weight="800" fill="#9a6c0e">${S.panel.luckCoinLucky}</text>`
      : lkArc('h', S.panel.luckCoinLucky, 'aB', 9, 3.2)
  }</svg><img class="lk-clogo" src="/assets/brand/jarchi-coin-logo.webp" alt="" />${LK_SHINE}`;
function lkTails(n) {
  const s = fd(n),
    size = s.length < 2 ? 84 : s.length < 3 ? 66 : 50;
  return `<svg viewBox="0 0 200 200">${LK_FACE_DEFS('t')}${lkName('t')}<g filter="url(#emt)" fill="#9a6c0e" text-anchor="middle" font-family="${LK_FONT}"><text x="100" y="${118 + size * 0.12}" font-size="${size}" font-weight="900">${s}</text><path d="M62 146 h76" stroke="#9a6c0e" stroke-width="1.6"/><text x="100" y="164" font-size="${FA ? 13 : 9}" font-weight="800"${FA ? '' : ' letter-spacing="3"'}>${S.panel.luckCoinTails}</text></g></svg>${LK_SHINE}`;
}
function coinFrame2(now, dt) {
  const c = lkCoin;
  if (lkFlipping) {
    const f = lkFlipping,
      p = Math.min(1, (now - f.t0) / f.dur);
    c.ay = f.a0 + (f.a1 - f.a0) * (1 - Math.pow(1 - p, 3));
    c.cy = -150 * Math.sin(Math.PI * Math.min(1, p * 1.08)); // up, and down a little before it stops turning
    if (p >= 1) {
      c.cy = 0;
      lkFlipping = null;
      f.done();
    }
  } else if (!c.drag && now > c.hold) {
    const pace = calm() ? 0 : 45;
    c.vel += (pace - c.vel) * Math.min(1, dt * (Math.abs(c.vel) > 70 ? 0.9 : 2.5));
    c.ay += c.vel * dt;
    if (calm() && Math.abs(c.vel) < 5) c.ay += (Math.round(c.ay / 180) * 180 - c.ay) * Math.min(1, dt * 3);
  }
  c.ax += (-8 - c.ax) * Math.min(1, dt * 3);
  $('#lkCoin').style.transform = `translateY(${c.cy}px) rotateX(${c.ax}deg) rotateY(${c.ay}deg)`;
  // The shine slides across each face as it turns; the shadow narrows edge on and fades as the coin goes up.
  const r = ((c.ay % 360) + 360) % 360,
    v0 = r > 180 ? r - 360 : r;
  $$('#lkCoin .lk-shine').forEach((e, i) => {
    const v = 50 - (i ? ((v0 + 360) % 360) - 180 : v0) * 1.1;
    e.style.background = `linear-gradient(115deg,transparent ${v - 18}%,rgba(255,255,255,.75) ${v}%,transparent ${v + 18}%)`;
  });
  const k = Math.abs(Math.cos((c.ay * Math.PI) / 180)),
    sh = $('#lkShadow');
  sh.style.width = `${(70 + 130 * k) * (1 - Math.min(0.5, -c.cy / 300))}px`;
  sh.style.opacity = String(1 - Math.min(0.6, -c.cy / 250));
}
function flipCoin() {
  if (lkFlipping || !luck) return;
  const c = lkCoin,
    cres = $('#lkCres'),
    heads = Math.random() < 0.5,
    turns = 7 + Math.floor(Math.random() * 3),
    now = ((c.ay % 360) + 360) % 360;
  cres.textContent = '';
  cres.classList.remove('show');
  c.drag = false;
  lkMetal(0, 0.14, 2600);
  lkWhoosh(2.4);
  lkFlipping = {
    t0: performance.now(),
    dur: 2700,
    a0: c.ay,
    a1: c.ay + turns * 360 + (((heads ? 0 : 180) - now + 360) % 360),
    done: () => {
      c.hold = performance.now() + 3500; // it rests on its side for a moment
      c.vel = 0;
      lkMetal(0, 0.16, 1900);
      lkMetal(0.16, 0.09, 2050);
      lkMetal(0.27, 0.05, 1980);
      lkMetal(0.34, 0.025, 2010);
      const co = luck.coin;
      luck.coin = { heads: co.heads + (heads ? 1 : 0), tails: co.tails + (heads ? 0 : 1), flips: [{ heads, at: Date.now() }, ...co.flips].slice(0, 6) };
      lkSave('coin');
      renderCoin();
      lkBump(heads ? '#lkHeads' : '#lkTails');
      cres.textContent = S.panel[heads ? 'luckHeadsWon' : 'luckTailsWon'];
      void cres.offsetWidth;
      cres.classList.add('show');
    },
  };
  lkLoop();
}
function lkBump(sel) {
  const n = $(sel);
  n.classList.remove('lk-bump');
  void n.offsetWidth;
  n.classList.add('lk-bump');
  n.parentElement.classList.add('hit');
  setTimeout(() => n.parentElement.classList.remove('hit'), 900);
}
let lkTailsShown;
function renderCoin() {
  $('#lkHeads').textContent = fd(luck.coin.heads);
  $('#lkTails').textContent = fd(luck.coin.tails);
  if (lkTailsShown !== luck.coin.tails) $('#lkTface').innerHTML = lkTails((lkTailsShown = luck.coin.tails));
  renderLuckTimes();
}
function wireCoin2() {
  const c = $('#lkCoin');
  for (let z = -10; z <= 10; z++) c.append(el('div', { className: 'edge', style: `transform: translateZ(${z}px) scale(.985)` }));
  c.append(
    el('div', { className: 'face', style: 'transform: translateZ(10.5px)', innerHTML: lkHeads() }),
    el('div', { id: 'lkTface', className: 'face', style: 'transform: rotateY(180deg) translateZ(10.5px)' }),
  );
  c.onpointerdown = (e) => {
    if (lkFlipping) return;
    Object.assign(lkCoin, { drag: true, lx: e.clientX, ly: e.clientY, lt: performance.now(), sv: 0 });
    c.classList.add('grab');
    c.setPointerCapture(e.pointerId);
  };
  c.onpointermove = (e) => {
    if (!lkCoin.drag) return;
    const t = performance.now(),
      dx = e.clientX - lkCoin.lx,
      dy = e.clientY - lkCoin.ly,
      ms = Math.max(1, t - lkCoin.lt);
    lkCoin.ay += dx * 0.6;
    lkCoin.ax = Math.max(-35, Math.min(35, lkCoin.ax - dy * 0.4));
    lkCoin.sv = lkCoin.sv * 0.5 + ((dx * 0.6) / ms) * 1000 * 0.5;
    Object.assign(lkCoin, { lx: e.clientX, ly: e.clientY, lt: t });
  };
  c.onpointerup = c.onpointercancel = () => {
    if (!lkCoin.drag) return;
    lkCoin.drag = false;
    c.classList.remove('grab');
    lkCoin.vel = performance.now() - lkCoin.lt > 120 ? 0 : Math.max(-2000, Math.min(2000, lkCoin.sv)); // held still before letting go: no spin
  };
}

// ---------- Everything from what's saved ----------
function renderLuck() {
  renderWheels();
  renderSlices();
  $('#lkPerSlice').checked = luck.perSlice;
  $('#lkTick').checked = luck.tick;
  $('#lkRemove').checked = luck.removeWinner;
  renderGwOptions();
  renderEntrants();
  renderGw();
  renderCoin();
}

function wireLuck(socket) {
  $$('.lk-tabs [role=tab]').forEach((b) => (b.onclick = () => showLuckTab(b.dataset.tab)));
  $('.lk-tabs').onkeydown = (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key] * (FA ? -1 : 1),
      i = LK_TABS.indexOf(lkTab);
    if (!step) return;
    showLuckTab(LK_TABS[(i + step + 3) % 3]);
    $(`.lk-tabs [data-tab=${lkTab}]`).focus();
  };
  showLuckTab(LK_TABS.includes(remember.get('jarchi.luckTab')) ? remember.get('jarchi.luckTab') : 'wheel');

  // Wheel
  $('#lkSpin').onclick = $('#lkHub').onclick = spinWheel;
  $('#lkWheelName').oninput = (e) => {
    lkWheel().name = e.target.value;
    lkSave('wheels');
    renderWheels();
  };
  twoClick($('#lkWheelDel'), $('#lkWheelDel span'), S.panel.luckWheelDelete, S.panel.luckSure, () => {
    if (lkSpinning || luck.wheels.length < 2) return;
    luck.wheels = luck.wheels.filter((w) => w !== lkWheel());
    luck.wheel = luck.wheels[0].id;
    lkSave('wheels', 'wheel');
    $('#lkWres').replaceChildren();
    renderWheels();
    renderSlices();
  });
  $('#lkAddSlice').onclick = () => {
    const w = lkWheel();
    if (lkSpinning || w.slices.length >= 60) return;
    w.slices.push({ text: S.panel.luckNewSlice, chance: 1 });
    lkSave('wheels');
    renderSlices();
    const text = $('#lkSlices').lastElementChild.querySelector('input');
    text.focus();
    text.select();
  };
  $('#lkPerSlice').onchange = (e) => {
    luck.perSlice = e.target.checked;
    lkSave('perSlice');
    renderSlices();
  };
  $('#lkTick').onchange = (e) => {
    luck.tick = e.target.checked;
    lkSave('tick');
  };
  $('#lkRemove').onchange = (e) => {
    luck.removeWinner = e.target.checked;
    lkSave('removeWinner');
  };

  // Giveaway: its options (the minutes and seconds as choices), Start, Close entries, Draw.
  const choices = (box, name, values, label) =>
    $(box).replaceChildren(
      ...values.map((v) => el('label', {}, el('input', { type: 'radio', name, value: String(v) }), el('span', { textContent: label(v) }))),
    );
  choices('#lkTimer', 'lkTimer', [0, 1, 2, 5], (n) => (n ? tpl(S.panel.luckMinutes, { n: fd(n) }) : S.panel.luckManual));
  choices('#lkSpinTime', 'lkSpinTime', [3, 5, 10], (n) => tpl(S.panel.luckSeconds, { n: fd(n) }));
  const setGw = (fields) => {
    Object.assign(luck.gw, fields);
    lkSave('gw');
    renderGwOptions();
  };
  $('#lkKeyword').oninput = (e) => {
    const word = e.target.value.trim();
    if (!word) return; // an empty word isn't saved: the last one stays
    luck.gw.keyword = word;
    lkSave('gw');
    renderGw();
  };
  $('#lkKeyword').onblur = () => renderGwOptions();
  for (const [name, set] of [
    ['lkWho', (v) => ({ subsOnly: v === 'subs' })],
    ['lkTimer', (v) => ({ timer: Number(v) })],
    ['lkSpinTime', (v) => ({ spin: Number(v) })],
    ['lkOrder', (v) => ({ order: v })],
    ['lkFlow', (v) => ({ flow: v })],
  ])
    $$(`[name=${name}]`).forEach((r) => (r.onchange = () => setGw(set(r.value))));
  $('#lkSubLuck').onchange = (e) => {
    setGw({ subLuck: e.target.checked });
    renderEntrants(); // the SUB ×2 tags
  };
  $('#lkNoRepeat').onchange = (e) => setGw({ noRepeat: e.target.checked });
  $$('.lk-num button').forEach((b) => {
    const k = b.closest('.lk-num').dataset.n;
    b.onclick = () => setGw({ [k]: Math.max(k === 'winners' ? 1 : 0, Math.min(5, luck.gw[k] + Number(b.dataset.d))) });
  });
  $('#lkGopen').onclick = startGiveaway;
  $('#lkGclose').onclick = () =>
    api('POST', '/api/luck/giveaway/close').then(
      (st) => ((lkLive = st), renderGw()),
      (err) => toast(err.message, true),
    );
  $('#lkGdraw').onclick = $('#lkAgain').onclick = drawGiveaway;
  $('#lkNext').onclick = () => lkRun?.wake?.();
  $('#lkDrawClose').onclick = () => $('#lkDraw').close();
  $('#lkDraw').addEventListener('close', () => {
    if (lkRun) lkRun.stop = true; // the rest of the names go straight to the results
    lkRun?.wake?.();
    lkWatch.clear();
  });
  socket.on('connect', () => socket.emit('luckJoin'));
  socket.on('giveaway', (st) => {
    lkLive = st;
    if (!luck) return;
    renderEntrants();
    renderGw();
  });
  socket.on('giveawayJoin', (e) => {
    lkLive.entrants.push(e);
    if (!luck) return;
    $('#lkEnt').prepend(lkEntrant(e));
    $('#lkEnt').children[LK_ENTRANTS]?.remove();
    $('#lkCount').textContent = fd(lkLive.entrants.length);
    renderGw();
  });
  socket.on('chat', luckChat);
  setInterval(() => luck && lkLive.endsAt && renderGwTime(), 1000);
  setInterval(() => luck && lkOn() && renderLuckTimes(), 30000); // "2 min ago" moves on

  // Coin
  wireCoin2();
  $('#lkFlip').onclick = flipCoin;
  $('#lkReset').onclick = () => {
    luck.coin = { ...luck.coin, heads: 0, tails: 0 };
    lkSave('coin');
    renderCoin();
  };

  // Space: spin / flip / the next name. Not while typing, nor with another popup open.
  addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.repeat || view !== 'luck' || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    if ($('#lkDraw').open) {
      if ($('#lkNext').hidden) return;
      e.preventDefault();
      lkRun?.wake?.();
      return;
    }
    if ($('dialog[open]') || lkTab === 'gw') return;
    e.preventDefault();
    if (lkTab === 'wheel') spinWheel();
    else flipCoin();
  });
  document.addEventListener('visibilitychange', lkLoop);
  document.fonts.ready.then(() => (lkDrawn = null)); // the slices' words in their own font, once it's loaded
  addEventListener('focus', () => view === 'luck' && loadLuck()); // back from the pop-out (or the panel)
  addEventListener('blur', lkFlush);

  // Pop out: this page in its own window. There: Always on top (the desktop app), and the panel's language followed.
  $('#luckPop').hidden = POP;
  $('#luckPop').onclick = () => window.open('/?pop=luck', 'jarchiLuck', 'popup,width=1180,height=820');
  if (POP) {
    document.title = `Jarchi · ${S.panel.navLuck}`;
    const app = window.jarchiApp,
      top = $('#luckTop input');
    if (app?.onTop) {
      $('#luckTop').hidden = false;
      top.checked = remember.get('jarchi.luckTop') === 'true';
      app.onTop(top.checked);
      top.onchange = () => {
        remember.set('jarchi.luckTop', String(top.checked));
        app.onTop(top.checked);
      };
    }
    addEventListener('storage', (e) => {
      if (e.key === 'jarchi.lang' && !lkRun) location.reload();
    });
  }
  api('GET', '/api/luck').then(gotLuck, (err) => toast(err.message, true));
}
