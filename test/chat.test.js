// Chat: parsers (Twitch IRC lines, Kick Pusher events, captured from real chats), 7TV emotes, settings and test messages.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.JARCHI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jarchi-chat-'));
process.env.JARCHI_PORT = '3998';
const { server, io } = require('../server');
const { bus, chatMessage } = require('../core/events');
const twitch = require('../connectors/twitch-chat');
const kick = require('../connectors/kick-chat');
const seventv = require('../core/seventv');

const base = 'http://127.0.0.1:3998';
const call = (method, url, body) => fetch(base + url, { method, headers: { 'x-jarchi': '1', 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
const collect = () => {
  const out = { messages: [], clears: [], channels: [] };
  return { out, cb: { onMessage: (m) => out.messages.push(m), onClear: (c) => out.clears.push(c), onChannel: (c) => out.channels.push(c), onStatus() {} } };
};
test.after(() => {
  io.close();
  server.closeAllConnections(); // a fetch whose body wasn't read keeps its connection open, and close() would wait for it
});

test('Twitch IRC lines -> messages, removals, room id', () => {
  const { out, cb } = collect();
  // A real-shaped PRIVMSG: badges, color, emotes by character position (the ü counts as one), first message.
  twitch.handle('@badge-info=subscriber/14;badges=moderator/1,subscriber/12;color=#1E90FF;display-name=Märk;emotes=25:0-4,11-15;first-msg=1;id=abc-1;room-id=71092938;tmi-sent-ts=1791570335656;user-id=42 :mark!mark@mark.tmi.twitch.tv PRIVMSG #xqc :Kappa über Kappa!', 'xqc', cb);
  const m = out.messages[0];
  assert.equal(m.id, 'abc-1');
  assert.equal(m.user.name, 'Märk');
  assert.equal(m.first, true);
  assert.deepEqual(m.parts.map((p) => p.t === 'emote' ? `[${p.name}]` : p.v), ['[Kappa]', ' über ', '[Kappa]', '!']);
  assert.match(m.parts[0].src, /emoticons\/v2\/25\/default/);
  assert.deepEqual(m.user.badges.map((b) => b.type), ['moderator', 'subscriber']);
  assert.ok(m.user.badges.every((b) => b.img.startsWith('https://static-cdn.jtvnw.net/badges/')));

  twitch.handle('@display-name=x;id=a2;user-id=7 :x!x@x PRIVMSG #xqc :\u0001ACTION waves\u0001', 'xqc', cb);
  assert.deepEqual([out.messages[1].action, out.messages[1].text], [true, 'waves']);

  twitch.handle('@msg-id=resub;system-msg=Fan\\ssubscribed\\sfor\\s6\\smonths!;display-name=Fan;id=s1;user-id=9 :tmi.twitch.tv USERNOTICE #xqc :hello', 'xqc', cb);
  assert.deepEqual([out.messages[2].kind, out.messages[2].system, out.messages[2].text], ['sub', 'Fan subscribed for 6 months!', 'hello']);

  // Bits: Twitch's global cheermotes (any case) become the gem for their amount; other words with a number stay text.
  twitch.handle('@bits=5351;display-name=Cheery;id=b1;user-id=5 :cheery!cheery@cheery.tmi.twitch.tv PRIVMSG #xqc :Cheer100 gg2 kappa5000 hi Cheer250', 'xqc', cb);
  assert.deepEqual(chatMessage(out.messages[3]).parts.map((p) => (p.t === 'cheer' ? [p.name, p.amount, p.gem] : p.v)),
    [['Cheer100', 100, 100], ' gg2 ', ['kappa5000', 5000, 5000], ' hi ', ['Cheer250', 250, 100]]);
  // Without bits it's plain text, as on Twitch.
  twitch.handle('@display-name=Faker;id=b2;user-id=6 :faker!faker@faker.tmi.twitch.tv PRIVMSG #xqc :Cheer10000', 'xqc', cb);
  assert.deepEqual(out.messages[4].parts, [{ t: 'text', v: 'Cheer10000' }]);

  // A line that is an alert carries it, for the chat's special lines (Events); a raid gets a line of its own; the viewers
  // of a community gift don't (the gift has the line). Notices name their viewer in the login tag.
  twitch.handle('@display-name=Raider;login=raider;id=r9;msg-id=raid;msg-param-viewerCount=15;room-id=1;system-msg=15\\sraiders\\sfrom\\sRaider\\shave\\sjoined! :tmi.twitch.tv USERNOTICE #xqc', 'xqc', cb);
  twitch.handle('@display-name=Santa;login=santa;id=g9;msg-id=subgift;msg-param-community-gift-id=1;room-id=1 :tmi.twitch.tv USERNOTICE #xqc', 'xqc', cb);
  const [raid, giftee] = out.messages.slice(-2).map(chatMessage);
  assert.deepEqual([raid.kind, raid.user.login, raid.system, raid.event], ['event', 'raider', '15 raiders from Raider have joined!', { type: 'raid', amount: 15, months: 0, gift: null, name: '' }]);
  assert.deepEqual([giftee.kind, giftee.user.login, giftee.event], ['sub', 'santa', null]);
  assert.deepEqual(chatMessage(out.messages[3]).event, { type: 'bits', amount: 5351, months: 0, gift: null, name: '' });
  assert.equal(chatMessage(out.messages[4]).event, null, 'no bits, no special line');
  out.messages.length = 5;

  twitch.handle('@login=bad;target-msg-id=abc-1 :tmi.twitch.tv CLEARMSG #xqc :oops', 'xqc', cb);
  twitch.handle('@ban-duration=600;target-user-id=42 :tmi.twitch.tv CLEARCHAT #xqc :mark', 'xqc', cb);
  twitch.handle(':tmi.twitch.tv CLEARCHAT #xqc', 'xqc', cb);
  assert.deepEqual(out.clears, [{ platform: 'twitch', messageId: 'abc-1' }, { platform: 'twitch', userId: '42' }, { platform: 'twitch' }]);

  twitch.handle('@emote-only=0;room-id=71092938 :tmi.twitch.tv ROOMSTATE #xqc', 'xqc', cb);
  assert.deepEqual(out.channels, [{ userId: '71092938' }]);
});

test('Kick Pusher events -> messages, badges, removals', () => {
  const { out, cb } = collect();
  const info = { subBadges: [{ months: 6, src: 'https://files.kick.com/sub6.png' }, { months: 1, src: 'https://files.kick.com/sub1.png' }] };
  const data = JSON.stringify({ id: 'k-1', content: 'gg [emote:37230:POLICE] nice', created_at: '2026-10-09T18:24:47+00:00',
    sender: { id: 56477090, username: 'Ali', slug: 'ali', identity: { color: '#E5FFAB', badges: [{ type: 'moderator', text: 'Moderator' }, { type: 'subscriber', text: 'Subscriber', count: 8 }],
      badges_v2: [{ name: 'level', image_url: 'https://ext.cdn.kick.com/chat/badges/33.png' }] } } });
  kick.handle('App\\Events\\ChatMessageEvent', data, 'xqc', info, cb);
  const m = out.messages[0];
  assert.equal(m.text, 'gg POLICE nice');
  assert.deepEqual(m.parts.map((p) => p.t === 'emote' ? `[${p.name}]` : p.v), ['gg ', '[POLICE]', ' nice']);
  assert.equal(m.parts[1].src, 'https://files.kick.com/emotes/37230/fullsize');
  assert.deepEqual(m.user.badges.map((b) => [b.type, b.img]), [['moderator', '/assets/kick-badges/moderator.svg'], ['subscriber', 'https://files.kick.com/sub6.png'], ['other', 'https://ext.cdn.kick.com/chat/badges/33.png']]);
  const img = (badges, subs = []) => kick.kickBadges({ badges }, subs).map((b) => b.img);
  assert.deepEqual(img([{ type: 'subscriber', count: 3 }]), ['/assets/kick-badges/subscriber.svg'], 'no channel sub badges: Kick\'s default');
  assert.deepEqual(img([{ type: 'subscriber' }], info.subBadges), ['https://files.kick.com/sub1.png']);
  assert.deepEqual(img([{ type: 'sub_gifter', count: 1 }, { type: 'sub_gifter', count: 24 }, { type: 'sub_gifter', count: 120 }, { type: 'sub_gifter', count: 999 }, { type: 'sub_gifter', count: 9000 }]),
    [1, 10, 100, 950, 5000].map((n) => `/assets/kick-badges/sub_gifter-${n}.svg`), 'gifter: the tier up to the count');
  assert.deepEqual(img([{ type: 'og' }, { type: 'founder' }, { type: 'verified' }, { type: 'staff' }, { type: 'brand_new_badge' }]),
    ['/assets/kick-badges/og.svg', '/assets/kick-badges/founder.svg', '/assets/kick-badges/verified.svg', '/assets/kick-badges/staff.svg', null], 'unknown type: text tag');
  const tiers = new Set(img(Array.from({ length: 6000 }, (_, i) => ({ type: 'sub_gifter', count: i + 1 }))));
  assert.equal(tiers.size, 28);
  for (const f of tiers) assert.ok(fs.existsSync(path.join(__dirname, '..', f)), f);
  // Kick's icons are shapes only, without a size of their own: sharp at any badge size.
  const dir = path.join(__dirname, '..', 'assets', 'kick-badges');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.svg'))) {
    const svg = fs.readFileSync(path.join(dir, f), 'utf8'), root = svg.slice(0, svg.indexOf('>'));
    assert.ok(/viewBox="0 0 \d+ \d+"/.test(root) && !/\s(width|height)=/.test(root) && !/<image|data:/.test(svg), f);
  }
  // A channel's sub badge: the biggest picture Kick lists for it.
  assert.equal(kick.biggest({ srcset: '', src: 'https://files.kick.com/a-fullsize.png' }), 'https://files.kick.com/a-fullsize.png');
  assert.equal(kick.biggest({ srcset: 'https://files.kick.com/a1.png 1x, https://files.kick.com/a3.png 3x, https://files.kick.com/a2.png 2x', src: 'https://files.kick.com/a.png' }), 'https://files.kick.com/a3.png');
  assert.equal(kick.biggest({ srcset: 'https://files.kick.com/s.png 36w, https://files.kick.com/l.png 72w' }), 'https://files.kick.com/l.png');

  kick.handle('App\\Events\\MessageDeletedEvent', { id: 'x', message: { id: 'k-1' } }, 'xqc', info, cb);
  kick.handle('App\\Events\\UserBannedEvent', { user: { id: 56477090, username: 'Ali' } }, 'xqc', info, cb);
  kick.handle('App\\Events\\ChatroomClearEvent', {}, 'xqc', info, cb);
  assert.deepEqual(out.clears, [{ platform: 'kick', messageId: 'k-1' }, { platform: 'kick', userId: 56477090 }, { platform: 'kick' }]);

  kick.handle('App\\Events\\GiftedSubscriptionsEvent', { gifter_username: 'Rich', gifted_usernames: ['a', 'b', 'c'] }, 'xqc', info, cb);
  assert.deepEqual([out.messages[1].kind, out.messages[1].system], ['sub', 'Rich gifted 3 subs!']);
  assert.deepEqual(chatMessage(out.messages[1]).event, { type: 'gift_sub', amount: 3, months: 0, gift: null, name: '' }, 'for the special line');

  // Kicks (the same gift twice) and a host: lines of their own, once each. A sub announced in chat carries its months;
  // one the gift above named is a plain line.
  const kicks = { gift_transaction_id: 't1', message: 'hi', sender: { id: 7, username: 'LifeWing', username_color: '#E26EFF', profile_picture: 'https://files.kick.com/p.webp' },
    gift: { gift_id: 'hell_yeah', name: 'Hell Yeah', amount: 1 }, created_at: '2026-10-14T03:20:32.535359344Z' };
  kick.handle('KicksGifted', kicks, 'xqc', info, cb);
  kick.handle('KicksGifted', kicks, 'xqc', info, cb);
  kick.handle('App\\Events\\StreamHostEvent', { number_viewers: 42, host_username: 'Friend', optional_message: '' }, 'xqc', info, cb);
  kick.handle('App\\Events\\SubscriptionEvent', { username: 'Fan', months: 5 }, 'xqc', info, cb);
  kick.handle('App\\Events\\SubscriptionEvent', { username: 'b', months: 1 }, 'xqc', info, cb);
  const [gift, host, fan, giftee] = out.messages.slice(2).map(chatMessage);
  assert.equal(out.messages.length, 6, 'one line per Kicks gift');
  assert.deepEqual([gift.kind, gift.user.login, gift.user.color, gift.user.avatar, gift.text, gift.event],
    ['event', 'lifewing', '#E26EFF', 'https://files.kick.com/p.webp', 'hi', { type: 'kicks', amount: 1, months: 0, gift: 'hell_yeah', name: 'Hell Yeah' }]);
  assert.deepEqual([host.kind, host.user.name, host.event.type, host.event.amount], ['event', 'Friend', 'raid', 42]);
  assert.deepEqual([fan.kind, fan.event], ['sub', { type: 'resub', amount: 0, months: 5, gift: null, name: '' }]);
  assert.deepEqual([giftee.kind, giftee.event], ['sub', null]);
});

test("Kick's Pusher key comes from Kick (it changes); anything odd falls back to the built-in one", async () => {
  const real = kick.kickGet;
  const answer = (connections) => { kick.kickGet = async () => ({ status: 200, json: { data: { connections, mode: 'websocket' }, message: 'success' } }); };
  answer([{ credentials: { app_key: '34bf7a0ff419a2a775b9', cluster: 'us2' }, provider: 'pusher' }]); // web.kick.com's real answer (2026-10-13)
  assert.equal(await kick.pusherUrl(72358661), 'wss://ws-us2.pusher.com/app/34bf7a0ff419a2a775b9?protocol=7&client=js&version=8.4.0&flash=false');
  answer([{ credentials: { app_key: 'aaaaaaaaaaaaaaaaaaaa', cluster: 'eu' }, provider: 'pusher' }]);
  assert.match(await kick.pusherUrl(1), /^wss:\/\/ws-eu\.pusher\.com\/app\/aaaaaaaaaaaaaaaaaaaa\?/, 'a new key or cluster is used as is');
  for (const odd of [[{ credentials: { url: 'wss://realtime.us-west-2.platform.kick.com/connection/websocket' }, provider: 'centrifugo' }],
    [{ credentials: { app_key: '34bf7a0ff419a2a775b9', cluster: 'evil.example/x' }, provider: 'pusher' }], undefined]) {
    answer(odd);
    assert.equal(await kick.pusherUrl(1), kick.PUSHER);
  }
  kick.kickGet = real;
});

test('7TV names become emotes; channel set wins over global', () => {
  seventv._set('global', [{ name: 'EZ', src: 'https://cdn.7tv.app/emote/g/2x.webp', still: 'https://cdn.7tv.app/emote/g/2x_static.webp' }]);
  seventv._set('kick', [{ name: 'EZ', src: 'https://cdn.7tv.app/emote/k/2x.webp', still: 'https://cdn.7tv.app/emote/k/2x_static.webp' }]);
  const parts = seventv.enrich('kick', [{ t: 'text', v: 'EZ clap EZ' }, { t: 'emote', name: 'KEKW', src: 'https://x/k', provider: 'kick' }]);
  assert.deepEqual(parts.map((p) => p.t === 'emote' ? `[${p.name}:${p.provider}]` : p.v), ['[EZ:7tv]', ' clap ', '[EZ:7tv]', '[KEKW:kick]']);
  assert.match(parts[0].src, /emote\/k\//, 'the channel emote wins');
  assert.match(seventv.enrich('twitch', [{ t: 'text', v: 'EZ' }])[0].src, /emote\/g\//, 'other platform: global');
});

test('chat settings, Reset style, test messages, OBS page and logos', async () => {
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  let s = await (await call('GET', '/api/settings')).json();
  assert.deepEqual([s.chat.style, s.chat.layout, s.chat.bots, s.chat.kickChannel], ['kick', 'vertical', 'botrix, kickbot', ''], 'new users start with Kick default');
  assert.deepEqual([s.chat.font, s.chat.width, s.chat.bgColor, s.chat.nameColorMode, s.chat.showColon], ['Inter', 340, '#181b1f', 'user', true], "Kick's chat: Inter, 340px, Kick's dark surface, names in their own color");
  const st = await (await call('GET', '/api/chat/status')).json();
  assert.deepEqual([st.kick.state, st.twitch.state], ['off', 'off']);

  for (const bad of [{ twitchChannel: 'no spaces' }, { kickChannel: 'x'.repeat(41) }, { maxMessages: 500 }, { layout: 'diagonal' }, { style: 'fancy' }, { nope: 1 }]) {
    assert.equal((await call('PATCH', '/api/settings', { chat: bad })).status, 400, JSON.stringify(bad));
  }
  s = await (await (await call('PATCH', '/api/settings', { chat: { style: 'ticker', bgColor: '#123456', blockedWords: 'spoiler', enabled: false } })).json());
  assert.deepEqual([s.chat.layout, s.chat.bgColor, s.chat.blockedWords], ['horizontal', '#123456', 'spoiler']);
  s = await (await call('POST', '/api/chat/reset-style')).json();
  assert.deepEqual([s.chat.style, s.chat.layout, s.chat.bgColor, s.chat.blockedWords, s.chat.enabled], ['ticker', 'horizontal', '#14141c', 'spoiler', false], 'Reset style keeps filters and on/off');

  const seen = [];
  const onChat = (m) => seen.push(m);
  bus.on('chat', onChat);
  const wait = (n) => new Promise((r) => setTimeout(r, n * 450 + 400));
  // "Show all effects": one message per effect, in order, then a combo run of one emote from several viewers, then one
  // special line (Events) of each kind, each from its smallest amount up.
  await call('PATCH', '/api/settings', { chat: { eventKicksMin: 100, eventBitsMin: 2000 } });
  const all = await (await call('POST', '/api/chat/test', { kind: 'all' })).json();
  assert.deepEqual(all.effects, ['sub', 'first', 'vip', 'mention', 'avatar', 'combo']);
  assert.deepEqual(all.events, ['kicks', 'gift', 'bits', 'raid']);
  await wait(all.sent);
  assert.equal(seen.length, all.sent);
  assert.ok(seen[0].kind === 'sub' && seen[0].system, 'sub');
  assert.equal(seen[0].event.type, 'resub', 'a sub is a special line');
  assert.ok(seen[1].first, 'first message');
  assert.ok(seen[2].user.badges.some((b) => b.type === 'vip'), 'VIP');
  assert.match(seen[3].text, /@streamer\b/, 'mention');
  assert.match(seen[4].user.avatar, /^https:\/\/static-cdn\.jtvnw\.net\/user-default-pictures-uv\//, 'profile picture');
  const run = seen.slice(5, -4);
  assert.ok(run.length >= 4 && new Set(run.map((m) => m.user.name)).size === run.length, 'combo: several viewers');
  assert.ok(run.every((m) => m.parts.length === 1 && m.parts[0].t === 'emote' && m.parts[0].name === run[0].parts[0].name), 'combo: the same emote');
  const [kicks, gift, bits, raid] = seen.slice(-4);
  assert.deepEqual([kicks.kind, kicks.platform, kicks.event.type], ['event', 'kick', 'kicks']);
  assert.ok(kicks.event.amount >= 100 && fs.existsSync(path.join(__dirname, '..', 'assets', 'kick-gifts', `${kicks.event.gift}.webp`)), "Kick's gift, its picture");
  assert.deepEqual([gift.kind, gift.event.type], ['sub', 'gift_sub']);
  assert.ok(bits.event.amount >= 2000 && bits.parts.some((p) => p.t === 'cheer' && p.amount === bits.event.amount), 'bits: the cheer in the message');
  assert.deepEqual([raid.kind, raid.event.type], ['event', 'raid']);
  // "Send test message" (emotes + 3 effects + a special line) and "Send 10 messages" (10, 2 of them effects)
  seen.length = 0;
  const sample = await (await call('POST', '/api/chat/test', { kind: 'sample' })).json();
  const burst = await (await call('POST', '/api/chat/test', { kind: 'burst' })).json();
  assert.deepEqual([sample.effects.length, sample.events.length], [3, 1]);
  assert.ok(sample.sent >= 6);
  assert.deepEqual([burst.sent, burst.effects.length, burst.events.length], [10, 2, 0]);
  await wait(sample.sent);
  bus.off('chat', onChat);
  assert.equal(seen.length, sample.sent + burst.sent);
  assert.ok(seen.every((m) => m.test));
  assert.ok(seen.some((m) => m.parts.some((p) => p.t === 'emote')));

  assert.equal((await fetch(`${base}/widgets/chat/`)).status, 200);
  for (const logo of ['kick', 'twitch']) assert.equal((await fetch(`${base}/assets/platform-logos/${logo}.svg`)).status, 200);
  // Kick's 6 default profile pictures are bundled (the chat widget picks one by name for Kick viewers without a picture).
  for (let i = 1; i <= 6; i++) {
    const r = await fetch(`${base}/assets/kick-avatars/default-avatar-${i}.webp`);
    assert.equal(r.status, 200);
    assert.equal(Buffer.from(await r.arrayBuffer()).subarray(8, 12).toString('latin1'), 'WEBP', `default-avatar-${i}`);
  }
});

test('test messages: random viewers with real badge images and the Kick channel\'s own sub badges', async () => {
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  const chat = require('../core/chat');
  const badges = require('../connectors/twitch-badges');
  assert.equal(badges.image('sub-gifter', '25'), 'https://static-cdn.jtvnw.net/badges/v1/052a5d41-f1cc-455c-bc7b-fe841ffaf17f/3');
  assert.equal(badges.image('sub-gifter', '7'), null, 'no made-up images');

  // A Kick channel with its own sub badges (1 and 6 months), without going online.
  const SUB1 = 'https://files.kick.com/sub1.png', SUB6 = 'https://files.kick.com/sub6.png';
  const realConnect = kick.connect;
  kick.connect = (slug, cb) => {
    cb.onChannel({ userId: null, subBadges: [{ months: 6, src: SUB6 }, { months: 1, src: SUB1 }] });
    return { stop() {} };
  };
  await call('PATCH', '/api/settings', { chat: { enabled: true, kickChannel: 'somechannel' } });

  const thumbs = await (await call('GET', '/api/chat/thumbs')).json();
  assert.equal(thumbs.length, 5);
  assert.ok(thumbs.every((m) => m.id && m.user.login && m.test));

  const msgs = Array.from({ length: 200 }, () => chat.thumbs()).flat();
  const names = (platform) => new Set(msgs.filter((m) => m.platform === platform).flatMap((m) => m.user.badges.map((b) => b.name)));
  for (const n of ['broadcaster', 'moderator', 'vip', 'subscriber', 'founder', 'sub-gifter', 'premium']) assert.ok(names('twitch').has(n), `twitch ${n}`);
  for (const n of ['broadcaster', 'moderator', 'vip', 'subscriber', 'og', 'founder', 'sub_gifter']) assert.ok(names('kick').has(n), `kick ${n}`);
  const all = msgs.flatMap((m) => m.user.badges.map((b) => ({ ...b, platform: m.platform })));
  assert.ok(all.filter((b) => b.platform === 'twitch').every((b) => b.img.startsWith('https://static-cdn.jtvnw.net/badges/v1/')), 'Twitch: Twitch\'s images');
  const kickIcons = new Set(all.filter((b) => b.platform === 'kick' && b.img?.startsWith('/assets/')).map((b) => b.img));
  assert.ok(all.filter((b) => b.platform === 'kick' && b.name !== 'subscriber' && b.name !== 'level').every((b) => b.img?.startsWith('/assets/kick-badges/')), 'Kick: Kick\'s icons');
  for (const icon of kickIcons) assert.equal((await fetch(base + icon)).status, 200, icon);
  const kickSubs = all.filter((b) => b.platform === 'kick' && b.name === 'subscriber');
  assert.ok(kickSubs.every((b) => b.img === SUB1 || b.img === SUB6) && kickSubs.some((b) => b.img === SUB1) && kickSubs.some((b) => b.img === SUB6), 'Kick subs: the channel\'s badge for their months');
  assert.ok(msgs.filter((m) => m.user.badges.length).length > msgs.length * 0.6, 'most viewers have badges');
  const who = (list) => list.map((m) => m.user.name).join();
  assert.notEqual(who(chat.thumbs()), who(chat.thumbs()), 'each send: other viewers');

  await call('PATCH', '/api/settings', { chat: { kickChannel: '' } });
  kick.connect = realConnect;
});

test('chat styles: all 27 can be picked (Kick default first), new options validate, bundled fonts are served', async () => {
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  const { styles, fonts } = await (await call('GET', '/api/chat/styles')).json();
  assert.equal(Object.keys(styles).length, 27);
  assert.equal(Object.keys(styles)[0], 'kick');
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'i18n', 'en.json'))).chatStyles)[0], 'kick', 'first in the picker');
  const bars = Object.keys(styles).filter((id) => styles[id].layout === 'horizontal');
  assert.deepEqual(bars, ['ticker', 'news', 'neonstrip', 'pills', 'minimal', 'led', 'cyberbar', 'candy', 'glassbar']);
  assert.ok(bars.every((id) => styles[id].tickerLoop === (id !== 'ticker')), 'the new bars loop; Ticker stays as it was');
  for (const bad of [{ tickerPos: 'middle' }, { tickerLoop: 1 }]) assert.equal((await call('PATCH', '/api/settings', { chat: bad })).status, 400, JSON.stringify(bad));
  await call('PATCH', '/api/settings', { chat: { tickerPos: 'bottom' } });
  await call('PATCH', '/api/settings', { chat: { style: 'news' } });
  await call('POST', '/api/chat/reset-style');
  assert.equal((await (await call('GET', '/api/settings')).json()).chat.tickerPos, 'bottom', 'bar position stays when the style changes or is reset');
  await call('PATCH', '/api/settings', { chat: { tickerPos: 'top' } });
  for (const id of Object.keys(styles)) {
    const s = await (await call('PATCH', '/api/settings', { chat: { style: id } })).json();
    assert.equal(s.chat.style, id);
    assert.ok(fonts.includes(s.chat.font), `${id}: font ${s.chat.font}`);
  }
  assert.equal((await call('PATCH', '/api/settings', { chat: { style: 'rpg' } })).status, 200);
  assert.equal((await (await call('GET', '/api/settings')).json()).chat.typewriter, true, 'RPG dialog types out');
  for (const ok of [{ nameColorMode: 'style' }, { enterAnim: 'drop' }, { typeSound: true }, { font: 'Vazirmatn' }, { badgeMode: 'all' }, { badgeSize: 1.5 }, { readableNames: false },
    { ogHat: false }, { hatStyle: 'fedora' }, { hatPos: 'avatar' }, { badgeBg: 'off' }]) assert.equal((await call('PATCH', '/api/settings', { chat: ok })).status, 200, JSON.stringify(ok));
  for (const bad of [{ nameColorMode: 'rainbow' }, { enterAnim: 'spin' }, { typewriter: 'yes' }, { font: 'Comic Sans' }, { badgeMode: 'some' }, { badgeSize: 5 },
    { hatStyle: 'tophat' }, { hatPos: 'middle' }, { badgeBg: 'light' }]) assert.equal((await call('PATCH', '/api/settings', { chat: bad })).status, 400, JSON.stringify(bad));
  const fresh = (await (await call('PATCH', '/api/settings', { chat: { style: 'comic' } })).json()).chat;
  assert.deepEqual([fresh.ogHat, fresh.hatStyle, fresh.hatPos, fresh.badgeBg, fresh.badgeMode], [false, 'fedora', 'avatar', 'off', 'important'],
    'the OG hat and the badge background stay when the style changes; badges take the style\'s');
  await call('PATCH', '/api/settings', { chat: { ogHat: true, hatStyle: 'cap', hatPos: 'first', badgeBg: 'auto' } });
  for (const hat of ['cap', 'beanie', 'fedora']) assert.equal((await fetch(`${base}/assets/og-hats/${hat}.svg`)).status, 200, hat);
  for (const file of ['press-start-2p/PressStart2P-Regular.ttf', 'bangers/Bangers-Regular.ttf', 'fredoka/Fredoka-Variable.ttf', 'vazirmatn/Vazirmatn-Variable.ttf', 'inter/Inter-Variable.ttf']) {
    assert.equal((await fetch(`${base}/assets/fonts/${file}`)).status, 200, file);
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'assets/fonts', path.dirname(file), 'OFL.txt')), `${file} license`);
  }
  await call('POST', '/api/chat/reset-style');
  await call('PATCH', '/api/settings', { chat: { style: 'classic' } });
});

