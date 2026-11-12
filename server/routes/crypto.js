// Crypto (Jarchi Pay): the gateway, donations, the donation page, crypto alerts and their looks.

const settings = require('../../core/settings');
const alertQueue = require('../../core/alerts');
const pay = require('../../core/pay');
const strings = require('../../i18n/en.json');

module.exports = function register(app, { changed, raw, upload }) {
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
};
