const path = require('node:path');
const http = require('node:http');
const { execFile } = require('node:child_process');
const express = require('express');
const { Server } = require('socket.io');
const { HOST, PORT, UPLOADS_DIR } = require('../core/config');
const { bus, emitEvent, connectedPlatforms, today, TYPES, PLATFORMS } = require('../core/events');
const settings = require('../core/settings');
const net = require('../core/net'); // first: every outgoing connection after this goes through the proxy setting
const media = require('../core/media');
const goals = require('../core/goals');
const chat = require('../core/chat');
const alertQueue = require('../core/alerts');
const twitchAccount = require('../connectors/twitch-account');
const kickAccount = require('../connectors/kick-account');
const stats = require('../core/stats');
const strings = require('../i18n/en.json');

const ROOT = path.join(__dirname, '..');
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// What the panel and widgets see: the settings plus which accounts are connected (widgets use it for the badge).
const view = (s = settings.get()) => ({ ...s, connected: connectedPlatforms() });
// Push every settings change to all open widgets.
const changed = (s) => {
  const v = view(s);
  io.emit('settings', v);
  return v;
};

// Only this PC's own panel may use the API: the Host check blocks DNS rebinding, and the custom header
// forces a CORS preflight (which we never answer), so other websites open in the browser can't call it.
app.use('/api', (req, res, next) => {
  const hostOk = [`127.0.0.1:${PORT}`, `localhost:${PORT}`].includes(req.headers.host);
  if (!hostOk || (req.method !== 'GET' && req.get('x-jarchi') !== '1')) return res.status(403).json({ error: 'forbidden' });
  next();
});
app.use(express.json());

app.get('/api/settings', (req, res) => res.json(view()));
// The panel's System colors: Windows' accent color from the registry (0xAABBGGRR), null when it can't be read (or not on
// Windows): the panel shows Jarchi's colors then.
app.get('/api/accent', (req, res) => execFile('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\DWM', '/v', 'AccentColor'], { windowsHide: true, timeout: 3000 }, (err, out) => {
  const abgr = !err && /AccentColor\s+REG_DWORD\s+0x([0-9a-f]{1,8})\b/i.exec(out)?.[1];
  const n = abgr && parseInt(abgr, 16);
  res.json({ accent: abgr ? `#${[n & 255, (n >>> 8) & 255, (n >>> 16) & 255].map((c) => c.toString(16).padStart(2, '0')).join('')}` : null });
}));
app.patch('/api/settings', (req, res) => {
  const s = settings.update(req.body);
  if ('privacyAccepted' in req.body) stats.ping(); // the Privacy Policy accepted just now: the first usage ping
  for (const [id, fields] of Object.entries(req.body.goals ?? {})) if ('target' in fields) goals.retarget(id);
  // Widgets switch between Kick's / Twitch's numbers and their own.
  if ('kickGoalSync' in req.body || 'twitchGoalSync' in req.body) goals.refresh();
  if (Object.keys(req.body).some((k) => k.startsWith('proxy'))) { // reconnect through the new proxy
    chat.restart();
    twitchAccount.start();
    kickAccount.start();
  } else if (req.body.chat) chat.sync(); // channel names may have changed
  res.json(changed(s));
});

const fileName = (req) => {
  try { return decodeURIComponent(req.get('x-filename') || ''); } catch { return ''; }
};
const raw = express.raw({ type: () => true, limit: media.MAX_BYTES });
app.post('/api/profile/picture', raw, (req, res) => res.json(changed(settings.saveProfilePicture(req.body, fileName(req)))));
// A widget's file: the request's body, or (x-link header: "Paste a link") the file at that link, downloaded once. Either
// way at most 10 MB, and an image or GIF over 512 px is shrunk (core/media.js) before save(params, buf, name) keeps it.
const upload = (save) => [raw, async (req, res) => {
  const { buf, name } = req.get('x-link') ? await media.download(req.get('x-link')) : { buf: req.body, name: fileName(req) };
  res.json(changed(save(req.params, await media.shrink(buf), name)));
}];
app.post('/api/upload/:type/:kind', ...upload((p, buf, name) => settings.saveUpload(p.type, p.kind, buf, name)));

// Media by amount: the fixed tiers of one alert type, by amount. { on } switches one; :kind is image | sound.
app.patch('/api/tiers/:type/:amount', (req, res) => res.json(changed(settings.setTier(req.params.type, Number(req.params.amount), req.body))));
app.post('/api/tiers/:type/:amount/:kind', ...upload((p, buf, name) => settings.saveTierFile(p.type, Number(p.amount), p.kind, buf, name)));
app.delete('/api/tiers/:type/:amount/:kind', (req, res) => res.json(changed(settings.removeTierFile(req.params.type, Number(req.params.amount), req.params.kind))));

