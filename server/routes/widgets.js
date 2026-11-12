// What OBS loads: the widget pages, their files, remote images, and the panel itself. Registered last.
const express = require('express');
const path = require('node:path');
const { UPLOADS_DIR } = require('../../core/config');
const { TYPES } = require('../../core/events');
const settings = require('../../core/settings');
const pay = require('../../core/pay');

module.exports = function register(app, { ROOT }) {
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
};
