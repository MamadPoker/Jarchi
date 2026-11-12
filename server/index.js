require('../core/secrets').guardConsole(); // before anything else: every log line from here on has its tokens blanked out
const path = require('node:path');
const http = require('node:http');
const { execFile } = require('node:child_process');
const express = require('express');
const { Server } = require('socket.io');
const { HOST, PORT, UPLOADS_DIR, DATA_DIR } = require('../core/config');
const store = require('../core/store');
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
const support = require('../core/support');
const messages = require('../core/messages');
const designs = require('../core/designs');
const pay = require('../core/pay');
const viewers = require('../core/viewers');
const vpn = require('../core/vpn');
const release = require('../core/release');
const strings = require('../i18n/en.json');

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

app.get('/api/settings', (req, res) => res.json(view()));
// The panel's System colors: Windows' accent color from the registry (0xAABBGGRR), null when it can't be read (or not on
// Windows): the panel shows Jarchi's colors then. Any web page can send this GET (it can't read the answer), so one
// reg.exe runs at a time and its answer is kept for 10 s: a page sending it over and over starts no pile of processes.
const ACCENT_MS = 10000;
let accent = null; // { at, answer: Promise of '#rrggbb' or null }
const readAccent = () =>
  new Promise((resolve) =>
    execFile('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\DWM', '/v', 'AccentColor'], { windowsHide: true, timeout: 3000 }, (err, out) => {
      const abgr = !err && /AccentColor\s+REG_DWORD\s+0x([0-9a-f]{1,8})\b/i.exec(out)?.[1];
      const n = abgr && parseInt(abgr, 16);
      resolve(abgr ? `#${[n & 255, (n >>> 8) & 255, (n >>> 16) & 255].map((c) => c.toString(16).padStart(2, '0')).join('')}` : null);
    }),
  );
app.get('/api/accent', async (req, res) => {
  if (!accent || Date.now() - accent.at > ACCENT_MS) accent = { at: Date.now(), answer: readAccent() };
  res.json({ accent: await accent.answer });
});
// The proxy setting changed: everything reconnects through it, and core/vpn.js starts over.
function reconnect() {
  net.resetPool(); // nothing goes on through the old setting
  chat.restart();
  twitchAccount.start();
  kickAccount.start();
  vpn.fine();
}
// What a settings change sets off. patch: what changed (a PATCH's body, or what an undo / redo changed).
function follow(patch) {
  for (const [id, fields] of Object.entries(patch.goals ?? {})) if ('target' in fields) goals.retarget(id);
  // Widgets switch between Kick's / Twitch's numbers and their own.
  if ('kickGoalSync' in patch || 'twitchGoalSync' in patch) goals.refresh();
  if (Object.keys(patch).some((k) => k.startsWith('proxy'))) reconnect();
  else if (patch.chat) chat.sync(); // channel names may have changed
}
app.patch('/api/settings', (req, res) => {
  const s = settings.update(req.body);
  if ('privacyAccepted' in req.body) {
    stats.ping().then(messages.load); // the Privacy Policy accepted just now: the first usage ping, then the team's messages
    pay.refresh(); // and the crypto gateway's state
  }
  follow(req.body);
  res.json(changed(s));
});
// Undo / redo (the panel's Ctrl+Z / Ctrl+Y, and Undo in its "Saved" note): one change back or forward again.
const changes = (a, b) =>
  Object.fromEntries(
    Object.keys(b)
      .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
      .map((k) => [k, b[k]]),
  );
for (const step of ['undo', 'redo'])
  app.post(`/api/settings/${step}`, (req, res) => {
    const before = settings.get(),
      s = settings[step]();
    if (!s) return res.status(409).json({ error: `nothing_to_${step}` });
    const patch = changes(before, s);
    if (patch.goals) patch.goals = Object.fromEntries(Object.keys(s.goals).map((id) => [id, changes(before.goals[id], s.goals[id])])); // retarget: a target changed
    follow(patch);
    res.json(changed(s));
  });

const fileName = (req) => {
  try {
    return decodeURIComponent(req.get('x-filename') || '');
  } catch {
    return '';
  }
};
const raw = express.raw({ type: () => true, limit: media.MAX_BYTES });
app.post('/api/profile/picture', raw, (req, res) => res.json(changed(settings.saveProfilePicture(req.body, fileName(req)))));
// A widget's file: the request's body, or (x-link header: "Paste a link") the file at that link, downloaded once. Either
// way at most 10 MB, and an image or GIF over 512 px is shrunk (core/media.js) before save(params, buf, name) keeps it.
const upload = (save) => [
  raw,
  async (req, res) => {
    const { buf, name } = req.get('x-link') ? await media.download(req.get('x-link')) : { buf: req.body, name: fileName(req) };
    res.json(changed(save(req.params, await media.shrink(buf), name)));
  },
];
app.post('/api/upload/:type/:kind', ...upload((p, buf, name) => settings.saveUpload(p.type, p.kind, buf, name)));