test('profile pictures: the message never waits for a lookup; a returning chatter\'s picture comes with the message', async () => {
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  const PIC = 'https://files.kick.com/images/user/1/profile_image/conversion/a-fullsize.webp';
  const realConnect = kick.connect, realAvatar = kick.avatar;
  let cb;
  kick.connect = (slug, c) => { cb = c; return { stop() {} }; };
  kick.avatar = async () => PIC;
  await call('PATCH', '/api/settings', { chat: { kickChannel: 'picchannel', avatars: true } });
  const seen = [], pics = [];
  const onChat = (m) => seen.push(m), onPic = (a) => pics.push(a);
  bus.on('chat', onChat);
  bus.on('chatAvatar', onPic);
  const say = (id) => cb.onMessage({ platform: 'kick', id, channel: 'picchannel', text: 'hi', user: { id: '1', login: 'newbie', name: 'Newbie', badges: [] }, parts: [{ t: 'text', v: 'hi' }] });
  say('p1');
  assert.deepEqual([seen.length, seen[0].user.avatar], [1, null], 'out at once, before its lookup');
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(pics, [{ platform: 'kick', login: 'newbie', avatar: PIC }], 'the picture follows');
  say('p2');
  assert.equal(seen[1].user.avatar, PIC, 'next message: with the picture');
  assert.equal(pics.length, 1, 'no second lookup');
  bus.off('chat', onChat);
  bus.off('chatAvatar', onPic);
  await call('PATCH', '/api/settings', { chat: { kickChannel: '', avatars: false } });
  Object.assign(kick, { connect: realConnect, avatar: realAvatar });
});

