// ---------- Build once ----------
function build() {
  document.documentElement.lang = S.lang;
  document.documentElement.dir = S.dir;
  document.title = S.panel.title;

  // Sidebar: the pages.
  $$('.nav-item').forEach((b) => (b.onclick = () => select(b.dataset.view)));
  // Ctrl+T opens Support from any page (by the key's place, so a Persian keyboard works too); not while typing in a
  // field or with a popup open.
  addEventListener('keydown', (e) => {
    if (!e.ctrlKey || e.shiftKey || e.altKey || e.metaKey || e.code !== 'KeyT') return;
    if (e.target.closest?.('input, textarea, select, [contenteditable]') || $('dialog[open]')) return;
    e.preventDefault();
    select('support');
  });
  // Ctrl+Z undoes the last settings change (again: the one before), Ctrl+Y or Ctrl+Shift+Z redoes it; by the key's place
  // too. Not in a text field: there it's the field's own undo.
  addEventListener('keydown', (e) => {
    if (!e.ctrlKey || e.altKey || e.metaKey) return;
    const s = e.code === 'KeyZ' ? (e.shiftKey ? 'redo' : 'undo') : e.code === 'KeyY' && !e.shiftKey && 'redo';
    if (!s || e.target.closest?.('textarea, [contenteditable], input:not([type=checkbox], [type=radio], [type=range], [type=color], [type=file])')) return;
    e.preventDefault();
    undoRedo(s);
  });

  // Alerts and Goals pages: their list (a goal goes in its platform's group). An alert's row also gets a swatch that
  // render() shows when it has its own theme, and the logo of its platform when it's from one platform only.
  for (const [v, items] of Object.entries(LISTS())) {
    for (const it of items) {
      const sw = el('input', { type: 'checkbox', onchange: () => it.toggle(sw.checked) });
      sw.setAttribute('aria-label', v === 'goal' ? goalName(it.key) : it.label);
      const row = el(
        'li',
        { className: 'nav-row' },
        el(
          'button',
          { className: 'nav-btn', onclick: () => select(v, it.key) },
          v === 'goal' ? goalIcon(it.key) : typeIcon(it.key),
          el('span', { className: 'label', textContent: it.label }),
          ...(v === 'alert' ? [el('span', { className: 'swatch own', hidden: true }), platMarks(it.key)] : []),
        ),
        el('label', { className: 'switch' }, sw, el('span')),
      );
      row.dataset.key = it.key;
      if (v === 'goal') {
        row.dataset.goal = it.key; // its colour
        row.append(goalCountRow(it.key));
      }
      $(v === 'goal' ? `#goalList [data-platform=${goalPlatform(it.key)}]` : '#alertList').append(row);
    }
  }

  // Alerts page: the main theme (opens the theme page), with a swatch per theme (render() outlines the current one).
  $('#themeSwatches').append(
    ...Object.entries(S.themes).map(([id, name]) => {
      const sw = el('span', { className: `swatch sw-${id}`, title: name });
      sw.dataset.theme = id;
      return sw;
    }),
  );
  $('#themeRow').onclick = () => select('theme');
  $('#themeBack').onclick = () => select('alert');

  // Home: feed filters, View all (History, with the feed's filter), a test alert of any type, and the OBS links menu
  // (closes on a click elsewhere or Escape). History has the same filters.
  const filterChips = (box, pick) =>
    box.append(
      ...Object.keys(FEED_FILTERS).map((f) => {
        const b = el('button', { textContent: S.panel.feedFilters[f], onclick: () => pick(f) });
        b.dataset.filter = f;
        return b;
      }),
    );
  filterChips($('#feedChips'), (f) => {
    feedFilter = f;
    renderHome();
  });
  filterChips($('#histChips'), (f) => {
    hist.filter = f;
    hist.page = 0;
    renderHistory();
  });
  $('#feedAll').onclick = () => {
    hist.filter = feedFilter;
    hist.page = 0;
    select('events');
  };
  $('#homeTest').onclick = () => {
    const types = Object.keys(settings.alerts);
    api('POST', `/api/test/${types[Math.floor(Math.random() * types.length)]}`, { platform: $('#testAs').value }).then(
      () => toast(S.panel.testSent),
      (err) => toast(err.message, true),
    );
  };
  wireMenu($('#obsMenuBtn'), $('#obsMenu')); // its links: renderHome()
  $('#widgetsManage').onclick = () => select('goal'); // the Widgets card shows only what's on: switch goals on or off there
  setInterval(() => view === 'home' && loadHome(), 30000); // "2 min ago", uptime, and today's numbers from 0 after midnight

  $('#connWarn').onclick = (e) => select(e.currentTarget.dataset.page);
  $('#connFix').onclick = $('#kcFix button').onclick = $('#twFix button').onclick = lookForVpn;
  setInterval(renderConnWarn, 5000); // over 30 s now, and the time in it
  // Top bar: Kick / Twitch status opens Connections. Language (also on Appearance).
  $$('.plat').forEach((b) => (b.onclick = () => select('connections')));
  $$('.lang button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.lang === S.lang));
    b.onclick = () => setLang(b.dataset.lang);
  });
  $$('[name=lang]').forEach((r) => {
    r.checked = r.value === S.lang;
    r.onchange = () => setLang(r.value);
  });

  // Appearance: a card per color theme, with a mini panel in it, in that theme (applyLook()). Pointing at a card shows
  // the whole panel in its theme; only a click keeps it.
  $('#palettes').append(
    ...PALETTES.map((id) => {
      const mini = el('span', { className: 'mini' }, el('i'), el('i'), el('i'));
      mini.dataset.id = id;
      if (id === 'system')
        mini.insertAdjacentHTML(
          'beforeend',
          '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
        ); // a PC: Windows' color
      return el(
        'label',
        { className: 'mode-card', onmouseenter: () => show(id), onmouseleave: () => show(palette()) },
        el('input', { type: 'radio', name: 'palette', value: id, onchange: () => (setLook('jarchi.palette', id), toast(S.panel.saved)) }),
        el(
          'span',
          { className: 'mode-body' },
          mini,
          el('span', { textContent: S.panel.palettes[id] }),
          ...(id === 'system' ? [el('small', { textContent: S.panel.systemHint })] : []),
        ),
      );
    }),
  );
  applyLook();

  // Guide: one button per topic.
  $('#guideTopics').append(
    ...Object.entries(S.guide.topics).map(([id, t]) => {
      const b = el('button', {
        textContent: t.title,
        onclick: () => {
          topic = id;
          renderGuide();
          const top = $('#guideBody').getBoundingClientRect().top;
          if (top < 60) scrollBy(0, top - 80); // scrolled down a long topic: back to the new topic's start (below the top bar)
        },
      });
      b.dataset.topic = id;
      return b;
    }),
  );

  // Theme page: a card per theme. Hover (or focus) previews it muted; click selects it and plays it with sound.
  for (const [id, name] of Object.entries(S.themes)) {
    const frame = el('iframe', { src: '/widgets/alerts/?preview=tile', title: name, tabIndex: -1, onload: () => playTile(frame) });
    frame.dataset.theme = id;
    frame.setAttribute('aria-hidden', 'true');
    const tile = el(
      'button',
      {
        className: 'theme-tile',
        onclick: () => {
          send('PATCH', '/api/settings', { theme: id });
          playTile(frame, false);
        },
        onmouseenter: () => playTile(frame),
        onfocus: () => playTile(frame),
      },
      el('div', { className: 'preview' }, frame),
      el(
        'div',
        { className: 'tile-foot' },
        el('span', { className: `swatch sw-${id}` }),
        el('span', { className: 'tile-name', textContent: name }),
        el('span', { className: 'selected-label', textContent: S.panel.selected }),
      ),
    );
    tile.dataset.theme = id;
    $('#themeGrid').append(tile);
  }

  // Goal style picker: a live thumbnail per style; clicking one starts the goal from that style's look.
  for (const [id, name] of Object.entries(S.goalStyles)) {
    const frame = el('iframe', { src: '/widgets/goal/subs?thumb', title: name, tabIndex: -1, onload: drawThumbs });
    frame.dataset.style = id;
    frame.setAttribute('aria-hidden', 'true');
    const tile = el(
      'button',
      { className: 'style-tile goal-tile', onclick: () => patchGoal(curGoal, { style: id }) },
      el('div', { className: 'preview' }, frame),
      el('span', { className: 'tile-name', textContent: name }),
    );
    tile.dataset.style = id;
    $('#styleGrid').append(tile);
  }
  $$('.preview').forEach((p) => fit.observe(p));

  // Alerts page: the main OBS link (every alert), and the selected alert's own (only that one; core/alerts.js).
  const obsUrl = `${location.origin}/widgets/alerts`;
  $('#obsUrl').value = obsUrl;
  $('#copy').title = $('#copyType').title = S.panel.copyObsHint;
  $('#copy').onclick = () => copyLink(obsUrl);
  $('#copyType').onclick = () => copyLink(`${obsUrl}/${cur}`);

  // Alert editor: every [data-f] input saves its field for the selected alert by itself, one save (and one "Saved") per
  // change: a slider when it's let go, typed text a moment after the last key (for the alert it was typed in) or when
  // the field is left (its change event). A value that's already saved isn't sent again.
  const editor = $('main [data-view=alert]');
  let typing;
  const saveField = (inp, type = cur) => {
    clearTimeout(typing);
    if (valueOf(inp) !== settings.alerts[type][inp.dataset.f]) patchAlert(type, { [inp.dataset.f]: valueOf(inp) });
  };
  $$('[data-f]', editor).forEach((inp) => inp.addEventListener('change', () => saveField(inp)));
  $$('input[type=text][data-f]', editor).forEach((inp) =>
    inp.addEventListener('input', () => {
      const type = cur;
      clearTimeout(typing);
      typing = setTimeout(() => saveField(inp, type), 700);
    }),
  );
  wireTabs(editor, 'jarchi.alertTab'); // Media, Sound, Text, Style
  wireBg($('#previewBox'), 'previewBg', 'jarchi.previewBg');
  $$('input[type=range][data-f]', editor).forEach((inp) => inp.addEventListener('input', () => showRange(inp)));
  // Name and message colors: Theme (null) or Custom, which starts from the color input's value.
  for (const f of ['nameColor', 'textColor']) {
    $$(`[name=${f}Mode]`).forEach((r) => (r.onchange = () => patchAlert(cur, { [f]: r.value === 'custom' ? $(`[data-f=${f}]`, editor).value : null })));
  }
  $('#resetText').onclick = () => send('POST', `/api/alerts/${cur}/reset-text`);
  // Alert size (Style tab): this alert's size, given to every alert in one save.
  $('#sizeAll').onclick = () =>
    send('PATCH', '/api/settings', { alerts: Object.fromEntries(Object.keys(settings.alerts).map((t) => [t, { size: settings.alerts[cur].size }])) });
  // Font size: Auto (the biggest that fits) or Custom (the slider).
  $$('[name=alertSizeMode]').forEach((r) => (r.onchange = () => patchAlert(cur, { autoSize: r.value === 'auto' })));
  // Per-alert theme: "" = same as the main theme.
  $('#alertTheme').append(new Option('', ''), ...Object.entries(S.themes).map(([id, name]) => new Option(name, id)));
  $('#alertTheme').onchange = (e) => patchAlert(cur, { theme: e.target.value || null });
  $$('.file', editor).forEach((row) =>
    wireFile(
      row,
      () => `/api/upload/${cur}/${row.dataset.kind}`,
      () => `/api/upload/${cur}/${row.dataset.kind}`,
    ),
  );
  $('#play').onclick = () => preview();
  $('#previewAmount').onchange = () => preview();
  $('#test').onclick = () =>
    api('POST', `/api/test/${cur}`, { platform: $('#testAs').value, amount: previewAmount() }).then(
      () => toast(S.panel.testSent),
      (err) => toast(err.message, true),
    );
  $('#reset').onclick = () => send('POST', `/api/reset/${cur}`);
  $('#preview').onload = () => preview();

  // Goal editor: [data-f] inputs save the selected goal's settings; the count has its own buttons.
  const goalEd = $('main [data-view=goal]');
  $('#goalFont').append(...goalData.fonts.map((f) => new Option(f, f)));
  $$('[data-f]', goalEd).forEach((inp) => inp.addEventListener('change', () => patchGoal(curGoal, { [inp.dataset.f]: valueOf(inp) })));
  $$('input[type=range]', goalEd).forEach((inp) => inp.addEventListener('input', () => showRange(inp)));
  wireFile(
    $('.file', goalEd),
    () => `/api/goals/${curGoal}/sound`,
    () => `/api/goals/${curGoal}/sound`,
  );
  $('#goalTest').onclick = () => goalCount({ add: GOAL_STEP[curGoal] });
  $('#goalPlus').onclick = () => goalCount({ add: GOAL_STEP[curGoal] });
  $('#goalMinus').onclick = () => goalCount({ add: -GOAL_STEP[curGoal] });
  $('#goalCurrent').onchange = (e) => goalCount({ set: Math.max(0, Math.round(Number(e.target.value) || 0)) });
  twoClick($('#goalZero'), $('#goalZero'), S.panel.goalZero, S.panel.confirmZero, () => goalCount({ set: 0 }));
  $('#goalResetStyle').onclick = () => send('POST', `/api/goals/${curGoal}/reset-style`);
  $$('[name=goalSizeMode]').forEach((r) => (r.onchange = () => patchGoal(curGoal, { autoSize: r.value === 'auto' }))); // font size: Auto or Custom
  $('#kickSync').onchange = (e) => send('PATCH', '/api/settings', { kickGoalSync: e.target.checked });
  $$('.from-kick', goalEd).forEach((m) => (m.innerHTML = KICK_K)); // Target / Current: Kick's K (tooltip from data-title)
  $('#goalCopy').title = S.panel.goalCopyHint;
  $('#goalCopy').onclick = () => copyLink(`${location.origin}/widgets/goal/${curGoal}`, S.panel.goalCopied);
  // Counts and chat status change on their own (events, connections), so follow them live.
  const socket = io();
  socket.on('connect', () => window.obsstudio || socket.emit('panelJoin')); // the panel: the team's messages come to it (never in OBS)
  socket.on('chatStyles', reloadChatStyles); // an exclusive design unlocked or downloaded again (core/designs.js)
  socket.on('teamMessages', (list) => {
    teamMsgs = list;
    renderTeam();
    if (list.some((m) => m.style === 'design' && m.code)) eyesUi.show(); // a design code: the 👀 by itself
  });
  document.addEventListener('visibilitychange', renderTeam); // shown once the window is in front
  $('#teamMsg').addEventListener('close', () => {
    // OK, ✕ or Esc: this one closed for good, the ones after it for the next start
    const m = teamQueue[teamAt];
    if (m && m === codeMsg)
      teamSkip.add(m.id); // Use code: closed for good only once its code works
    else teamDone(m);
    teamQueue.slice(teamAt + 1).forEach((m) => teamSkip.add(m.id));
    renderTeam(); // any new one that came meanwhile
  });
  $$('dialog:not(#teamMsg)').forEach((x) => x.addEventListener('close', renderTeam)); // it waited for that one
  socket.on('goals', (state) => {
    goalData.state = state;
    render();
  });
  socket.on('settings', (s) => {
    // also changed by the server itself (a connected account fills its chat channel)
    settings = s;
    render();
  });
  socket.on('chatStatus', (st) => {
    chatStatus = st;
    renderStatus();
    if (view === 'home') renderHome();
  });
  socket.on('proxyHelp', (h) => {
    help = h;
    renderProxyHelp();
  });
  socket.on('devUpdate', (u) => {
    devUpdate = u;
    renderDevUpdate();
  });
  socket.on('obsSize', (s) => {
    sourceSize = s;
    fitPreview();
  });

  // Connections: the Twitch account. Connect opens Twitch's page in a new tab at once, like Kick's (its link has the code
  // in it: nothing to type; Open again, if the browser blocked it), until the streamer approves Jarchi there. Home's
  // Twitch tab shows the Twitch channel's goals.
  const twitchCall = (method, url, body) =>
    api(method, url, body).then(
      (t) => {
        twitch = t;
        render();
        return t;
      },
      (err) => toast(err.message, true),
    );
  $('#twConnect').onclick = () => twitchCall('POST', '/api/twitch/connect').then((t) => t?.uri && window.open(t.uri, '_blank', 'noopener'));
  $('#twDisconnect').onclick = () => twitchCall('POST', '/api/twitch/disconnect');
  $('#twOpen').onclick = () => window.open(twitch.uri, '_blank', 'noopener');
  $('#twitchGoalsConnect').onclick = $('#twitchSyncConnect').onclick = () => select('connections');
  $('#twitchSync').onchange = (e) => send('PATCH', '/api/settings', { twitchGoalSync: e.target.checked });
  showGoalTab = wireTabs($('#goalList'), 'jarchi.goalTab');
  wireTabs($('#homeGoalsBox'), 'jarchi.homeGoalTab');
  socket.on('twitchAccount', (t) => {
    twitch = t;
    render(); // the Connections card, the Goals page's Twitch tab, Home's Twitch tab
  });
  // Connections: the Kick account. Connect opens Kick's login page in a new tab (Open Kick, if the browser blocked it);
  // after the login that tab comes back to Connections, and this one follows by socket.
  const kickCall = (method, url) =>
    api(method, url).then(
      (k) => {
        kick = k;
        renderKick();
        return k;
      },
      (err) => toast(err.message, true),
    );
  $('#kcConnect').onclick = () => kickCall('POST', '/api/kick/connect').then((k) => k?.uri && window.open(k.uri, '_blank', 'noopener'));
  $('#kcDisconnect').onclick = () => kickCall('POST', '/api/kick/disconnect');
  $('#kcOpen').onclick = () => window.open(kick.uri, '_blank', 'noopener');
  socket.on('crypto', gotCrypto);
  socket.on('kickAccount', (k) => {
    kick = k;
    renderKick();
    renderProfile();
    if (view === 'viewers') renderViewers(); // its Kick link's hint
  });
  // Home: new events (also from the test buttons), today's chat count, widget pages opening and closing.
  socket.on('event', (ev) => {
    hist.list.unshift(ev);
    if (!ev.test) home.today.alerts++;
    if (view === 'home') renderHome();
    if (view === 'events') renderHistory();
  });
  socket.on('chat', (m) => {
    if (!m.test && m.kind !== 'event') $('#statChat').textContent = fmt(++home.today.chat);
  }); // Kicks / raid lines aren't messages
  socket.on('kickGoals', (list) => {
    home.kickGoals = list;
    if (view === 'home') renderHome();
  });
  socket.on('widgets', (o, s) => {
    open = o;
    seenWidgets = s ?? [];
    if (view === 'home') renderHome();
  });
  socket.on('alertQueue', (q) => {
    queue = q;
    renderQueue();
  });
  $('#qPause').onclick = () => queueCall('POST', 'pause', { paused: !queue.paused });
  $('#qSkip').onclick = () => queueCall('POST', 'skip');
  twoClick($('#qClear'), $('#qClear span'), S.panel.qClear, S.panel.qConfirmClear, () => queueCall('POST', 'clear').then((q) => q && toast(S.panel.qCleared)));

  // Chat page: the settings in their tabs, and the style gallery (a live thumbnail per style; a click starts the chat
  // from that style's look). Bars get wide, low thumbnails.
  const chatEd = $('main [data-view=chat]');
  for (const [tab, boxes] of Object.entries(CHAT_TABS())) {
    $(`#pane-c-${tab}`).append(
      ...boxes.map(([title, controls]) =>
        el('div', { className: 'box' }, el('h2', { textContent: S.panel[title] }), ...controls.map(([kind, f, o = {}]) => chatControl(kind, f, o))),
      ),
    );
  }
  wireTabs(chatEd, 'jarchi.chatTab');
  buildChatTiles();
  $$('[name=styleGroup]').forEach((r) => (r.onchange = () => showStyleGroup(r.value)));
  $$('[data-f]', chatEd).forEach((inp) =>
    inp.addEventListener('change', () =>
      patchChat({
        [inp.dataset.f]: inp.type === 'number' ? Math.max(0, Math.round(Number(inp.value) || 0)) : valueOf(inp), // amounts: whole numbers
      }),
    ),
  );
  $$('input[type=range]', chatEd).forEach((inp) => inp.addEventListener('input', () => showRange(inp)));
  $$('[data-placeholder]').forEach((e) => (e.placeholder = S.panel[e.dataset.placeholder]));
  wireBg($('#chatPreviewBox'), 'chatPreviewBg', 'jarchi.chatPreviewBg');
  $('#chatReplay').onclick = () => $('#chatPreview').contentWindow?.postMessage({ replay: true }, location.origin);
  // Test messages. Effects and special lines that are off still get their message (Kicks and raids: none), just
  // without that look: say which ones. A sub is a special line, or with those off the usual line with its glow.
  const OFF = {
    first: 'fxFirst',
    vip: 'fxRainbowVip',
    mention: 'fxMention',
    combo: 'fxCombo',
    avatar: 'avatars',
    kicks: 'eventKicks',
    gift: 'eventGifts',
    bits: 'eventBits',
    raid: 'eventRaids',
  };
  const sendTest = (kind) =>
    api('POST', '/api/chat/test', { kind, chat: curChat }).then(
      (r) => {
        const c = chatCfg();
        const off = [...r.effects, ...r.events].map((k) => (k === 'sub' ? !c.eventSubs && 'fxSubGlow' : OFF[k])).filter((f) => f && !c[f]);
        $('#chatFxHint').textContent = off.map((f) => S.panel.fxOff[f]).join(' · ');
        toast(S.panel.chatTestSent);
      },
      (err) => toast(err.message, true),
    );
  $('#chatTest').onclick = () => sendTest('sample');
  $('#chatBurst').onclick = () => sendTest('burst');
  $('#chatAllFx').onclick = () => sendTest('all');
  wireMenu($('#chatTestMore'), $('#chatTestMenu'));
  $('#chatResetStyle').onclick = () => send('POST', '/api/chat/reset-style', { chat: curChat });
  const [before, after] = S.panel.chatStyleHint.split('{mark}');
  $('#chatStyleHint').replaceChildren(before, ownMark(), after);
  $('#chatResetOwn').onclick = () => send('POST', '/api/chat/reset-style', { own: true, chat: curChat }); // the shared settings stay
  $('#chatUndo').onclick = () => undoRedo('undo');
  $('#chatCopy').title = S.panel.chatCopyHint;
  $('#chatCopy').onclick = () => copyLink(chatUrl(curChat), S.panel.chatCopied);
  // The chats' tabs: "+" adds Chat 2 (a copy of Chat 1) and opens it; rename; delete Chat 2 (click twice).
  $('#chatAdd').onclick = () => send('POST', '/api/chat/add').then(() => settings.chat2 && select('chat', 'chat2'));
  $('#chatRename').onclick = renameChat;
  twoClick($('#chatDelete'), $('#chatDelete span'), '', S.panel.chatDeleteConfirm, () => send('POST', '/api/chat/remove').then(() => select('chat', 'chat')));
  new ResizeObserver(() => {
    if (view === 'chat') fitChat();
  }).observe($('.chat-preview'));
  renderStatus();

  wireCss(
    $('#alertCss'),
    () => settings.alerts[cur],
    (f) => patchAlert(cur, f),
  );
  twoClick($('#cssAll'), $('#cssAll'), S.panel.cssApplyAll, S.panel.cssApplyAllConfirm, () => {
    const customCss = $('#alertCss textarea').value; // as typed, even if not saved yet
    send('PATCH', '/api/settings', { alerts: Object.fromEntries(ALERT_ORDER.map((t) => [t, { customCss }])) }); // one step: Undo brings every alert's back
  });
  wireCss(
    $('#goalCss'),
    () => settings.goals[curGoal],
    (f) => patchGoal(curGoal, f),
  );
  wireCss($('#chatCss'), chatCfg, patchChat);

  // Viewers page: [data-f] inputs save the widget's settings (Chart's minutes are numbers); the style picker (a live
  // thumbnail per style; a click starts from its look); the preview's link and Test (a made-up change of its number,
  // in the preview only); a row per OBS link, with Connect while its account isn't connected (renderViewers()).
  const viewersEd = $('main [data-view=viewers]');
  $('#viewersFont').append(...viewerData.fonts.map((f) => new Option(f, f)));
  $$('[data-f]', viewersEd).forEach((inp) =>
    inp.addEventListener('change', () => patchViewers({ [inp.dataset.f]: inp.dataset.f === 'chartMinutes' ? Number(inp.value) : valueOf(inp) })),
  );
  $$('input[type=range]', viewersEd).forEach((inp) => inp.addEventListener('input', () => showRange(inp)));
  for (const [id, name] of Object.entries(S.viewerStyles)) {
    const frame = el('iframe', { src: '/widgets/viewers/total?thumb', title: name, tabIndex: -1, onload: drawViewerThumbs });
    frame.dataset.style = id;
    frame.setAttribute('aria-hidden', 'true');
    const tile = el(
      'button',
      { className: 'style-tile viewers-tile', onclick: () => patchViewers({ style: id }) },
      el('div', { className: 'preview' }, frame),
      el('span', { className: 'tile-name', textContent: name }),
    );
    tile.dataset.style = id;
    $('#viewersStyleGrid').append(tile);
    fit.observe(tile.querySelector('.preview'));
  }
  $$('[name=viewersSource]').forEach((r) => {
    r.checked = r.value === viewerSource();
    r.onchange = () => (remember.set('jarchi.viewersSource', r.value), select('viewers'));
  });
  $('#viewersTest').onclick = () => $('#viewersPreview').contentWindow?.postMessage({ test: true }, location.origin);
  $('#viewersLinks').append(
    ...VIEWER_SOURCES.map((p) => {
      const logos = (p === 'total' ? ['kick', 'twitch'] : [p]).map((l) =>
        el('img', { className: 'plat-logo', src: `/assets/platform-logos/${l}.svg`, alt: '' }),
      );
      const copy = el(
        'button',
        { title: S.panel.viewersCopyHint, onclick: () => copyLink(`${location.origin}/widgets/viewers/${p}`, S.panel.viewersCopied) },
        el('span', { textContent: S.panel.copyObs }),
      );
      copy.insertAdjacentHTML('afterbegin', COPY_ICON);
      const connect = el('button', {
        className: 'ghost connect',
        textContent: S.panel[p === 'kick' ? 'kcConnect' : 'twConnect'],
        hidden: true,
        onclick: () => select('connections'),
      });
      const row = el(
        'li',
        {},
        el('span', { className: 'row' }, ...logos),
        el('span', { className: 'stack' }, el('b', { textContent: p === 'total' ? S.panel.viewersTotal : S.platforms[p] }), el('small')),
        connect,
        copy,
      );
      row.dataset.source = p;
      return row;
    }),
  );
  wireCss($('#viewersCss'), () => settings.viewers, patchViewers);

  // Settings
  $('#showBadge').onchange = (e) => send('PATCH', '/api/settings', { showBadge: e.target.checked });
  for (const [id, name] of Object.entries(S.platforms)) $('#testAs').append(new Option(name, id));
  const patchGlobal = (fields) => send('PATCH', '/api/settings', fields);
  $('#alertGap').onchange = (e) => patchGlobal({ alertGap: Number(e.target.value) });
  wireProxy();
  twoClick($('#resetAll'), $('#resetAll'), S.panel.resetAll, S.panel.confirmResetAll, () => send('POST', '/api/reset'));
  wireProfile();
  wireTour();
  wireUpdate();
  wireUninstall();
  wireDev();
  wireDevUpdate();
  wireSupport();
  wireCrypto();
  wireEyes();

  $$('[data-i18n]').forEach((e) => (e.textContent = S.panel[e.dataset.i18n]));
  const [madeA, madeB] = S.panel.madeWith.split('{heart}'); // About's "Made with ♥ by MamadPoker", the heart in gold
  $('#madeWith').append(madeA, el('span', { className: 'heart', textContent: '♥' }), madeB, ' ', el('b', { textContent: 'MamadPoker' }));
  $('#aboutPrivacy').onclick = () => showPrivacy();
  $$('input[name=privacyLang]').forEach((r) => (r.onchange = () => renderPrivacy(r.value)));
  $$('input[name=newsLang]').forEach((r) => (r.onchange = () => renderNews(r.value)));
  $('#privacyCheck').onchange = (e) => ($('#privacyOk').disabled = !e.target.checked);
  $$('[data-title]').forEach((e) => e.setAttribute('aria-label', (e.title = S.panel[e.dataset.title])));
  $$('[data-aria]').forEach((e) => e.setAttribute('aria-label', S.panel[e.dataset.aria]));
  $$('[data-help]').forEach(addHelp); // after data-i18n, which sets the labels' text
  $$('input[type=text]:not([dir]), input[type=number]:not([dir])').forEach((i) => (i.dir = 'ltr')); // links, {user}, names, numbers
  wireHelp();
}

