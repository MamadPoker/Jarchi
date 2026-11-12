// The Home page: today's numbers, the feed, the version; the team's messages.

const { today } = require('../../core/events');
const goals = require('../../core/goals');
const alertQueue = require('../../core/alerts');
const messages = require('../../core/messages');

module.exports = function register(app, { DEV }) {
  // The panel's Home page: today's numbers, when Jarchi started (uptime) and the Kick channel's goals. Open widgets and
  // goal changes come by socket (Twitch's goals with the Twitch account's status). History: every saved event (Home's live
  // feed and the History feed page; new ones come by socket).
  const STARTED = Date.now();
  app.get('/api/home', (req, res) => res.json({ today: today(), started: STARTED, kickGoals: goals.kickList() }));
  app.get('/api/history', (req, res) => res.json(alertQueue.feed()));
  app.get('/api/version', (req, res) => res.json({ version: require('../../package.json').version, dev: DEV })); // About; dev: Settings' dev tools
  // Team messages (Home's cards, core/messages.js): a card shown = seen, its ✕ = closed. The list itself goes by socket, to
  // the panel only.
  app.post('/api/messages/:id/:what', (req, res) => {
    const id = Number(req.params.id),
      what = req.params.what;
    if (!(what === 'seen' ? messages.seen(id) : what === 'closed' && messages.close(id))) return res.status(404).json({ error: 'not_found' });
    res.json(messages.list());
  });
};