test('Twitch profile pictures without a key: decapi.me (plain text), else api.ivr.fi (JSON "logo")', async () => {
  const badges = require('../connectors/twitch-badges');
  const key = { TWITCH_CLIENT_ID: process.env.TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET: process.env.TWITCH_CLIENT_SECRET };
  for (const k in key) delete process.env[k];
  const realFetch = global.fetch;
  const asked = [];
  const pic = (id, size) => `https://static-cdn.jtvnw.net/jtv_user_pictures/${id}-profile_image-${size}.png`;
  // Answers shaped like the real ones (checked live with xqc, shroud, pokimane, caedrel).
  const DECAPI = { shroud: pic('c754eebf', '300x300'), ghost: 'User not found: ghost', odd: 'https://example.com/x.png' };
  global.fetch = async (url) => {
    const u = new URL(url);
    asked.push(u.hostname);
    if (u.hostname === 'decapi.me') {
      const login = u.pathname.split('/').pop();
      if (login === 'slowpoke') throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
      return new Response(DECAPI[login], { headers: { 'content-type': 'text/plain' } });
    }
    const login = u.searchParams.get('login');
    return Response.json(login === 'ghost' ? [] : [{ login, logo: pic(login, '600x600') }]);
  };
  try {
    assert.equal(await badges.avatar('shroud'), pic('c754eebf', '300x300'), 'decapi\'s URL as it is');
    assert.deepEqual(asked, ['decapi.me'], 'no second request when decapi answers');
    assert.equal(await badges.avatar('slowpoke'), pic('slowpoke', '300x300'), 'decapi slow or down: ivr, at the same size');
    assert.equal(await badges.avatar('odd'), pic('odd', '300x300'), 'only a picture on Twitch\'s own CDN is taken');
    assert.equal(await badges.avatar('ghost'), null, 'no such user: null (a letter in chat)');
  } finally {
    global.fetch = realFetch;
    for (const k in key) if (key[k] !== undefined) process.env[k] = key[k];
  }
});

