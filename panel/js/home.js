// ---------- Home ----------
const COPY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>';
// Copy text: the clipboard API, else the older way (a hidden field: inside an open window, the only place a modal one lets
// focus go), else false. copyLink: a toast either way (blocked: how to copy by hand).
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {}
  const t = el('textarea', { value: text, readOnly: true });
  t.style.cssText = 'position: fixed; top: 0; opacity: 0';
  ($('dialog[open]') ?? document.body).append(t);
  t.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {}
  t.remove();
  return ok;
}
const copyLink = (url, msg = S.panel.copied) => copyText(url).then((ok) => toast(ok ? msg : S.panel.copyFailed, !ok));
// A Copy button for a code shown beside it (box): a click copies it, and the button is a check with "Copied" for 2 s.
// Blocked: says so, and selects the code, for Ctrl+C.
function copyButton(text, box) {
  const b = el('button', { className: 'copy-btn', textContent: S.panel.teamCopy });
  let back;
  b.onclick = async () => {
    if (!(await copyText(text))) {
      getSelection().selectAllChildren(box);
      return toast(S.panel.copyFailed, true);
    }
    clearTimeout(back);
    b.classList.add('copied');
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    b.append(S.panel.copiedShort);
    back = setTimeout(() => {
      b.classList.remove('copied');
      b.textContent = S.panel.teamCopy;
    }, 2000);
  };
  return b;
}
const copyBtn = (name, url) => {
  // a widget's copy icon (Home's Widgets card, the welcome tour)
  const b = el('button', { className: 'icon-btn', title: S.panel.copyObs, ariaLabel: `${S.panel.copyObs}: ${name}`, onclick: () => copyLink(url) });
  b.innerHTML = COPY_ICON; // fixed markup
  return b;
};
// The widget pages: [id the server counts them by, name, OBS link]. Only the switched-on ones are needed (alerts and
// viewers always: they have no switch). One chat is "Chat"; with Chat 2 each goes by its name. Viewers: one per link,
// "Viewers (Kick)", "Viewers (Twitch)", "Viewers (Total)".
const widgetPages = () => [
  ['alerts', S.panel.groupAlerts, `${location.origin}/widgets/alerts`],
  ...CHAT_KEYS.filter((k) => settings[k]).map((k) => [k, settings.chat2 ? chatName(k) : S.panel.chatName, chatUrl(k)]),
  ...Object.keys(settings.goals).map((id) => [id, goalName(id), `${location.origin}/widgets/goal/${id}`]),
  ...VIEWER_SOURCES.map((p) => [
    `viewers-${p}`,
    tpl(S.panel.goalOn, { goal: S.panel.navViewers, platform: p === 'total' ? S.panel.viewersTotal : S.platforms[p] }),
    `${location.origin}/widgets/viewers/${p}`,
  ]),
];
// In use (Home's Widgets): on, and a Viewer count link only once it was opened in OBS (seenWidgets, from the server).
let seenWidgets = [];
const widgetUsed = (id) => widgetOn(id) && (!id.startsWith('viewers-') || open[id] > 0 || seenWidgets.includes(id));
const widgetOn = (id) => id === 'alerts' || id.startsWith('viewers-') || (CHAT_KEYS.includes(id) ? settings[id] : settings.goals[id]).enabled;
const FEED_FILTERS = { all: null, subs: ['sub', 'resub', 'gift_sub'], kicks: ['kicks'], raids: ['raid'], follows: ['follow'] };
const ofType = (list, f) => list.filter((ev) => !FEED_FILTERS[f] || FEED_FILTERS[f].includes(ev.type));
const pressFilter = (box, f) => $$('button', box).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === f)));

// What's missing before going live: [text, the page (and item) that fixes it]. Widgets switched off aren't needed.
function issues() {
  const out = ['kick', 'twitch']
    .filter((p) => chatStatus[p].state !== 'connected')
    .map((p) => [tpl(S.panel.issuePlatform, { platform: S.platforms[p] }), ['chat']]); // the channel names are on the Chat page for now
  if (!open.alerts) out.push([S.panel.issueAlerts, ['alert'], 'obs']);
  for (const k of CHAT_KEYS) {
    if (settings[k]?.enabled && !open[k]) out.push([settings.chat2 ? tpl(S.panel.issueChatN, { chat: chatName(k) }) : S.panel.issueChat, ['chat', k], 'obs']);
  }
  for (const [id, g] of Object.entries(settings.goals))
    if (g.enabled && !open[id]) out.push([tpl(S.panel.issueGoal, { goal: goalName(id) }), ['goal', id], 'obs']);
  return out;
}