// Alert queue (core/alerts): what's playing, how many wait, and the panel's controls.
app.get('/api/alerts/queue', (req, res) => res.json(alertQueue.state()));
app.post('/api/alerts/skip', (req, res) => res.json(alertQueue.skip()));
app.post('/api/alerts/clear', (req, res) => res.json(alertQueue.clear()));
app.post('/api/alerts/pause', (req, res) => res.json(alertQueue.pause(req.body?.paused === true)));
app.delete('/api/alerts/queue/:id', (req, res) => res.json(alertQueue.remove(req.params.id)));
app.post('/api/alerts/replay/:id', (req, res) => res.json(alertQueue.replay(req.params.id)));
app.post('/api/alerts/:type/reset-text', (req, res) => res.json(changed(settings.resetAlertText(req.params.type))));

// The panel's Home page: today's numbers, when Jarchi started (uptime) and the Kick channel's goals. Open widgets and
// goal changes come by socket (Twitch's goals with the Twitch account's status). History: every saved event (Home's live
// feed and the History feed page; new ones come by socket).
const STARTED = Date.now();
app.get('/api/home', (req, res) => res.json({ today: today(), started: STARTED, kickGoals: goals.kickList() }));
app.get('/api/history', (req, res) => res.json(alertQueue.feed()));
app.get('/api/version', (req, res) => res.json({ version: require('../package.json').version })); // About

// Proxy: "Test connection" (Kick, Twitch, 7TV), and which proxy is in use right now.
app.post('/api/net/test', async (req, res) => res.json(await chat.check()));
app.get('/api/net/proxy', async (req, res) => res.json({ mode: settings.get().proxyMode, proxy: await net.current() }));
app.delete('/api/upload/:type/:kind', (req, res) => res.json(changed(settings.removeUpload(req.params.type, req.params.kind))));
app.post('/api/reset{/:type}', (req, res) => {
  const s = settings.reset(req.params.type);
  if (!req.params.type) {
    settings.GOAL_IDS.forEach(goals.retarget); // targets went back to their defaults
    chat.sync(); // channels were cleared
  }
  res.json(changed(s));
});

// Chat: connectors run in core/chat; the look is a regular setting.
app.get('/api/chat/status', (req, res) => res.json(chat.status()));
app.get('/api/chat/styles', (req, res) => res.json({ styles: settings.CHAT_STYLES, fonts: settings.CHAT_FONTS }));
app.post('/api/chat/test', (req, res) => res.json(chat.test(['burst', 'all'].includes(req.body?.kind) ? req.body.kind : 'sample')));
app.get('/api/chat/thumbs', (req, res) => res.json(chat.thumbs()));
app.post('/api/chat/reset-style', (req, res) => res.json(changed(settings.resetChatStyle())));
// The streamer's profile pictures for the panel's background art: { kick, twitch }, null where no channel / picture.
app.get('/api/streamer', async (req, res) => res.json(await chat.streamer()));

// The Twitch account (Connections page): the login with Twitch's code, Disconnect. Its status (also the Twitch channel's
// goals) comes by socket too.
app.get('/api/twitch', (req, res) => res.json(twitchAccount.status()));
app.post('/api/twitch/connect', async (req, res) => res.json(await twitchAccount.login()));
app.post('/api/twitch/disconnect', async (req, res) => res.json(await twitchAccount.disconnect()));

// The Kick account (Connections page): Connect gives Kick's login page (through Jarchi's Kick relay), which comes back
// to /api/kick/callback in the browser, and that opens Connections again. Its status comes by socket too.
app.get('/api/kick', (req, res) => res.json(kickAccount.status()));
app.post('/api/kick/connect', async (req, res) => res.json(await kickAccount.login()));
app.post('/api/kick/disconnect', async (req, res) => res.json(await kickAccount.disconnect()));
app.get('/api/kick/callback', async (req, res) => {
  await kickAccount.callback(req.query);
  res.redirect('/#connections');
});

// Goals: counts (current / reached) live in core/goals; their look and target are regular settings.
app.get('/api/goals', (req, res) => res.json({ state: goals.all(), styles: settings.GOAL_STYLES, fonts: settings.FONTS }));
app.patch('/api/goals/:id', (req, res) => res.json(goals.change(req.params.id, req.body)));
app.post('/api/goals/:id/reset-style', (req, res) => res.json(changed(settings.resetGoalStyle(req.params.id))));
app.post('/api/goals/:id/sound', ...upload((p, buf, name) => settings.saveGoalSound(p.id, buf, name)));
app.delete('/api/goals/:id/sound', (req, res) => res.json(changed(settings.removeGoalSound(req.params.id))));

