// Smoke test: boots the real server on a temp data dir and exercises migration, settings, uploads, reset and the event bus.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Start from a v0.1 (unversioned) settings file with an uploaded sound, like an existing user would have.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarchi-'));
fs.mkdirSync(path.join(dataDir, 'uploads'));
fs.writeFileSync(path.join(dataDir, 'uploads', 'sub-sound-1.wav'), 'RIFF\0\0\0\0WAVE');
fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({
  theme: 'fun',
  alerts: { sub: { volume: 0.4, sound: { file: 'sub-sound-1.wav', name: 'old.wav' } } },
  goals: { subs: { title: 'Road to 50', countTwitch: true, source: 'twitch' }, followers: { source: 'both' } }, // before v6
}));
// The Home page's feed and today's numbers from before a restart (a broken feed entry is dropped).
fs.writeFileSync(path.join(dataDir, 'feed.json'), JSON.stringify([{ id: 'old', time: 1, platform: 'kick', type: 'sub', user: 'Saved', amount: 0, months: 0, message: '', test: false }, { type: 'nope' }]));
fs.writeFileSync(path.join(dataDir, 'today.json'), JSON.stringify({ date: new Date().toDateString(), alerts: 5, chat: 7 }));
process.env.JARCHI_DATA_DIR = dataDir;
process.env.JARCHI_PORT = '3999';
const { server, io } = require('../server');
const { bus, setConnected, emitEvent } = require('../core/events');
const goals = require('../core/goals');

test.after(() => io.close());

const base = 'http://127.0.0.1:3999';
const call = (method, url, body, headers = {}) => fetch(base + url, {
  method,
  headers: { 'x-jarchi': '1', ...(body && !Buffer.isBuffer(body) && { 'content-type': 'application/json' }), ...headers },
  body: Buffer.isBuffer(body) ? body : body && JSON.stringify(body),
});
const upload = (type, kind, buf) => call('POST', `/api/upload/${type}/${kind}`, buf, { 'content-type': 'application/octet-stream', 'x-filename': 'party.gif' });
const patch = (fields) => call('PATCH', '/api/settings', { alerts: { follow: fields } });

