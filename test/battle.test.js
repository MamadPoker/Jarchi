// The Song Battle page's link to Jarchi Battle (core/battle.js), against a stand-in for its app API: nothing asked
// before the Privacy Policy is accepted or before Connect; the one-time link; the key taken once, sealed on disk and
// never sent to the panel; a battle with the setup, its song feed, the streamer's own song, Remove, Start, Cancel;
// after a restart, the battle that hasn't finished; a stopped key (401). The battle screen: the bracket, chat votes,
// the winners, the live state saved there (vote counts only), the champion. And the page link's QR code (core/qr.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarchi-battle-'));
const KEY = crypto.randomBytes(32).toString('base64'); // as electron/main.js hands it over
const JB = 'https://battle.test';
const APP_KEY = `jba_${'k'.repeat(43)}`;
const ID = '11111111-2222-4333-8444-555555555555';
const disk = () => fs.readFileSync(path.join(dir, 'battle.json'), 'utf8');
const settingsFile = (s) => fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ version: 9, ...s }));
// Jarchi started afresh on this data folder.
function start() {
  for (const k of Object.keys(require.cache)) if (!k.includes('node_modules')) delete require.cache[k];
  Object.assign(process.env, { JARCHI_DATA_DIR: dir, JARCHI_SECRET_KEY: KEY, JARCHI_BATTLE_URL: JB });
  return require('../core/battle');
}
const song = (n, more = {}) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  source: 'youtube',
  link: `https://www.youtube.com/watch?v=abcdefghij${n}`,
  title: `Song ${n}`,
  cover: null,
  similar: false,
  removed: false,
  by: { platform: 'kick', username: `viewer${n}` },
  sentAt: 1000 + n,
  seq: n,
  ...more,
});

// Jarchi Battle: this install's link (status: the key goes out once), the battle, its songs, every call.
const jb = { status: { status: 'none' }, live: true, battle: null, feed: [], asked: [] };
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url),
    at = `${init.method ?? 'GET'} ${u.pathname}`;
  assert.equal(u.origin, JB);
  jb.asked.push({ at, query: u.search, auth: init.headers?.authorization ?? null, body: init.body && JSON.parse(init.body) });
  const json = (b, status = 200) => Response.json(b, { status }),
    done = () => new Response(null, { status: 204 });
  if (at === 'POST /api/app/request') return json({ url: `${JB}/connect/abc`, expiresAt: Date.now() + 900000 }, 201);
  if (at === 'POST /api/app/status') {
    const s = jb.status;
    if (s.key) jb.status = { status: 'connected', channel: s.channel, platform: s.platform };
    return json(s);
  }
  if (init.headers?.authorization !== `Bearer ${APP_KEY}` || !jb.live) return json({ error: 'key' }, 401);
  const b = jb.battle,
    on = `/api/app/battles/${b?.id}`;
  if (at === 'POST /api/app/battles') {
    jb.battle = {
      id: ID,
      url: `${JB}/mamad`,
      status: 'collecting',
      topic: jb.asked.at(-1).body.topic,
      settings: jb.asked.at(-1).body,
      createdAt: 5,
      songs: [],
      cursor: 0,
    };
    return json({ id: ID, url: `${JB}/mamad` }, 201);
  }
  if (at === 'GET /api/app/battles/current') return json({ battle: b?.status === 'finished' ? null : b && { bracket: [], current: null, votes: 0, ...b } });
  if (!b) return json({ error: 'not_found' }, 404);
  if (at === `GET ${on}/songs`) {
    const since = Number(u.searchParams.get('since')),
      changed = jb.feed.filter((s) => s.seq > since).sort((x, y) => x.seq - y.seq);
    return json({ songs: changed, cursor: changed.at(-1)?.seq ?? since });
  }
  if (at === `POST ${on}/songs`) {
    if (b.songs.length >= 3) return json({ error: 'full' }, 409);
    const s = song(9, { by: { platform: 'kick', username: 'mamad' }, link: jb.asked.at(-1).body.link, sentAt: 9999 });
    b.songs.push(s);
    return json(s, 201);
  }
  if (at.startsWith(`DELETE ${on}/songs/`)) return done();
  if (at === `PATCH ${on}/settings`) {
    const { topic = b.topic, ...set } = jb.asked.at(-1).body;
    if (b.status !== 'collecting') return json({ error: 'state' }, 409);
    if (set.size < b.songs.length) return json({ error: 'size' }, 409);
    return (Object.assign(b, { topic, settings: { ...b.settings, ...set } }), done());
  }
  if (at === `POST ${on}/start`) return b.status === 'live' ? json({ error: 'state' }, 409) : ((b.status = 'live'), done());
  if (at === `POST ${on}/cancel`) return ((jb.battle = null), done());
  if (b.status !== 'live' && /\/(live|finish)$/.test(at)) return json({ error: 'state' }, 409);
  if (at === `PUT ${on}/live`) return (Object.assign(b, jb.asked.at(-1).body), done());
  if (at === `POST ${on}/finish`) return ((b.status = 'finished'), (b.champion = jb.asked.at(-1).body.champion), done());
  return json({ error: 'not_found' }, 404);
};

