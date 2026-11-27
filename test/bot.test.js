// The chat bot's link (core/bot.js), against stand-ins for the relay's POST /bot/ticket and the bot's API: only the
// owner's channel for now; the key from a ticket, sealed on disk (never plain; a dev run keeps it in memory only); a key
// the bot stopped taking = register again; events mapped to the bot's, sent without the alert waiting, dropped when the
// bot can't be reached. And the Bot page's own text check (panel/js/bot.js botWhy), run here as it is.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarchi-bot-'));
const KEY = crypto.randomBytes(32).toString('base64'); // as electron/main.js hands it over
const RELAY = 'https://relay.test',
  BOT = 'https://bot.test';
const SETTINGS = {
  on: { follow: true, sub: true, gift_sub: true, kicks: true, raid: false },
  texts: { follow: null, sub: null, gift_sub: null, kicks: null, raid: null },
  defaults: { follow: '📣 Thanks for the follow, {user}!' },
  placeholders: { follow: ['user'], sub: ['user', 'months'] },
  textMax: 200,
};

// Jarchi started afresh on this data folder: the installed app (its key) or a dev run, with this Kick login.
function start({ key = KEY, login = 'MamadPoker', installed = '1' } = {}) {
  for (const k of Object.keys(require.cache)) if (!k.includes('node_modules')) delete require.cache[k];
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ version: 9, privacyAccepted: 1, installId: '7b0c6f9e-1c2d-4e5f-8a9b-0c1d2e3f4a5b' }));
  fs.writeFileSync(path.join(dir, 'kick.json'), JSON.stringify({ access: 'acc', refresh: 'ref', expires: Date.now() + 3600e3, userId: 7, login }));
  Object.assign(process.env, { JARCHI_DATA_DIR: dir, JARCHI_SECRET_KEY: key, KICK_RELAY_URL: RELAY, JARCHI_BOT_URL: BOT, JARCHI_INSTALLED: installed });
  return { bot: require('../core/bot'), events: require('../core/events') };
}

// The relay hands out tickets, the bot a key for each (the newest one only works) and takes events.
const fake = { tickets: 0, key: null, events: [], down: false, hold: false, asked: [] };
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url),
    at = `${init.method ?? 'GET'} ${u.origin}${u.pathname}`,
    h = init.headers ?? {};
  fake.asked.push(at);
  const json = (b, status = 200) => Response.json(b, { status });
  if (at === `POST ${RELAY}/bot/ticket`) {
    assert.equal(h.authorization, 'Bearer acc');
    assert.equal(h['x-jarchi-install'], '7b0c6f9e-1c2d-4e5f-8a9b-0c1d2e3f4a5b');
    return json({ ticket: `jt1.${++fake.tickets}` });
  }
  assert.equal(u.origin, BOT);
  if (fake.down) throw new TypeError('fetch failed');
  if (fake.hold) await new Promise(() => {}); // a bot that never answers
  if (at === `POST ${BOT}/v1/register`) return json({ key: (fake.key = `jbk_${JSON.parse(init.body).ticket}`), channel: { id: '7', slug: 'mamadpoker' } });
  if (h.authorization !== `Bearer ${fake.key}`) return json({ error: 'bad_key' }, 401);
  if (at === `GET ${BOT}/v1/settings`) return json(SETTINGS);
  if (at === `PUT ${BOT}/v1/settings`)
    return JSON.stringify(JSON.parse(init.body)).includes('http') ? json({ error: 'bad_text', type: 'follow', why: 'link' }, 400) : json(SETTINGS);
  if (at === `POST ${BOT}/v1/events`) return (fake.events.push(JSON.parse(init.body)), json({ ok: true }, 202));
  return json({ error: 'not_found' }, 404);
};
const until = async (ok) => {
  for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(ok());
};
const disk = () => fs.readFileSync(path.join(dir, 'bot.json'), 'utf8');

test("another streamer's installed Jarchi: coming soon, and nothing reaches the bot", async () => {
  const { bot, events } = start({ login: 'someone' });
  assert.deepEqual(await bot.state(), { allowed: false });
  await assert.rejects(bot.setOn(true), { code: 'bot_soon' });
  events.emitEvent({ platform: 'kick', type: 'follow', user: 'Ali' });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(fake.asked, []);
});

