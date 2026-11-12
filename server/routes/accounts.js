// The Twitch and Kick accounts: connect, disconnect, and the page Kick's login comes back to.

const settings = require('../../core/settings');
const twitchAccount = require('../../connectors/twitch-account');
const kickAccount = require('../../connectors/kick-account');
const vpn = require('../../core/vpn');

module.exports = function register(app) {
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
  const PAGE_STRINGS = { en: require('../../i18n/en.json').panel.loginPage, fa: require('../../i18n/fa.json').panel.loginPage };
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
    res
      .set({ 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" })
      .type('html')
      .send(loginPage('Kick', r));
  });
};
