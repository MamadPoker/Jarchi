// ---------- Sync UI from settings ----------
function render() {
  renderNew();
  for (const [list, all, selected] of [
    ['#alertList', settings.alerts, cur],
    ['#goalList', settings.goals, curGoal],
  ]) {
    $$(`${list} .nav-row`).forEach((row) => {
      const cfg = all[row.dataset.key];
      row.classList.toggle('active', row.dataset.key === selected);
      row.classList.toggle('off', !cfg.enabled);
      $('input', row).checked = cfg.enabled;
      const count = $('.count-input', row); // goals: the count (never under the cursor), Kick's / Twitch's when synced
      if (count) {
        const st = goalData.state[row.dataset.key];
        if (count !== document.activeElement) count.value = st.current;
        count.readOnly = st.kick || st.twitch;
        $('.of', row).textContent = `/ ${fmt(st.target)}`;
        $('.zero', row).hidden = st.kick || st.twitch;
      }
      const own = $('.swatch.own', row);
      if (!own) return;
      own.hidden = !cfg.theme;
      own.className = `swatch own sw-${cfg.theme}`;
      own.title = cfg.theme ? tpl(S.panel.themeOf, { name: S.themes[cfg.theme] }) : '';
    });
  }

  $('#chatUndo').hidden = !settings.canUndo;
  for (const [box, cfg] of [
    ['#alertCss', settings.alerts[cur]],
    ['#goalCss', settings.goals[curGoal]],
    ['#chatCss', chatCfg()],
    ['#viewersCss', settings.viewers],
  ]) {
    const area = $(`${box} textarea`);
    if (area !== document.activeElement) area.value = cfg.customCss; // never under the cursor
  }
  $('#themeSwatch').className = `swatch sw-${settings.theme}`;
  $('#themeName').textContent = S.themes[settings.theme];
  $$('#themeSwatches .swatch').forEach((s) => s.classList.toggle('current', s.dataset.theme === settings.theme));
  $$('.theme-tile').forEach((t) => {
    t.classList.toggle('selected', t.dataset.theme === settings.theme);
    t.setAttribute('aria-pressed', String(t.dataset.theme === settings.theme));
  });

  // Goals page: "Sync from Kick" / "Sync from Twitch", and which goals each channel has.
  const setOn = (key) =>
    Object.keys(settings.goals)
      .filter((id) => goalData.state[id][key])
      .map((id) => S.goals[id].name)
      .join(FA ? '، ' : ', ');
  $('#kickSync').checked = settings.kickGoalSync;
  $('#kickSyncHint').textContent = !settings.chat.kickChannel
    ? S.panel.kickSyncNoChannel
    : setOn('onKick')
      ? tpl(S.panel.kickSyncOnKick, { goals: setOn('onKick') })
      : S.panel.kickSyncNone;
  $('#twitchSync').checked = settings.twitchGoalSync;
  $('#twitchSyncHint').textContent =
    twitch.state !== 'connected'
      ? S.panel.twitchSyncNoAccount
      : setOn('onTwitch')
        ? tpl(S.panel.twitchSyncOnTwitch, { goals: setOn('onTwitch') })
        : S.panel.twitchGoalsNone;
  $('#twitchSyncConnect').hidden = twitch.state !== 'off';
  $('#twitchSyncRow').hidden = twitch.state === 'off'; // not connected: Connect instead of the switch

  renderTwitch();
  renderKick();
  renderProxy();
  renderProfile();
  artFaces();
  $('#showBadge').checked = settings.showBadge;
  if (view === 'settings') renderSettings();
  if (view === 'alert') renderAlert();
  if (view === 'goal') renderGoal();
  if (view === 'viewers') renderViewers();
  if (view === 'chat') renderChat();
  if (view === 'home') renderHome();
  if (view === 'events') renderHistory();
  if (view === 'donations' && cryptoTab === 'alerts') renderCryptoAlerts();
  renderSupport(); // also the sidebar's dot
}

function renderSettings() {
  if ($('#alertGap') !== document.activeElement) $('#alertGap').value = settings.alertGap; // never under the cursor
}

function renderChat() {
  const ed = $('main [data-view=chat]');
  if (!settings[curChat]) curChat = 'chat'; // Chat 2 deleted (here, in another window, or undone)
  const c = chatCfg();
  const src = `${chatUrl(curChat).slice(location.origin.length)}?preview`;
  if ($('#chatPreview').getAttribute('src') !== src) $('#chatPreview').src = src;
  renderChatTabs();
  fill(ed, c);
  $$('.chat-tile').forEach((t) => t.classList.toggle('selected', t.dataset.style === c.style));
  $('#chatResetOwn').textContent = tpl(S.panel.chatResetOwn, { style: styleName(c.style) });
  const show = {
    off: !c.enabled,
    badges: c.showBadges,
    big: c.bigEmotes,
    nameCustom: c.nameColorMode === 'custom',
    bgColor: c.bg === 'color',
    borderOn: c.border,
    msgBorder: c.border && (c.bubbles || c.bg === 'off'),
    typewriter: c.typewriter,
    ticker: c.layout === 'horizontal',
    vertical: c.layout === 'vertical',
    fade: c.fade,
    bots: c.hideBots,
    nameOwn: c.nameColorMode === 'user',
    hat: c.ogHat,
    evKicks: c.eventKicks,
    evGifts: c.eventGifts,
    evBits: c.eventBits,
  };
  $$('[data-only]', ed).forEach((e) => (e.hidden = !show[e.dataset.only]));
  ed.dataset.layout = c.layout; // a bar's preview spans the page (panel.css .chat-page)
  fitChat();
}

