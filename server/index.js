const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { Server } = require('socket.io');
const { HOST, PORT, UPLOADS_DIR } = require('../core/config');
const { bus, emitEvent, connectedPlatforms, TYPES, PLATFORMS } = require('../core/events');
const settings = require('../core/settings');
const goals = require('../core/goals');
const chat = require('../core/chat');
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
app.patch('/api/settings', (req, res) => {
  const s = settings.update(req.body);
  for (const [id, fields] of Object.entries(req.body.goals ?? {})) if ('target' in fields) goals.retarget(id);
  if (req.body.chat) chat.sync(); // channel names or on/off may have changed
  res.json(changed(s));
});

app.post('/api/upload/:type/:kind', express.raw({ type: () => true, limit: '20mb' }), (req, res) => {
  let name = '';
  try { name = decodeURIComponent(req.get('x-filename') || ''); } catch {}
  res.json(changed(settings.saveUpload(req.params.type, req.params.kind, req.body, name)));
});
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

// Goals: counts (current / reached) live in core/goals; their look and target are regular settings.
app.get('/api/goals', (req, res) => res.json({ state: goals.all(), styles: settings.GOAL_STYLES, fonts: settings.FONTS }));
app.patch('/api/goals/:id', (req, res) => res.json(goals.change(req.params.id, req.body)));
app.post('/api/goals/:id/reset-style', (req, res) => res.json(changed(settings.resetGoalStyle(req.params.id))));
app.post('/api/goals/:id/sound', express.raw({ type: () => true, limit: '20mb' }), (req, res) => {
  let name = '';
  try { name = decodeURIComponent(req.get('x-filename') || ''); } catch {}
  res.json(changed(settings.saveGoalSound(req.params.id, req.body, name)));
});
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

app.use('/uploads', express.static(UPLOADS_DIR, { setHeaders: (res) => res.set('X-Content-Type-Options', 'nosniff') }));
// One goal page, two OBS URLs: /widgets/goal/subs and /widgets/goal/kicks.
app.get('/widgets/goal/:id{/}', (req, res, next) => {
  if (!settings.GOAL_IDS.includes(req.params.id)) return next();
  res.sendFile(path.join(ROOT, 'widgets', 'goal', 'index.html'));
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

io.on('connection', (socket) => {
  socket.emit('strings', strings);
  socket.emit('settings', view());
  socket.emit('goals', goals.all());
  socket.emit('chatStatus', chat.status());
  socket.emit('chatHistory', chat.recent());
});
// Every count change goes to widgets and the panel; the second argument names a goal that just hit its target.
goals.events.on('change', (reached) => io.emit('goals', goals.all(), reached));
bus.on('event', (ev) => io.emit('event', ev));
bus.on('connections', () => changed());
bus.on('chat', (m) => io.emit('chat', m));
bus.on('chatClear', (c) => io.emit('chatClear', c));
bus.on('chatAvatar', (a) => io.emit('chatAvatar', a));
chat.events.on('status', (st) => io.emit('chatStatus', st));

server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `Port ${PORT} is already in use. Set JARCHI_PORT in .env to another port.` : err);
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  console.log(`Jarchi is running
  Settings panel: http://${HOST}:${PORT}/
  OBS alerts URL: http://${HOST}:${PORT}/widgets/alerts`);
  chat.sync(); // connect to the saved Kick / Twitch channels
});

module.exports = { app, server, io };
