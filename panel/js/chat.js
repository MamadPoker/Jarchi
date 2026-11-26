// One control of a Chat tab. Inputs carry data-f like the other editors, so fill() and the save handler just work.
function chatControl(kind, f, o) {
  const label = S.panel[o.label ?? f] ?? f;
  const input = (props) => {
    const i = el(props.tag ?? 'input', props.tag ? {} : props);
    i.dataset.f = f;
    return i;
  };
  let node;
  if (kind === 'toggle') {
    node = el(
      'label',
      { className: 'row between toggle-row' },
      el('span', { textContent: label }),
      el('span', { className: 'switch' }, input({ type: 'checkbox' }), el('span')),
    );
  } else if (kind === 'range') {
    const out = el('b');
    out.dataset.out = f;
    node = el(
      'label',
      { className: 'field' },
      el('span', {}, el('span', { textContent: label }), ' ', out),
      input({ type: 'range', min: o.min, max: o.max, step: o.step ?? 1 }),
    );
  } else if (kind === 'seg') {
    node = el(
      'div',
      { className: 'field' },
      el('span', { textContent: label }),
      el(
        'div',
        { className: 'seg' },
        ...o.options.map(([v, k]) => {
          const r = input({ type: 'radio', name: `chat-${f}`, value: v });
          return el('label', {}, r, el('span', { textContent: S.panel[k] ?? k }));
        }),
      ),
    );
  } else if (kind === 'select') {
    const sel = input({ tag: 'select' });
    sel.append(...o.options.map(([v, k]) => new Option(S.panel[k] ?? k, v)));
    node = el('label', { className: 'field' }, el('span', { textContent: label }), sel);
  } else if (kind === 'number') {
    // a smallest amount, under its line's switch
    node = el(
      'label',
      { className: 'row between toggle-row sub-row' },
      el('span', { textContent: label }),
      input({ type: 'number', min: 0, step: 1, className: 'num' }),
    );
  } else {
    node = el(
      'label',
      { className: 'field' },
      el('span', { textContent: label }),
      input({ type: kind === 'color' ? 'color' : 'text', maxLength: 1000, ...(o.dir && { dir: o.dir }) }),
      o.hint ? el('small', { textContent: S.panel[o.hint] }) : '',
    );
  }
  node.firstChild.dataset.help = `chat.${f}`; // the label: build() adds its "?"
  if (f in chatStyles.kick) node.firstChild.prepend(ownMark()); // saved for each style: a style from /api/chat/styles has just those
  if (o.only) node.dataset.only = o.only;
  return node;
}

// The gold palette before a Chat setting that's saved for each style (and in the note under the style grid).
function ownMark() {
  const m = svgIn(
    'own-mark',
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 0 0 0 18c1 0 1.7-.8 1.7-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.7-1.7 1.7-1.7h2a5.4 5.4 0 0 0 5.4-5.4C21 6.6 17 3 12 3z"/>' +
      '<circle cx="7.5" cy="10.5" r="1" fill="currentColor"/><circle cx="10" cy="6.8" r="1" fill="currentColor"/><circle cx="14.5" cy="6.8" r="1" fill="currentColor"/><circle cx="17" cy="10.2" r="1" fill="currentColor"/></svg>',
  );
  m.title = S.panel.ownMark;
  m.setAttribute('role', 'img');
  m.setAttribute('aria-label', S.panel.ownMark);
  return m;
}

// The Chat page's chats: Chat 1, and Chat 2 to 4 once "+" added them. The page is the selected one's (curChat): its
// settings, preview, tests, resets and OBS link. The channels are the same for all (Chat 1's), so are the messages.
const CHAT_KEYS = ['chat', 'chat2', 'chat3', 'chat4'];
let curChat = CHAT_KEYS.includes(remember.get('jarchi.chat')) ? remember.get('jarchi.chat') : 'chat';
const chatCfg = () => settings[curChat] ?? settings.chat;
const chats = () => CHAT_KEYS.filter((k) => settings[k]); // the ones there now
const chatDefaultName = (key) => tpl(S.panel.chatN, { n: fd(CHAT_KEYS.indexOf(key) + 1) });
const chatName = (key) => settings[key]?.name || chatDefaultName(key);
const chatUrl = (key) => `${location.origin}/widgets/chat${key === 'chat' ? '' : `/${key.slice(4)}`}`;

