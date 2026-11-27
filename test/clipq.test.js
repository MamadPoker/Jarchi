// ClipQ (core/clipq.js): which chat words are clip links, and the queue chat fills while it's open: one clip per
// link, the limit per viewer, repeated links, mods' commands (only with their switches on and a mod or broadcaster
// badge), !block until the queue closes. Nothing goes out: the sites' lookups are stubbed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.JARCHI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jarchi-clipq-'));
global.fetch = async () => ({ ok: false }); // YouTube's titles
require('../connectors/kick-chat').kickGet = async () => ({ status: 404, json: null }); // Kick's
const clipq = require('../core/clipq');
const { chatMessage } = require('../core/events');

const ALL = ['youtube', 'instagram', 'twitch', 'kick'];
const say = (text, login = 'viewer', badges = []) =>
  clipq.heard(chatMessage({ platform: login === 'tw' ? 'twitch' : 'kick', text, user: { login, name: login, badges } }));
const mod = (text) => say(text, 'amod', [{ type: 'moderator', name: 'moderator' }]);
const yt = (n) => `https://youtu.be/abcdefghij${n}`;
const keys = () => [clipq.state().now, ...clipq.state().queue].filter(Boolean).map((c) => c.key);
function fresh(settings = {}) {
  clipq.setOpen(false);
  while (clipq.state().played.length) clipq.back();
  while (clipq.state().now) clipq.remove(clipq.state().now.id);
  clipq.update({
    sources: ALL,
    perViewer: 0,
    noRepeats: true,
    mods: false,
    commands: { skip: true, remove: true, block: true, open: true, close: true },
    ...settings,
  });
  clipq.setOpen(true);
}

test('clip links: each site, written any way; other links and words are not clips', () => {
  const found = clipq.clipsIn(
    [
      'look youtube.com/watch?v=dQw4w9WgXcQ&t=10 and https://youtu.be/dQw4w9WgXcQ!',
      'https://www.youtube.com/shorts/aqz-KE-bpKQ',
      'm.youtube.com/watch?feature=x&v=aqzKEbpKQ01',
      'https://www.instagram.com/reel/C9abcdEFgh/?igsh=x instagram.com/someone/reel/C9abcdEFgi',
      'https://www.instagram.com/p/C9abcdEFgj/',
      'https://clips.twitch.tv/DeliciousDelightfulPicklesWOOP-abc123 twitch.tv/xqc/clip/OtherClip-x1 https://clips.twitch.tv/embed?clip=x',
      'https://kick.com/xqc/clips/clip_01H811MXG4FBR62FXPE1AXABDH (kick.com/xqc?clip=clip_01H6QY1H0QCE582N739JNZTD3Q)',
      'https://www.youtube.com/@channel https://twitch.tv/xqc https://kick.com/xqc https://example.com/watch?v=dQw4w9WgXcQ hello',
    ].join(' '),
    ALL,
  );
  assert.deepEqual(
    found.map((c) => [c.key, c.link, c.vertical]),
    [
      ['youtube:dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', false],
      ['youtube:dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', false],
      ['youtube:aqz-KE-bpKQ', 'https://www.youtube.com/shorts/aqz-KE-bpKQ', true],
      ['youtube:aqzKEbpKQ01', 'https://www.youtube.com/watch?v=aqzKEbpKQ01', false],
      ['instagram:C9abcdEFgh', 'https://www.instagram.com/reel/C9abcdEFgh/', true],
      ['instagram:C9abcdEFgi', 'https://www.instagram.com/reel/C9abcdEFgi/', true],
      ['instagram:C9abcdEFgj', 'https://www.instagram.com/p/C9abcdEFgj/', true],
      ['twitch:DeliciousDelightfulPicklesWOOP-abc123', 'https://clips.twitch.tv/DeliciousDelightfulPicklesWOOP-abc123', false],
      ['twitch:OtherClip-x1', 'https://clips.twitch.tv/OtherClip-x1', false],
      ['kick:clip_01H811MXG4FBR62FXPE1AXABDH', 'https://kick.com/xqc/clips/clip_01H811MXG4FBR62FXPE1AXABDH', false],
      ['kick:clip_01H6QY1H0QCE582N739JNZTD3Q', 'https://kick.com/xqc/clips/clip_01H6QY1H0QCE582N739JNZTD3Q', false],
    ],
  );
  assert.deepEqual(
    clipq.clipsIn('https://youtu.be/dQw4w9WgXcQ https://clips.twitch.tv/SomeClip', ['twitch']).map((c) => c.source),
    ['twitch'],
  );
});

