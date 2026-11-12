require('../core/secrets').guardConsole(); // before anything else: every log line from here on has its tokens blanked out
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { Server } = require('socket.io');
const { HOST, PORT } = require('../core/config');
const { connectedPlatforms } = require('../core/events');
const settings = require('../core/settings');
const net = require('../core/net'); // first: every outgoing connection after this goes through the proxy setting
const media = require('../core/media');
const goals = require('../core/goals');
const chat = require('../core/chat');
const twitchAccount = require('../connectors/twitch-account');
const kickAccount = require('../connectors/kick-account');
const stats = require('../core/stats');
require('../core/messages'); // before the first usage ping: it takes the team's messages from each ping's answer
const designs = require('../core/designs');
const pay = require('../core/pay');
const vpn = require('../core/vpn');
const release = require('../core/release');

const ROOT = path.join(__dirname, '..');
// A dev run (npm start, npm run app): never the installed app (electron/main.js says JARCHI_INSTALLED) or a packaged
// build (its code is in app.asar). Only then Settings shows its dev tools.
const DEV = process.env.JARCHI_INSTALLED !== '1' && !__dirname.includes('app.asar');
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// What the panel and widgets see: the settings plus which accounts are connected (widgets use it for the badge), and
// whether there's a change to undo (the panel's "Saved" note shows Undo).
const view = (s = settings.get()) => ({ ...s, connected: connectedPlatforms(), canUndo: settings.canUndo() });
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

// What the route files (routes/*.js) share, as ctx.
// The proxy setting changed: everything reconnects through it, and core/vpn.js starts over.
function reconnect() {
  net.resetPool(); // nothing goes on through the old setting
  chat.restart();
  twitchAccount.start();
  kickAccount.start();
  vpn.fine();
}
const fileName = (req) => {
  try {
    return decodeURIComponent(req.get('x-filename') || '');
  } catch {
    return '';
  }
};
const raw = express.raw({ type: () => true, limit: media.MAX_BYTES });
// A widget's file: the request's body, or (x-link header: "Paste a link") the file at that link, downloaded once. Either
// way at most 10 MB, and an image or GIF over 512 px is shrunk (core/media.js) before save(params, buf, name) keeps it.
const upload = (save) => [
  raw,
  async (req, res) => {
    const { buf, name } = req.get('x-link') ? await media.download(req.get('x-link')) : { buf: req.body, name: fileName(req) };
    res.json(changed(save(req.params, await media.shrink(buf), name)));
  },
];

const ctx = { io, view, changed, raw, upload, fileName, reconnect, DEV, ROOT };
// The same order as ever: every /api route, then what OBS loads (widgets.js ends with the panel's static files).
for (const routes of ['settings', 'home', 'alerts', 'net', 'chat', 'accounts', 'support', 'crypto', 'luck', 'goals', 'widgets'])
  require(`./routes/${routes}`)(app, ctx);

app.use((err, req, res, next) => {
  if (!err.status) console.error(err);
  const code = err.status === 413 ? 'too_large' : err.status ? err.code || 'bad_request' : 'server_error';
  res.status(err.status || 500).json({ error: code, ...(err.status && err.field && { field: err.field }) }); // field: core/pay.js
});

require('./sockets')(ctx);
// A Kick / Twitch account connected on the Connections page fills that platform's channel on the Chat page, only when
// it's empty there (a name typed there always stays), so its chat, alerts and the panel's background art start at once.
// For each new login, and at start (below) for the accounts connected before.
const accountLogin = { kick: kickAccount.status().login, twitch: twitchAccount.status().login };
function fillChannel(platform, login) {
  const key = `${platform}Channel`;
  if (!login || settings.get().chat[key]) return;
  try {
    changed(settings.update({ chat: { [key]: platform === 'kick' ? kickAccount.slug(login) : login } }, false)); // not a Ctrl+Z step
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
  vpn.status('twitch', st.state === 'connected', st.state === 'connecting');
});
kickAccount.events.on('status', (st) => {
  io.emit('kickAccount', st);
  accountChanged('kick', st);
  vpn.status('relay', st.state === 'connected', st.state === 'connecting'); // the Kick account's live events come through the relay
});

server.on('error', (/** @type {NodeJS.ErrnoException} */ err) => {
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
  stats.start().then(() => designs.sync()); // usage pings (with the team's messages), once the Privacy Policy is accepted; then the designs (the relay knows this install by its ping)
  pay.start(); // the crypto gateway's state (Jarchi Pay), the same
  if (DEV) release.start(); // a dev run doesn't update itself: it hears of new versions (core/release.js)
});
// The desktop app (electron/main.js) asks: 'quit' -> the last usage ping, then goodbye (`npm start` gets Ctrl+C);
// 'proxy' -> the proxy in use as a URL (or null), before each update check, so updates come the same way.
process.parentPort?.on('message', async (e) => {
  if (e.data === 'quit') {
    settings.forget(); // the files kept for undo go
    stats.ping(false).finally(() => process.parentPort.postMessage('bye'));
  }
  if (e.data === 'proxy') {
    const p = await net.current().catch(() => null);
    process.parentPort.postMessage({ proxy: p && `${p.type}://${p.host}:${p.port}` });
  }
});
process.once('SIGINT', () => (settings.forget(), stats.ping(false).finally(() => process.exit(130))));

module.exports = { app, server, io };
