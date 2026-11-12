// ---------- Alert queue (its own page) ----------
// One line icon per alert type, in the type's own color (the --dot colors).
const TYPE_ICON = {
  follow: 'M15 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M8.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19 8v6M22 11h-6',
  sub: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  resub: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  gift_sub: 'M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-1-3-5-3-5-1s3 1 5 1zM12 7c1-3 5-3 5-1s-3 1-5 1z',
  kicks: 'M13 2L4 14h7l-1 8 9-12h-7z',
  bits: 'M12 2l8 5v10l-8 5-8-5V7z',
  raid: 'M17 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M21 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8',
  crypto:
    'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M14.8 9.2a2.8 2.8 0 0 0-2.8-1.7c-1.6 0-2.8.9-2.8 2.1 0 2.9 5.6 1.5 5.6 4.5 0 1.2-1.2 2.2-2.8 2.2a2.9 2.9 0 0 1-2.8-1.8M12 6v1.5M12 16.3v1.7',
};
function typeIcon(type) {
  const i = el('span', { className: 'q-icon', title: S.types[type] });
  i.dataset.key = type;
  i.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${TYPE_ICON[type]}"/></svg>`; // fixed paths, no user text
  return i;
}
// An alert from one platform only: that platform's logo, "Kick only" / "Twitch only".
const platMarks = (type) =>
  el(
    'span',
    { className: 'plat-marks' },
    ...(ALERT_PLATFORMS[type] ?? []).map((p) => {
      const only = tpl(S.panel.platformOnly, { platform: S.platforms[p] });
      return el('img', { src: `/assets/platform-logos/${p}.svg`, alt: only, title: only });
    }),
  );
// "Rich · Gifted subs · 10": icon, name, type, and the amount (or a resub's months).
function alertRow(a, action) {
  const amount =
    a.type === 'crypto' ? `${a.amount} USDT` : a.type === 'resub' && a.months ? tpl(S.panel.qMonths, { n: fmt(a.months) }) : a.amount ? fmt(a.amount) : '';
  const who = a.user || S.panel.cryptoAnon; // only a crypto donation has none: the donor hid it
  return el(
    'li',
    { className: 'q-item' },
    typeIcon(a.type),
    el('span', { className: 'q-who' }, el('b', { textContent: who, title: who, dir: 'auto' }), el('small', { textContent: S.types[a.type] })),
    el('span', { className: 'q-amt', textContent: amount }),
    action ?? '',
  );
}

function renderQueue() {
  const q = queue,
    n = q.now;
  for (const c of $$('#qCount, #qNavCount')) c.textContent = fd(q.waiting);
  $('#qNavCount').hidden = !q.waiting; // in the sidebar: only when alerts are waiting
  $('#qPaused').hidden = !q.paused;
  $('#queue').dataset.state = q.paused ? 'paused' : n ? 'playing' : 'idle';
  $('#qNow').replaceChildren(n ? alertRow(n) : el('p', { className: 'q-empty', textContent: S.panel.qIdle }));
  // Progress bar: from where the alert is now to the end, in the time it has left.
  const bar = $('#qBar');
  bar.style.transition = 'none';
  bar.style.width = n ? `${(1 - n.left / n.ms) * 100}%` : '0';
  if (n) {
    bar.getBoundingClientRect(); // start the transition from that width
    bar.style.transition = `width ${n.left}ms linear`;
    bar.style.width = '100%';
  }
  $('#qPause span').textContent = q.paused ? S.panel.qResume : S.panel.qPause;
  $('#qPause').title = q.paused ? S.panel.qResumeHint : S.panel.qPauseHint;
  $('#qSkip').disabled = !n;
  $('#qClear').disabled = !q.waiting;
  $('#qList').replaceChildren(
    ...q.list.map((a) =>
      alertRow(
        a,
        el('button', {
          className: 'x',
          textContent: '×',
          title: S.panel.qRemove,
          ariaLabel: S.panel.qRemove,
          onclick: () => queueCall('DELETE', `queue/${encodeURIComponent(a.id)}`),
        }),
      ),
    ),
  );
  $('#qEmpty').hidden = q.list.length > 0;
  $('#qHistory').replaceChildren(
    ...q.history.map((a) =>
      alertRow(
        a,
        el('button', {
          className: 'replay',
          textContent: S.panel.qReplay,
          onclick: () => queueCall('POST', `replay/${encodeURIComponent(a.id)}`).then((r) => r && toast(S.panel.qReplayed)),
        }),
      ),
    ),
  );
  $('#qNoHistory').hidden = q.history.length > 0;
  $('#qNoObs').hidden = q.overlays > 0;
}
const queueCall = (method, what, body) =>
  api(method, `/api/alerts/${what}`, body).then(
    (q) => {
      queue = q;
      renderQueue();
      return q;
    },
    (err) => toast(err.message, true),
  );

// ---------- Goal marks (panel only): an icon per goal in its colour (CSS [data-goal]), Kick's K ----------
// Kick's own logo shape (assets/platform-logos/kick.svg), drawn in currentColor so light mode can use a darker green.
const KICK_K =
  '<svg class="kick-k" viewBox="0 0 26 26" aria-hidden="true"><path fill-rule="evenodd" d="M1 0H9.76711V5.79452H12.589V2.82193H15.5616V0H24.1781V8.61645H21.3561V11.589H18.3836V14.411H21.3561V17.3836H24.1781V26H15.5616V23.1781H12.589V20.2055H9.76711V26H1V0Z"/></svg>';
const HEART = 'M12 20.5s-7.6-4.5-9.4-9.2C1.4 8.1 3.5 4.7 7 4.7c2 0 3.6 1.1 5 2.9 1.4-1.8 3-2.9 5-2.9 3.5 0 5.6 3.4 4.4 6.6-1.8 4.7-9.4 9.2-9.4 9.2z';
const GOAL_ICON = {
  subs: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${TYPE_ICON.sub}"/></svg>`, // star
  kicks: KICK_K,
  followers: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${HEART}"/></svg>`, // heart
  bits: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${TYPE_ICON.bits}"/></svg>`, // gem
};
GOAL_ICON.twitchSubs = GOAL_ICON.subs; // Twitch's look like Kick's
GOAL_ICON.twitchFollowers = GOAL_ICON.followers;
const svgIn = (cls, markup) => {
  // fixed markup only
  const s = el('span', { className: cls });
  s.innerHTML = markup;
  return s;
};
// A Kick / Twitch channel goal's icon and bar colour (Home), by its type, never its title: the Jarchi goal of the same
// kind, so a Twitch followers goal looks exactly like Kick's (green heart). Cheerers are bits too.
const CHANNEL_GOAL = {
  followers: 'followers',
  subscriptions: 'subs',
  kicks: 'kicks',
  follow: 'followers',
  subscription: 'subs',
  subscription_count: 'subs',
  new_subscription: 'subs',
  new_subscription_count: 'subs',
  new_bit: 'bits',
  new_cheerer: 'bits',
};
const goalIcon = (id) => svgIn('goal-icon', GOAL_ICON[id] ?? ''); // a goal type that's new to Jarchi: none
