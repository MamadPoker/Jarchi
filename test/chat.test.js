// Chat: parsers (Twitch IRC lines, Kick Pusher events, captured from real chats), 7TV emotes, settings and test messages.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.JARCHI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jarchi-chat-'));
process.env.JARCHI_PORT = '3998';
const { server, io } = require('../server');
const { bus } = require('../core/events');
const twitch = require('../connectors/twitch-chat');
const kick = require('../connectors/kick-chat');
const seventv = require('../core/seventv');

const base = 'http://127.0.0.1:3998';
const call = (method, url, body) => fetch(base + url, { method, headers: { 'x-jarchi': '1', 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
const collect = () => {
  const out = { messages: [], clears: [], channels: [] };
  return { out, cb: { onMessage: (m) => out.messages.push(m), onClear: (c) => out.clears.push(c), onChannel: (c) => out.channels.push(c), onStatus() {} } };
};
test.after(() => io.close());

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

  kick.handle('App\\Events\\MessageDeletedEvent', { id: 'x', message: { id: 'k-1' } }, 'xqc', info, cb);
  kick.handle('App\\Events\\UserBannedEvent', { user: { id: 56477090, username: 'Ali' } }, 'xqc', info, cb);
  kick.handle('App\\Events\\ChatroomClearEvent', {}, 'xqc', info, cb);
  assert.deepEqual(out.clears, [{ platform: 'kick', messageId: 'k-1' }, { platform: 'kick', userId: 56477090 }, { platform: 'kick' }]);

  kick.handle('App\\Events\\GiftedSubscriptionsEvent', { gifter_username: 'Rich', gifted_usernames: ['a', 'b', 'c'] }, 'xqc', info, cb);
  assert.deepEqual([out.messages[1].kind, out.messages[1].system], ['sub', 'Rich gifted 3 subs!']);
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
  assert.deepEqual([s.chat.style, s.chat.layout, s.chat.bots, s.chat.kickChannel], ['classic', 'vertical', 'botrix, kickbot', '']);
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
  assert.equal((await (await call('POST', '/api/chat/test', { kind: 'sample' })).json()).sent, 5);
  assert.equal((await (await call('POST', '/api/chat/test', { kind: 'burst' })).json()).sent, 10);
  await new Promise((r) => setTimeout(r, 2600));
  bus.off('chat', onChat);
  assert.equal(seen.length, 15);
  assert.ok(seen.every((m) => m.test));
  assert.ok(seen.some((m) => m.kind === 'sub') && seen.some((m) => m.first) && seen.some((m) => m.parts.some((p) => p.t === 'emote')));

  assert.equal((await fetch(`${base}/widgets/chat/`)).status, 200);
  for (const logo of ['kick', 'twitch']) assert.equal((await fetch(`${base}/assets/platform-logos/${logo}.svg`)).status, 200);
});

test('test messages: random viewers with real badge images and the Kick channel\'s own sub badges', async () => {
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  const chat = require('../core/chat');
  const badges = require('../connectors/twitch-badges');
  assert.equal(badges.image('sub-gifter', '25'), 'https://static-cdn.jtvnw.net/badges/v1/052a5d41-f1cc-455c-bc7b-fe841ffaf17f/2');
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