// The chats' tabs at the top of the Chat page (redrawn only when a chat or a name changes, so a tab keeps its focus),
// "+" until there are 4; every one but Chat 1 can be deleted.
let chatTabsDrawn = '';
function renderChatTabs() {
  const box = $('#chatTabs');
  if ($('.chat-rename', box)) return; // being renamed
  const keys = chats();
  const drawn = JSON.stringify(keys.map((k) => [k, chatName(k)]));
  if (drawn !== chatTabsDrawn) {
    chatTabsDrawn = drawn;
    box.replaceChildren(
      ...keys.map((k) =>
        el(
          'label',
          {},
          el('input', { type: 'radio', name: 'chatPick', value: k, onchange: () => select('chat', k) }),
          el('span', { textContent: chatName(k), dir: 'auto' }),
        ),
      ),
    );
  }
  $$('input', box).forEach((r) => (r.checked = r.value === curChat));
  $('#chatAdd').hidden = keys.length === CHAT_KEYS.length;
  $('#chatDelete').hidden = curChat === 'chat';
}
// The selected chat's name becomes a field in its tab: Enter or leaving it saves, Esc doesn't. Empty: its usual name.
function renameChat() {
  const input = el('input', { type: 'text', className: 'chat-rename', value: chatName(curChat), maxLength: 30, dir: 'auto' });
  input.setAttribute('aria-label', S.panel.chatRename);
  let done;
  const finish = (save) => {
    if (done) return;
    done = true;
    input.remove();
    chatTabsDrawn = '';
    renderChatTabs();
    const name = input.value.trim();
    if (save && name !== chatName(curChat)) patchChat({ name: name === chatDefaultName(curChat) ? '' : name });
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') finish(e.key === 'Enter');
  };
  input.onblur = () => finish(true);
  $(`#chatTabs input[value=${curChat}]`).parentElement.replaceWith(input);
  input.focus();
  input.select();
}

// Each style's own look with sample messages; filters off so the samples always show. Only the group on screen: a
// hidden thumbnail has no size to lay its messages out in (the other group is drawn when it's picked).
function drawChatThumbs() {
  if (!chatThumbs || view !== 'chat') return;
  for (const f of $$('.chat-tile:not([hidden]) iframe')) {
    const style = f.dataset.style;
    const ticker = chatStyles[style].layout === 'horizontal';
    const cfg = {
      ...chatCfg(),
      ...chatStyles[style],
      style,
      enabled: true,
      width: ticker ? 440 : 400,
      height: ticker ? 64 : 290,
      maxMessages: 6,
      hideCommands: false,
      hideBots: false,
      hiddenUsers: '',
      blockedWords: '',
      hideLinks: false,
      source: 'both',
      avatars: false,
      fxMention: false,
    };
    f.contentWindow?.postMessage({ strings: EN, cfg, messages: chatThumbs }, location.origin);
  }
}

// The style gallery's tiles: the exclusive designs this install unlocked first (their own names, an Exclusive badge),
// then Jarchi's styles. Built again when a design is unlocked (reloadChatStyles).
const styleName = (id) => S.chatStyles[id] ?? chatExclusive[id]?.[S.lang] ?? chatExclusive[id]?.en ?? id;
function buildChatTiles() {
  const grid = $('#chatStyleGrid');
  $$('.preview', grid).forEach((p) => fit.unobserve(p));
  grid.replaceChildren(
    ...[...Object.keys(chatExclusive), ...Object.keys(S.chatStyles)]
      .filter((id) => chatStyles[id])
      .map((id) => {
        const frame = el('iframe', { src: '/widgets/chat?thumb', title: styleName(id), tabIndex: -1, onload: drawChatThumbs });
        frame.dataset.style = id;
        frame.setAttribute('aria-hidden', 'true');
        const tile = el(
          'button',
          { className: `style-tile chat-tile${chatStyles[id].layout === 'horizontal' ? ' bar' : ''}`, onclick: () => patchChat({ style: id }) },
          el('div', { className: 'preview' }, frame),
          el(
            'span',
            { className: 'tile-name' },
            styleName(id),
            id in chatExclusive ? el('span', { className: 'pill exclusive', textContent: S.panel.chatExclusive }) : '',
          ),
        );
        tile.dataset.style = id;
        fit.observe(tile.querySelector('.preview'));
        return tile;
      }),
  );
}
async function reloadChatStyles() {
  try {
    ({ styles: chatStyles, fonts: chatFonts, exclusive: chatExclusive } = await api('GET', '/api/chat/styles'));
  } catch {
    return;
  }
  buildChatTiles();
  if (styleGroup) showStyleGroup(styleGroup);
  if (view === 'chat') {
    renderChat();
    drawChatThumbs();
  }
}