test('Song Battle: connect once, a battle with its live song list, start, cancel, after a restart', async () => {
  // No Privacy Policy accepted: nothing goes to Jarchi Battle.
  settingsFile({});
  let battle = start();
  assert.equal((await battle.refresh()).state, 'none');
  await assert.rejects(battle.request(), { code: 'battle_privacy' });
  assert.equal(jb.asked.length, 0);

  // Accepted, but Connect not pressed: still nothing asked.
  settingsFile({ privacyAccepted: 1 });
  battle = start();
  const installId = require('../core/settings').installId();
  assert.deepEqual(await battle.refresh(), { state: 'none', battle: null, setup: battle.now().setup });
  assert.equal(jb.asked.length, 0);

  // Connect: Jarchi Battle's one-time link, for the browser. While the streamer signs in: pending.
  assert.deepEqual(await battle.request(), { url: `${JB}/connect/abc` });
  assert.deepEqual(jb.asked.at(-1), { at: 'POST /api/app/request', query: '', auth: null, body: { installId } });
  jb.status = { status: 'pending', expiresAt: Date.now() + 900000 };
  assert.equal((await battle.refresh()).state, 'pending');

  // Signed in: the key comes once, sealed on disk, never to the panel; no battle yet.
  jb.status = { status: 'connected', channel: 'mamad', platform: 'kick', key: APP_KEY };
  let st = await battle.refresh();
  assert.deepEqual([st.state, st.channel, st.platform, st.page, st.battle], ['connected', 'mamad', 'kick', `${JB}/mamad`, null]);
  assert.ok(!JSON.stringify(st).includes(APP_KEY), 'the key never reaches the panel');
  assert.ok(!disk().includes(APP_KEY), 'sealed on disk');
  assert.equal(jb.asked.at(-1).at, 'GET /api/app/battles/current');

  // The setup: kept for the next battle; a wrong field changes nothing.
  await assert.rejects(battle.update({ size: 5 }), { code: 'bad_request' });
  await assert.rejects(battle.update({ moderators: [{ platform: 'kick', username: 'no spaces' }] }), { code: 'bad_request' });
  await battle.update({ size: 16, mods: false, moderators: [{ platform: 'twitch', username: 'Mod_1' }], voting: 'me' });
  assert.equal(jb.asked.at(-1).at, 'GET /api/app/battles/current', 'no battle: nothing to tell Jarchi Battle');
  assert.equal(battle.now().setup.size, 16);

  // Open for songs: Jarchi Battle gets the setup (moderators off: none; voting is Jarchi's own), then the battle.
  await assert.rejects(battle.create({ topic: '  ' }), { code: 'battle_bad', field: 'topic' });
  st = await battle.create({ topic: ' 2000s hits ' });
  assert.deepEqual(jb.asked.at(-2).body, {
    topic: '2000s hits',
    size: 16,
    perViewer: 1,
    sources: ['youtube', 'soundcloud'],
    signIn: true,
    showNames: false,
    blurCovers: false,
    hideTitles: false,
    moderators: [],
  });
  assert.deepEqual([st.battle.id, st.battle.status, st.battle.topic, st.battle.songs], [ID, 'collecting', '2000s hits', []]);

  // The feed: what changed since the cursor, merged by id, oldest first; a song taken out goes, Similar follows.
  jb.feed = [song(2), song(1)];
  st = await battle.feed();
  assert.equal(jb.asked.at(-1).query, '?since=0');
  assert.deepEqual(
    st.battle.songs.map((s) => s.title),
    ['Song 1', 'Song 2'],
  );
  jb.feed.push(song(1, { seq: 3, removed: true }), song(2, { seq: 4, similar: true }), song(3, { seq: 5 }));
  st = await battle.feed();
  assert.equal(jb.asked.at(-1).query, '?since=2');
  assert.deepEqual(
    st.battle.songs.map((s) => [s.title, s.similar]),
    [
      ['Song 2', true],
      ['Song 3', false],
    ],
  );
  assert.equal(st.battle.cursor, 5);

  // The streamer's own song: in the list at once; Jarchi Battle's limits are the page's (full, a bad link).
  st = await battle.add(' https://youtu.be/abcdefghij9 ');
  assert.deepEqual(jb.asked.at(-1).body, { link: 'https://youtu.be/abcdefghij9' });
  assert.equal(st.battle.songs.at(-1).by.username, 'mamad');
  jb.battle.songs.push(song(7), song(8));
  await assert.rejects(battle.add('https://youtu.be/abcdefghijk'), { code: 'battle_full' });
  await assert.rejects(battle.add(''), { code: 'battle_link' });

  // Late joiners: a bigger battle while it takes songs, on Jarchi Battle first, only what changed (Mods help too: the
  // list). Kept for the next battle too. What would break it changes nothing: under the songs it has, no topic.
  st = await battle.update({ size: 32, showNames: true, mods: true });
  assert.deepEqual(jb.asked.at(-1), {
    at: `PATCH /api/app/battles/${ID}/settings`,
    query: '',
    auth: `Bearer ${APP_KEY}`,
    body: { size: 32, showNames: true, moderators: [{ platform: 'twitch', username: 'Mod_1' }] },
  });
  assert.deepEqual([st.battle.settings.size, st.battle.settings.showNames, st.battle.settings.perViewer, st.setup.size], [32, true, 1, 32]);
  jb.battle.songs.push(song(6), song(5));
  await assert.rejects(battle.update({ size: 4, topic: 'Smaller' }), { code: 'battle_size' });
  await assert.rejects(battle.update({ topic: '' }), { code: 'battle_topic' });
  jb.battle.songs.splice(-2);
  st = battle.now();
  assert.deepEqual([st.battle.settings.size, st.battle.topic, st.setup.size], [32, '2000s hits', 32]);
  const asked = jb.asked.length;
  await battle.update({ voteTime: 10 }); // the battle screen's own: Jarchi Battle isn't asked
  assert.deepEqual([jb.asked.length, battle.now().setup.voteTime], [asked, 10]);

  // Remove, then Start (2 songs at least).
  st = await battle.remove(song(3).id);
  assert.equal(jb.asked.at(-1).at, `DELETE /api/app/battles/${ID}/songs/${song(3).id}`);
  assert.deepEqual(
    st.battle.songs.map((s) => s.title),
    ['Song 2', 'Song 9'],
  );
  st = await battle.start();
  assert.equal(st.battle.status, 'live');
  st = await battle.update({ size: 64 }); // live: for the next battle only
  assert.deepEqual(
    [jb.asked.filter((a) => !a.at.endsWith('/live')).at(-1).at, st.battle.settings.size, st.setup.size],
    [`POST /api/app/battles/${ID}/start`, 32, 64],
  );
  assert.equal((await battle.feed()).battle.status, 'live'); // no feed while live
  assert.notEqual(jb.asked.at(-1).at.split('?')[0], `GET /api/app/battles/${ID}/songs`);

  // A restart: the key from disk, the battle that hasn't finished with its songs.
  battle = start();
  jb.battle.songs = [song(5), song(4)];
  st = await battle.refresh();
  assert.deepEqual([st.state, st.battle.status, st.setup.voting], ['connected', 'live', 'me']);
  assert.deepEqual(
    st.battle.songs.map((s) => s.title),
    ['Song 4', 'Song 5'],
  );

  // Start again: Jarchi Battle says it moved on (409): the battle is taken again as it is.
  await assert.rejects(battle.start(), { code: 'battle_state' });
  assert.equal(jb.asked.filter((a) => !a.at.endsWith('/live')).at(-1).at, 'GET /api/app/battles/current'); // a live save may come between

  // Cancel: no battle; the setup is still there for the next one.
  st = await battle.cancel();
  assert.deepEqual([st.battle, st.setup.size], [null, 64]);
  await assert.rejects(battle.start(), { code: 'battle_state' });

  // The key stopped (a newer connection for this channel): not connected, connect again.
  jb.live = false;
  st = await battle.refresh();
  assert.deepEqual([st.state, st.lost, st.error], ['none', true, undefined]);
  assert.ok(!disk().includes('enc:'), 'the key is gone from disk');
});