test('readable names: a platform color too close to its background keeps its hue, just lighter or darker', () => {
  // The widget's color code, run here as it is (from its section comment up to behind(), which needs a page).
  const src = fs.readFileSync(path.join(__dirname, '..', 'widgets', 'chat', 'chat.js'), 'utf8');
  const code = src.slice(src.indexOf('// ---------- Readable names'), src.indexOf('function behind('));
  const { readable, contrast, toHsl, gradientAt } = require('node:vm').runInNewContext(`${code}; ({ readable, contrast, toHsl, gradientAt })`);
  for (const [color, bg] of [['#4CFF75', '#ffffff'], ['#0000FF', '#14141c'], ['#FFFFFF', '#ffe14d'], ['#E5FFAB', '#a5e4ff'], ['#FF0000', '#ffffff'], ['#000000', '#111111'], ['#e6c200', '#a5e4ff'], ['#e6c200', '#ffffff']]) {
    const out = readable(color, bg);
    assert.ok(contrast(out, bg) >= 4.5 && contrast(out, bg) < 5.1, `${color} on ${bg} -> ${out}: readable, and only just`);
    if (toHsl(color)[1] > 0.1) assert.ok(Math.abs(toHsl(out)[0] - toHsl(color)[0]) < 4, `${color} -> ${out}: same hue`);
  }
  assert.equal(readable('#FF6B6B', '#14141c'), '#FF6B6B', 'already readable: unchanged');

  // What's behind a name includes gradients, at the name's spot: Cyberpunk's sub glow is strong on the left only,
  // Galaxy's purple glow sits in the top-left corner.
  const box = { left: 0, top: 0, width: 400, height: 40 };
  const alpha = (kind, g, x, y) => Math.round(gradientAt(kind, g, box, x, y)[3] * 1000) / 1000;
  const glow = '90deg, rgba(255, 213, 77, 0.35), rgba(0, 0, 0, 0) 70%';
  assert.deepEqual(gradientAt('linear', glow, box, 0, 20).slice(0, 3).map(Math.round), [255, 213, 77]);
  assert.equal(alpha('linear', glow, 0, 20), 0.35);
  assert.equal(alpha('linear', glow, 140, 20), 0.175, 'halfway to the 70% stop');
  assert.equal(alpha('linear', glow, 390, 20), 0);
  assert.equal(alpha('linear', 'rgba(255, 255, 255, 0.3), rgba(255, 255, 255, 0.06)', 200, 0), 0.3, 'no angle: top to bottom');
  const galaxy = 'at 15% 0%, rgba(140, 80, 255, 0.3), rgba(0, 0, 0, 0) 60%';
  assert.equal(alpha('radial', galaxy, 60, 0), 0.3, 'at its center');
  assert.equal(alpha('radial', galaxy, 400, 40), 0, 'far corner');
});

