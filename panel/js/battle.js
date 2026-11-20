// ---------- Song Battle (core/battle.js: Jarchi Battle, battle.jarchi.app) ----------
// Not connected: Connect opens Jarchi Battle's one-time link in the browser; while it waits, the state is asked every
// 3 s and when the window comes back, until the key is in. Connected: the setup (saved as it changes, for the next
// battle; while a battle runs, that battle's, fixed), the page link with its QR code, and the battle's songs: the feed
// every 3 s while it takes songs and the page is in view. The songs stay blurred until the mouse is on one, so a cover
// or a title that isn't fit for the stream stays off it. The battle screen comes after Start (the next step).
let bt = null; // core/battle.js now(): { state, channel, platform, page, battle, setup, lost, error }
const BT_SIZES = [4, 8, 16, 32, 64, 128],
  BT_PER = [1, 2, 3];
const BT_SOURCES = { youtube: 'YouTube', spotify: 'Spotify', soundcloud: 'SoundCloud' };
const BT_TAKING = ['collecting', 'closed'];

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
  const on = bt.state === 'connected';
  $('#btHero').hidden = on;
  $('#btOn').hidden = !on;
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

// One song: its cover, title (Similar: an earlier one has its link or name), where it's from and who sent it, and
// Remove while the battle hasn't started.
function btSong(s, removable) {
  const by = s.by ?? {},
    who = ['kick', 'twitch'].includes(by.platform)
      ? [lkIco(by.platform), el('bdi', { textContent: by.username })]
      : [el('span', { textContent: S.panel.battleGuest })];
  return el(
    'li',
    { className: 'bt-song', tabIndex: 0 },
    /^https:\/\//.test(s.cover ?? '')
      ? el('img', { className: 'bt-cover', src: s.cover, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' })
      : el('span', { className: 'bt-cover' }),
    el(
      'span',
      { className: 'bt-txt' },
      el(
        'b',
        {},
        el('bdi', { textContent: s.title }),
        s.similar ? el('em', { className: 'bt-sim', textContent: S.panel.battleSimilar, title: S.panel.battleSimilarHint }) : '',
      ),
      el('small', {}, el('span', { className: 'bt-src', textContent: BT_SOURCES[s.source] ?? s.source }), ...who),
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

function wireBattle() {
  const choices = (box, name, values) =>
    $(box).replaceChildren(...values.map((v) => el('label', {}, el('input', { type: 'radio', name, value: String(v) }), el('span', { textContent: fd(v) }))));
  choices('#btSize', 'btSize', BT_SIZES);
  choices('#btPer', 'btPer', BT_PER);
  $('#btSources').replaceChildren(
    ...Object.entries(BT_SOURCES).map(([v, name]) => el('label', {}, el('input', { type: 'checkbox', value: v }), el('span', { textContent: name }))),
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
  $('#btStart').onclick = () => api('POST', '/api/battle/start').then(gotBattle, (err) => (toast(err.message, true), loadBattle()));
  twoClick($('#btCancel'), $('#btCancel span'), S.panel.battleCancel, S.panel.battleCancelSure, () =>
    api('POST', '/api/battle/cancel').then(
      (st) => (gotBattle(st), toast(S.panel.battleCancelled)),
      (err) => (toast(err.message, true), loadBattle()),
    ),
  );

  addEventListener('focus', () => view === 'battle' && loadBattle()); // back from the browser: signed in there
  setInterval(() => {
    if (view !== 'battle' || document.hidden || !bt) return;
    if (bt.state === 'pending') loadBattle();
    else if (BT_TAKING.includes(bt.battle?.status)) api('GET', '/api/battle/songs').then(gotBattle, () => {});
  }, 3000);
}
