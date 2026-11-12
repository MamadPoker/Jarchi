// Socket.IO: which widget pages are open, what a panel / overlay / widget gets when it joins, and every change that
// goes out to them.
const path = require('node:path');
const { DATA_DIR } = require('../core/config');
const store = require('../core/store');
const { bus, TYPES } = require('../core/events');
const settings = require('../core/settings');
const goals = require('../core/goals');
const chat = require('../core/chat');
const alertQueue = require('../core/alerts');
const twitchAccount = require('../connectors/twitch-account');
const kickAccount = require('../connectors/kick-account');
const messages = require('../core/messages');
const designs = require('../core/designs');
const pay = require('../core/pay');
const viewers = require('../core/viewers');
const vpn = require('../core/vpn');
const release = require('../core/release');
const strings = require('../i18n/en.json');

module.exports = function sockets({ io, view, changed, DEV }) {
  // Widget pages open right now, in OBS or a browser (the panel's previews don't count): the Home page's green dots.
  const WIDGETS = ['alerts', 'chat', 'chat2', ...settings.GOAL_IDS, 'viewers-kick', 'viewers-twitch', 'viewers-total'];
  // seen: every widget link ever opened, kept (data/widgets.json): Home lists a Viewer count link only once it's in use.
  const open = Object.fromEntries(WIDGETS.map((w) => [w, 0]));
  const SEEN_FILE = path.join(DATA_DIR, 'widgets.json');
  const seen = new Set(store.load(SEEN_FILE).seen ?? []);
  function opened(socket, w) {
    open[w]++;
    if (!seen.has(w)) store.save(SEEN_FILE, { seen: [...seen.add(w)] });
    io.emit('widgets', open, [...seen]);
    socket.once('disconnect', () => {
      open[w]--;
      io.emit('widgets', open, [...seen]);
    });
  }

  io.on('connection', (socket) => {
    socket.emit('strings', strings);
    socket.emit('settings', view());
    socket.emit('goals', goals.all());
    socket.emit('chatStatus', chat.status());
    socket.emit('chatHistory', chat.recent());
    socket.emit('alertQueue', alertQueue.state());
    socket.emit('widgets', open, [...seen]);
    socket.emit('twitchAccount', twitchAccount.status());
    socket.emit('kickAccount', kickAccount.status());
    socket.emit('proxyHelp', vpn.state());
    socket.emit('obsSize', settings.obsSize()); // the panel's alert preview
    // The panel says it's the panel: only its sockets get the team's messages (never a widget in OBS).
    socket.once('panelJoin', () => {
      socket.join('panel');
      socket.emit('teamMessages', messages.list());
      socket.emit('crypto', pay.now());
    });
    if (DEV && release.latest()) socket.emit('devUpdate', release.latest()); // a newer Jarchi than this source copy (core/release.js)
    // The alerts overlay joins to get alerts from the queue (the panel's previews don't): the main link, or one type's own
    // (its lane in core/alerts). The Home page counts the main link.
    socket.once('alertsJoin', (only) => {
      const lane = TYPES.includes(only) ? only : 'all';
      socket.join(['alerts', `alerts:${lane}`]);
      alertQueue.join((now) => socket.emit('alert', now), lane);
      socket.once('disconnect', () => alertQueue.leave(lane));
      if (lane === 'all') opened(socket, 'alerts');
      socket.on('alertShown', (r) => alertQueue.shown(r, socket.conn.transport.name)); // alert timing line
      // In OBS: its Browser Source's size (on connect, and when it changes). A new one goes to the panel's preview.
      socket.on('obsSize', (s) => settings.setObsSize(s) && io.emit('obsSize', settings.obsSize()));
    });
    socket.once('widgetJoin', (w) => w !== 'alerts' && WIDGETS.includes(w) && opened(socket, w)); // a chat, a goal
    // A viewers page (OBS or the panel's preview): the counts are asked while one is open (core/viewers.js).
    socket.once('viewersJoin', () => {
      socket.join('viewers');
      socket.emit('viewers', viewers.state());
      viewers.watch(1);
      socket.once('disconnect', () => viewers.watch(-1));
    });

    // "Show chat timing": a chat widget says when it drew a live message; core/chat prints how long each step took.
    socket.on('chatShown', (r) => chat.timing(r, socket.conn.transport.name));
  });
  alertQueue.events.on('play', (a, lane) => io.to(`alerts:${lane}`).emit('alert', a));
  alertQueue.events.on('skip', (id) => io.to('alerts').emit('alertSkip', id));
  alertQueue.events.on('state', (st) => io.emit('alertQueue', st));
  // Every count change goes to widgets and the panel; the second argument names a goal that just hit its target.
  goals.events.on('change', (reached) => io.emit('goals', goals.all(), reached));
  goals.events.on('kick', (list) => io.emit('kickGoals', list)); // Home's Kick tab
  viewers.events.on('change', (st) => io.to('viewers').emit('viewers', st));
  bus.on('event', (ev) => io.emit('event', ev));
  bus.on('connections', () => changed());
  bus.on('chat', (m) => {
    m.sent = Date.now(); // for "Show chat timing" (the recent messages hold this same object)
    io.emit('chat', m);
  });
  bus.on('chatClear', (c) => io.emit('chatClear', c));
  bus.on('chatAvatar', (a) => io.emit('chatAvatar', a));
  // Kick / Twitch / the relay out of reach for 30 s: maybe the user's VPN app can help (core/vpn.js). Still connecting
  // counts, and so does Kick refusing this network (blocked) or a proxy that stopped answering; a channel that isn't there
  // or Kick's chat server refusing Jarchi's app key don't.
  const NOT_NETWORK = ['not_found', 'refused'];
  chat.events.on('status', (st) => {
    io.emit('chatStatus', st);
    for (const p of ['kick', 'twitch']) {
      const { state, detail } = st[p];
      vpn.status(p, state === 'connected', state === 'connecting' || (state === 'error' && !NOT_NETWORK.includes(detail)));
    }
  });
  vpn.events.on('state', (st) => io.emit('proxyHelp', st));
  messages.events.on('change', (list) => io.to('panel').emit('teamMessages', list));
  designs.events.on('change', () => io.to('panel').emit('chatStyles')); // a design unlocked or downloaded again: Chat styles asks again
  pay.events.on('state', (st) => io.to('panel').emit('crypto', st));
  release.events.on('found', (r) => io.emit('devUpdate', r));
};
