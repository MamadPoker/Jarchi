// The proxy: Test connection, the proxy in use, the VPN app help.

const settings = require('../../core/settings');
const net = require('../../core/net');
const chat = require('../../core/chat');
const vpn = require('../../core/vpn');

module.exports = function register(app, { changed, reconnect, DEV }) {
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
};