// The style gallery shows one group: vertical styles or bars (horizontal). Starts on the current style's group.
let styleGroup;
function showStyleGroup(g) {
  styleGroup = g;
  $$('[name=styleGroup]').forEach((r) => (r.checked = r.value === g));
  $$('.chat-tile').forEach((t) => (t.hidden = chatStyles[t.dataset.style].layout !== g));
  const grid = $('#chatStyleGrid'),
    current = $('.chat-tile.selected:not([hidden])', grid);
  grid.dataset.group = g;
  grid.scrollTop = current ? current.offsetTop - 8 : 0; // the chat's own style in view
  drawChatThumbs();
}

// The chat preview iframe is as big as the chat (+ a margin), scaled down to fit and centered.
function fitChat() {
  const box = $('.chat-preview'),
    f = $('#chatPreview'),
    c = chatCfg();
  const W = c.width + 60,
    H = c.height + 60;
  const k = Math.min(box.clientWidth / W, box.clientHeight / H, 1);
  Object.assign(f.style, {
    width: `${W}px`,
    height: `${H}px`,
    transform: `translate(${(box.clientWidth - W * k) / 2}px, ${(box.clientHeight - H * k) / 2}px) scale(${k})`,
  });
}

// Chat page status lines, and the top bar's Kick / Twitch pills (green dot = connected).
function renderStatus() {
  const names = { off: 'stOff', connecting: 'stConnecting', connected: 'stConnected', error: 'stError' };
  for (const p of ['kick', 'twitch']) {
    const st = chatStatus[p];
    const e = $(`#${p}Status`);
    e.className = `status st-${st.state}`;
    e.textContent = S.panel[names[st.state]] + (st.state === 'error' && st.detail ? ` · ${S.panel[`err_${st.detail}`] ?? st.detail}` : '');
    const pill = $(`.plat[data-p="${p}"]`);
    pill.classList.toggle('on', st.state === 'connected');
    pill.setAttribute('aria-label', (pill.title = `${S.platforms[p]}: ${e.textContent}`));
  }
  renderConnWarn();
}

// The top bar's warning: a Kick / Twitch connection that should be up (a channel set, an account connected) has been
// down for over 30 s, counted from when this panel saw it go (or opened). A click opens where it's set up. On Home,
// instead, a card once it's over a minute and for a reason a VPN can help with (not a channel that isn't there), with
// Fix it: the VPN popup (core/vpn.js look).
const DOWN_MS = 30000,
  CARD_MS = 60000,
  downSince = {};
const NOT_NETWORK = ['not_found', 'refused'];
const outOfReach = (st) => st.state === 'connecting' || (st.state === 'error' && !NOT_NETWORK.includes(st.detail));
const secs = new Intl.NumberFormat(FA ? 'fa' : 'en', { style: 'unit', unit: 'second', unitDisplay: 'short' });
const mins = new Intl.NumberFormat(FA ? 'fa' : 'en', { style: 'unit', unit: 'minute', unitDisplay: 'short' });
function renderConnWarn() {
  const now = Date.now(),
    long = [],
    card = [];
  const conns = [
    ['kickChat', 'kick', 'chat', !['off', 'connected'].includes(chatStatus.kick.state), outOfReach(chatStatus.kick)],
    ['twitchChat', 'twitch', 'chat', !['off', 'connected'].includes(chatStatus.twitch.state), outOfReach(chatStatus.twitch)],
    ['kickAccount', 'kick', 'connections', kick?.state === 'connecting', kick?.state === 'connecting'],
    ['twitchAccount', 'twitch', 'connections', twitch?.state === 'connecting', twitch?.state === 'connecting'],
  ];
  for (const [id, platform, page, down, net] of conns) {
    if (!down) delete downSince[id];
    else if (now - (downSince[id] ??= now) > DOWN_MS) long.push({ platform, page, since: downSince[id] });
    if (down && net && now - downSince[id] > CARD_MS) card.push({ platform, since: downSince[id] });
  }
  const said = (list, text) => {
    const s = Math.floor((now - Math.min(...list.map((c) => c.since))) / 1000);
    return tpl(text, {
      platforms: [...new Set(list.map((c) => S.platforms[c.platform]))].join(FA ? '، ' : ', '),
      time: s < 60 ? secs.format(s) : mins.format(Math.floor(s / 60)),
    });
  };
  $('#connCard').hidden = !card.length;
  if (card.length) $('#connCardTitle').textContent = said(card, S.panel.connCardTitle);
  const w = $('#connWarn');
  w.hidden = !long.length || help.state === 'broken' || (view === 'home' && card.length > 0); // the proxy's own warning says why; Home's card
  if (w.hidden) return;
  w.dataset.page = long[0].page;
  w.title = S.panel.connDownHint;
  $('span', w).textContent = said(long, S.panel.connDown);
}

