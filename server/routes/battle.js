// Song Battle (the Song Battle page, core/battle.js): connecting to Jarchi Battle, the setup, the battle that hasn't
// finished with its songs, start and cancel; the page link's QR code, and posting the link in Kick / Twitch chat.
const settings = require('../../core/settings');
const battle = require('../../core/battle');
const qr = require('../../core/qr');
const kickAccount = require('../../connectors/kick-account');
const twitchAccount = require('../../connectors/twitch-account');
const strings = { en: require('../../i18n/en.json'), fa: require('../../i18n/fa.json') };

module.exports = function register(app) {
  app.get('/api/battle', async (req, res) => res.json(await battle.refresh()));
  app.post('/api/battle/connect', async (req, res) => res.json(await battle.request()));
  app.patch('/api/battle/setup', async (req, res) => res.json(await battle.update(req.body)));
  app.post('/api/battle/new', async (req, res) => res.json(await battle.create(req.body)));
  app.get('/api/battle/songs', async (req, res) => res.json(await battle.feed()));
  app.post('/api/battle/songs', async (req, res) => res.json(await battle.add(req.body?.link)));
  app.delete('/api/battle/songs/:id', async (req, res) => res.json(await battle.remove(req.params.id)));
  app.post('/api/battle/start', async (req, res) => res.json(await battle.start()));
  app.post('/api/battle/cancel', async (req, res) => res.json(await battle.cancel()));
  // The battle screen: the current match's chat vote (start, end now, again), its winner, the next match; after the
  // champion, Reveal and New battle.
  app.post('/api/battle/vote', (req, res) => res.json(battle.openVote()));
  app.post('/api/battle/vote/end', (req, res) => res.json(battle.closeVote()));
  app.delete('/api/battle/vote', (req, res) => res.json(battle.resetVote()));
  app.post('/api/battle/winner', async (req, res) => res.json(await battle.pick(req.body?.side, req.body?.coin)));
  app.post('/api/battle/next', async (req, res) => res.json(await battle.next()));
  app.post('/api/battle/reveal', (req, res) => res.json(battle.reveal()));
  app.post('/api/battle/clear', (req, res) => res.json(battle.clear()));

  // The page link as a QR code (core/qr.js), for viewers to scan off the stream.
  app.get('/api/battle/qr', (req, res) => {
    const { page } = battle.now(),
      svg = page && qr.svg(page);
    if (!svg) return res.status(404).json({ error: 'not_found' });
    res.type('image/svg+xml').set('cache-control', 'no-store').send(svg);
  });

  // "Post in chat": the page link in the chat of each account connected on the Connections page, in the panel's
  // language. -> { kick, twitch }: 'sent', null (not connected), or why not (scope: connect again for the permission).
  app.post('/api/battle/chat', async (req, res) => {
    const { page } = battle.now();
    if (!page) return res.status(409).json({ error: 'battle_key' });
    const text = (strings[settings.get().lang] ?? strings.en).panel.battleChatText.replace('{link}', page);
    const post = (account) =>
      account.status().login
        ? account.say(text).then(
            () => 'sent',
            (err) => err.code ?? 'network',
          )
        : null;
    const [kick, twitch] = await Promise.all([post(kickAccount), post(twitchAccount)]);
    res.json({ kick, twitch });
  });
};