function renderAlert() {
  const editor = $('main [data-view=alert]');
  const cfg = settings.alerts[cur];
  editor.dataset.key = cur; // the type's colour
  $('.title path', editor).setAttribute('d', TYPE_ICON[cur]);
  $('.name', editor).textContent = S.types[cur];
  $('#copyType span').textContent = tpl(S.panel.copyAlertLink, { alert: S.types[cur] });
  fill(editor, cfg);
  for (const f of ['nameColor', 'textColor']) $$(`[name=${f}Mode]`).forEach((r) => (r.checked = (r.value === 'custom') === (cfg[f] !== null)));
  $$('[name=alertSizeMode]').forEach((r) => (r.checked = (r.value === 'auto') === cfg.autoSize));
  $('#alertTheme').options[0].textContent = S.panel.sameAsMain.replace('{theme}', S.themes[settings.theme]);
  $('#alertTheme').value = cfg.theme ?? '';
  $('#alertThemeSwatch').className = `swatch sw-${cfg.theme ?? settings.theme}`;

  const show = {
    off: !cfg.enabled,
    minAmount: 'minAmount' in cfg,
    video: isVideo(cfg.image?.file),
    customSound: cfg.soundMode === 'custom',
    customFrame: cfg.frame === 'custom',
    customColor: cfg.textColor !== null,
    customName: cfg.nameColor !== null,
    customSize: !cfg.autoSize,
    amount: samples[cur].amount > 0,
    tiers: 'tiersOn' in cfg,
    tiersOn: cfg.tiersOn,
    look: 'look' in cfg,
    kickLook: kickLook(cur, cfg),
    themed: !kickLook(cur, cfg),
  };
  $$('[data-only]', editor).forEach((e) => (e.hidden = !show[e.dataset.only]));
  if (show.tiers) renderTiers(cfg);
  $('[name=soundMode][value=theme] + span', editor).textContent = S.panel[show.kickLook ? 'soundKick' : 'soundTheme']; // in the Kick look, the default sound is the Kick chime
  $$('.file', editor).forEach((row) => {
    const f = cfg[row.dataset.kind];
    const fname = $('.fname', row);
    fname.textContent = f
      ? f.name
      : row.dataset.kind === 'image'
        ? defaultMedia('image', kickLook(cur, cfg))
        : S.panel[kickLook(cur, cfg) ? 'soundNoFileKick' : 'soundNoFile'];
    fname.classList.toggle('default', !f);
    $('.remove', row).hidden = !f;
  });
}

// A card's "why it can't connect" (the account's why) with Fix it (the VPN help): only for network trouble or Kick refusing
// this network, not a refused login or an ended one.
function renderAccFix(box, a) {
  const show = !!a.why && ['network', 'blocked'].includes(a.error);
  box.hidden = !show;
  if (show) $('code', box).textContent = a.why;
}
// The Connections page's Twitch card.
function renderTwitch() {
  const t = twitch,
    on = t.state !== 'off';
  const line = $('#twState');
  line.className = `status st-${!on ? (t.error ? 'error' : 'off') : t.state === 'connected' ? 'connected' : 'connecting'}`;
  line.textContent = [tpl(S.panel.twStates[t.state], { login: t.login }), t.error && S.panel.twErrors[t.error]].filter(Boolean).join(' · ');
  $('#twConnect').hidden = on;
  $('#twDisconnect').hidden = !on;
  $('#twDisconnect').textContent = S.panel[t.state === 'waiting' ? 'twCancel' : 'twDisconnect'];
  $('#twWait').hidden = t.state !== 'waiting';
  renderAccFix($('#twFix'), t);
  renderConnWarn();
}

// The Connections page's Kick card.
function renderKick() {
  const k = kick,
    on = k.state !== 'off';
  const line = $('#kcState');
  line.className = `status st-${!on ? (k.error ? 'error' : 'off') : k.state === 'connected' ? 'connected' : 'connecting'}`;
  line.textContent = [tpl(S.panel.kcStates[k.state], { login: k.login }), k.error && S.panel.kcErrors[k.error]].filter(Boolean).join(' · ');
  $('#kcConnect').hidden = on;
  $('#kcDisconnect').hidden = !on;
  $('#kcDisconnect').textContent = S.panel[k.state === 'waiting' ? 'twCancel' : 'twDisconnect'];
  $('#kcWait').hidden = k.state !== 'waiting';
  renderAccFix($('#kcFix'), k);
  renderConnWarn();
}