// ---------- Live chat: the Chat page's Pop out (/?pop=livechat) ----------
// Kick and Twitch chat to read on a second monitor, not for OBS: every message as it comes, whatever a chat's filters
// hide in OBS, plainly (no design, nothing fades); test messages aren't chat. Newest at the bottom; scrolled up to read,
// it stays there until scrolled back down. Moderators' deletions go from it too.
const LC_KEEP = 500; // messages kept on screen
const lcRemote = (u) => (u?.startsWith('https://') ? `/remote?u=${encodeURIComponent(u)}` : u); // through Jarchi's proxy setting
let lcStick = true;
function lcRow(m) {
  const logo = el('img', {
    className: 'lc-logo',
    src: `/assets/platform-logos/${m.platform}.svg`,
    alt: S.platforms[m.platform],
    title: S.platforms[m.platform],
  });
  const name = el('bdi', { className: 'lc-name', textContent: m.user.name });
  if (m.user.color) name.style.setProperty('--uc', m.user.color);
  const said = m.parts.map((p) =>
    p.t === 'emote'
      ? el('img', { className: 'lc-emote', src: lcRemote(p.src), alt: p.name, title: p.name })
      : p.t === 'cheer'
        ? el('b', { className: 'lc-cheer' }, el('img', { src: `/assets/twitch-bits/${p.gem}.gif`, alt: '' }), fmt(p.amount))
        : p.v,
  );
  const text = m.parts.some((p) => p.t !== 'text' || p.v.trim()) && el('span', { className: 'lc-said', dir: 'auto' }, ...said);
  const li = el('li', { className: `lc-row ${m.platform}${m.action ? ' lc-action' : ''}` });
  Object.assign(li.dataset, { id: m.id, user: m.user.id, platform: m.platform });
  if (m.event) {
    // a sub, gift, Kicks, bits or raid: "<name> gifted 5 subs", and what they wrote under it
    li.classList.add('lc-event');
    li.append(el('div', {}, logo, name, ` ${did(m.event)}`), text || '');
    return li;
  }
  // What it answers, and Twitch's sub notice, above it (on the row's side; their words read their own way: <bdi>).
  if (m.reply)
    li.append(
      el(
        'div',
        { className: 'lc-reply' },
        '↩ ',
        el('bdi', { textContent: `@${m.reply.name}` }),
        m.reply.text ? ': ' : '',
        el('bdi', { textContent: m.reply.text }),
      ),
    );
  if (m.system) li.append(el('div', { className: 'lc-system' }, el('bdi', { textContent: m.system })));
  const badges = m.user.badges.filter((b) => b.img).map((b) => el('img', { className: 'lc-badge', src: lcRemote(b.img), alt: b.title, title: b.title }));
  li.append(logo, ...badges, name, text ? ': ' : '', text || '');
  return li;
}
function lcAdd(msgs) {
  const list = $('#lcList');
  list.append(...msgs.filter((m) => !m.test).map(lcRow));
  while (list.childElementCount > LC_KEEP) list.firstElementChild.remove();
  $('#lcEmpty').hidden = list.childElementCount > 0;
}
function wireChatPop(socket) {
  popOut('livechat', 'chatPopTitle', $('#chatPop'), $('#lcLang'), $('#lcTop'), 420);
  if (POP !== 'livechat') return;
  const page = document.scrollingElement;
  addEventListener('scroll', () => (lcStick = page.scrollHeight - page.scrollTop - page.clientHeight < 40), { passive: true });
  new ResizeObserver(() => lcStick && page.scrollTo(0, page.scrollHeight)).observe($('#lcList')); // new rows, pictures loading
  socket.on('chatHistory', (msgs) => {
    $('#lcList').replaceChildren(); // (again after a reconnect)
    lcAdd(msgs);
  });
  socket.on('chat', (m) => lcAdd([m]));
  // { platform, messageId }: one message; { platform, userId }: a ban or timeout; { platform }: the whole chat cleared.
  socket.on('chatClear', (c) =>
    $$('#lcList > li').forEach(
      (li) => li.dataset.platform === c.platform && (c.messageId ? li.dataset.id === c.messageId : !c.userId || li.dataset.user === c.userId) && li.remove(),
    ),
  );
}