test('the owner: register with a ticket, the key sealed, events mapped, a stopped key replaced', async () => {
  let { bot, events } = start();
  const st = await bot.setOn(true);
  assert.equal(st.allowed, true);
  assert.equal(st.on, true);
  assert.equal(st.error, '');
  assert.deepEqual(st.bot, SETTINGS);
  assert.equal(fake.tickets, 1);
  assert.ok(!disk().includes(fake.key) && disk().includes('enc:v1:'), 'the key is sealed on disk, never plain');
  assert.ok(!JSON.stringify(st).includes(fake.key), 'the panel never gets the key');

  // Kick events, as the bot takes them; test events, Twitch's and bits never go.
  const send = (e) => events.emitEvent({ platform: 'kick', ...e });
  send({ type: 'follow', user: 'Ali' });
  send({ type: 'sub', user: 'Bo' });
  send({ type: 'resub', user: 'Cy', months: 14 });
  send({ type: 'gift_sub', user: 'Di', amount: 5 });
  send({ type: 'kicks', user: 'Ed', amount: 100 });
  send({ type: 'raid', user: 'Fa', amount: 0 });
  send({ type: 'follow', user: 'Te', test: true });
  events.emitEvent({ platform: 'twitch', type: 'follow', user: 'Tw' });
  await until(() => fake.events.length === 6);
  assert.deepEqual(fake.events, [
    { type: 'follow', user: 'Ali' },
    { type: 'sub', user: 'Bo', months: 1 },
    { type: 'sub', user: 'Cy', months: 14 },
    { type: 'gift_sub', user: 'Di', count: 5 },
    { type: 'kicks', user: 'Ed', amount: 100 },
    { type: 'raid', user: 'Fa', viewers: 0 },
  ]);

  // Restarted: the sealed key is read back, no new ticket.
  ({ bot, events } = start());
  await bot.state();
  assert.equal(fake.tickets, 1);

  // The bot stopped taking the key (registered elsewhere): a new ticket, and the event still goes.
  fake.key = 'jbk_other';
  events.emitEvent({ platform: 'kick', type: 'follow', user: 'Gi' });
  await until(() => fake.events.length === 7);
  assert.equal(fake.tickets, 2);

  // A text the bot refuses: why, for the page.
  await assert.rejects(bot.save({ texts: { follow: 'see http://x' } }), { code: 'bot_bad_text', field: 'link' });
  assert.equal((await bot.test('follow')).ok, true);
  assert.deepEqual(fake.events.at(-1), { type: 'follow', user: 'MamadPoker' });

  // Off: Jarchi sends nothing.
  await bot.setOn(false);
  events.emitEvent({ platform: 'kick', type: 'follow', user: 'Ha' });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(fake.events.length, 8);
});

test("a bot that's down or never answers never holds up an alert", async () => {
  const { bot, events } = start();
  await bot.setOn(true);
  fake.hold = true;
  const t = Date.now();
  assert.ok(events.emitEvent({ platform: 'kick', type: 'follow', user: 'Slow' }));
  assert.ok(Date.now() - t < 50);
  fake.hold = false;
  fake.down = true;
  events.emitEvent({ platform: 'kick', type: 'follow', user: 'Down' }); // dropped, no throw
  const st = await bot.state();
  assert.equal(st.error, 'offline');
  assert.equal(st.bot, null);
  fake.down = false;
});

test('a dev run keeps the key in memory only', async () => {
  fs.rmSync(path.join(dir, 'bot.json'));
  const { bot } = start({ key: '', installed: '' });
  assert.equal((await bot.state()).allowed, true);
  assert.ok(fake.key);
  assert.ok(!disk().includes('jbk_') && !disk().includes('"key"'));
});

test("the Bot page's text check: what the bot would refuse", () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'panel', 'js', 'bot.js'), 'utf8');
  const code = src.slice(src.indexOf('const BOT_CHECK'), src.indexOf('const botWhyText'));
  const { botWhy } = vm.runInNewContext(`const tpl = (s, v) => s.replace(/\\{(\\w+)\\}/g, (m, k) => v[k] ?? m); ${code}; ({ botWhy })`);
  const why = (t, names = ['user', 'months']) => botWhy(t, names, 200);
  assert.equal(why('📣 Thanks for the sub, @{user}! Months: {months}'), '');
  assert.equal(why('   '), 'empty');
  assert.equal(why('x'.repeat(201)), 'too_long');
  assert.equal(why('Thanks {count}'), 'placeholder');
  assert.equal(why('Thanks {user}', ['user']), '');
  assert.equal(why('Thanks @mod'), 'mention');
  assert.equal(why('/ban {user}'), 'command');
  assert.equal(why('!so {user}'), 'command');
  assert.equal(why('go to jarchi.app'), 'link');
  assert.equal(why('www.x'), 'link');
  assert.equal(why('1.2.3.4'), 'link');
  assert.equal(why('ممنون {user} عزیز'), '');
});