test('Song Battle bracket: the first round has every song once, byes go through by themselves, never two in a match', () => {
  const { bracketFor } = start(),
    ids = (n) => Array.from({ length: n }, (_, i) => `s${i}`);
  assert.deepEqual(
    bracketFor(ids(2)).map((r) => r.length),
    [1],
  );
  for (const [n, rounds, byes] of [
    [5, [4, 2, 1], 3],
    [8, [4, 2, 1], 0],
    [9, [8, 4, 2, 1], 7],
    [128, [64, 32, 16, 8, 4, 2, 1], 0],
  ]) {
    const R = bracketFor(ids(n));
    assert.deepEqual(
      R.map((r) => r.length),
      rounds,
    );
    assert.deepEqual(
      R[0]
        .flatMap((x) => x.slice(0, 2))
        .filter(Boolean)
        .sort(),
      ids(n).sort(),
    );
    const alone = R[0].filter((x) => x[1] === null);
    assert.equal(alone.length, byes);
    assert.ok(alone.every((x) => x[0] && x[2] === 0)); // a bye: one song, and it's through
    R[0].forEach((x, m) => x[2] === 0 && assert.equal(R[1][m >> 1][m & 1], x[0]));
  }
});

test('Song Battle screen: chat votes (one each, the last counts), the winners, after a restart, the champion; counts only', async () => {
  jb.live = true;
  jb.status = { status: 'connected', channel: 'mamad', platform: 'kick', key: APP_KEY };
  let battle = start();
  await battle.request();
  assert.equal((await battle.refresh()).state, 'connected');
  await battle.update({ voting: 'chat', voteTime: 30 });
  await assert.rejects(battle.update({ voteTime: 45 }), { code: 'bad_request' });
  await battle.create({ topic: 'Live' });
  jb.battle.songs = [1, 2, 3, 4].map((n) => song(n));
  await battle.refresh();
  let st = await battle.start();
  const at = st.battle.current,
    match = () => battle.now().battle.bracket[at[0]][at[1]];
  assert.deepEqual(at, [0, 0]);

  // Chat: 1 or 2 (a Persian digit too) once the vote is on; one vote each, the last counts; tests and other text don't.
  let { bus } = require('../core/events');
  const say = (login, text, more) => bus.emit('chat', { platform: 'kick', kind: 'message', text, user: { login }, ...more });
  say('voter_early', '1');
  assert.deepEqual(match().slice(3), [0, 0]);
  st = battle.openVote();
  assert.equal(st.battle.vote.status, 'open');
  assert.ok(st.battle.vote.endsAt > Date.now() + 29000 && st.battle.vote.endsAt <= Date.now() + 30000);
  say('voter_a', '1');
  say('voter_b', ' 2 ');
  say('Voter_A', '2'); // changed their mind
  say('voter_c', '۱');
  say('voter_g', '1');
  bus.emit('chat', { platform: 'twitch', kind: 'message', text: '1', user: { login: 'voter_a' } }); // someone else on Twitch
  say('voter_d', '12');
  say('voter_e', '1', { test: true });
  assert.deepEqual(match().slice(3), [3, 2]);
  st = battle.closeVote();
  assert.equal(st.battle.vote.status, 'done');
  say('voter_late', '2');
  assert.deepEqual(match().slice(3), [3, 2]);
  assert.ok(!JSON.stringify(st).includes('voter_'), 'who voted never reaches the panel');

  // Vote again: from 0. "I pick the winner": no vote to start.
  battle.resetVote();
  assert.deepEqual([match().slice(3), battle.now().battle.vote], [[0, 0], null]);
  await battle.update({ voting: 'me' });
  assert.throws(() => battle.openVote(), { code: 'battle_state' });
  await battle.update({ voting: 'chat' });
  battle.openVote();
  say('voter_a', '2');
  battle.closeVote();

  // The winner (here the other song: the streamer's call), into the next round; one winner only.
  st = battle.pick(0);
  assert.deepEqual(match().slice(2), [0, 0, 1]);
  assert.equal(st.battle.bracket[1][0][0], match()[0]);
  assert.throws(() => battle.pick(1), { code: 'battle_state' });
  assert.throws(() => battle.openVote(), { code: 'battle_state' });

  // Jarchi Battle's page gets the bracket and the match on now (about every 2 s): counts, never who voted.
  await new Promise((r) => setTimeout(r, 2100));
  const saves = jb.asked.filter((a) => a.at === `PUT /api/app/battles/${ID}/live`);
  assert.deepEqual(saves.at(-1).body, { bracket: battle.now().battle.bracket, current: at });
  assert.ok(!JSON.stringify(saves).includes('voter_'));

  // A restart: the bracket as saved there, the same match on.
  battle = start();
  ({ bus } = require('../core/events'));
  st = await battle.refresh();
  assert.deepEqual([st.battle.bracket, st.battle.current, st.battle.vote], [saves.at(-1).body.bracket, at, null]);

  // Next match, until the final; then the champion: the last bracket saved first, then finish.
  await assert.rejects(
    battle.next().then(() => battle.next()),
    { code: 'battle_state' },
  ); // the next one has no winner yet
  assert.deepEqual(battle.now().battle.current, [0, 1]);
  battle.pick(1);
  st = await battle.next();
  assert.deepEqual(st.battle.current, [1, 0]);
  battle.pick(0);
  st = await battle.next();
  const final = jb.asked.slice(-2);
  assert.deepEqual(
    final.map((a) => a.at),
    [`PUT /api/app/battles/${ID}/live`, `POST /api/app/battles/${ID}/finish`],
  );
  assert.equal(final[0].body.bracket[1][0][2], 0);
  assert.equal(final[1].body.champion, final[0].body.bracket[1][0][0]);
  assert.deepEqual([st.battle.status, st.battle.champion], ['finished', final[1].body.champion]);

  // The finished battle stays for the bracket and the champion (Jarchi Battle's "current" has none now), until New battle.
  assert.equal((await battle.refresh()).battle.status, 'finished');
  await assert.rejects(battle.next(), { code: 'battle_state' });
  assert.equal(battle.clear().battle, null);
  assert.throws(() => battle.clear(), { code: 'battle_state' });
});

test("QR code: the page link, as a reference encoder draws it; a text that doesn't fit gets none", () => {
  const qr = require('../core/qr');
  // The modules' fingerprint, made with the qrcode package (npm) for the same text, version 6, level H.
  const print = (t) =>
    crypto
      .createHash('sha256')
      .update(
        qr
          .matrix(t)
          .map((r) => `${r.map(Number).join('')}\n`)
          .join(''),
      )
      .digest('hex')
      .slice(0, 16);
  assert.equal(print('https://battle.jarchi.app/mamadpoker'), '1a08289a3477111b');
  assert.equal(print('https://battle.jarchi.app/some_one-99'), 'ae0a2a5b2ad4d8c5');
  const svg = qr.svg('https://battle.jarchi.app/mamadpoker');
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 49 49"/);
  assert.match(svg, /<image href="data:image\/png;base64,/); // the logo, inside: an <img> loads nothing else
  assert.ok(qr.svg(`https://battle.jarchi.app/${'a'.repeat(30)}`)); // the longest link: 56 bytes
  assert.equal(qr.svg(`https://battle.jarchi.app/${'a'.repeat(33)}`), null); // 59 bytes
});