// Media by amount: the fixed tiers of one alert type, by amount. { on } switches one; :kind is image | sound.
app.patch('/api/tiers/:type/:amount', (req, res) => res.json(changed(settings.setTier(req.params.type, Number(req.params.amount), req.body))));
app.post('/api/tiers/:type/:amount/:kind', ...upload((p, buf, name) => settings.saveTierFile(p.type, Number(p.amount), p.kind, buf, name)));
app.delete('/api/tiers/:type/:amount/:kind', (req, res) =>
  res.json(changed(settings.removeTierFile(req.params.type, Number(req.params.amount), req.params.kind))),
);

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
app.get('/api/version', (req, res) => res.json({ version: require('../package.json').version, dev: DEV })); // About; dev: Settings' dev tools

// Proxy: "Test connection" (Kick, Twitch, 7TV), and which proxy is in use right now.
app.post('/api/net/test', async (req, res) => res.json(await chat.check()));
app.get('/api/net/proxy', async (req, res) => res.json({ mode: settings.get().proxyMode, proxy: await net.current() }));
// The user's VPN app (core/vpn.js; its state comes by socket, 'proxyHelp'): look for it now, Yes (-> the settings), No.
app.post('/api/proxy/look', (req, res) => res.json(vpn.look()));
// Yes: { settings } once Kick and the relay answer through it (everything reconnects), else { settings: null } and the
// popup says why ('proxyHelp' failed), or the offer was answered in another window.
app.post('/api/proxy/accept', async (req, res) => {
  const s = await vpn.accept();
  if (s) reconnect();
  res.json({ settings: s && changed(s) });
});
app.post('/api/proxy/dismiss', (req, res) => {
  vpn.dismiss();
  res.json(vpn.state());
});
// Dev runs only: "Test as if Kick were blocked" (Settings) runs the help above as if Kick couldn't be reached; what it
// finds comes by socket ('proxyHelp') as usual.
if (DEV)
  app.post('/api/dev/kick-blocked', (req, res) => {
    vpn.trouble('kick', true);
    res.json({ ok: true });
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

// Chat: connectors run in core/chat; the look is a regular setting. Tests and resets are for one chat: { chat: 'chat2' }
// is Chat 2, else Chat 1. "+" adds Chat 2, remove deletes it.
const chatOf = (body) => (body?.chat === 'chat2' ? 'chat2' : 'chat');
app.get('/api/chat/status', (req, res) => res.json(chat.status()));
app.get('/api/chat/styles', (req, res) => res.json({ styles: settings.CHAT_DESIGNS, fonts: settings.CHAT_FONTS, exclusive: designs.names() }));
// Exclusive chat designs (core/designs.js): a code from the panel's hidden 👀; a design's CSS for the chat widget.
app.post('/api/designs/redeem', async (req, res) => res.json(await designs.redeem(req.body?.code)));
app.get('/widgets/chat/designs/:file', (req, res, next) => {
  const css = /^(x-[a-z0-9-]{1,30})\.css$/.test(req.params.file) && designs.css(req.params.file.slice(0, -4));
  if (!css) return next();
  res.set({ 'content-type': 'text/css; charset=utf-8', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' }).send(css);
});
app.post('/api/chat/test', (req, res) => {
  const key = chatOf(req.body);
  if (!settings.get()[key]) return res.status(400).json({ error: 'bad_request' }); // Chat 2 is gone (another window)
  res.json(chat.test(['burst', 'all'].includes(req.body?.kind) ? req.body.kind : 'sample', key));
});
app.get('/api/chat/thumbs', (req, res) => res.json(chat.thumbs(chatOf(req.query))));
app.post('/api/chat/reset-style', (req, res) => res.json(changed(settings.resetChatStyle(req.body?.own === true, chatOf(req.body)))));
app.post('/api/chat/add', (req, res) => res.json(changed(settings.addChat())));
app.post('/api/chat/remove', (req, res) => res.json(changed(settings.removeChat())));
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
// The browser comes back here from Kick's login. Jarchi then swaps the code through the relay and asks Kick's API who this
// is (both through Jarchi's proxy setting); the page says how that went and why not, in the panel's language. A network
// failure there also opens the VPN help in the app (core/vpn.js), unless the streamer said No to it before.
const PAGE_STRINGS = { en: require('../i18n/en.json').panel.loginPage, fa: require('../i18n/fa.json').panel.loginPage };
const html = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function loginPage(platform, r) {
  const lang = settings.get().lang === 'fa' ? 'fa' : 'en',
    P = PAGE_STRINGS[lang],
    name = (s) => html(s).replace('{platform}', platform);
  const net = ['network', 'blocked'].includes(r.error);
  return `<!doctype html><html lang="${lang}" dir="${lang === 'fa' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Jarchi</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#091312;color:#e7f1f0;font:16px/1.7 Vazirmatn,"Segoe UI",Tahoma,sans-serif}
main{max-width:520px;margin:24px;padding:26px;border:1px solid ${r.ok ? '#1fa39a' : '#b45309'};border-radius:16px;background:#101e1e}h1{margin:0 0 8px;font-size:21px;color:${r.ok ? '#4fd1bf' : '#f6dc8e'}}
p{margin:8px 0}code{display:block;direction:ltr;text-align:left;padding:8px 10px;border-radius:8px;background:#091312;color:#f6dc8e;font:13px Consolas,monospace;overflow-wrap:anywhere}a{color:#4fd1bf}</style></head>
<body><main><h1>${name(r.ok ? P.okTitle : P.failTitle)}</h1>${
    r.ok
      ? `<p>${html(P.okText)}</p>`
      : `<p>${html(P.reasons[r.error] ?? P.reasons.network)}</p>
${r.why ? `<p>${html(P.detail)}</p><code>${html(r.why)}</code>` : ''}${net ? `<p>${html(P.vpnHint)}</p>` : ''}<p><a href="/#connections">${html(P.back)}</a></p>`
  }</main></body></html>`;
}
app.get('/api/kick/callback', async (req, res) => {
  const r = await kickAccount.callback(req.query);
  if (['network', 'blocked'].includes(r.error) && settings.get().proxyAsk) vpn.look();
  res.set({ 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" }).type('html').send(loginPage('Kick', r));
});

// Support (the Support page): /api/support/... is the relay's /support/... for this install (core/support.js). A JSON
// body (express.json read it already) goes on as JSON. A screenshot comes back only as a PNG, JPG or WebP (by its bytes).
const SHOT_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
app.use('/api/support', raw, async (req, res) => {
  const sent = req.is('json') ? JSON.stringify(req.body) : Buffer.isBuffer(req.body) && req.body.length ? req.body : undefined;
  const r = await support.call(req.method, `/support${req.path}`, sent, req.get('content-type'));
  if (!req.path.includes('/images/')) return res.json(await r.json());
  const body = Buffer.from(await r.arrayBuffer()),
    type = SHOT_TYPES[settings.sniff(body)];
  if (!type) return res.status(502).json({ error: 'support_failed' });
  res.set({ 'content-type': type, 'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=86400' }).send(body);
});

// Crypto (the Crypto page, core/pay.js): Jarchi Pay's gateway and donations. Its token stays in core/pay.js; the panel
// gets the state (also by socket when it changes), the donations and the one-time links it opens in the browser.
app.get('/api/crypto', async (req, res) => res.json(await pay.refresh()));
app.post('/api/crypto/request', async (req, res) => res.json(await pay.request(req.body?.accept)));
app.get('/api/crypto/donations', async (req, res) => res.json(await pay.donations(req.query)));
app.post('/api/crypto/wallets/link', async (req, res) => res.json(await pay.walletLink()));
app.post('/api/crypto/wallets/cancel', async (req, res) => res.json(await pay.cancelChange()));
// The donation page's look (the Crypto page's Donation page tab): the line and the links, the picture and the banner.
app.get('/api/crypto/page', async (req, res) => res.json(await pay.page()));
app.put('/api/crypto/page', async (req, res) => res.json(await pay.savePage(req.body)));
app.put('/api/crypto/page/:kind', raw, async (req, res) => res.json(await pay.setPicture(req.params.kind, req.body)));
app.delete('/api/crypto/page/:kind', async (req, res) => res.json(await pay.resetPicture(req.params.kind)));
// Crypto alerts: new donations (core/pay.js) play in the same queue as every other alert, on the main OBS link. Test:
// a sample donation with the look to play ({ look }); Replay: one of the Crypto page's donations as it was paid.
pay.events.on('donation', alertQueue.push);
app.post('/api/crypto/test', (req, res) => {
  alertQueue.push(
    pay.alertOf(
      { name: 'Jarchi', amount: '10.0000', network: 'bep20', message: strings.test.message, txHash: `0x${'8f3a'.repeat(15)}c21d` },
      true,
      req.body?.look,
    ),
  );
  res.json(alertQueue.state());
});
app.post('/api/crypto/replay', (req, res) => {
  alertQueue.push(pay.alertOf(req.body));
  res.json(alertQueue.state());
});
// Their settings: the card and the two designs' duration are regular settings (crypto); a look (custom, or an amount
// alert's id) has its own fields and files; 'main' is the two designs' sound.
app.post('/api/crypto/tiers', (req, res) => {
  const { settings: s, id } = settings.addCryptoTier(req.body?.min);
  res.json({ settings: changed(s), id });
});
app.delete('/api/crypto/tiers/:id', (req, res) => res.json(changed(settings.removeCryptoTier(req.params.id))));
app.patch('/api/crypto/looks/:look', (req, res) => res.json(changed(settings.setCryptoLook(req.params.look, req.body))));
app.post('/api/crypto/files/:look/:kind', ...upload((p, buf, name) => settings.saveCryptoFile(p.look, p.kind, buf, name)));
app.delete('/api/crypto/files/:look/:kind', (req, res) => res.json(changed(settings.removeCryptoFile(req.params.look, req.params.kind))));

// Team messages (Home's cards, core/messages.js): a card shown = seen, its ✕ = closed. The list itself goes by socket, to
// the panel only.
app.post('/api/messages/:id/:what', (req, res) => {
  const id = Number(req.params.id),
    what = req.params.what;
  if (!(what === 'seen' ? messages.seen(id) : what === 'closed' && messages.close(id))) return res.status(404).json({ error: 'not_found' });
  res.json(messages.list());
});

// Goals: counts (current / reached) live in core/goals; their look and target are regular settings.
app.get('/api/goals', (req, res) => res.json({ state: goals.all(), styles: settings.GOAL_STYLES, fonts: settings.FONTS }));
app.patch('/api/goals/:id', (req, res) => res.json(goals.change(req.params.id, req.body)));
app.post('/api/goals/:id/reset-style', (req, res) => res.json(changed(settings.resetGoalStyle(req.params.id))));
app.post('/api/goals/:id/sound', ...upload((p, buf, name) => settings.saveGoalSound(p.id, buf, name)));
app.delete('/api/goals/:id/sound', (req, res) => res.json(changed(settings.removeGoalSound(req.params.id))));

// Viewers: the styles' looks and the fonts (the panel's style picker); the numbers come by socket to viewers pages.
app.get('/api/viewers', (req, res) => res.json({ styles: settings.VIEWER_STYLES, fonts: settings.CHAT_FONTS }));

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
// Only images (by their real bytes: Kick's CDN says "binary/octet-stream"), only from the platforms' own sites (and
// Jarchi Pay's: the donation page's pictures).
const REMOTE_HOSTS = /(^|\.)(kick\.com|jtvnw\.net|7tv\.app|7tv\.io)$/,
  PAY_HOST = new URL(pay.PAY).hostname;
const IMAGE = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
app.get('/remote', async (req, res) => {
  let url;
  try {
    url = new URL(String(req.query.u));
  } catch {}
  if (url?.protocol !== 'https:' || !(REMOTE_HOSTS.test(url.hostname) || url.hostname === PAY_HOST)) return res.status(400).end();
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

// Chat 2's OBS link; Chat 1's is /widgets/chat (below).
app.get('/widgets/chat/2{/}', (req, res) => res.sendFile(path.join(ROOT, 'widgets', 'chat', 'index.html')));
app.use('/uploads', express.static(UPLOADS_DIR, { setHeaders: (res) => res.set('X-Content-Type-Options', 'nosniff') }));
// One goal page, an OBS URL per goal: Kick's /widgets/goal/subs, /kicks, /followers; Twitch's /twitchSubs, /bits, /twitchFollowers.
app.get('/widgets/goal/:id{/}', (req, res, next) => {
  if (!settings.GOAL_IDS.includes(req.params.id)) return next();
  res.sendFile(path.join(ROOT, 'widgets', 'goal', 'index.html'));
});
// One viewers page, an OBS URL per count: /widgets/viewers/kick, /twitch, /total (both added up).
app.get('/widgets/viewers/:source{/}', (req, res, next) => {
  if (!['kick', 'twitch', 'total'].includes(req.params.source)) return next();
  res.sendFile(path.join(ROOT, 'widgets', 'viewers', 'index.html'));
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
  res.status(err.status || 500).json({ error: code, ...(err.status && err.field && { field: err.field }) }); // field: core/pay.js
});

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
  stats.start().then(() => (messages.start(), designs.sync())); // usage pings, once the Privacy Policy is accepted; then the team's messages (the relay knows this install by its ping)
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