test('the queue: only while open, the first clip waits in the player, per viewer, no repeats, Next', () => {
  fresh({ perViewer: 2 });
  clipq.setOpen(false);
  say(yt(1));
  assert.deepEqual(keys(), []); // closed: nothing is picked up
  clipq.setOpen(true);
  say(`${yt(1)} ${yt(2)} ${yt(3)}`); // the third is over this viewer's 2
  say(yt(1), 'other'); // a repeat
  say(`hi ${yt(4)}`, 'tw');
  assert.deepEqual(keys(), ['youtube:abcdefghij1', 'youtube:abcdefghij2', 'youtube:abcdefghij4']);
  assert.equal(clipq.state().now.by.name, 'viewer');
  assert.equal(clipq.state().now.title, ''); // YouTube didn't answer: the panel names it by its site
  clipq.next('not-this-one'); // another window's Next for a clip already gone: nothing
  assert.equal(clipq.state().now.key, 'youtube:abcdefghij1');
  clipq.next(clipq.state().now.id);
  say(yt(5)); // the played one no longer counts against this viewer
  assert.deepEqual(keys(), ['youtube:abcdefghij2', 'youtube:abcdefghij4', 'youtube:abcdefghij5']);
  clipq.clear(); // the waiting ones; the clip in the player stays
  assert.deepEqual(keys(), ['youtube:abcdefghij2']);
  say(yt(1), 'third'); // played since the queue opened: still a repeat
  assert.deepEqual(keys(), ['youtube:abcdefghij2']);
  clipq.update({ noRepeats: false });
  say(yt(1), 'third');
  assert.deepEqual(keys(), ['youtube:abcdefghij2', 'youtube:abcdefghij1']);
});

test('Previous and Played: a clip Next took out comes back, the one in the player goes back to the top of Up next', () => {
  fresh();
  say(`${yt(1)} ${yt(2)} ${yt(3)}`);
  const played = () => clipq.state().played.map((c) => c.key);
  clipq.back();
  assert.deepEqual(keys(), ['youtube:abcdefghij1', 'youtube:abcdefghij2', 'youtube:abcdefghij3']); // nothing played yet
  clipq.next();
  clipq.next();
  assert.deepEqual(played(), ['youtube:abcdefghij2', 'youtube:abcdefghij1']); // the last one first
  clipq.back(undefined, 'not-this-one'); // another window's Previous, for a clip already gone: nothing
  assert.equal(clipq.state().now.key, 'youtube:abcdefghij3');
  clipq.back(undefined, clipq.state().now.id); // Previous
  assert.deepEqual(keys(), ['youtube:abcdefghij2', 'youtube:abcdefghij3']);
  assert.deepEqual(played(), ['youtube:abcdefghij1']);
  clipq.back(clipq.state().played[0].id); // Played's clip 1
  assert.deepEqual(keys(), ['youtube:abcdefghij1', 'youtube:abcdefghij2', 'youtube:abcdefghij3']);
  assert.deepEqual(played(), []);
  for (let n = 4; n <= 9; n++) say(yt(n), `v${n}`);
  while (clipq.state().now) clipq.next(); // to the end: an empty player, Previous still works
  assert.equal(played().length, 5); // only the last 5
  clipq.back();
  assert.equal(clipq.state().now.key, 'youtube:abcdefghij9');
});

