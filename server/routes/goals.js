// Goals and the viewer count: counts, looks, sounds.

const settings = require('../../core/settings');
const goals = require('../../core/goals');

module.exports = function register(app, { changed, upload }) {
  // Goals: counts (current / reached) live in core/goals; their look and target are regular settings.
  app.get('/api/goals', (req, res) => res.json({ state: goals.all(), styles: settings.GOAL_STYLES, fonts: settings.FONTS }));
  app.patch('/api/goals/:id', (req, res) => res.json(goals.change(req.params.id, req.body)));
  app.post('/api/goals/:id/reset-style', (req, res) => res.json(changed(settings.resetGoalStyle(req.params.id))));
  app.post('/api/goals/:id/sound', ...upload((p, buf, name) => settings.saveGoalSound(p.id, buf, name)));
  app.delete('/api/goals/:id/sound', (req, res) => res.json(changed(settings.removeGoalSound(req.params.id))));

  // Viewers: the styles' looks and the fonts (the panel's style picker); the numbers come by socket to viewers pages.
  app.get('/api/viewers', (req, res) => res.json({ styles: settings.VIEWER_STYLES, fonts: settings.CHAT_FONTS }));
};
