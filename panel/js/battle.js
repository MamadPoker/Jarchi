// ---------- Song Battle (core/battle.js: Jarchi Battle, battle.jarchi.app) ----------
// Not connected: Connect opens Jarchi Battle's one-time link in the browser; while it waits, the state is asked every
// 3 s and when the window comes back, until the key is in. Connected: the setup (saved as it changes, for the next
// battle; while a battle runs, that battle's, fixed), the page link with its QR code, and the battle's songs: the feed
// every 3 s while it takes songs and the page is in view. The songs stay blurred until the mouse is on one, so a cover
// or a title that isn't fit for the stream stays off it. After Start: the battle screen (further down).
let bt = null; // core/battle.js now(): { state, channel, platform, page, battle, setup, lost, error }
const BT_SIZES = [4, 8, 16, 32, 64, 128],
  BT_PER = [1, 2, 3];
const BT_SOURCES = { youtube: 'YouTube', spotify: 'Spotify', soundcloud: 'SoundCloud' };
const BT_TAKING = ['collecting', 'closed'];
// The sites a battle takes, by name in the panel's language: "YouTube or SoundCloud", "YouTube, Spotify or SoundCloud".
function btSites(sources) {
  const names = Object.keys(BT_SOURCES)
      .filter((v) => sources.includes(v))
      .map((v) => S.panel.battleSiteNames[v]),
    [comma, or] = S.panel.battleSitesJoin;
  return names.length > 1 ? names.slice(0, -1).join(comma) + or + names.at(-1) : names[0];
}

const loadBattle = () => api('GET', '/api/battle').then(gotBattle, (err) => toast(err.message, true));
function gotBattle(st) {
  bt = st;
  if (view === 'battle') renderBattle();
}
// The page opened (select).
const showBattle = () => (bt && renderBattle(), loadBattle());

// What the setup shows: the battle's own settings while one runs (mods: it has some), else the saved setup.
function btSetup() {
  const b = bt.battle;
  return b ? { ...bt.setup, ...b.settings, topic: b.topic, mods: b.settings.moderators.length > 0 } : bt.setup;
}
// A setup change: shown at once, saved for the next battle.
function btSave(fields) {
  Object.assign(bt.setup, fields);
  renderBattleSetup();
  api('PATCH', '/api/battle/setup', fields).then(
    (st) => (bt.setup = st.setup),
    (err) => (toast(err.message, true), loadBattle()),
  );
}