// "gifted 5 subs", "sent 100 Kicks"; feedDidOne for 1 (and a resub without its months).
function did(ev) {
  const n = ev.type === 'resub' ? ev.months : ev.amount;
  const one = S.panel.feedDidOne[ev.type];
  return one && (n === 1 || (ev.type === 'resub' && !n)) ? one : tpl(S.panel.feedDid[ev.type], { n: fmt(n) });
}
const since = new Intl.RelativeTimeFormat(FA ? 'fa' : 'en', { numeric: 'auto', style: 'short' });
function ago(t) {
  const s = (Date.now() - t) / 1000;
  return s < 60
    ? since.format(0, 'second')
    : s < 3600
      ? since.format(-Math.floor(s / 60), 'minute')
      : s < 86400
        ? since.format(-Math.floor(s / 3600), 'hour')
        : since.format(-Math.floor(s / 86400), 'day');
}
function uptime() {
  const m = Math.floor((Date.now() - home.started) / 60000);
  return fd(tpl(S.panel[m < 60 ? 'uptimeM' : 'uptimeHM'], { h: Math.floor(m / 60), m: m % 60 }));
}

const loadHome = () =>
  api('GET', '/api/home').then(
    (h) => {
      home = h;
      if (view === 'home') renderHome();
    },
    () => {},
  );

// An event (Home's live feed, History), with when it came; a test button's alert says so.
const feedRow = (ev, when) =>
  el(
    'li',
    { className: 'feed-row' },
    ev.platform === 'test'
      ? typeIcon(ev.type)
      : el('img', { className: 'feed-logo', src: `/assets/platform-logos/${ev.platform}.svg`, alt: S.platforms[ev.platform], title: S.platforms[ev.platform] }),
    el(
      'span',
      { className: 'feed-what' },
      el('b', { textContent: ev.user, dir: 'auto' }),
      ` ${did(ev)}`,
      ev.test ? el('span', { className: 'pill', textContent: S.platforms.test }) : '',
    ),
    el('small', { textContent: when }),
    el('button', {
      className: 'replay',
      textContent: S.panel.qReplay,
      onclick: () => queueCall('POST', `replay/${encodeURIComponent(ev.id)}`).then((q) => q && toast(S.panel.qReplayed)),
    }),
  );

