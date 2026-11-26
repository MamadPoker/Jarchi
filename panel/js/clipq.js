// ---------- ClipQ (core/clipq.js runs the queue) ----------
// Open the queue, and every clip link sent in Kick or Twitch chat (from the sites turned on) lines up by itself. The
// clip on now waits in the player until Play; Next brings the one after it, and with Auto next each clip that ends
// brings the next one, playing. Previous, and Played under Up next, bring an earlier one back. The player is the battle
// screen's page from localhost (battle-player.html): YouTube, Kick and Instagram clips take Jarchi's buttons; Twitch's
// embed only its own (Auto next stops at it), and Instagram's too when Instagram gave Jarchi no video for the clip.
// Both ClipQ windows (the panel and its pop-out) show the same queue; a clip that starts in one stops the other's.
let cq = null; // core/clipq.js state(): { settings, open, now, queue, played }
const CQ_SITES = { youtube: 'YouTube', instagram: 'Instagram', twitch: 'Twitch', kick: 'Kick' };
const CQ_PER = [1, 2, 3, 0]; // 0: no limit
const CQ_CLIP = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9v6l5-3z"/></svg>';
const CQ_AGAIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4"/></svg>';
const CQ_FULL = {
  on: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg>',
  off: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M20 15h-5v5M4 15h5v5"/></svg>',
};
const cqP = { clip: null, st: {}, seeking: false, go: false }; // this window's player: its clip, what it says, Play asked before Kick's video came

const loadClipq = () => api('GET', '/api/clipq').then(gotClipq, (err) => toast(err.message, true));
function gotClipq(st) {
  cq = st;
  renderClipq(); // hidden or not: the player follows the queue (a mod's !skip) on every page
}
const showClipq = () => (cq && renderClipq(), loadClipq());
const cqAct = (method, url, body) => api(method, url, body).then(gotClipq, (err) => toast(err.message, true));
const cqSave = (fields) => {
  Object.assign(cq.settings, fields);
  renderClipq();
  cqAct('PATCH', '/api/clipq', fields);
};

// The sound, the same in both windows (this browser's).
const cqVol = () => (/^\d+$/.test(remember.get('jarchi.clipqVol') ?? '') ? Number(remember.get('jarchi.clipqVol')) : 80);
const cqMuted = () => remember.get('jarchi.clipqMute') === '1';
const cqSay = (msg) => $('#cqFrame').contentWindow?.postMessage(msg, BT_PLAYER);
// A clip's name: its title, or (none from its site) what it is: "YouTube Short", "Kick clip".
const cqKind = (c) =>
  c.source === 'youtube' ? (c.vertical ? 'short' : 'youtube') : c.source === 'instagram' ? (c.link.includes('/p/') ? 'post' : 'reel') : c.source;
const cqName = (c) => c.title || S.panel.clipqKinds[cqKind(c)];
const cqWho = (by) => (cq.settings.showSender ? [lkIco(by.platform), el('bdi', { textContent: by.name })] : []);
// What the player loads: the clip's own video (Kick's, Instagram's), else its site's player; nothing while Jarchi still
// asks Kick or Instagram for it.
function cqSrc(c) {
  if (c.video) return c.video;
  if (c.source === 'youtube') return `https://www.youtube.com/watch?v=${c.vid}`;
  return c.source === 'kick' || (c.source === 'instagram' && !c.looked) ? null : c.link;
}
// Twitch's embed, and Instagram's: their own buttons only.
const cqFixed = (c) => c.source === 'twitch' || (c.source === 'instagram' && c.looked && !c.video);

function renderClipq() {
  if (!cq) return;
  $('#cqState').className = `lk-pill ${cq.open ? 'open' : 'closed'}`;
  $('#cqState').textContent = S.panel[cq.open ? 'clipqIsOpen' : 'clipqIsClosed'];
  $('#cqOpen').className = `lk-btn bt-sm ${cq.open ? 'r' : 'g'}`;
  $('#cqOpen').textContent = S.panel[cq.open ? 'clipqClose' : 'clipqOpen'];
  cqPlayer();
  cqList();
  cqPlayed();
  cqSettings();
}