// Sample events for the Test button and the panel's live preview.
const FAKE = {
  follow: {},
  sub: { months: 1 },
  resub: { months: 7, message: strings.test.message },
  gift_sub: { amount: 5 },
  kicks: { amount: 100, message: strings.test.message },
  bits: { amount: 500, message: strings.test.message },
  raid: { amount: 42 },
};
const SAMPLES = Object.fromEntries(TYPES.map((t) => [t, { user: strings.test.user, amount: 0, months: 0, message: '', ...FAKE[t] }]));
app.get('/api/samples', (req, res) => res.json(SAMPLES));

app.post('/api/test/:type', (req, res) => {
  const { type } = req.params;
  if (!TYPES.includes(type)) return res.status(400).json({ error: 'bad_request' });
  const platform = PLATFORMS.includes(req.body?.platform) ? req.body.platform : 'test';
  const amount = Number.isFinite(req.body?.amount) && req.body.amount >= 0 ? req.body.amount : SAMPLES[type].amount;
  res.json(emitEvent({ ...SAMPLES[type], amount, platform, type, test: true }));
});

// Emotes, badges and profile pictures for widgets, fetched here so they go through the proxy setting too.
// Only images (by their real bytes: Kick's CDN says "binary/octet-stream"), only from the platforms' own sites.
const REMOTE_HOSTS = /(^|\.)(kick\.com|jtvnw\.net|7tv\.app|7tv\.io)$/;
const IMAGE = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
app.get('/remote', async (req, res) => {
  let url;
  try { url = new URL(String(req.query.u)); } catch {}
  if (url?.protocol !== 'https:' || !REMOTE_HOSTS.test(url.hostname)) return res.status(400).end();
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 Jarchi' }, signal: AbortSignal.timeout(15000) });
    const body = Buffer.from(await r.arrayBuffer());
    const type = IMAGE[settings.sniff(body)];
    if (!r.ok || !type) return res.status(502).end();
    res.set({ 'content-type': type, 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff' }).send(body);
  } catch {
    res.status(502).end();
  }
});

app.use('/uploads', express.static(UPLOADS_DIR, { setHeaders: (res) => res.set('X-Content-Type-Options', 'nosniff') }));
// One goal page, an OBS URL per goal: Kick's /widgets/goal/subs, /kicks, /followers; Twitch's /twitchSubs, /bits, /twitchFollowers.
app.get('/widgets/goal/:id{/}', (req, res, next) => {
  if (!settings.GOAL_IDS.includes(req.params.id)) return next();
  res.sendFile(path.join(ROOT, 'widgets', 'goal', 'index.html'));
});
// One alerts page, an OBS URL per alert type too: /widgets/alerts/sub plays only subs.
app.get('/widgets/alerts/:type{/}', (req, res, next) => {
  if (!TYPES.includes(req.params.type)) return next();
  res.sendFile(path.join(ROOT, 'widgets', 'alerts', 'index.html'));
});
app.use('/widgets', express.static(path.join(ROOT, 'widgets'))); // every widgets/<name>/ folder is its own OBS URL
app.use('/i18n', express.static(path.join(ROOT, 'i18n')));
app.use('/assets', express.static(path.join(ROOT, 'assets'))); // official platform logos
app.use('/', express.static(path.join(ROOT, 'panel')));

app.use((err, req, res, next) => {
  if (!err.status) console.error(err);
  const code = err.status === 413 ? 'too_large' : err.status ? err.code || 'bad_request' : 'server_error';
  res.status(err.status || 500).json({ error: code });
});

// Widget pages open right now, in OBS or a browser (the panel's previews don't count): the Home page's green dots.
const WIDGETS = ['alerts', 'chat', ...settings.GOAL_IDS];
const open = Object.fromEntries(WIDGETS.map((w) => [w, 0]));
function opened(socket, w) {
  open[w]++;
  io.emit('widgets', open);
  socket.once('disconnect', () => {
    open[w]--;
    io.emit('widgets', open);
  });
}

io.on('connection', (socket) => {
  socket.emit('strings', strings);
  socket.emit('settings', view());
  socket.emit('goals', goals.all());
  socket.emit('chatStatus', chat.status());
  socket.emit('chatHistory', chat.recent());
  socket.emit('alertQueue', alertQueue.state());
  socket.emit('widgets', open);
  socket.emit('twitchAccount', twitchAccount.status());
  socket.emit('kickAccount', kickAccount.status());
  // The alerts overlay joins to get alerts from the queue (the panel's previews don't): the main link, or one type's own
  // (its lane in core/alerts). The Home page counts the main link.
  socket.once('alertsJoin', (only) => {
    const lane = TYPES.includes(only) ? only : 'all';
    socket.join(['alerts', `alerts:${lane}`]);
    alertQueue.join((now) => socket.emit('alert', now), lane);
    socket.once('disconnect', () => alertQueue.leave(lane));
    if (lane === 'all') opened(socket, 'alerts');
    socket.on('alertShown', (r) => alertQueue.shown(r, socket.conn.transport.name)); // alert timing line
  });
  socket.once('widgetJoin', (w) => w !== 'alerts' && WIDGETS.includes(w) && opened(socket, w)); // chat, a goal

  // "Show chat timing": a chat widget says when it drew a live message; core/chat prints how long each step took.
  socket.on('chatShown', (r) => chat.timing(r, socket.conn.transport.name));
});
alertQueue.events.on('play', (a, lane) => io.to(`alerts:${lane}`).emit('alert', a));
alertQueue.events.on('skip', (id) => io.to('alerts').emit('alertSkip', id));
alertQueue.events.on('state', (st) => io.emit('alertQueue', st));
// Every count change goes to widgets and the panel; the second argument names a goal that just hit its target.
goals.events.on('change', (reached) => io.emit('goals', goals.all(), reached));
goals.events.on('kick', (list) => io.emit('kickGoals', list)); // Home's Kick tab
bus.on('event', (ev) => io.emit('event', ev));
bus.on('connections', () => changed());
bus.on('chat', (m) => {
  m.sent = Date.now(); // for "Show chat timing" (the recent messages hold this same object)
  io.emit('chat', m);
});
bus.on('chatClear', (c) => io.emit('chatClear', c));
bus.on('chatAvatar', (a) => io.emit('chatAvatar', a));
chat.events.on('status', (st) => io.emit('chatStatus', st));
// A Kick / Twitch account connected on the Connections page fills that platform's channel on the Chat page, only when
// it's empty there (a name typed there always stays), so its chat, alerts and the panel's background art start at once.
// For each new login, and at start (below) for the accounts connected before.
const accountLogin = { kick: kickAccount.status().login, twitch: twitchAccount.status().login };
function fillChannel(platform, login) {
  const key = `${platform}Channel`;
  if (!login || settings.get().chat[key]) return;
  try {
    changed(settings.update({ chat: { [key]: platform === 'kick' ? kickAccount.slug(login) : login } }));
  } catch {
    return; // a name the channel rules don't take: left empty
  }
  chat.sync();
}
const accountChanged = (platform, st) => {
  if (st.login !== accountLogin[platform]) fillChannel(platform, st.login);
  accountLogin[platform] = st.login;
};
twitchAccount.events.on('status', (st) => {
  io.emit('twitchAccount', st);
  goals.twitchGoals(st.goals); // "Sync from Twitch"
  accountChanged('twitch', st);
});
kickAccount.events.on('status', (st) => {
  io.emit('kickAccount', st);
  accountChanged('kick', st);
});

server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `Port ${PORT} is already in use. Set JARCHI_PORT in .env to another port.` : err);
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  console.log(`Jarchi is running
  Settings panel: http://${HOST}:${PORT}/
  OBS alerts URL: http://${HOST}:${PORT}/widgets/alerts`);
  process.parentPort?.postMessage('listening'); // the desktop app (electron/main.js) opens its window now
  fillChannel('kick', accountLogin.kick); // a channel from each account connected before, where the Chat page has none
  fillChannel('twitch', accountLogin.twitch);
  chat.sync(); // connect to the saved Kick / Twitch channels
  twitchAccount.start(); // and the Twitch and Kick accounts, when they're connected
  kickAccount.start();
  media.shrinkOld().catch(console.error); // uploads from before the 512 px rule, once
  stats.start(); // usage pings, once the Privacy Policy is accepted
});
// Quitting: the last usage ping, then goodbye. The desktop app asks first (electron/main.js); `npm start` gets Ctrl+C.
process.parentPort?.on('message', (e) => e.data === 'quit' && stats.ping(false).finally(() => process.parentPort.postMessage('bye')));
process.once('SIGINT', () => stats.ping(false).finally(() => process.exit(130)));

module.exports = { app, server, io };
