// The alert queue's controls, and the sample events for Test and the panel's preview.

const { emitEvent, TYPES, PLATFORMS } = require('../../core/events');
const settings = require('../../core/settings');
const alertQueue = require('../../core/alerts');
const strings = require('../../i18n/en.json');

module.exports = function register(app, { changed }) {
  // Alert queue (core/alerts): what's playing, how many wait, and the panel's controls.
  app.get('/api/alerts/queue', (req, res) => res.json(alertQueue.state()));
  app.post('/api/alerts/skip', (req, res) => res.json(alertQueue.skip()));
  app.post('/api/alerts/clear', (req, res) => res.json(alertQueue.clear()));
  app.post('/api/alerts/pause', (req, res) => res.json(alertQueue.pause(req.body?.paused === true)));
  app.delete('/api/alerts/queue/:id', (req, res) => res.json(alertQueue.remove(req.params.id)));
  app.post('/api/alerts/replay/:id', (req, res) => res.json(alertQueue.replay(req.params.id)));
  app.post('/api/alerts/:type/reset-text', (req, res) => res.json(changed(settings.resetAlertText(req.params.type))));
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
};