test('migration, settings, uploads, reset, events', async () => {
  if (!server.listening) await new Promise((r) => server.once('listening', r));

  // Home: the saved events and today's numbers are back after a restart.
  const home = await (await call('GET', '/api/home')).json();
  assert.deepEqual([(await (await call('GET', '/api/history')).json()).map((e) => e.user), home.today], [['Saved'], { alerts: 5, chat: 7 }]);

  // v1 -> v2: old custom sound keeps playing, old values kept, file still served.
  let s = await (await call('GET', '/api/settings')).json();
  // The panel's System colors: Windows' accent color from the registry, null where it can't be read.
  const { accent } = await (await call('GET', '/api/accent')).json();
  assert.ok(accent === null || /^#[0-9a-f]{6}$/.test(accent), accent);
  // Background art: no channels set, no profile pictures (and no lookups).
  assert.deepEqual(await (await call('GET', '/api/streamer')).json(), { kick: null, twitch: null });
  // Twitch account: not connected, nothing runs, Jarchi's own Client ID; a bad Client ID is refused, a good one kept.
  assert.deepEqual(await (await call('GET', '/api/twitch')).json(), { state: 'off', error: '', code: '', uri: '', clientId: '6z5ycye2mjhj10jk1jkwkelft0l7p3', login: '', goals: [] });
  assert.equal((await call('PATCH', '/api/twitch', { clientId: 'no spaces' })).status, 400);
  assert.equal((await (await call('PATCH', '/api/twitch', { clientId: 'abc123' })).json()).clientId, 'abc123');
  assert.equal(s.theme, 'fun');
  assert.equal(s.alerts.sub.soundMode, 'custom');
  assert.equal(s.alerts.sub.volume, 0.4);
  assert.equal(s.alerts.follow.soundMode, 'theme');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'))).version, 6);
  // v5 -> v6: the Sub and Followers goals stay (as Kick's), without "Also count Twitch subs" and Source.
  assert.deepEqual([s.goals.subs.title, 'countTwitch' in s.goals.subs, 'source' in s.goals.subs, 'source' in s.goals.followers], ['Road to 50', false, false, false]);
  assert.equal(s.chat.style, 'classic', 'an earlier user who never picked a chat style keeps Classic (Kick default is for new users)');
  assert.equal((await fetch(`${base}/uploads/sub-sound-1.wav`)).status, 200);

  // Platform badge: setting on by default, but nothing is connected yet, so widgets keep it hidden.
  assert.equal(s.showBadge, true);
  assert.deepEqual(s.connected, []);
  assert.equal((await (await call('PATCH', '/api/settings', { showBadge: false })).json()).showBadge, false);
  assert.equal((await call('PATCH', '/api/settings', { showBadge: 'yes' })).status, 400);
  setConnected('kick', true);
  assert.deepEqual((await (await call('GET', '/api/settings')).json()).connected, ['kick']);
  setConnected('kick', false);

  assert.equal(s.alerts.kicks.minAmount, 10, "Kicks: 1-Kick taps stay out of the queue by default");
  assert.ok(!('minAmount' in s.alerts.follow));
  assert.ok(s.alerts.raid.fontSize > s.alerts.follow.fontSize, 'raid is bigger than follow');

  let r = await call('PATCH', '/api/settings', { theme: 'galaxy', alerts: { follow: { volume: 0.3, frame: 'custom', frameBg: '#112233', textPos: 'over', textColor: '#ffffff' } } });
  s = await r.json();
  assert.equal(s.theme, 'galaxy');
  assert.deepEqual([s.alerts.follow.volume, s.alerts.follow.frame, s.alerts.follow.frameBg, s.alerts.follow.textPos], [0.3, 'custom', '#112233', 'over']);
  assert.equal((await (await patch({ textColor: null })).json()).alerts.follow.textColor, null);

  // Per-alert theme (null = main theme) and text alignment (default center, also for old files without it).
  assert.equal(s.alerts.follow.theme, null);
  assert.equal(s.alerts.sub.textAlign, 'center', 'migrated v1 alert gets the center default');
  s = await (await patch({ theme: 'fire', textAlign: 'left' })).json();
  assert.deepEqual([s.alerts.follow.theme, s.alerts.follow.textAlign, s.theme], ['fire', 'left', 'galaxy']);
  assert.equal((await (await patch({ theme: null })).json()).alerts.follow.theme, null);
  await patch({ theme: 'ice' });

  for (const bad of [{ volume: 5 }, { minAmount: 5 }, { frameBg: 'red' }, { soundMode: 'loud' }, { textPos: 'left' }, { fontSize: 500 }, { theme: 'casino' }, { textAlign: 'justify' }]) {
    assert.equal((await patch(bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await call('PATCH', '/api/settings', { theme: 'casino' })).status, 400);
  assert.equal((await fetch(base + '/api/reset', { method: 'POST' })).status, 403, 'missing x-jarchi header must be rejected');

  r = await upload('follow', 'image', Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1'));
  assert.equal(r.status, 200);
  const file = (await r.json()).alerts.follow.image.file;
  assert.ok(fs.existsSync(path.join(dataDir, 'uploads', file)));
  assert.equal((await fetch(`${base}/uploads/${file}`)).status, 200);

  r = await upload('raid', 'image', Buffer.from('\0\0\0\x18ftypisom\0\0\0\0', 'latin1'));
  assert.equal(r.status, 200, 'mp4 accepted');
  assert.match((await r.json()).alerts.raid.image.file, /\.mp4$/);
  assert.equal((await upload('raid', 'image', Buffer.from('\0\0\0\x18ftypM4A \0\0\0\0', 'latin1'))).status, 400, 'm4a audio is not a video');

  assert.equal((await upload('follow', 'image', Buffer.from('<html>not an image</html>'))).status, 400);
  assert.equal((await upload('follow', 'sound', Buffer.from('GIF89a', 'latin1'))).status, 400, 'gif is not a sound');
  assert.equal((await upload('follow', 'image', Buffer.alloc(21 * 1024 * 1024))).status, 413);

  s = await (await upload('follow', 'sound', Buffer.from('RIFF\0\0\0\0WAVE', 'latin1'))).json();
  assert.equal(s.alerts.follow.soundMode, 'custom', 'uploading a sound selects it');
  s = await (await call('DELETE', '/api/upload/follow/sound')).json();
  assert.equal(s.alerts.follow.soundMode, 'theme', 'removing it goes back to the theme sound');

  s = await (await call('POST', '/api/reset/follow')).json();
  assert.equal(s.alerts.follow.image, null);
  assert.equal(s.alerts.follow.volume, 0.7);
  assert.equal(s.alerts.follow.frame, 'theme');
  assert.equal(s.alerts.follow.theme, null, 'reset goes back to the main theme');
  assert.equal(s.alerts.follow.textAlign, 'center');
  assert.equal(s.theme, 'galaxy', 'per-type reset keeps the theme');
  assert.ok(!fs.existsSync(path.join(dataDir, 'uploads', file)));

  s = await (await call('POST', '/api/reset')).json();
  assert.equal(s.theme, 'neon');
  assert.ok(!fs.existsSync(path.join(dataDir, 'uploads', 'sub-sound-1.wav')));

  const samples = await (await call('GET', '/api/samples')).json();
  assert.equal(samples.raid.amount, 42);

  const got = new Promise((r) => bus.once('event', r));
  assert.equal((await call('POST', '/api/test/kicks', { platform: 'kick', amount: 2500 })).status, 200);
  const ev = await got;
  assert.deepEqual([ev.platform, ev.type, ev.amount, ev.test], ['kick', 'kicks', 2500, true]);
});

test('goals: count from events, latch when reached, saved, styles', async () => {
  const goalsNow = async () => (await (await call('GET', '/api/goals')).json()).state;
  const count = async (id, body) => (await call('PATCH', `/api/goals/${id}`, body)).json();
  for (const id of ['subs', 'kicks', 'twitchSubs']) await count(id, { set: 0 });

  // From the event bus, each goal only its own platform's: subs/resubs +1 and each gifted sub +1 (Kick's to the Sub goal,
  // Twitch's to the Twitch Sub goal), Kicks only from Kick. Nothing is added up across platforms any more.
  emitEvent({ platform: 'kick', type: 'resub', user: 'a', months: 3 });
  emitEvent({ platform: 'twitch', type: 'sub', user: 'a' });
  emitEvent({ platform: 'twitch', type: 'gift_sub', user: 'a', amount: 5 });
  emitEvent({ platform: 'twitch', type: 'kicks', user: 'a', amount: 100 });
  emitEvent({ platform: 'kick', type: 'kicks', user: 'a', amount: 250 });
  emitEvent({ platform: 'twitch', type: 'bits', user: 'a', amount: 500 });
  let st = await goalsNow();
  assert.deepEqual([st.subs.current, st.twitchSubs.current, st.kicks.current], [1, 6, 250], 'a Twitch gift of 5 counts 5');
  for (const old of [{ countTwitch: true }, { source: 'both' }]) {
    assert.equal((await call('PATCH', '/api/settings', { goals: { subs: old } })).status, 400, JSON.stringify(old));
  }

  // Reaching the target latches "reached" and announces it once.
  await call('PATCH', '/api/settings', { goals: { subs: { target: 10 } } });
  const announced = new Promise((r) => goals.events.once('change', r));
  st = await count('subs', { add: 9 });
  assert.equal(await announced, 'subs');
  assert.deepEqual([st.subs.current, st.subs.reached], [10, true]);
  st = await count('subs', { add: 3 });
  assert.equal(st.subs.current, 13, 'counts past the target');
  st = await count('subs', { add: -8 });
  assert.deepEqual([st.subs.current, st.subs.reached], [5, true], 'stays full until reset or a new target');
  await call('PATCH', '/api/settings', { goals: { subs: { target: 50 } } });
  assert.equal((await goalsNow()).subs.reached, false, 'a new target clears it');
  await call('PATCH', '/api/settings', { goals: { subs: { target: 5 } } });
  assert.equal((await goalsNow()).subs.reached, true, 'a target at or below the count is reached right away');
  st = await count('subs', { set: 0 });
  assert.deepEqual([st.subs.current, st.subs.reached], [0, false], 'Reset to 0 clears it');
  assert.equal((await call('PATCH', '/api/goals/subs', { add: 'x' })).status, 400);
  assert.equal((await call('PATCH', '/api/goals/nope', { add: 1 })).status, 400);

  // Counts are saved (goals.json), separate from settings.
  await count('kicks', { set: 640 });
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'goals.json'))).kicks.current, 640);

  // A style is a starting point: options apply on top, a new style brings its own look, Reset style keeps title/target.
  let s = await (await call('PATCH', '/api/settings', { goals: { kicks: { barColor: '#123456', title: 'K', target: 2000 } } })).json();
  assert.equal(s.goals.kicks.barColor, '#123456');
  s = await (await call('PATCH', '/api/settings', { goals: { kicks: { style: 'neon' } } })).json();
  assert.deepEqual([s.goals.kicks.barColor, s.goals.kicks.title], ['#00f0ff', 'K']);
  await call('PATCH', '/api/settings', { goals: { kicks: { bg: 'off', radius: 3, enabled: false } } });
  s = await (await call('POST', '/api/goals/kicks/reset-style')).json();
  const k = s.goals.kicks;
  assert.deepEqual([k.style, k.bg, k.radius, k.title, k.target, k.enabled], ['neon', 'color', 16, 'K', 2000, false]);
  for (const bad of [{ style: 'fancy' }, { target: 0 }, { titlePos: 'left' }, { font: 'Wingdings' }, { barColor: 'red' }, { scale: 9 }]) {
    assert.equal((await call('PATCH', '/api/settings', { goals: { kicks: bad } })).status, 400, JSON.stringify(bad));
  }

  // Celebration sound upload selects it.
  s = await (await call('POST', '/api/goals/kicks/sound', Buffer.from('RIFF\0\0\0\0WAVE', 'latin1'), { 'content-type': 'audio/wav', 'x-filename': 'yay.wav' })).json();
  assert.deepEqual([s.goals.kicks.celebrateSound, s.goals.kicks.sound.name], ['custom', 'yay.wav']);

  // One OBS page per goal.
  assert.equal((await fetch(`${base}/widgets/goal/subs`)).status, 200);
  assert.equal((await fetch(`${base}/widgets/goal/kicks/`)).status, 200);
  assert.equal((await fetch(`${base}/widgets/goal/twitchSubs`)).status, 200);
  assert.equal((await fetch(`${base}/widgets/goal/nope`)).status, 404);
});

