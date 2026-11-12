// The Luck page (core/luck.js): its saved wheels, giveaway options and coin score; the giveaway's Start, Close entries
// and Draw. Who joins comes by socket ('giveaway', 'giveawayJoin').
const luck = require('../../core/luck');

module.exports = function register(app) {
  app.get('/api/luck', (req, res) => res.json(luck.get()));
  app.patch('/api/luck', (req, res) => res.json(luck.update(req.body)));
  app.post('/api/luck/giveaway/start', (req, res) => res.json(luck.start()));
  app.post('/api/luck/giveaway/close', (req, res) => res.json(luck.close()));
  app.post('/api/luck/giveaway/draw', (req, res) => res.json(luck.draw()));
};
