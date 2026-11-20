// The Song Battle page's link to Jarchi Battle (core/battle.js), against a stand-in for its app API: nothing asked
// before the Privacy Policy is accepted or before Connect; the one-time link; the key taken once, sealed on disk and
// never sent to the panel; a battle with the setup, its song feed, the streamer's own song, Remove, Start, Cancel;
// after a restart, the battle that hasn't finished; a stopped key (401). And the page link's QR code (core/qr.js).
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
  if (at === 'GET /api/app/battles/current') return json({ battle: b && { ...b, bracket: [], current: null, votes: 0 } });
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
  if (at === `POST ${on}/start`) return b.status === 'live' ? json({ error: 'state' }, 409) : ((b.status = 'live'), done());
  if (at === `POST ${on}/cancel`) return ((jb.battle = null), done());
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
  assert.throws(() => battle.update({ size: 5 }), { code: 'bad_request' });
  assert.throws(() => battle.update({ moderators: [{ platform: 'kick', username: 'no spaces' }] }), { code: 'bad_request' });
  battle.update({ size: 16, mods: false, moderators: [{ platform: 'twitch', username: 'Mod_1' }], voting: 'me' });
  assert.equal(battle.now().setup.size, 16);

  // Open for songs: Jarchi Battle gets the setup (moderators off: none; voting is Jarchi's own), then the battle.
  await assert.rejects(battle.create({ topic: '  ' }), { code: 'battle_bad', field: 'topic' });
  st = await battle.create({ topic: ' 2000s hits ' });
  assert.deepEqual(jb.asked.at(-2).body, {
    topic: '2000s hits',
    size: 16,
    perViewer: 1,
    sources: ['youtube', 'spotify', 'soundcloud'],
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

  // Remove, then Start (2 songs at least).
  st = await battle.remove(song(3).id);
  assert.equal(jb.asked.at(-1).at, `DELETE /api/app/battles/${ID}/songs/${song(3).id}`);
  assert.deepEqual(
    st.battle.songs.map((s) => s.title),
    ['Song 2', 'Song 9'],
  );
  st = await battle.start();
  assert.equal(st.battle.status, 'live');
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
  assert.equal(jb.asked.at(-1).at, 'GET /api/app/battles/current');

  // Cancel: no battle; the setup is still there for the next one.
  st = await battle.cancel();
  assert.deepEqual([st.battle, st.setup.size], [null, 16]);
  await assert.rejects(battle.start(), { code: 'battle_state' });

  // The key stopped (a newer connection for this channel): not connected, connect again.
  jb.live = false;
  st = await battle.refresh();
  assert.deepEqual([st.state, st.lost, st.error], ['none', true, undefined]);
  assert.ok(!disk().includes('enc:'), 'the key is gone from disk');
});

test("QR code: the page link, as a reference encoder draws it; a text that doesn't fit gets none", () => {
  const qr = require('../core/qr');
  // The modules' fingerprint, made with the qrcode package (npm) for the same text, version 4, level M.
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
  assert.equal(print('https://battle.jarchi.app/mamadpoker'), '508b1b0038e477ef');
  assert.equal(print('https://battle.jarchi.app/some_one-99'), 'eb3b819560a56c75');
  assert.match(qr.svg('https://battle.jarchi.app/mamadpoker'), /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 41 41"/);
  assert.equal(qr.svg(`https://battle.jarchi.app/${'a'.repeat(37)}`), null); // 63 bytes
});