// History: every saved event, newest first, 20 a page, each with its local date and time ("19 Oct 2026, 04:50"; in
// Persian the Persian calendar: "۲۷ مهر ۱۴۰۵، ۰۴:۵۰"). Page buttons: all of them up to 7, else the first, the last and
// the ones beside the open one.
const PAGE = 20;
const dayFmt = new Intl.DateTimeFormat(FA ? 'fa-IR' : 'en-GB', { day: 'numeric', month: FA ? 'long' : 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat(FA ? 'fa-IR' : 'en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dateTime = (t) => `${dayFmt.format(t)}${FA ? '، ' : ', '}${timeFmt.format(t)}`; // one fa-IR format would say "ساعت"
const loadHistory = () =>
  api('GET', '/api/history').then(
    (list) => {
      hist.list = list;
      if (view === 'events') renderHistory();
    },
    () => {},
  );
function renderHistory() {
  pressFilter($('#histChips'), hist.filter);
  const rows = ofType(hist.list, hist.filter);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  hist.page = Math.min(hist.page, pages - 1);
  $('#histList').replaceChildren(...rows.slice(hist.page * PAGE, (hist.page + 1) * PAGE).map((ev) => feedRow(ev, dateTime(ev.time))));
  $('#histEmpty').hidden = rows.length > 0;
  const go = (p, text, props) =>
    el('button', {
      textContent: text,
      onclick: () => {
        hist.page = p;
        renderHistory();
      },
      ...props,
    });
  const nums = [];
  for (let p = 0; p < pages; p++) {
    if (pages <= 7 || p === 0 || p === pages - 1 || Math.abs(p - hist.page) <= 1) nums.push(go(p, fd(p + 1), p === hist.page && { ariaCurrent: 'page' }));
    else if (nums.at(-1).tagName !== 'SPAN') nums.push(el('span', { textContent: '…' }));
  }
  $('#histPages').hidden = pages < 2;
  $('#histPages').replaceChildren(
    go(hist.page - 1, S.panel.prev, { disabled: !hist.page }),
    ...nums,
    go(hist.page + 1, S.panel.next, { disabled: hist.page === pages - 1 }),
  );
}

function renderHome() {
  const missing = issues();
  $('#banner').classList.toggle('ready', !missing.length);
  $('#bannerTitle').textContent = S.panel[missing.length ? 'notReadyTitle' : 'readyTitle'];
  $('#bannerHint').hidden = missing.length > 0;
  $('#obsOrderHint').hidden = !missing.some((m) => m[2]); // a widget isn't open in OBS
  $('#issues').replaceChildren(
    ...missing.map(([text, page]) =>
      el('li', {}, el('span', { textContent: text }), el('button', { textContent: S.panel.fix, onclick: () => select(...page) })),
    ),
  );
  $('#obsMenu').replaceChildren(
    ...widgetPages().map(([, name, url]) => {
      // the OBS links menu: Chat 2 comes and goes
      const b = el('button', { onclick: () => copyLink(url) }, el('span', { textContent: name }));
      b.insertAdjacentHTML('beforeend', COPY_ICON);
      return b;
    }),
  );

  // Live feed: the 10 newest events, whenever they came. View all = History.
  pressFilter($('#feedChips'), feedFilter);
  const rows = ofType(hist.list, feedFilter).slice(0, 10);
  $('#feedList').replaceChildren(...rows.map((ev) => feedRow(ev, ago(ev.time))));
  $('#feedEmpty').hidden = rows.length > 0;

  // Widgets: only the ones in use (alerts always), green when a page of it is open (in OBS) right now.
  $('#widgetList').replaceChildren(
    ...widgetPages()
      .filter(([id]) => widgetUsed(id))
      .map(([id, name, url]) =>
        el(
          'li',
          { className: `widget-row${open[id] ? ' on' : ''}` },
          el('i', { className: 'state-dot' }),
          el('span', { className: 'stack' }, el('b', { textContent: name }), el('small', { textContent: S.panel[open[id] ? 'widgetOpen' : 'widgetClosed'] })),
          copyBtn(name, url),
        ),
      ),
  );

  // Goals: what's set on each channel right now, exactly as Kick / Twitch list it (read-only; whatever the syncs do).
  // Kick's have no title: their type names them. A Twitch goal's title is its description, else its type.
  $('#kickGoals').replaceChildren(...home.kickGoals.map((g) => homeGoal(CHANNEL_GOAL[g.type], S.panel.kickGoalTypes[g.type] ?? g.type, g.current, g.target)));
  hint('#kickGoalsHint', !settings.chat.kickChannel ? S.panel.kickSyncNoChannel : home.kickGoals.length ? '' : S.panel.kickSyncNone);
  $('#twitchGoals').replaceChildren(
    ...twitch.goals.map((g) => {
      const kind = S.panel.twitchGoalTypes[g.type] ?? g.type;
      return homeGoal(CHANNEL_GOAL[g.type], g.description || kind, g.current, g.target, [], g.description ? el('small', { textContent: kind }) : '');
    }),
  );
  hint(
    '#twitchGoalsHint',
    twitch.state === 'off' ? S.panel.twitchGoalsOff : twitch.state === 'connected' && !twitch.goals.length ? S.panel.twitchGoalsNone : '',
  );
  $('#twitchGoalsConnect').hidden = twitch.state !== 'off';

  $('#statAlerts').textContent = fmt(home.today.alerts);
  $('#statChat').textContent = fmt(home.today.chat);
  $('#statUptime').textContent = uptime();
}

// A hint line: its text, hidden when there's none.
const hint = (sel, text) => Object.assign($(sel), { textContent: text, hidden: !text });
// One goal on Home: its icon and name, current / target, more (marks, a line under it), and a bar, in the goal's colour.
function homeGoal(id, name, current, target, marks = [], under = '') {
  const bar = el('i');
  bar.style.width = `${Math.min(100, target ? (current / target) * 100 : 0)}%`;
  const row = el(
    'div',
    { className: 'home-goal' },
    el(
      'div',
      { className: 'row' },
      goalIcon(id),
      el('b', { textContent: name, dir: 'auto' }),
      el('small', { textContent: `${fmt(current)} / ${fmt(target)}` }),
      ...marks,
    ),
    under,
    el('div', { className: 'goal-bar' }, bar),
  );
  row.dataset.goal = id;
  return row;
}

// ---------- Team messages ----------
// From Jarchi's team (core/messages.js, by socket, to the panel only; never in OBS): a window in the middle of Jarchi
// (#teamMsg, the page behind blurred and dimmed), one message at a time ("1 of 3", Next), in the panel's language and its
// style's colour and icon (info | update | warning | gift | design: a design code, its icon the 👀). A gift is a gently shaking box first; Open it: a little
// confetti, then the message. A link (https only) is a strong button that opens in the browser; a code has Copy (a check
// with "Copied" for 2 s); a design code also has Use code: the 👀 popover with it filled in (the message closes for good
// once the code works; until then it comes back next start). Shown =
// seen (told once); Next, OK, ✕ or Esc = that one closed for good, and ✕ before the last leaves the rest for Jarchi's
// next start. It waits for the window to be in front and for any other dialog (the tour, the Privacy Policy) to close.
let teamMsgs = [],
  teamQueue = [],
  teamAt = 0;
const teamSkip = new Set(); // closed here (a list sent just before may still have it) or left for the next start
const TEAM_ICON = {
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  update:
    '<path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9a2.2 2.2 0 0 0-2.9-.1zM12 15l-3-3a22 22 0 0 1 2-4A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22.4 22.4 0 0 1-4 2zM9 12H4s.6-3 2-4c1.6-1.1 5 0 5 0M12 15v5s3-.6 4-2c1.1-1.6 0-5 0-5"/>', // rocket
  warning: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>',
  gift: `<path d="${TYPE_ICON.gift_sub}"/>`,
  design: '', // the 👀 itself (the profile chip's), teamShow()
};
// The gift's box: the lid (with its bow) lifts off when it's opened.
const GIFT_BOX = `<svg viewBox="0 0 120 120" aria-hidden="true"><ellipse class="gift-shade" cx="60" cy="112" rx="40" ry="4"/><g class="gift-all">
  <rect class="gift-body" x="22" y="56" width="76" height="52" rx="6"/><rect class="gift-ribbon" x="53" y="56" width="14" height="52"/>
  <g class="gift-lid"><path class="gift-ribbon" d="M60 41c-5-13-23-18-26-9-2 8 14 10 26 9zM60 41c5-13 23-18 26-9 2 8-14 10-26 9z"/>
  <rect class="gift-top" x="16" y="40" width="88" height="20" rx="5"/><rect class="gift-ribbon" x="53" y="40" width="14" height="20"/></g></g></svg>`;
const CONFETTI = ['var(--gold)', 'var(--gift)', 'var(--ok)', 'var(--info)', '#f472b6'];
const teamCall = (id, what) => api('POST', `/api/messages/${id}/${what}`).catch(() => {});
const calm = () => STILL.matches || document.documentElement.hasAttribute('data-still'); // Reduce animations: Windows' or the panel's
function renderTeam() {
  if (document.visibilityState !== 'visible' || $('dialog[open]')) return; // again when it's in front / the other one closes
  teamQueue = teamMsgs.filter((m) => !teamSkip.has(m.id));
  if (!teamQueue.length) return;
  teamShow(0);
  $('#teamMsg').showModal();
}
function teamDone(m) {
  // closed for good: not shown again here, and the relay told
  teamSkip.add(m.id);
  teamCall(m.id, 'closed');
}
function teamShow(i, opened) {
  const d = $('#teamMsg'),
    m = teamQueue[(teamAt = i)],
    lang = FA ? 'fa' : 'en',
    last = i === teamQueue.length - 1;
  const style = Object.hasOwn(TEAM_ICON, m.style) ? m.style : 'info';
  if (!m.seen) {
    m.seen = true;
    teamCall(m.id, 'seen');
  }
  d.className = `profile-dialog team-msg ${style}`;
  const x = el('button', { className: 'ghost team-x', title: S.panel.teamClose, ariaLabel: S.panel.teamClose, onclick: () => d.close() });
  x.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  if (style === 'gift' && !opened) {
    // the box first
    const box = Object.assign(svgIn('gift-box', GIFT_BOX), { id: 'teamTitle', role: 'img', ariaLabel: S.panel.teamGift });
    const open = el('button', {
      className: 'primary gift-open',
      autofocus: true,
      textContent: S.panel.teamGiftOpen,
      onclick: () => {
        if (calm()) return teamShow(i, true);
        open.disabled = true;
        d.classList.add('opening');
        const bits = el(
          'div',
          { className: 'confetti' },
          ...Array.from({ length: 30 }, (_, n) =>
            el('i', {
              style: `--x: ${rnd(-170, 170)}px; --y: ${rnd(-190, -70)}px; --r: ${rnd(-720, 720)}deg; --c: ${CONFETTI[n % CONFETTI.length]}; animation-delay: ${rnd(0, 120)}ms`,
            }),
          ),
        );
        d.append(bits);
        setTimeout(() => bits.remove(), 1800);
        setTimeout(() => d.open && teamQueue[i] === m && teamShow(i, true), 600); // not if it was closed meanwhile
      },
    });
    $('#teamBody').replaceChildren(x, box, open);
    return open.focus();
  }
  const link =
    m.link && /^https:\/\//i.test(m.link.url)
      ? el('button', { className: 'team-link', textContent: m.link.label[lang], dir: 'auto', onclick: () => window.open(m.link.url, '_blank', 'noopener') })
      : '';
  const shown = m.code && el('code', { textContent: m.code, dir: 'ltr' });
  const code = m.code ? el('div', { className: 'team-code' }, shown, copyButton(m.code, shown)) : '';
  const use =
    style === 'design' && m.code
      ? el('button', {
          className: 'primary team-use',
          textContent: S.panel.teamUseCode,
          onclick: (e) => {
            e.stopPropagation(); // the page's "a click elsewhere closes the popover" would close it again at once
            codeMsg = m; // not closed for good until its code works (the close handler)
            d.close();
            eyesUi.show();
            eyesUi.open(m.code);
          },
        })
      : '';
  if (use) use.autofocus = true; // the window opening focuses it (showModal), not OK
  const go = el('button', {
    className: link || use ? '' : 'primary',
    autofocus: !use,
    textContent: last ? S.panel.teamOk : S.panel.next,
    onclick: () => (last ? d.close() : (teamDone(m), teamShow(i + 1))),
  });
  const count = teamQueue.length > 1 ? tpl(S.panel.teamOf, { n: fmt(i + 1), total: fmt(teamQueue.length) }) : '';
  const icon = style === 'design' ? $('#eyes svg').outerHTML : `<svg viewBox="0 0 24 24" aria-hidden="true">${TEAM_ICON[style]}</svg>`;
  $('#teamBody').replaceChildren(
    x,
    svgIn('team-icon', icon),
    el('h2', { id: 'teamTitle', textContent: m.title[lang], dir: 'auto' }),
    el('p', { className: 'team-text', textContent: m.body[lang], dir: 'auto' }),
    code,
    use,
    link,
    el('div', { className: 'team-foot' }, el('small', { textContent: count }), go),
  );
  (use || go).focus();
}

// Two clicks instead of confirm(): no blocking dialog. The first click arms the button for 3 seconds.
function twoClick(btn, label, idle, confirm, action) {
  let armed;
  const disarm = () => {
    clearTimeout(armed);
    armed = null;
    label.textContent = idle;
    btn.classList.remove('armed');
  };
  btn.onclick = () => {
    if (armed) return (disarm(), action());
    armed = setTimeout(disarm, 3000);
    btn.classList.add('armed');
    label.textContent = confirm;
  };
}
