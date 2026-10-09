const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { Server } = require('socket.io');
const { HOST, PORT, UPLOADS_DIR } = require('../core/config');
const { bus, emitEvent, TYPES, PLATFORMS } = require('../core/events');
const settings = require('../core/settings');
const strings = require('../i18n/en.json');

const ROOT = path.join(__dirname, '..');
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Push every settings change to all open widgets.
const changed = (s) => (io.emit('settings', s), s);

// Only this PC's own panel may use the API: the Host check blocks DNS rebinding, and the custom header
// forces a CORS preflight (which we never answer), so other websites open in the browser can't call it.
app.use('/api', (req, res, next) => {
  const hostOk = [`127.0.0.1:${PORT}`, `localhost:${PORT}`].includes(req.headers.host);
  if (!hostOk || (req.method !== 'GET' && req.get('x-jarchi') !== '1')) return res.status(403).json({ error: 'forbidden' });
  next();
});
app.use(express.json());

app.get('/api/settings', (req, res) => res.json(settings.get()));
app.patch('/api/settings', (req, res) => res.json(changed(settings.update(req.body))));

app.post('/api/upload/:type/:kind', express.raw({ type: () => true, limit: '20mb' }), (req, res) => {
  let name = '';
  try { name = decodeURIComponent(req.get('x-filename') || ''); } catch {}
  res.json(changed(settings.saveUpload(req.params.type, req.params.kind, req.body, name)));
});
app.delete('/api/upload/:type/:kind', (req, res) => res.json(changed(settings.removeUpload(req.params.type, req.params.kind))));
app.post('/api/reset{/:type}', (req, res) => res.json(changed(settings.reset(req.params.type))));

const FAKE = {
  follow: {},
  sub: { months: 1 },
  resub: { months: 7, message: strings.test.message },
  gift_sub: { amount: 5 },
  kicks: { amount: 100, message: strings.test.message },
  bits: { amount: 500, message: strings.test.message },
  raid: { amount: 42 },
};
app.post('/api/test/:type', (req, res) => {
  const { type } = req.params;
  if (!TYPES.includes(type)) return res.status(400).json({ error: 'bad_request' });
  const platform = PLATFORMS.includes(req.body?.platform) ? req.body.platform : 'test';
  res.json(emitEvent({ platform, type, user: strings.test.user, ...FAKE[type], test: true }));
});

app.use('/uploads', express.static(UPLOADS_DIR, { setHeaders: (res) => res.set('X-Content-Type-Options', 'nosniff') }));
app.use('/widgets', express.static(path.join(ROOT, 'widgets'))); // every widgets/<name>/ folder is its own OBS URL
app.use('/i18n', express.static(path.join(ROOT, 'i18n')));
app.use('/', express.static(path.join(ROOT, 'panel')));

app.use((err, req, res, next) => {
  if (!err.status) console.error(err);
  const code = err.status === 413 ? 'too_large' : err.status ? err.code || 'bad_request' : 'server_error';
  res.status(err.status || 500).json({ error: code });
});

io.on('connection', (socket) => {
  socket.emit('strings', strings);
  socket.emit('settings', settings.get());
});
bus.on('event', (ev) => io.emit('event', ev));

server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `Port ${PORT} is already in use. Set JARCHI_PORT in .env to another port.` : err);
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  console.log(`Jarchi is running
  Settings panel: http://${HOST}:${PORT}/
  OBS alerts URL: http://${HOST}:${PORT}/widgets/alerts`);
});

module.exports = { app, server, io };