// Custom CSS (an editor's Advanced box): saved half a second after the last key and when the box is left, so the
// preview and OBS follow the typing, each save a step Ctrl+Z can undo (inside the box, Ctrl+Z is the box's own); Clear
// empties it. cfg: the open alert's / goal's / chat's settings; patch saves fields to it. render() fills it in.
function wireCss(box, cfg, patch) {
  const area = $('textarea', box);
  let typing;
  const save = () => {
    clearTimeout(typing);
    if (area.value !== cfg().customCss) patch({ customCss: area.value });
  };
  area.oninput = () => {
    clearTimeout(typing);
    typing = setTimeout(save, 500);
  };
  area.onchange = save;
  $('.css-clear', box).onclick = () => {
    area.value = '';
    save();
  };
}

// Range sliders: filled track + value label (labels are per editor: both editors have e.g. "volume"). `f`: the field
// it shows, for a slider that isn't a [data-f] one.
function showRange(inp, f = inp.dataset.f) {
  inp.style.setProperty('--fill', `${((inp.value - inp.min) / (inp.max - inp.min)) * 100}%`);
  const out = $(`[data-out="${f}"]`, inp.closest('.view'));
  if (out) out.textContent = fd(FORMAT[f](inp.value));
}

// Put a config's values into an editor's [data-f] inputs.
function fill(root, cfg) {
  $$('[data-f]', root).forEach((inp) => {
    const val = cfg[inp.dataset.f];
    if (inp.type === 'checkbox') inp.checked = val;
    else if (inp.type === 'radio')
      inp.checked = inp.value === String(val); // a number too (Viewers' chart minutes)
    else if (inp.type === 'color') inp.value = val ?? '#ffffff';
    else if (inp !== document.activeElement || !['text', 'number'].includes(inp.type)) inp.value = val ?? ''; // never under the cursor
    if (inp.type === 'range') showRange(inp);
  });
}
