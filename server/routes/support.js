// The Support page, through the relay.
const settings = require('../../core/settings');
const support = require('../../core/support');

module.exports = function register(app, { raw }) {
  // Support (the Support page): /api/support/... is the relay's /support/... for this install (core/support.js). A JSON
  // body (express.json read it already) goes on as JSON. A screenshot comes back only as a PNG, JPG or WebP (by its bytes).
  const SHOT_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
  app.use('/api/support', raw, async (req, res) => {
    const sent = req.is('json') ? JSON.stringify(req.body) : Buffer.isBuffer(req.body) && req.body.length ? req.body : undefined;
    const r = await support.call(req.method, `/support${req.path}`, sent, req.get('content-type'));
    if (!req.path.includes('/images/')) return res.json(await r.json());
    const body = Buffer.from(await r.arrayBuffer()),
      type = SHOT_TYPES[settings.sniff(body)];
    if (!type) return res.status(502).json({ error: 'support_failed' });
    res.set({ 'content-type': type, 'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=86400' }).send(body);
  });
};
