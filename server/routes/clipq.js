// ClipQ (the ClipQ page, core/clipq.js): its settings, Open / Close the queue, Next, Previous (and Played's clips),
// Remove, Clear queue. What comes in from chat goes out by socket ('clipq'). And hls.js for the player page
// (battle-player.html): Kick's clips are HLS.
const clipq = require('../../core/clipq');

module.exports = function register(app) {
  app.get('/api/clipq', (req, res) => res.json(clipq.state()));
  app.patch('/api/clipq', (req, res) => res.json(clipq.update(req.body)));
  app.post('/api/clipq/open', (req, res) => res.json(clipq.setOpen(true)));
  app.post('/api/clipq/close', (req, res) => res.json(clipq.setOpen(false)));
  app.post('/api/clipq/next', (req, res) => res.json(clipq.next(req.body?.from)));
  app.post('/api/clipq/back', (req, res) => res.json(clipq.back(req.body?.id, req.body?.from)));
  app.post('/api/clipq/clear', (req, res) => res.json(clipq.clear()));
  app.delete('/api/clipq/:id', (req, res) => res.json(clipq.remove(req.params.id)));
  app.get('/js/hls.js', (req, res) => res.sendFile(require.resolve('hls.js/dist/hls.light.min.js')));
};