function renderBattle() {
  if (!bt) return;
  const on = bt.state === 'connected',
    st = on && bt.battle?.status,
    live = st === 'live',
    done = st === 'finished';
  $('#btHero').hidden = on;
  $('#btOn').hidden = !on || live || done;
  $('#btLive').hidden = !live && !done;
  $('#btTabs').hidden = $('#btRound').hidden = $('#btEnd').hidden = !live;
  $('#btProg').hidden = !live && !done;
  $$('#btTabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === btTab)));
  if (!done && $('#btChamp').open) $('#btChamp').close(); // New battle pressed in the other window
  if (!live) btStop();
  if (live || done) return renderLive();
  if (!on) {
    // Waiting: Connect again is a new link (that browser tab closed, say), and the newest one counts.
    const why = [
      bt.state === 'pending' && S.panel.battlePending,
      bt.lost && S.panel.battleLost,
      bt.error && (S.errors[bt.error] ?? S.errors.battle_failed),
    ].filter(Boolean);
    $('#btWhy').replaceChildren(...why.flatMap((t, i) => (i ? [el('br'), t] : [t])));
    $('#btWhy').hidden = !why.length;
    return;
  }
  renderBattleSetup();
  renderBattleShare();
  renderSongs();
}

function renderBattleSetup() {
  const s = btSetup(),
    locked = !!bt.battle;
  $('#btForm').disabled = locked;
  $('#btFixed').hidden = !locked;
  $('#btOpen').hidden = locked;
  if ($('#btTopic') !== document.activeElement) $('#btTopic').value = s.topic;
  for (const [name, v] of [
    ['btSize', s.size],
    ['btPer', s.perViewer],
    ['btVoting', s.voting],
  ])
    $$(`[name=${name}]`).forEach((r) => (r.checked = r.value === String(v)));
  $$('#btSources input').forEach((c) => (c.checked = s.sources.includes(c.value)));
  // The invite line and the paste box name only the sites turned on (this battle's, while one runs).
  const sites = btSites(s.sources);
  $('#btInviteSub').textContent = tpl(S.panel.battleInviteSub, { sites });
  $('#btLink').placeholder = tpl(S.panel.battleLinkHint, { sites });
  $('#btLink').setAttribute('aria-label', $('#btLink').placeholder);
  $$('#btForm [data-k]').forEach((c) => (c.checked = s[c.dataset.k]));
  $('#btModBox').hidden = !s.mods;
  $('#btMods').replaceChildren(
    ...s.moderators.map((m, i) =>
      el(
        'span',
        { className: 'bt-mod' },
        lkIco(m.platform),
        el('bdi', { textContent: m.username }),
        locked
          ? ''
          : el('button', {
              className: 'bt-x',
              textContent: '✕',
              title: tpl(S.panel.battleModRemove, { name: m.username }),
              onclick: () => btSave({ moderators: bt.setup.moderators.filter((_, k) => k !== i) }),
            }),
      ),
    ),
  );
}

function renderBattleShare() {
  const link = bt.page.replace(/^https?:\/\//, ''),
    src = `/api/battle/qr?c=${encodeURIComponent(bt.channel)}`; // a new channel: a new picture
  $('#btUrl').textContent = link;
  if ($('#btQr').getAttribute('src') !== src) $('#btQr').src = src;
  $('#btQr').alt = tpl(S.panel.battleQrAlt, { link });
  $('#btWho').textContent = tpl(S.panel.battleConnectedAs, { channel: bt.channel, platform: S.platforms[bt.platform] ?? bt.platform });
}

// Who sent a song (a guest: no account), and its cover (https only, never with a referrer).
const btWho = (by = {}) =>
  ['kick', 'twitch'].includes(by.platform) ? [lkIco(by.platform), el('bdi', { textContent: by.username })] : [el('span', { textContent: S.panel.battleGuest })];
const btCover = (s, className = 'bt-cover') =>
  /^https:\/\//.test(s.cover ?? '')
    ? el('img', { className, src: s.cover, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' })
    : el('span', { className });

// One song: its cover, title (Similar: an earlier one has its link or name), where it's from and who sent it, and
// Remove while the battle hasn't started.
function btSong(s, removable) {
  return el(
    'li',
    { className: 'bt-song', tabIndex: 0 },
    btCover(s),
    el(
      'span',
      { className: 'bt-txt' },
      el(
        'b',
        {},
        el('bdi', { textContent: s.title }),
        s.similar ? el('em', { className: 'bt-sim', textContent: S.panel.battleSimilar, title: S.panel.battleSimilarHint }) : '',
      ),
      el('small', {}, el('span', { className: 'bt-src', textContent: BT_SOURCES[s.source] ?? s.source }), ...btWho(s.by)),
    ),
    removable
      ? el('button', {
          className: 'bt-x',
          textContent: '✕',
          title: S.panel.battleRemove,
          onclick: () => api('DELETE', `/api/battle/songs/${s.id}`).then(gotBattle, (err) => (toast(err.message, true), loadBattle())),
        })
      : '',
  );
}

function renderSongs() {
  const b = bt.battle,
    songs = b?.songs ?? [],
    st = b?.status ?? 'none',
    taking = BT_TAKING.includes(st);
  $('#btStatus').className = `lk-pill ${{ collecting: 'open', closed: 'closed', live: 'live' }[st] ?? ''}`;
  $('#btStatus').textContent = S.panel[{ none: 'battleNone', collecting: 'battleCollecting', closed: 'battleClosed', live: 'battleLive' }[st]];
  $('#btCount').textContent = b ? `${fd(songs.length)} / ${fd(b.settings.size)}` : '';
  $('#btAdd').hidden = st !== 'collecting';
  $('#btBlurHint').hidden = !songs.length;
  const left = b ? b.settings.size - songs.length : 0,
    note = !b ? S.panel.battleNoneHint : taking && left > 0 ? tpl(S.panel.battleEmpty, { n: fd(left) }) : '';
  // Only when the list changed (the feed asks every 3 s), each row kept as it was: only a new one fades in, and the
  // one under the mouse stays sharp.
  const keys = songs.map((s) => `${s.id}:${s.similar}:${taking}`);
  if (`${keys}|${note}` !== $('#btList').dataset.keys) {
    const rows = new Map($$('#btList > .bt-song').map((li) => [li.dataset.key, li]));
    $('#btList').replaceChildren(
      ...songs.map((s, i) => {
        const old = rows.get(keys[i]);
        old?.classList.remove('new');
        return old ?? Object.assign(btSong(s, taking), { className: 'bt-song new' });
      }),
      ...(note ? [el('li', { className: 'bt-empty', textContent: note })] : []),
    );
    $$('#btList > .bt-song').forEach((li, i) => (li.dataset.key = keys[i]));
    $('#btList').dataset.keys = `${keys}|${note}`;
  }
  $('#btStart').hidden = !taking;
  $('#btStart').disabled = songs.length < 2;
  $('#btCancel').hidden = !b;
}

// Post the link in chat: each connected account's result, in one note.
async function btPostChat() {
  $('#btChat').disabled = true;
  try {
    const r = await api('POST', '/api/battle/chat');
    const ps = ['kick', 'twitch'].filter((p) => r[p]),
      sent = ps.filter((p) => r[p] === 'sent'),
      bad = ps.filter((p) => r[p] !== 'sent');
    if (!ps.length) return toast(S.panel.battleChatNone, true);
    const why = bad.map((p) => tpl(S.panel[r[p] === 'scope' ? 'battleChatScope' : 'battleChatFailed'], { platform: S.platforms[p] }));
    hint('#btChatWhy', why.join(' '));
    if (sent.length) toast(tpl(S.panel.battleChatSent, { platforms: sent.map((p) => S.platforms[p]).join(' · ') }));
  } catch (err) {
    toast(err.message, true);
  } finally {
    $('#btChat').disabled = false;
  }
}

function wireBattle(socket) {
  const choices = (box, name, values) =>
    $(box).replaceChildren(...values.map((v) => el('label', {}, el('input', { type: 'radio', name, value: String(v) }), el('span', { textContent: fd(v) }))));
  choices('#btSize', 'btSize', BT_SIZES);
  choices('#btPer', 'btPer', BT_PER);
  // Spotify's chip says it: in Jarchi a Spotify song plays 30 seconds (battle-player.js), so it's off at first too.
  const short = (v) => (v === 'spotify' ? [el('em', { className: 'bt-sim', textContent: S.panel.battle30s, title: S.panel.battle30sHint })] : []);
  $('#btSources').replaceChildren(
    ...Object.entries(BT_SOURCES).map(([v, name]) => el('label', {}, el('input', { type: 'checkbox', value: v }), el('span', {}, name, ...short(v)))),
  );
  for (const [name, set] of [
    ['btSize', (v) => ({ size: Number(v) })],
    ['btPer', (v) => ({ perViewer: Number(v) })],
    ['btVoting', (v) => ({ voting: v })],
  ])
    $$(`[name=${name}]`).forEach((r) => (r.onchange = () => btSave(set(r.value))));
  $$('#btSources input').forEach(
    (c) =>
      (c.onchange = () => {
        const sources = $$('#btSources input:checked').map((x) => x.value);
        if (!sources.length) return (c.checked = true); // one at least
        btSave({ sources });
      }),
  );
  $$('#btForm [data-k]').forEach((c) => (c.onchange = () => btSave({ [c.dataset.k]: c.checked })));
  $('#btTopic').onchange = (e) => btSave({ topic: e.target.value.trim().slice(0, 100) });
  $('#btDice').onclick = () => {
    const all = S.panel.battleTopics.filter((t) => t !== $('#btTopic').value);
    btSave({ topic: all[Math.floor(Math.random() * all.length)] });
  };
  $('#btModFrom').replaceChildren(...['kick', 'twitch'].map((p) => new Option(S.platforms[p], p)));
  $('#btModForm').onsubmit = (e) => {
    e.preventDefault();
    const username = $('#btModName').value.trim().replace(/^@/, ''),
      platform = $('#btModFrom').value,
      mods = bt.setup.moderators;
    if (!/^[\w-]{1,30}$/.test(username)) return toast(S.panel.battleModBad, true);
    $('#btModName').value = '';
    if (mods.length >= 50 || mods.some((m) => m.platform === platform && m.username.toLowerCase() === username.toLowerCase())) return;
    btSave({ moderators: [...mods, { platform, username }] });
  };
  $('#btOpen').onclick = async () => {
    $('#btOpen').disabled = true;
    try {
      gotBattle(await api('POST', '/api/battle/new', { ...bt.setup, topic: $('#btTopic').value.trim().slice(0, 100) || S.panel.battleTopicDefault }));
    } catch (err) {
      toast(err.message, true);
    } finally {
      $('#btOpen').disabled = false;
    }
  };

  $('#btConnect').onclick = () =>
    api('POST', '/api/battle/connect').then(
      ({ url }) => {
        window.open(url, '_blank', 'noopener');
        loadBattle();
      },
      (err) => toast(err.message, true),
    );
  $('#btCopy').onclick = () => copyLink(bt.page, S.panel.battleLinkCopied);
  $('#btChat').onclick = btPostChat;
  $('#btModFrom').value = 'kick';

  $('#btAdd').onsubmit = async (e) => {
    e.preventDefault();
    const link = $('#btLink').value.trim();
    if (!link) return;
    const btn = $('button', e.target);
    btn.disabled = true;
    try {
      const st = await api('POST', '/api/battle/songs', { link }),
        had = new Set(bt.battle?.songs.map((s) => s.id)),
        s = st.battle?.songs.find((x) => !had.has(x.id));
      gotBattle(st);
      $('#btLink').value = '';
      if (s) toast(tpl(S.panel[s.similar ? 'battleAddedSimilar' : 'battleAdded'], { title: s.title }));
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
    }
  };
  $('#btStart').onclick = () => btAct('POST', '/api/battle/start');
  for (const b of ['#btCancel', '#btEnd'])
    twoClick($(b), $(`${b} span`), S.panel.battleCancel, S.panel.battleCancelSure, () =>
      btAct('POST', '/api/battle/cancel').then((st) => st && toast(S.panel.battleCancelled)),
    );
  wireLive(socket);

  addEventListener('focus', () => view === 'battle' && loadBattle()); // back from the browser: signed in there
  setInterval(() => {
    if (view !== 'battle' || document.hidden || !bt) return;
    if (bt.state === 'pending') loadBattle();
    else if (BT_TAKING.includes(bt.battle?.status)) api('GET', '/api/battle/songs').then(gotBattle, () => {});
  }, 3000);
}

// ---------- The battle screen (core/battle.js runs it: the bracket, chat's votes, the timer, the winners) ----------
// The match on now, its two songs face to face: 1 on the left, 2 on the right (what chat types, in both languages). Each
// plays in its site's own player (battle-player.html, from localhost: it says why) under Jarchi's buttons, one song at a
// time. The battle's settings: with Hide a song's name, "???" and its player covered (the player shows the name too)
// until it has played (here or in the pop-out); Blur the covers: the player blurred until the mouse is on its card; who sent it only with
// Show who sent. Between them the vote (Chat votes: its timer, Start vote / End now, then who leads, Confirm winner or
// Vote again) or, with I pick the winner, nothing to wait for: "This one wins" on either song decides, in both modes.
const BT_PLAYER = `http://localhost:${location.port}`;
const BT_RING = 326.7; // the timer ring's length (radius 52)
const btSides = [0, 1].map((i) => ({ i, song: null, st: {}, seeking: false })); // wireLive() adds each card's parts
const btPlayed = new Set(); // ids of the songs played: their names show (Hide a song's name)
let btFlipping = null, // the coin, from its flip until the next match: { key, side, done }
  btTab = 'game', // the battle screen's tab: game | bracket
  btChampOf = null; // the battle whose champion this window has shown (once, with confetti)
// What a language switch's reload keeps of this window (help.js useLang, then select): the tab, and the champion already
// shown, unless its card is open now (then it opens again).
const btBack = () => [btTab, $('#btChamp').open ? null : btChampOf];

// A call on the battle screen -> the state, shown. Refused: why, and the state as it is now (-> undefined).
const btAct = (method, url, body) =>
  api(method, url, body).then(
    (st) => (gotBattle(st), st),
    (err) => (toast(err.message, true), loadBattle(), undefined),
  );
const btSay = (s, msg) => s.frame.contentWindow?.postMessage(msg, BT_PLAYER);
function btPlay(s) {
  const o = btSides[1 - s.i];
  if (o.st.playing) btSay(o, { pause: true });
  btSay(s, { play: true });
}
const btClock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const btShown = (s) => !btSetup().hideTitles || btPlayed.has(s.id) || bt.battle?.status === 'finished'; // over: all of them
const btName = (s) => (btShown(s) ? s.title : S.panel.battleHidden);
const btRoundName = (matches) => S.panel.battleRounds[matches] ?? tpl(S.panel.battleRoundOf, { n: fd(matches * 2) });
// The battle's songs leave their players when it isn't live any more: nothing plays on.
function btStop() {
  for (const s of btSides) if (s.song) Object.assign(s, { song: null, st: {} }).frame.src = 'about:blank';
}

// A side's buttons and time, from what its player says. Play / pause are drawn: the ▶ glyph differs from font to font.
const BT_ICONS = {
  battlePlay: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
  battlePause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
};
// The mute button's speaker, with sound or without (ClipQ's too).
const BT_SOUND = {
  on: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
  off: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4zM17 9l5 6M22 9l-5 6"/></svg>',
};
// A side's volume and mute, for YouTube and SoundCloud songs (Spotify's player takes neither from outside). Each new song
// starts at the last volume set, kept in this browser for next time, and with its sound on.
const BT_VOL = ['youtube', 'soundcloud'];
const btVol = () => (/^\d+$/.test(remember.get('jarchi.battleVol') ?? '') ? Math.min(100, Number(remember.get('jarchi.battleVol'))) : 100);
function btSound(s) {
  const on = BT_VOL.includes(s.song?.source),
    v = s.muted ? 0 : s.level;
  s.mute.hidden = s.vol.hidden = !on;
  s.vol.value = String(s.level);
  s.vol.style.setProperty('--fill', `${v}%`);
  s.mute.innerHTML = BT_SOUND[v ? 'on' : 'off'];
  s.mute.title = S.panel[s.muted ? 'clipqUnmute' : 'clipqMute'];
}
function btTime(s) {
  const { playing, pos = 0, dur = 0 } = s.st,
    icon = playing ? 'battlePause' : 'battlePlay';
  if (s.pp.title !== S.panel[icon]) Object.assign(s.pp, { title: S.panel[icon], innerHTML: BT_ICONS[icon] });
  s.seek.max = String(Math.max(1, Math.round(dur)));
  if (!s.seeking) s.seek.value = String(Math.round(pos));
  s.seek.style.setProperty('--fill', `${(Number(s.seek.value) / Number(s.seek.max)) * 100}%`);
  s.tm.textContent = `${btClock(s.seeking ? Number(s.seek.value) : pos)} / ${btClock(dur)}`;
  s.err.hidden = !s.st.error;
  s.card.classList.toggle('playing', !!playing);
}

// Both battle windows (the panel and its pop-out) share, per battle, which songs have played, so a name shows in both
// (and after a reload); a song that starts in one stops the one playing in the other (wireLive: the storage event).
function btPlayedNow(b, id) {
  btPlayed.add(id);
  remember.set('jarchi.battlePlayed', JSON.stringify({ battle: b.id, ids: b.songs.map((s) => s.id).filter((x) => btPlayed.has(x)) }));
}
function btReadPlayed(b) {
  try {
    const p = JSON.parse(remember.get('jarchi.battlePlayed'));
    if (p?.battle === b.id) p.ids.forEach((id) => btPlayed.add(id));
  } catch {}
}

// The battle screen: the Game tab (the match on now) or the Bracket; finished: the bracket with its champion. In the
// head, a dot per match (byes aside): done, on now, still to come.
function renderLive() {
  const b = bt.battle,
    R = b.bracket,
    done = b.status === 'finished',
    [r, m] = b.current ?? [],
    x = R[r]?.[m],
    brk = done || btTab === 'bracket';
  btReadPlayed(b);
  const dots = R.flatMap((round, ri) => round.map((y, mi) => (ri || y[1] ? (y[2] !== null ? 'd' : !done && ri === r && mi === m ? 'c' : '-') : ''))).filter(
    Boolean,
  );
  if ($('#btProg').dataset.at !== dots.join('')) {
    $('#btProg').dataset.at = dots.join('');
    $('#btProg').style.setProperty('--n', String(dots.length));
    $('#btProg').replaceChildren(...dots.map((d) => el('i', { className: d })));
  }
  $('#btBracket').hidden = !brk;
  if (brk) renderBracket(b, done);
  if (done) {
    $('#btArena').hidden = $('#btTie').hidden = true;
    return btChampion(b);
  }
  if (!x) return;
  const set = btSetup(),
    key = `${b.id}:${r}:${m}`,
    songs = [0, 1].map((i) => b.songs.find((s) => s.id === x[i])),
    v = b.vote,
    phase =
      x[2] !== null ? 'won' : set.voting !== 'chat' ? 'judge' : v?.status === 'open' ? 'open' : v?.status !== 'done' ? 'ready' : x[3] === x[4] ? 'tie' : 'lead',
    tie = phase === 'tie' || btFlipping?.key === key,
    real = (y) => y[0] && y[1];
  if (!songs[0] || !songs[1]) return;
  const total = R[r].filter(real).length;
  $('#btRound').textContent =
    total > 1
      ? tpl(S.panel.battleRound, { round: btRoundName(R[r].length), n: fd(R[r].slice(0, m + 1).filter(real).length), total: fd(total) })
      : btRoundName(R[r].length);
  $('#btArena').hidden = tie || brk; // on the Bracket tab the players play on, out of sight
  $('#btTie').hidden = !tie || brk;
  btSides.forEach((s, i) => btSide(s, songs[i], x, phase, set));
  if (tie) renderTie(x, songs, set, key);
  renderPod(phase, x, songs, `${key}:${phase}:${songs.map(btShown)}`, r === R.length - 1);
  btTick();
}

function btSide(s, song, x, phase, set) {
  const i = s.i,
    tot = x[3] + x[4],
    p = tot ? Math.round((x[3 + i] / tot) * 100) : 0;
  if (s.song?.id !== song.id) {
    Object.assign(s, { song, st: {}, seeking: false, level: btVol(), muted: false });
    s.frame.src = `${BT_PLAYER}/battle-player.html?${new URLSearchParams({ source: song.source, link: song.link, ...(BT_VOL.includes(song.source) && { vol: String(s.level / 100) }) })}`;
    s.err.replaceChildren(
      S.panel.battleCantPlay,
      ' ',
      el('a', { href: song.link, target: '_blank', rel: 'noopener', textContent: tpl(S.panel.battleOpenOn, { site: BT_SOURCES[song.source] }) }),
    );
    btTime(s);
    btSound(s);
  }
  const shown = btShown(song);
  s.title.replaceChildren(
    ...(shown ? [el('bdi', { textContent: song.title })] : [S.panel.battleHidden, el('small', { textContent: S.panel.battleHiddenHint })]),
  );
  s.curtain.hidden = shown;
  s.by.replaceChildren(el('span', { className: 'bt-src', textContent: BT_SOURCES[song.source] }), ...(set.showNames ? btWho(song.by) : []));
  s.vote.hidden = set.voting !== 'chat';
  s.bar.style.width = `${p}%`;
  s.pct.textContent = tpl(S.panel.battlePct, { p: fd(p) });
  s.votes.textContent = tpl(S.panel.battleVotes, { n: fd(x[3 + i]) });
  s.pick.hidden = x[2] !== null;
  s.card.classList.toggle('blur', set.blurCovers);
  s.card.classList.toggle('lead', phase === 'lead' && x[3 + i] > x[4 - i]);
  s.card.classList.toggle('win', x[2] === i);
  s.card.classList.toggle('lose', x[2] === 1 - i);
}

// The middle card, made again only when the match or its phase changes (the timer ticks on its own: btTick).
function renderPod(phase, x, songs, at, final) {
  const pod = $('#btPod');
  if (pod.dataset.at === at) return;
  pod.dataset.at = at;
  const btn = (cls, text, onclick) => el('button', { className: `lk-btn ${cls}`, textContent: text, onclick }),
    keys = () =>
      el(
        'div',
        { className: 'bt-keys' },
        el('small', { textContent: S.panel.battleTypeInChat }),
        el('div', {}, el('span', { className: 'k1', textContent: '1' }), el('span', { className: 'k2', textContent: '2' })),
      ),
    ring = () =>
      el('div', {
        className: 'bt-ring',
        innerHTML: `<svg viewBox="0 0 120 120"><defs><linearGradient id="btRg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color: var(--teal)"/><stop offset="1" style="stop-color: var(--gold)"/></linearGradient></defs><circle cx="60" cy="60" r="52" class="rt"/><circle cx="60" cy="60" r="52" class="rf"/></svg><div class="rc"><b></b><small></small></div>`,
      }),
    lead = x[3] > x[4] ? 0 : 1,
    tot = x[3] + x[4];
  const parts = {
    ready: () => [
      ring(),
      el('div', { className: 'bt-pst', textContent: S.panel.battleReady }),
      keys(),
      el(
        'div',
        { className: 'bt-pb' },
        btn('g', S.panel.battleVoteStart, () => btAct('POST', '/api/battle/vote')),
        el(
          'label',
          { className: 'bt-len' },
          `${S.panel.battleLength} `,
          el(
            'select',
            { onchange: (e) => (btSave({ voteTime: Number(e.target.value) }), btTick()) },
            ...[30, 60, 90].map((n) => new Option(tpl(S.panel.battleLengthN, { n: fd(n) }), String(n), false, n === btSetup().voteTime)),
          ),
        ),
      ),
    ],
    open: () => [
      ring(),
      el('div', { className: 'bt-pst' }, el('span', { className: 'bt-livep' }, el('i'), S.panel.battleVoteLive)),
      keys(),
      el(
        'div',
        { className: 'bt-pb' },
        btn('o', S.panel.battleEndNow, () => btAct('POST', '/api/battle/vote/end')),
      ),
    ],
    lead: () => [
      el(
        'div',
        { className: 'bt-pwin' },
        el('small', { textContent: S.panel.battleVoteEnded }),
        el('b', { textContent: tpl(S.panel.battleLeads, { n: fd(lead + 1), p: fd(Math.round((x[3 + lead] / tot) * 100)) }) }),
        el('small', {}, el('bdi', { textContent: btName(songs[lead]) })),
      ),
      el(
        'div',
        { className: 'bt-pb' },
        btn('g', S.panel.battleConfirm, () => btAct('POST', '/api/battle/winner', { side: lead })),
        btn('o bt-sm', S.panel.battleVoteAgain, () => btAct('DELETE', '/api/battle/vote')),
      ),
      el('small', { className: 'bt-mh', textContent: S.panel.battleFinalCall }),
    ],
    judge: () => [
      el(
        'div',
        { className: 'bt-pmsg' },
        el('span', { textContent: '👑', ariaHidden: 'true' }),
        el('b', { textContent: S.panel.battleJudge }),
        el('small', { textContent: S.panel.battleJudgeHint }),
      ),
    ],
    won: () => [
      el(
        'div',
        { className: 'bt-pwin' },
        el('div', { className: 'bt-pc', textContent: '👑', ariaHidden: 'true' }),
        el('small', { textContent: S.panel.battleWinner }),
        el('b', {}, el('bdi', { textContent: btName(songs[x[2]]) })),
        el('small', { textContent: S.panel[final ? 'battleFinalWon' : 'battleGoesOn'] }),
      ),
      el(
        'div',
        { className: 'bt-pb' },
        btn('g', S.panel[final ? 'battleToChampion' : 'battleNext'], (e) => btNext(e.target)),
      ),
    ],
    tie: () => [],
  };
  pod.replaceChildren(el('div', { className: 'bt-vsb', textContent: 'VS' }), ...parts[phase]());
}
// The timer ring: seconds left while a vote is on, else the length it will run.
function btTick() {
  const ring = $('#btPod .bt-ring'),
    v = bt?.battle?.vote,
    total = btSetup().voteTime,
    open = v?.status === 'open',
    left = open ? Math.max(0, Math.ceil((v.endsAt - Date.now()) / 1000)) : total;
  if (!ring) return;
  $('b', ring).textContent = fd(left);
  $('small', ring).textContent = S.panel.battleSeconds;
  $('.rf', ring).style.strokeDashoffset = String(BT_RING * (1 - left / total));
  ring.classList.toggle('on', open);
}

// Next match; after the final, the champion (renderLive: the bracket and the champion card).
async function btNext(btn) {
  btn.disabled = true;
  await btAct('POST', '/api/battle/next');
  btn.disabled = false;
}
// New battle, after the champion: back to the setup, in both windows.
const btClear = () => btAct('POST', '/api/battle/clear').then((st) => st && $('#btChamp').open && $('#btChamp').close());

// The champion: its cover, title, where it's from and (Show who sent) who sent it; blurred like the covers.
function btChampSong(b) {
  const s = b.songs.find((x) => x.id === b.champion),
    set = btSetup();
  return el(
    'div',
    { className: `bt-cw${set.blurCovers ? ' blur' : ''}` },
    btCover(s),
    el(
      'span',
      { className: 'bt-txt' },
      el('b', {}, el('bdi', { textContent: s.title })),
      el('small', {}, el('span', { className: 'bt-src', textContent: BT_SOURCES[s.source] }), ...(set.showNames ? btWho(s.by) : [])),
    ),
  );
}
// Once per battle in each window: the champion's card over the bracket, with confetti, and New battle.
function btChampion(b) {
  if (btChampOf === b.id) return;
  btChampOf = b.id;
  const d = $('#btChamp');
  $('#btChampSong').replaceChildren(btChampSong(b));
  d.showModal();
  if (calm()) return;
  const r = (a, z) => a + Math.random() * (z - a),
    bits = el(
      'div',
      { className: 'confetti' },
      ...Array.from({ length: 40 }, (_, n) =>
        el('i', {
          style: `--x: ${r(-240, 240)}px; --y: ${r(-230, -80)}px; --r: ${r(-720, 720)}deg; --c: ${CONFETTI[n % CONFETTI.length]}; animation-delay: ${r(0, 200)}ms`,
        }),
      ),
    );
  d.append(bits);
  setTimeout(() => bits.remove(), 2000);
}

// The Bracket tab, as in the design: a column per round (its name on top), each match its two songs, the winner
// highlighted, the match on now marked; a bye is "—", a place still to be won "?". Then the champion's card (once
// there is one, with New battle). Names hidden like on the Game tab. Made again only when something in it changed.
function renderBracket(b, done) {
  const R = b.bracket,
    c = !done && b.current,
    song = (id) => b.songs.find((s) => s.id === id),
    at = JSON.stringify([
      b.id,
      R.map((round) => round.map((x) => x.slice(0, 3))),
      c,
      b.champion ?? null,
      R.flat()
        .flatMap((x) => x.slice(0, 2))
        .map((id) => id && btShown(song(id))),
    ]);
  if ($('#btBracket').dataset.at === at) return;
  $('#btBracket').dataset.at = at;
  $('#btBracket').replaceChildren(
    ...R.map((round, ri) =>
      el(
        'div',
        { className: 'bt-rcol' },
        el('h5', { textContent: btRoundName(round.length) }),
        el(
          'div',
          { className: 'bt-ms' },
          ...round.map((x, mi) =>
            el(
              'div',
              { className: `bt-m${ri === R.length - 1 ? ' fin' : ''}${c && c[0] === ri && c[1] === mi ? ' cur' : ''}` },
              ...[0, 1].map((i) =>
                el('p', { className: x[2] === i ? 'w' : '' }, x[i] ? el('bdi', { textContent: btName(song(x[i])) }) : ri ? S.panel.battleTbd : '—'),
              ),
            ),
          ),
        ),
      ),
    ),
    el(
      'div',
      { className: 'bt-champ-card' },
      el('div', { className: 'bt-cup', textContent: '🏆', ariaHidden: 'true' }),
      el('b', { textContent: S.panel.battleChampionTitle }),
      b.champion ? btChampSong(b) : el('small', { textContent: S.panel.battleNoChampion }),
      ...(done ? [el('button', { className: 'lk-btn g', textContent: S.panel.battleNew, onclick: btClear })] : []),
    ),
  );
}

// A tie: the lucky coin (heads 1, tails 2) picks the winner, then the next match comes.
function renderTie(x, songs, set, key) {
  const f = btFlipping?.key === key && btFlipping.done ? btFlipping : null;
  $$('#btTie .bt-tside').forEach((t, i) => {
    const s = songs[i],
      at = `${key}:${btShown(s)}`;
    t.classList.toggle('blur', set.blurCovers);
    t.classList.toggle('win', f?.side === i);
    t.classList.toggle('lose', !!f && f.side !== i);
    if (t.dataset.at === at) return;
    t.dataset.at = at;
    t.replaceChildren(
      el('span', { className: 'bt-num', textContent: String(i + 1) }),
      btShown(s) ? btCover(s, 'bt-tcover') : el('span', { className: 'bt-tcover' }), // a cover tells the name too
      el('b', {}, el('bdi', { textContent: btName(s) })),
      el('div', { className: 'bt-tv', textContent: `${tpl(S.panel.battlePct, { p: fd(50) })} · ${tpl(S.panel.battleVotes, { n: fd(x[3]) })}` }),
    );
  });
  if (btFlipping) return;
  $('#btFlip').disabled = false;
  $('#btTmsg').textContent = S.panel.battleFlipHint;
  $('#btCoin').style.transform = 'rotateX(-8deg)';
  lkShine($('#btCoin'), 0);
}
function btFlip() {
  const b = bt.battle,
    [r, m] = b.current,
    key = `${b.id}:${r}:${m}`,
    side = Math.random() < 0.5 ? 0 : 1,
    coin = $('#btCoin'),
    t0 = performance.now(),
    a1 = (7 + Math.floor(Math.random() * 3)) * 360 + side * 180;
  btFlipping = { key, side, done: false };
  $('#btFlip').disabled = true;
  $('#btTmsg').textContent = '';
  lkMetal(0, 0.14, 2600);
  lkWhoosh(2.2);
  const frame = (now) => {
    const p = Math.min(1, (now - t0) / 2300),
      ay = a1 * (1 - Math.pow(1 - p, 3));
    coin.style.transform = `translateY(${-70 * Math.sin(Math.PI * p)}px) rotateX(-8deg) rotateY(${ay}deg)`;
    lkShine(coin, ay);
    if (p < 1) return requestAnimationFrame(frame);
    lkMetal(0, 0.16, 1900);
    lkMetal(0.16, 0.09, 2050);
    btFlipping.done = true;
    const s = b.songs.find((x) => x.id === b.bracket[r][m][side]);
    $('#btTmsg').replaceChildren(
      el('b', { className: 'bt-gd', textContent: S.panel[side ? 'battleTailsWon' : 'battleHeadsWon'] }),
      ' · ',
      tpl(S.panel.battleGoesOnTitle, { title: btName(s) }),
    );
    renderLive();
    setTimeout(async () => {
      if ((await btAct('POST', '/api/battle/winner', { side })) && view === 'battle') await btNext($('#btFlip'));
      btFlipping = null;
      if (view === 'battle') renderBattle();
    }, 1600);
  };
  requestAnimationFrame(frame);
}

function wireLive(socket) {
  btSides.forEach((s) => {
    const skip = (d, text, title) =>
      el('button', {
        className: 'bt-pbn',
        textContent: text,
        title,
        onclick: () => btSay(s, { seek: Math.min(s.st.dur || Infinity, Math.max(0, (s.st.pos || 0) + d)) }),
      });
    Object.assign(s, {
      card: $(`#btArena .s${s.i + 1}`),
      frame: el('iframe', { className: 'bt-frame', allow: 'autoplay; encrypted-media', title: tpl(S.panel.battleSongN, { n: String(s.i + 1) }) }),
      curtain: el(
        'button',
        { className: 'bt-curtain', onclick: () => btPlay(s) },
        el('b', { textContent: '▶' }),
        el('small', { textContent: S.panel.battleCurtain }),
      ),
      title: el('b', { className: 'bt-title' }),
      by: el('small', { className: 'bt-by' }),
      pp: el('button', { className: 'bt-pbn bt-pp', onclick: () => (s.st.playing ? btSay(s, { pause: true }) : btPlay(s)) }),
      seek: el('input', {
        type: 'range',
        min: '0',
        step: '1',
        title: S.panel.battleSeek,
        oninput: () => ((s.seeking = true), btTime(s)),
        onchange: () => ((s.seeking = false), btSay(s, { seek: Number(s.seek.value) })),
      }),
      tm: el('span', { className: 'bt-tm' }),
      level: btVol(),
      muted: false,
      mute: el('button', { className: 'bt-pbn', onclick: () => ((s.muted = !s.muted), btSay(s, { muted: s.muted }), btSound(s)) }),
      vol: el('input', {
        type: 'range',
        className: 'bt-vol',
        min: '0',
        max: '100',
        step: '1',
        title: S.panel.clipqVolume,
        oninput: () => {
          Object.assign(s, { level: Number(s.vol.value), muted: false });
          remember.set('jarchi.battleVol', s.vol.value);
          btSay(s, { volume: s.level / 100, muted: false });
          btSound(s);
        },
      }),
      err: el('p', { className: 'bt-err', hidden: true }),
      bar: el('i'),
      pct: el('b'),
      votes: el('span'),
      pick: el('button', { className: 'lk-btn o bt-pick', textContent: S.panel.battlePick, onclick: () => btAct('POST', '/api/battle/winner', { side: s.i }) }),
    });
    s.vote = el('div', { className: 'bt-vote' }, el('div', { className: 'bt-vb' }, s.bar), el('div', { className: 'bt-vn' }, s.pct, s.votes));
    s.card.replaceChildren(
      el('span', { className: 'bt-num', textContent: String(s.i + 1) }),
      el('div', { className: 'bt-media' }, s.frame, s.curtain),
      s.err,
      s.title,
      s.by,
      el('div', { className: 'bt-ctl' }, skip(-10, '⏪ 10', S.panel.battleBack), s.pp, skip(10, '10 ⏩', S.panel.battleFwd), s.seek, s.tm, s.mute, s.vol),
      s.vote,
      s.pick,
    );
    btTime(s);
    btSound(s);
  });
  // What each player says: where it is, playing or not. One that starts (also with its own button) stops the other.
  addEventListener('message', (e) => {
    const s = e.origin === BT_PLAYER && btSides.find((x) => x.frame.contentWindow === e.source);
    if (!s?.song || !e.data?.st) return;
    const was = s.st.playing;
    s.st = e.data.st;
    if (s.st.playing && btSides[1 - s.i].st.playing) btSay(btSides[1 - s.i], { pause: true });
    btTime(s);
    if (!s.st.playing || was) return;
    remember.set('jarchi.battlePlaying', String(Date.now())); // the other battle window stops its song
    if (btPlayed.has(s.song.id) || !bt?.battle) return;
    btPlayedNow(bt.battle, s.song.id);
    if (view === 'battle') renderLive();
  });
  addEventListener('storage', (e) => {
    if (e.key === 'jarchi.battlePlaying') btSides.forEach((s) => s.st.playing && btSay(s, { pause: true }));
    else if (e.key === 'jarchi.battlePlayed' && view === 'battle' && bt?.battle?.status === 'live') renderLive();
  });

  // The coin: the Luck page's faces (heads the logo, tails a 2), its own ids.
  const c = $('#btCoin');
  for (let z = -7; z <= 7; z++) c.append(el('div', { className: 'edge', style: `transform: translateZ(${z}px) scale(.985)` }));
  c.append(
    el('div', { className: 'face', style: 'transform: translateZ(7.3px)', innerHTML: lkHeads('bh') }),
    el('div', { className: 'face', style: 'transform: rotateY(180deg) translateZ(7.3px)', innerHTML: lkTails(2, 'bt') }),
  );
  $('#btFlip').onclick = btFlip;
  $('#btAgain').onclick = btClear;
  $$('#btTabs [data-tab]').forEach(
    (b) =>
      (b.onclick = () => {
        btTab = b.dataset.tab;
        renderBattle();
      }),
  );
  popOut('battle', 'navSongBattle', $('#btPop'), $('#btLang'), $('#btTop'), 1280);
  socket.on('connect', () => socket.emit('battleJoin')); // the panel and the pop-out alike
  socket.on('battle', gotBattle); // votes coming in, the timer running out
  setInterval(() => view === 'battle' && !document.hidden && bt?.battle?.vote?.status === 'open' && btTick(), 250);
}