test("Home: each event goes into feed.json at once, today's numbers into today.json within 2 s", async () => {
  const read = (name) => JSON.parse(fs.readFileSync(path.join(dataDir, name)));
  emitEvent({ platform: 'twitch', type: 'raid', user: 'Saver', amount: 3 });
  assert.equal(read('feed.json')[0].user, 'Saver');
  const { today } = await (await call('GET', '/api/home')).json();
  for (let i = 0; i < 40 && read('today.json').alerts !== today.alerts; i++) await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(read('today.json'), { date: new Date().toDateString(), ...today });
});

test("Kick goals: a goal set on Kick shows Kick's numbers (live events too), the others stay manual; Sync from Kick off", async () => {
  const kick = require('../connectors/kick-chat');
  const reached = [];
  const onChange = (id) => reached.push(id);
  goals.events.on('change', onChange);
  // The Kick connector passes goal events on as they come (kick.com's real names, with or without App\Events\).
  const got = [];
  const cb = { onGoal: (g) => got.push(g) };
  kick.handle('GoalProgressUpdateEvent', JSON.stringify({ id: 'g1', current_value: 375 }), 'me', {}, cb);
  kick.handle('App\\Events\\GoalCanceledEvent', { id: 'g2' }, 'me', {}, cb);
  assert.deepEqual(got, [{ id: 'g1', current_value: 375 }, { id: 'g2', status: 'canceled' }]);

  // kick.com/api/v2/channels/<slug>/goals, as it answered for a real channel (2026-10-17), plus a canceled one.
  goals.kickGoals([
    { id: 'g1', type: 'followers', status: 'active', target_value: 500, current_value: 374 },
    { id: 'g2', type: 'kicks', status: 'active', target_value: 10000, current_value: 330 },
    { id: 'g3', type: 'subscriptions', status: 'canceled', target_value: 5, current_value: 1 },
  ]);
  let a = goals.all();
  assert.deepEqual([a.followers.current, a.followers.target, a.followers.kick, a.kicks.kick, a.subs.kick], [374, 500, true, true, false]);
  // Home's Kick tab: Kick's own list as it is (the canceled one left out), also in /api/home.
  const kickTab = [{ id: 'g1', type: 'followers', current: 374, target: 500 }, { id: 'g2', type: 'kicks', current: 330, target: 10000 }];
  assert.deepEqual([goals.kickList(), (await (await call('GET', '/api/home')).json()).kickGoals], [kickTab, kickTab]);
  const subs = a.subs.current;
  emitEvent({ platform: 'kick', type: 'sub', user: 'x' });
  emitEvent({ platform: 'kick', type: 'kicks', user: 'x', amount: 100 });
  assert.deepEqual([goals.all().subs.current, goals.all().kicks.current], [subs + 1, 330], 'manual counts on; Kick shows its own');

  // Live: a progress event with only the number, then the goal reached celebrates once; canceled -> manual again.
  goals.kickGoal({ id: 'g1', current_value: 499 });
  assert.deepEqual(goals.kickList().map((g) => [g.id, g.current]), [['g1', 499], ['g2', 330]], 'in its place');
  assert.deepEqual([goals.all().followers.current, goals.all().followers.target], [499, 500]);
  goals.kickGoal({ id: 'g1', type: 'followers', status: 'achieved', current_value: 500, target_value: 500 });
  assert.deepEqual([goals.all().followers.reached, reached.at(-1)], [true, 'followers']);
  goals.kickGoal({ id: 'g2', type: 'kicks', status: 'canceled' });
  assert.equal(goals.all().kicks.kick, false);
  // A kind of goal Jarchi has none for: only on Home.
  const before0 = JSON.stringify(goals.all());
  goals.kickGoal({ id: 'g9', type: 'watch_hours', status: 'active', current_value: 3, target_value: 10 });
  assert.equal(JSON.stringify(goals.all()), before0);

  // Sync from Kick off: every goal manual (Kick's is still known), and widgets hear about it.
  const before = reached.length;
  assert.equal((await call('PATCH', '/api/settings', { kickGoalSync: false })).status, 200);
  a = goals.all();
  assert.deepEqual([a.followers.kick, a.followers.onKick, a.followers.target, reached.length], [false, true, 100, before + 1]);
  assert.deepEqual(goals.kickList(), [{ id: 'g1', type: 'followers', current: 500, target: 500 }, { id: 'g9', type: 'watch_hours', current: 3, target: 10 }], "Home's list: whatever the sync does");
  await call('PATCH', '/api/settings', { kickGoalSync: true });
  // No Kick channel any more: no Kick goals.
  goals.kickGoals(null);
  assert.equal(goals.all().followers.onKick, false);
  assert.deepEqual(goals.kickList(), []);
  goals.events.off('change', onChange);
});
test('Twitch goals: Sync from Twitch shows Twitch\'s numbers in the Twitch goals only, never in Kick\'s', async () => {
  const reached = [];
  const onChange = (id) => reached.push(id);
  goals.events.on('change', onChange);
  const bitsBefore = goals.all().bits.current;
  emitEvent({ platform: 'twitch', type: 'bits', user: 'c', amount: 250 });
  emitEvent({ platform: 'kick', type: 'bits', user: 'c', amount: 999 });
  assert.equal(goals.all().bits.current, bitsBefore + 250, 'the Bits goal counts Twitch bits');

  // Kick has a followers goal; Twitch (as connectors/twitch-account.js keeps them) followers, subs and bits goals, and a
  // cheerers goal that no Jarchi goal shows.
  goals.kickGoals([{ id: 'k1', type: 'followers', status: 'active', target_value: 500, current_value: 300 }]);
  goals.twitchGoals([
    { id: 't1', type: 'follow', description: '', current: 40, target: 100 },
    { id: 't2', type: 'new_subscription_count', description: 'Road to 50', current: 12, target: 50 },
    { id: 't3', type: 'new_bit', description: '', current: 900, target: 1000 },
    { id: 't4', type: 'new_cheerer', description: '', current: 3, target: 10 },
  ]);
  let a = goals.all();
  const marks = (g) => [g.current, g.target, g.kick, g.twitch];
  assert.deepEqual(marks(a.followers), [300, 500, true, false], "Kick's Followers goal: Kick's numbers only");
  assert.deepEqual(marks(a.twitchFollowers), [40, 100, false, true]);
  assert.deepEqual(marks(a.twitchSubs), [12, 50, false, true]);
  assert.deepEqual([a.subs.twitch, a.subs.onTwitch], [false, false]);
  assert.deepEqual(marks(a.bits), [900, 1000, false, true]);
  assert.equal(a.kicks.twitch, false);

  // Twitch's bits goal reached: it celebrates once.
  goals.twitchGoals([{ id: 't3', type: 'new_bit', description: '', current: 1000, target: 1000 }]);
  assert.deepEqual([goals.all().bits.reached, reached.at(-1)], [true, 'bits']);

  // Sync from Twitch off: the Twitch goals their own counts again (Twitch's still known); Kick's untouched.
  goals.twitchGoals([{ id: 't1', type: 'follow', current: 40, target: 100 }, { id: 't3', type: 'new_bit', current: 1000, target: 1000 }]);
  assert.equal((await call('PATCH', '/api/settings', { twitchGoalSync: false })).status, 200);
  a = goals.all();
  assert.deepEqual(marks(a.followers), [300, 500, true, false]);
  assert.deepEqual([a.twitchFollowers.twitch, a.twitchFollowers.onTwitch, a.bits.twitch, a.bits.onTwitch, a.bits.current], [false, true, false, true, bitsBefore + 250]);
  await call('PATCH', '/api/settings', { twitchGoalSync: true });
  // Not connected (no goals) and no Kick channel: all manual.
  goals.twitchGoals([]);
  goals.kickGoals(null);
  a = goals.all();
  assert.deepEqual([a.followers.kick, a.twitchFollowers.twitch, a.bits.onTwitch], [false, false, false]);
  assert.equal((await fetch(`${base}/widgets/goal/bits`)).status, 200);
  assert.equal((await fetch(`${base}/widgets/goal/twitchFollowers`)).status, 200);
  goals.events.off('change', onChange);
});
