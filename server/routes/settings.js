// The settings: read, change, undo / redo, uploads, media by amount, reset; the panel's accent color.
const { execFile } = require('node:child_process');
const settings = require('../../core/settings');
const goals = require('../../core/goals');
const chat = require('../../core/chat');
const stats = require('../../core/stats');
const messages = require('../../core/messages');
const pay = require('../../core/pay');

module.exports = function register(app, { view, changed, raw, upload, fileName, reconnect }) {
  app.get('/api/settings', (req, res) => res.json(view()));
  // The panel's System colors: Windows' accent color from the registry (0xAABBGGRR), null when it can't be read (or not on
  // Windows): the panel shows Jarchi's colors then. Any web page can send this GET (it can't read the answer), so one
  // reg.exe runs at a time and its answer is kept for 10 s: a page sending it over and over starts no pile of processes.
  const ACCENT_MS = 10000;
  let accent = null; // { at, answer: Promise of '#rrggbb' or null }
  const readAccent = () =>
    new Promise((resolve) =>
      execFile('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\DWM', '/v', 'AccentColor'], { windowsHide: true, timeout: 3000 }, (err, out) => {
        const abgr = !err && /AccentColor\s+REG_DWORD\s+0x([0-9a-f]{1,8})\b/i.exec(out)?.[1];
        const n = abgr && parseInt(abgr, 16);
        resolve(abgr ? `#${[n & 255, (n >>> 8) & 255, (n >>> 16) & 255].map((c) => c.toString(16).padStart(2, '0')).join('')}` : null);
      }),
    );
  app.get('/api/accent', async (req, res) => {
    if (!accent || Date.now() - accent.at > ACCENT_MS) accent = { at: Date.now(), answer: readAccent() };
    res.json({ accent: await accent.answer });
  });
  // What a settings change sets off. patch: what changed (a PATCH's body, or what an undo / redo changed).
  function follow(patch) {
    for (const [id, fields] of Object.entries(patch.goals ?? {})) if ('target' in fields) goals.retarget(id);
    // Widgets switch between Kick's / Twitch's numbers and their own.
    if ('kickGoalSync' in patch || 'twitchGoalSync' in patch) goals.refresh();
    if (Object.keys(patch).some((k) => k.startsWith('proxy'))) reconnect();
    else if (patch.chat) chat.sync(); // channel names may have changed
  }
  app.patch('/api/settings', (req, res) => {
    const s = settings.update(req.body);
    if ('privacyAccepted' in req.body) {
      stats.ping().then(messages.load); // the Privacy Policy accepted just now: the first usage ping, then the team's messages
      pay.refresh(); // and the crypto gateway's state
    }
    follow(req.body);
    res.json(changed(s));
  });
  // Undo / redo (the panel's Ctrl+Z / Ctrl+Y, and Undo in its "Saved" note): one change back or forward again.
  const changes = (a, b) =>
    Object.fromEntries(
      Object.keys(b)
        .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
        .map((k) => [k, b[k]]),
    );
  for (const step of ['undo', 'redo'])
    app.post(`/api/settings/${step}`, (req, res) => {
      const before = settings.get(),
        s = settings[step]();
      if (!s) return res.status(409).json({ error: `nothing_to_${step}` });
      const patch = changes(before, s);
      if (patch.goals) patch.goals = Object.fromEntries(Object.keys(s.goals).map((id) => [id, changes(before.goals[id], s.goals[id])])); // retarget: a target changed
      follow(patch);
      res.json(changed(s));
    });
  app.post('/api/profile/picture', raw, (req, res) => res.json(changed(settings.saveProfilePicture(req.body, fileName(req)))));
  app.post('/api/upload/:type/:kind', ...upload((p, buf, name) => settings.saveUpload(p.type, p.kind, buf, name)));

  // Media by amount: the fixed tiers of one alert type, by amount. { on } switches one; :kind is image | sound.
  app.patch('/api/tiers/:type/:amount', (req, res) => res.json(changed(settings.setTier(req.params.type, Number(req.params.amount), req.body))));
  app.post('/api/tiers/:type/:amount/:kind', ...upload((p, buf, name) => settings.saveTierFile(p.type, Number(p.amount), p.kind, buf, name)));
  app.delete('/api/tiers/:type/:amount/:kind', (req, res) =>
    res.json(changed(settings.removeTierFile(req.params.type, Number(req.params.amount), req.params.kind))),
  );
  app.delete('/api/upload/:type/:kind', (req, res) => res.json(changed(settings.removeUpload(req.params.type, req.params.kind))));
  app.post('/api/reset{/:type}', (req, res) => {
    const s = settings.reset(req.params.type);
    if (!req.params.type) {
      settings.GOAL_IDS.forEach(goals.retarget); // targets went back to their defaults
      chat.sync(); // channels were cleared
    }
    res.json(changed(s));
  });
};