// The clip on now in this window's player: loaded when it changes, playing when Auto next goes on from the one that
// was playing (or ended) here, or when its Play came before Kick said where its video is. The stage takes the clip's
// shape (--ar, its width / height: the video's, Instagram's embed's, else 16:9 or standing up), as big as fits.
function cqLoad(c, play) {
  const src = c && cqSrc(c),
    q = { vol: String(cqVol() / 100), muted: cqMuted() ? '1' : '0', ...(play && { play: '1' }) };
  Object.assign(cqP, { clip: c, st: {}, seeking: false, go: !!(play && c && !src) });
  $('#cqFrame').src = src ? `${BT_PLAYER}/battle-player.html?${new URLSearchParams({ source: c.source, link: src, ...q })}` : 'about:blank';
}
function cqPlayer() {
  const c = cq.now;
  if (c?.id !== cqP.clip?.id) cqLoad(c, cq.settings.autoNext && (cqP.st.playing || cqP.st.ended || cqP.go));
  else if (c && cqSrc(c) !== cqSrc(cqP.clip)) cqLoad(c, cqP.go); // Kick's or Instagram's answer came
  cqP.clip = c; // its title may have come since
  const fixed = !!c && cqFixed(c),
    lost = c?.source === 'kick' && c.looked && !c.video;
  $('#cqStage').style.setProperty('--ar', String(cqP.st.ar || (c?.vertical ? 9 / 16 : 16 / 9)));
  $('#cqNone').hidden = !!c;
  $('#cqMedia').hidden = !c;
  $('#cqBig').hidden = !c || fixed;
  $('#cqTitle').replaceChildren(c ? el('bdi', { textContent: cqName(c) }) : '');
  $('#cqBy').replaceChildren(...(c ? [el('span', { className: 'bt-src', textContent: CQ_SITES[c.source] }), ...cqWho(c.by)] : []));
  $('#cqFixed').hidden = !fixed;
  if (fixed) $('#cqFixed').textContent = tpl(S.panel.clipqFixed, { site: CQ_SITES[c.source] });
  if (c && (lost || cqP.st.error))
    $('#cqErr').replaceChildren(
      S.panel.clipqCantPlay,
      ' ',
      el('a', { href: c.link, target: '_blank', rel: 'noopener', textContent: tpl(S.panel.battleOpenOn, { site: CQ_SITES[c.source] }) }),
    );
  $('#cqErr').hidden = !(c && (lost || cqP.st.error));
  for (const b of ['#cqBack', '#cqFwd', '#cqSeek']) $(b).disabled = !c || fixed;
  $('#cqPP').disabled = !c || (fixed && c.source === 'instagram');
  $('#cqNext').disabled = !c;
  $('#cqPrev').disabled = !cq.played.length;
  $('#cqAuto').setAttribute('aria-pressed', String(cq.settings.autoNext));
  cqTime();
}

// The buttons and time, from what the player says. Play / pause are drawn: the ▶ glyph differs from font to font.
function cqTime() {
  const { playing, pos = 0, dur = 0 } = cqP.st,
    icon = playing ? 'battlePause' : 'battlePlay',
    seek = $('#cqSeek');
  for (const b of [$('#cqPP'), $('#cqBig')]) if (b.title !== S.panel[icon]) Object.assign(b, { title: S.panel[icon], innerHTML: BT_ICONS[icon] });
  seek.max = String(Math.max(1, Math.round(dur)));
  if (!cqP.seeking) seek.value = String(Math.round(pos));
  seek.style.setProperty('--fill', `${(Number(seek.value) / Number(seek.max)) * 100}%`);
  $('#cqTime').textContent = `${btClock(cqP.seeking ? Number(seek.value) : pos)} / ${btClock(dur)}`;
  $('#cqStage').classList.toggle('playing', !!playing);
  const v = cqMuted() ? 0 : cqVol();
  $('#cqVol').value = String(cqVol());
  $('#cqVol').style.setProperty('--fill', `${v}%`);
  $('#cqMute').innerHTML = BT_SOUND[v ? 'on' : 'off'];
  $('#cqMute').title = S.panel[cqMuted() ? 'clipqUnmute' : 'clipqMute'];
}
function cqPlay() {
  remember.set('jarchi.clipqPlaying', String(Date.now())); // the other ClipQ window stops its clip
  cqSay({ play: true });
}
const cqToggle = () => (cqP.st.playing ? cqSay({ pause: true }) : cqPlay());
const cqNext = () => cqAct('POST', '/api/clipq/next', { from: cqP.clip?.id });
// Previous (no id), or a clip of Played, back into the player; the one in it goes back to the top of Up next.
const cqBackTo = (id) => cqAct('POST', '/api/clipq/back', { id, from: cqP.clip?.id });

