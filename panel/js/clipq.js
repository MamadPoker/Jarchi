// ---------- ClipQ (core/clipq.js runs the queue) ----------
// Open the queue, and every clip link sent in Kick or Twitch chat (from the sites turned on) lines up by itself. The
// clip on now waits in the player until Play; Next brings the one after it, and with Auto next each clip that ends
// brings the next one, playing. The player is the battle screen's page from localhost (battle-player.html): YouTube
// and Kick clips take Jarchi's buttons; Twitch's and Instagram's embeds only their own (Auto next stops at them).
// Both ClipQ windows (the panel and its pop-out) show the same queue; a clip that starts in one stops the other's.
let cq = null; // core/clipq.js state(): { settings, open, now, queue }
const CQ_SITES = { youtube: 'YouTube', instagram: 'Instagram', twitch: 'Twitch', kick: 'Kick' };
const CQ_FIXED = ['twitch', 'instagram'];
const CQ_PER = [1, 2, 3, 0]; // 0: no limit
const CQ_CLIP = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9v6l5-3z"/></svg>';
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
const cqSrc = (c) => (c.source === 'kick' ? c.video : c.source === 'youtube' ? `https://www.youtube.com/watch?v=${c.vid}` : c.link);

function renderClipq() {
  if (!cq) return;
  $('#cqState').className = `lk-pill ${cq.open ? 'open' : 'closed'}`;
  $('#cqState').textContent = S.panel[cq.open ? 'clipqIsOpen' : 'clipqIsClosed'];
  $('#cqOpen').className = `lk-btn bt-sm ${cq.open ? 'r' : 'g'}`;
  $('#cqOpen').textContent = S.panel[cq.open ? 'clipqClose' : 'clipqOpen'];
  cqPlayer();
  cqList();
  cqSettings();
}

// The clip on now in this window's player: loaded when it changes, playing when Auto next goes on from the one that
// was playing (or ended) here, or when its Play came before Kick said where its video is.
function cqLoad(c, play) {
  const src = c && cqSrc(c),
    q = { vol: String(cqVol() / 100), muted: cqMuted() ? '1' : '0', ...(play && { play: '1' }) };
  Object.assign(cqP, { clip: c, st: {}, seeking: false, go: !!(play && c && !src) });
  $('#cqFrame').src = src ? `${BT_PLAYER}/battle-player.html?${new URLSearchParams({ source: c.source, link: src, ...q })}` : 'about:blank';
}
function cqPlayer() {
  const c = cq.now;
  if (c?.id !== cqP.clip?.id) cqLoad(c, cq.settings.autoNext && (cqP.st.playing || cqP.st.ended || cqP.go));
  else if (c && c.video !== cqP.clip.video) cqLoad(c, cqP.go);
  cqP.clip = c; // its title may have come since
  const fixed = !!c && CQ_FIXED.includes(c.source),
    lost = c?.source === 'kick' && c.looked && !c.video;
  $('#cqStage').classList.toggle('tall', !!c && (c.vertical || cqP.st.ar < 1));
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
  $('#cqPP').disabled = !c || c.source === 'instagram';
  $('#cqNext').disabled = !c;
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

// Up next: each clip waiting, with its number (what !remove takes), picture, name, site and sender, and ✕.
function cqList() {
  const q = cq.queue;
  $('#cqCount').textContent = q.length ? fd(q.length) : '';
  $('#cqList').replaceChildren(
    ...q.map((c, i) =>
      el(
        'li',
        { className: 'cq-row' },
        el('span', { className: 'cq-n', textContent: fd(i + 1) }),
        /^https:\/\//.test(c.thumb ?? '')
          ? el('img', { className: `cq-thumb ${c.source}`, src: c.thumb, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' })
          : el('span', { className: `cq-thumb ${c.source}`, innerHTML: CQ_CLIP }), // no picture from its site (Instagram's never)
        el(
          'span',
          { className: 'bt-txt' },
          el('b', {}, el('bdi', { textContent: cqName(c) })),
          el('small', {}, el('span', { className: 'bt-src', textContent: CQ_SITES[c.source] }), ...cqWho(c.by)),
        ),
        el('button', { className: 'bt-x', textContent: '✕', title: S.panel.clipqRemove, onclick: () => cqAct('DELETE', `/api/clipq/${c.id}`) }),
      ),
    ),
    ...(q.length ? [] : [el('li', { className: 'bt-empty', textContent: S.panel[cq.open ? 'clipqEmptyOpen' : 'clipqEmptyClosed'] })]),
  );
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

  // The player's buttons.
  $('#cqPP').onclick = $('#cqBig').onclick = cqToggle;
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
