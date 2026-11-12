// The chat: status, styles, exclusive designs, tests, Chat 2; the streamer's pictures.

const settings = require('../../core/settings');
const chat = require('../../core/chat');
const designs = require('../../core/designs');

module.exports = function register(app, { changed }) {
  // Chat: connectors run in core/chat; the look is a regular setting. Tests and resets are for one chat: { chat: 'chat2' }
  // is Chat 2, else Chat 1. "+" adds Chat 2, remove deletes it.
  const chatOf = (body) => (body?.chat === 'chat2' ? 'chat2' : 'chat');
  app.get('/api/chat/status', (req, res) => res.json(chat.status()));
  app.get('/api/chat/styles', (req, res) => res.json({ styles: settings.CHAT_DESIGNS, fonts: settings.CHAT_FONTS, exclusive: designs.names() }));
  // Exclusive chat designs (core/designs.js): a code from the panel's hidden 👀; a design's CSS for the chat widget.
  app.post('/api/designs/redeem', async (req, res) => res.json(await designs.redeem(req.body?.code)));
  app.get('/widgets/chat/designs/:file', (req, res, next) => {
    const css = /^(x-[a-z0-9-]{1,30})\.css$/.test(req.params.file) && designs.css(req.params.file.slice(0, -4));
    if (!css) return next();
    res.set({ 'content-type': 'text/css; charset=utf-8', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' }).send(css);
  });
  app.post('/api/chat/test', (req, res) => {
    const key = chatOf(req.body);
    if (!settings.get()[key]) return res.status(400).json({ error: 'bad_request' }); // Chat 2 is gone (another window)
    res.json(chat.test(['burst', 'all'].includes(req.body?.kind) ? req.body.kind : 'sample', key));
  });
  app.get('/api/chat/thumbs', (req, res) => res.json(chat.thumbs(chatOf(req.query))));
  app.post('/api/chat/reset-style', (req, res) => res.json(changed(settings.resetChatStyle(req.body?.own === true, chatOf(req.body)))));
  app.post('/api/chat/add', (req, res) => res.json(changed(settings.addChat())));
  app.post('/api/chat/remove', (req, res) => res.json(changed(settings.removeChat())));
  // The streamer's profile pictures for the panel's background art: { kick, twitch }, null where no channel / picture.
  app.get('/api/streamer', async (req, res) => res.json(await chat.streamer()));
};