// A clip's row: its picture, name, site and sender, after Up next's number and before its button.
const cqRow = (c, lead, btn) =>
  el(
    'li',
    { className: 'cq-row' },
    ...lead,
    /^https:\/\//.test(c.thumb ?? '')
      ? el('img', { className: `cq-thumb ${c.source}`, src: c.thumb, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' })
      : el('span', { className: `cq-thumb ${c.source}`, innerHTML: CQ_CLIP }), // no picture from its site (Instagram's never)
    el(
      'span',
      { className: 'bt-txt' },
      el('b', {}, el('bdi', { textContent: cqName(c) })),
      el('small', {}, el('span', { className: 'bt-src', textContent: CQ_SITES[c.source] }), ...cqWho(c.by)),
    ),
    btn,
  );
// Up next: each clip waiting, with its number (what !remove takes), and ✕.
function cqList() {
  const q = cq.queue;
  $('#cqCount').textContent = q.length ? fd(q.length) : '';
  $('#cqList').replaceChildren(
    ...q.map((c, i) =>
      cqRow(
        c,
        [el('span', { className: 'cq-n', textContent: fd(i + 1) })],
        el('button', { className: 'bt-x', textContent: '✕', title: S.panel.clipqRemove, onclick: () => cqAct('DELETE', `/api/clipq/${c.id}`) }),
      ),
    ),
    ...(q.length ? [] : [el('li', { className: 'bt-empty', textContent: S.panel[cq.open ? 'clipqEmptyOpen' : 'clipqEmptyClosed'] })]),
  );
}
// Played: the last clips Next took out of the player, the last one first, each with a button back into it.
function cqPlayed() {
  $('#cqPlayedBox').hidden = !cq.played.length;
  $('#cqPlayed').replaceChildren(
    ...cq.played.map((c) =>
      cqRow(c, [], el('button', { className: 'bt-x cq-again', innerHTML: CQ_AGAIN, title: S.panel.clipqPlayAgain, onclick: () => cqBackTo(c.id) })),
    ),
  );
}
// Full screen: the whole player card, its buttons too (Esc leaves it, as everywhere).
function cqFullBtn() {
  const on = !!document.fullscreenElement;
  Object.assign($('#cqFull'), { innerHTML: CQ_FULL[on ? 'off' : 'on'], title: S.panel[on ? 'clipqFullExit' : 'clipqFull'] });
}

function cqSettings() {
  const s = cq.settings;
  $$('#cqSources input').forEach((c) => (c.checked = s.sources.includes(c.value)));
  $$('[name=cqPer]').forEach((r) => (r.checked = r.value === String(s.perViewer)));
  $$('#cqForm [data-k]').forEach((c) => (c.checked = s[c.dataset.k]));
  $$('#cqCmds input').forEach((c) => (c.checked = s.commands[c.value]));
  $('#cqCmds').hidden = !s.mods;
}

function wireClipq(socket) {
  // Settings: the sites (one at least), clips per viewer, the switches, the mods' commands.
  $('#cqSources').replaceChildren(
    ...Object.keys(CQ_SITES).map((v) => el('label', {}, el('input', { type: 'checkbox', value: v }), el('span', { textContent: S.panel.clipqSourceNames[v] }))),
  );
  $$('#cqSources input').forEach(
    (c) =>
      (c.onchange = () => {
        const sources = $$('#cqSources input:checked').map((x) => x.value);
        if (!sources.length) return (c.checked = true);
        cqSave({ sources });
      }),
  );
  $('#cqPer').replaceChildren(
    ...CQ_PER.map((v) =>
      el('label', {}, el('input', { type: 'radio', name: 'cqPer', value: String(v) }), el('span', { textContent: v ? fd(v) : S.panel.clipqNoLimit })),
    ),
  );
  $$('[name=cqPer]').forEach((r) => (r.onchange = () => cqSave({ perViewer: Number(r.value) })));
  $$('#cqForm [data-k]').forEach((c) => (c.onchange = () => cqSave({ [c.dataset.k]: c.checked })));
  $('#cqCmds').replaceChildren(
    ...Object.entries(S.panel.clipqCmds).map(([k, [name, text]]) =>
      el(
        'label',
        { className: 'lk-tg' },
        el('span', { className: 'switch' }, el('input', { type: 'checkbox', value: k }), el('span')),
        el('span', {}, el('code', { dir: 'ltr', textContent: name }), el('small', { textContent: text })),
      ),
    ),
  );
  $$('#cqCmds input').forEach((c) => (c.onchange = () => cqSave({ commands: { [c.value]: c.checked } })));

  // The head: Open / Close the queue.
  $('#cqOpen').onclick = () =>
    api('POST', `/api/clipq/${cq?.open ? 'close' : 'open'}`).then(
      (st) => (gotClipq(st), toast(S.panel[st.open ? 'clipqOpened' : 'clipqClosed'])),
      (err) => toast(err.message, true),
    );

  // The player's buttons. The big play / pause shows while the mouse moves on the video, then fades. A click doesn't
  // focus it: a key pressed after (Alt+Tab) would light it up for good.
  $('#cqPP').onclick = $('#cqBig').onclick = cqToggle;
  $('#cqBig').onmousedown = (e) => e.preventDefault();
  const stage = $('#cqStage'),
    sleep = () => stage.classList.remove('awake');
  let idle;
  stage.onmousemove = () => (stage.classList.add('awake'), clearTimeout(idle), (idle = setTimeout(sleep, 2000)));
  stage.onmouseleave = sleep;
  $('#cqFull').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : $('.cq-player').requestFullscreen()).catch(() => {});
  addEventListener('fullscreenchange', cqFullBtn);
  addEventListener('keydown', (e) => e.key === 'Escape' && document.fullscreenElement && document.exitFullscreen()); // where the window doesn't
  cqFullBtn();
  $('#cqPrev').onclick = () => cqBackTo();
  $('#cqBack').onclick = () => cqSay({ seek: Math.max(0, (cqP.st.pos || 0) - 10) });
  $('#cqFwd').onclick = () => cqSay({ seek: Math.min(cqP.st.dur || Infinity, (cqP.st.pos || 0) + 10) });
  $('#cqSeek').oninput = () => ((cqP.seeking = true), cqTime());
  $('#cqSeek').onchange = () => ((cqP.seeking = false), cqSay({ seek: Number($('#cqSeek').value) }));
  $('#cqNext').onclick = cqNext;
  $('#cqVol').oninput = () => {
    remember.set('jarchi.clipqVol', $('#cqVol').value);
    remember.set('jarchi.clipqMute', '0');
    cqSay({ volume: cqVol() / 100, muted: false });
    cqTime();
  };
  $('#cqMute').onclick = () => {
    remember.set('jarchi.clipqMute', cqMuted() ? '0' : '1');
    cqSay({ muted: cqMuted() });
    cqTime();
  };
  $('#cqAuto').onclick = () => cqSave({ autoNext: !cq.settings.autoNext });
  twoClick($('#cqClear'), $('#cqClear span'), S.panel.clipqClear, S.panel.clipqClearSure, () => cqAct('POST', '/api/clipq/clear'));

  // What the player says. A clip that ends with Auto next on brings the next one (cqPlayer plays it).
  addEventListener('message', (e) => {
    if (e.origin !== BT_PLAYER || e.source !== $('#cqFrame').contentWindow || !e.data?.st || !cqP.clip) return;
    const was = cqP.st;
    cqP.st = e.data.st;
    if (cqP.st.playing && !was.playing) remember.set('jarchi.clipqPlaying', String(Date.now()));
    if (cqP.st.ended && !was.ended && cq.settings.autoNext && cq.queue.length) cqNext();
    if (cqP.st.ar !== was.ar) cqPlayer();
    else cqTime();
  });
  addEventListener('storage', (e) => {
    if (e.key === 'jarchi.clipqPlaying' && cqP.st.playing) cqSay({ pause: true });
    if (['jarchi.clipqVol', 'jarchi.clipqMute'].includes(e.key ?? '')) {
      cqSay({ volume: cqVol() / 100, muted: cqMuted() });
      if (cq) cqTime();
    }
  });

  popOut('clips', 'navClipQ', $('#cqPop'), $('#cqLang'), $('#cqTop'), 1280);
  socket.on('connect', () => socket.emit('clipqJoin')); // the panel and the pop-out alike
  socket.on('clipq', gotClipq); // clips from chat, a mod's command, the other window
}
