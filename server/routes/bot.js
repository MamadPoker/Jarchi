// The Bot page (core/bot.js talks to TheJarchi, bot.jarchi.app): the main switch, the /mod notice, the thank-you
// messages' switches and texts, and Send a test. The bot's key stays in core/bot.js.
const bot = require('../../core/bot');

module.exports = function register(app) {
  app.get('/api/bot', async (req, res) => res.json(await bot.state()));
  app.post('/api/bot/on', async (req, res) => res.json(await bot.setOn(req.body?.on)));
  app.post('/api/bot/modded', async (req, res) => res.json(await bot.setModded()));
  app.put('/api/bot/settings', async (req, res) => res.json(await bot.save(req.body)));
  app.post('/api/bot/test', async (req, res) => res.json(await bot.test(req.body?.type)));
};
