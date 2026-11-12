// Viewers widget: core/viewers.js asks Kick and Twitch only while a viewers page is open, keeps the last numbers when a
// platform doesn't answer, and keeps 15 minutes of history; its settings start from a style's look.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.JARCHI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jarchi-viewers-'));
const kickAccount = require('../connectors/kick-account');
const twitchAccount = require('../connectors/twitch-account');
const kickChat = require('../connectors/kick-chat');
const settings = require('../core/settings');
const viewers = require('../core/viewers');

test('counts are asked while a viewers page is open; a failed ask keeps the last numbers; 15 minutes are kept', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1e9 });
  let kick = { live: true, viewers: 120 },
    twitch = null,
    asked = 0; // no Twitch account
  t.mock.method(kickAccount, 'stream', async () => {
    asked++;
    if (kick instanceof Error) throw kick;
    return kick;
  });
  t.mock.method(twitchAccount, 'stream', async () => twitch);
  const seen = [];
  viewers.events.on('change', (st) => seen.push(st));
  const flush = () => new Promise(setImmediate);

  viewers.watch(1); // OBS opens one: asked at once
  await flush();
  assert.equal(asked, 1);
  assert.deepEqual(seen.at(-1), { kick: { live: true, viewers: 120 }, twitch: null, history: [[1e9, 120, null]] });
  viewers.watch(1); // a second page: still one ask every 30 s
  await flush();
  assert.equal(asked, 1);

  kick = new Error('Kick channel 500');
  twitch = { live: true, viewers: 30 };
  t.mock.timers.tick(viewers.EVERY_MS);
  await flush();
  assert.equal(asked, 2);
  assert.deepEqual(seen.at(-1).kick, { live: true, viewers: 120 }, 'Kick not answering: no Offline flash');
  assert.deepEqual(seen.at(-1).history.at(-1), [1e9 + viewers.EVERY_MS, 120, 30]);

  kick = { live: false, viewers: 0 };
  for (let i = 0; i < 40; i++) {
    t.mock.timers.tick(viewers.EVERY_MS);
    await flush();
  }
  const { history } = viewers.state();
  assert.ok(
    history.every((e) => e[0] > Date.now() - viewers.KEEP_MS),
    'older than 15 minutes: gone',
  );
  assert.deepEqual(history.at(-1).slice(1), [null, 30], 'not live: null');

  viewers.watch(-1);
  viewers.watch(-1); // both pages closed: no more asks
  const before = asked;
  t.mock.timers.tick(viewers.EVERY_MS * 3);
  await flush();
  assert.equal(asked, before);
});

test("Kick's and Twitch's stream: viewers while live, 0 offline, null without an account, an error when they don't say", async (t) => {
  assert.equal(await kickAccount.stream(), null);
  assert.equal(await twitchAccount.stream(), null);
  assert.equal(await kickAccount.live(), null);
  // The Kick channel answer kick-account reads (website API): its livestream while live.
  const k = kickChat.kickGet;
  t.after(() => (kickChat.kickGet = k));
  fs.writeFileSync(
    path.join(process.env.JARCHI_DATA_DIR, 'kick.json'),
    JSON.stringify({ refresh: 'r', access: 'a', login: 'Some_One', expires: Date.now() + 3600e3 }),
  );
  delete require.cache[require.resolve('../connectors/kick-account')];
  const fresh = require('../connectors/kick-account');
  const asked = [];
  kickChat.kickGet = async (p) => (asked.push(p), { status: 200, json: { livestream: { is_live: true, viewer_count: 345 } } });
  assert.deepEqual(await fresh.stream(), { live: true, viewers: 345 });
  assert.deepEqual(asked, ['/api/v2/channels/some-one']);
  kickChat.kickGet = async () => ({ status: 200, json: { livestream: null } });
  assert.deepEqual(await fresh.stream(), { live: false, viewers: 0 });
  kickChat.kickGet = async () => ({ status: 403, json: null });
  await assert.rejects(fresh.stream());
  assert.equal(await fresh.live(), null);
});

test('viewers settings: a style starts from its own look, the rest stays; Jarchi gold keeps its colors; wrong values are refused', () => {
  assert.equal(settings.get().viewers.style, 'gold');
  let v = settings.update({ viewers: { numberColor: '#123456', font: 'Bangers', anim: 'flip', chartMinutes: 15 } }).viewers;
  assert.deepEqual([v.numberColor, v.font, v.anim, v.chartMinutes], ['#d6a83e', 'Bangers', 'flip', 15], "Jarchi gold: Jarchi's colors, its font can change");
  settings.update({ viewers: { style: 'chart' } });
  v = settings.update({ viewers: { numberColor: '#123456' } }).viewers;
  assert.equal(v.numberColor, '#123456', 'other styles: the color picked');
  v = settings.update({ viewers: { style: 'comic' } }).viewers;
  assert.deepEqual([v.style, v.numberColor, v.font, v.anim, v.chartMinutes], ['comic', '#111111', 'Bangers', 'flip', 15]);
  for (const bad of [{ style: 'nope' }, { chartMinutes: 12 }, { anim: 'spin' }, { size: 2 }, { numberColor: 'red' }, { live: true }]) {
    assert.throws(() => settings.update({ viewers: bad }), /bad_request/, JSON.stringify(bad));
  }
  assert.equal(settings.undo().viewers.style, 'chart', 'Ctrl+Z: the style before');
});