test("an Instagram clip's video, from its embed page: only a .mp4 on Instagram's CDN", () => {
  const page = (media) =>
    `<script>x.init([{"isSidecar":false,"contextJSON":${JSON.stringify(JSON.stringify({ gql_data: { shortcode_media: media } }))}}])</script>`;
  const mp4 = 'https://instagram.fadb6-5.fna.fbcdn.net/o1/v/t16/f2/m69/AQPf.mp4?strext=1&oh=00_x&oe=6B0E424A';
  assert.equal(clipq.igVideo(page({ is_video: true, video_duration: 71.4, video_url: mp4 })), mp4);
  assert.equal(clipq.igVideo(page({ is_video: false, display_url: 'https://scontent.cdninstagram.com/a.jpg' })), null); // a photo
  assert.equal(clipq.igVideo(page({ video_url: 'https://evil.example/x.mp4' })), null);
  assert.equal(clipq.igVideo(page({ video_url: 'javascript:alert(1)//.fbcdn.net/x.mp4' })), null);
  assert.equal(clipq.igVideo('<html>Instagram changed its page</html>'), null);
  assert.equal(clipq.igVideo('"contextJSON":"{not json"'), null);
});

test("mods' commands: off until allowed, each with its switch, only with a mod or broadcaster badge", () => {
  fresh();
  say(`${yt(1)} ${yt(2)} ${yt(3)} ${yt(4)}`);
  mod('!skip');
  assert.equal(keys().length, 4); // "Mods can manage the queue" is off
  clipq.update({ mods: true });
  say('!skip'); // no badge
  say('!skip', 'vip', [{ type: 'vip', name: 'vip' }]);
  assert.equal(keys().length, 4);
  mod('!SKIP');
  assert.deepEqual(keys(), ['youtube:abcdefghij2', 'youtube:abcdefghij3', 'youtube:abcdefghij4']);
  mod('!remove ۲'); // Up next's number 2, typed on a Persian keyboard
  assert.deepEqual(keys(), ['youtube:abcdefghij2', 'youtube:abcdefghij3']);
  mod('!remove 9');
  mod('!remove x');
  assert.equal(keys().length, 2);
  clipq.update({ commands: { skip: false } });
  say('!skip', 'boss', [{ type: 'broadcaster', name: 'broadcaster' }]);
  assert.equal(keys().length, 2); // that command is switched off
  clipq.update({ commands: { skip: true } });
  say('!skip', 'boss', [{ type: 'broadcaster', name: 'broadcaster' }]);
  assert.deepEqual(keys(), ['youtube:abcdefghij3']);
  say(`!skip ${yt(7)}`); // a command's links aren't clips
  assert.deepEqual(keys(), ['youtube:abcdefghij3']);
});

test('!block keeps a viewer out until the queue closes; !clipq close closes it, !clipq open opens it', () => {
  fresh({ mods: true });
  mod('!block @Spam_Guy'); // Kick's login for Spam_Guy is spam-guy
  say(yt(1), 'spam-guy');
  say(yt(2), 'fan');
  assert.deepEqual(keys(), ['youtube:abcdefghij2']);
  mod('!clipq close');
  assert.equal(clipq.state().open, false);
  clipq.setOpen(true);
  say(yt(1), 'spam-guy'); // a new queue: not blocked any more
  assert.deepEqual(keys(), ['youtube:abcdefghij2', 'youtube:abcdefghij1']);
  clipq.update({ commands: { close: false } });
  mod('!clipq close');
  assert.equal(clipq.state().open, true);
  clipq.setOpen(false);
  say('!clipq open'); // no badge
  clipq.update({ commands: { open: false } });
  mod('!clipq open'); // its switch is off
  assert.equal(clipq.state().open, false);
  clipq.update({ commands: { open: true }, mods: false });
  mod('!clipq open'); // "Mods can manage the queue" is off
  assert.equal(clipq.state().open, false);
  clipq.update({ mods: true });
  say('!ClipQ Open', 'boss', [{ type: 'broadcaster', name: 'broadcaster' }]);
  assert.equal(clipq.state().open, true);
});

test('settings: kept in clipq.json, one bad field changes nothing', () => {
  clipq.update({ perViewer: 3, showSender: false });
  assert.throws(() => clipq.update({ perViewer: 5, showSender: true }), /bad_request/);
  assert.throws(() => clipq.update({ sources: [] }), /bad_request/);
  assert.throws(() => clipq.update({ commands: { dance: true } }), /bad_request/);
  const disk = JSON.parse(fs.readFileSync(path.join(process.env.JARCHI_DATA_DIR, 'clipq.json'), 'utf8'));
  assert.equal(disk.perViewer, 3);
  assert.equal(clipq.get().showSender, false);
  assert.equal(clipq.get().autoNext, false); // off until the streamer turns it on
});