test('"Show chat timing": a widget\'s "shown" becomes one server line with each step; nothing while off', async () => {
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  const chat = require('../core/chat');
  const { emitChat } = require('../core/events');
  const ESC = String.fromCharCode(27);
  const m = emitChat({ platform: 'kick', id: 'late-1', time: Date.now() - 2000, text: `hi ${ESC}[31mred`, user: { name: 'Late' } });
  assert.ok(m.received >= m.time + 2000 && m.sent >= m.received, 'received and sent are stamped on the way out');
  assert.equal(chat.timing({ id: 'late-1', shown: m.sent + 30, where: 'OBS' }, 'websocket'), null, 'off by default');
  assert.equal((await call('PATCH', '/api/settings', { chat: { showTiming: 'yes' } })).status, 400);
  await call('PATCH', '/api/settings', { chat: { showTiming: true } });
  const log = console.log;
  console.log = () => {};
  try {
    const line = chat.timing({ id: 'late-1', shown: m.sent + 30, where: 'OBS' }, 'websocket');
    assert.match(line, /^chat timing {2}kick {3}created \d\d:\d\d:\d\d\.\d{3} {2}received \+2\.0\ds {2}sent \+0\.0\ds {2}shown \+0\.03s {2}total \+2\.0\ds {2}OBS\/websocket {2}Late: hi {2}\[31mred$/, 'control codes out');
    assert.match(chat.timing({ id: 'late-1', shown: m.sent, where: '<b>' }, 'polling'), / \?\/polling /, 'an unknown place is "?"');
    assert.equal(chat.timing({ id: 'nope', shown: m.sent }, 'websocket'), null, 'unknown message');
    assert.equal(chat.timing({ id: 'late-1', shown: 'soon' }, 'websocket'), null, 'no time');
  } finally {
    console.log = log;
    await call('PATCH', '/api/settings', { chat: { showTiming: false } });
  }
});

test('a connected account fills its empty chat channel, never a name typed there', async () => {
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  const kickAccount = require('../connectors/kick-account'), twitchAccount = require('../connectors/twitch-account');
  const realKick = kick.connect, realTwitch = twitch.connect, joined = [];
  kick.connect = twitch.connect = (channel) => (joined.push(channel), { stop() {} });
  const channels = async () => { const { chat: c } = await (await call('GET', '/api/settings')).json(); return [c.kickChannel, c.twitchChannel]; };
  try {
    await call('PATCH', '/api/settings', { chat: { kickChannel: '', twitchChannel: 'typedname' } });
    kickAccount.events.emit('status', { state: 'connected', login: 'Mamad_Poker' }); // Kick's name -> its channel slug
    twitchAccount.events.emit('status', { state: 'connected', login: 'mamad', goals: [] });
    assert.deepEqual(await channels(), ['mamad-poker', 'typedname']);
    assert.ok(joined.includes('mamad-poker'), 'its chat connects at once');
    await call('PATCH', '/api/settings', { chat: { kickChannel: 'other' } });
    kickAccount.events.emit('status', { state: 'connected', login: 'Mamad_Poker' }); // the same login again: nothing
    assert.deepEqual(await channels(), ['other', 'typedname']);
  } finally {
    kickAccount.events.emit('status', { state: 'off', login: '' });
    twitchAccount.events.emit('status', { state: 'off', login: '', goals: [] });
    await call('PATCH', '/api/settings', { chat: { kickChannel: '', twitchChannel: '' } });
    Object.assign(kick, { connect: realKick });
    Object.assign(twitch, { connect: realTwitch });
  }
});

// Connections > Test connection (core/chat.js check()): each host on its own, through the proxy setting only (net.reach's
// second argument is a proxy to try: map()'s index there made the second host of each service "a proxy that's down").
test('Test connection: every host tried with the proxy setting; Off: straight, nothing about a proxy', async () => {
  const net = require('../core/net'), chat = require('../core/chat'), kickChat = require('../connectors/kick-chat'), settings = require('../core/settings');
  const real = { reach: net.reach, kickGet: kickChat.kickGet, fetch: globalThis.fetch }, asked = [];
  net.reach = async (...args) => void asked.push(args);
  kickChat.kickGet = async () => ({ status: 200, json: {} });
  globalThis.fetch = async () => new Response('{}');
  settings.update({ proxyMode: 'off' });
  try {
    assert.deepStrictEqual(await chat.check(), { mode: 'off', proxy: null, results: { kick: 'ok', twitch: 'ok', sevenTv: 'ok' } });
    assert.deepStrictEqual(asked.map((a) => a.length), [1, 1, 1, 1, 1], 'a host each, never a proxy');
    assert.ok(asked.some(([h]) => h === 'files.kick.com') && asked.some(([h]) => h === 'static-cdn.jtvnw.net'));
  } finally {
    Object.assign(net, { reach: real.reach });
    kickChat.kickGet = real.kickGet;
    globalThis.fetch = real.fetch;
    settings.update({ proxyMode: 'auto' });
  }
});
