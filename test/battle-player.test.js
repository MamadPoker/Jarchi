// The player page (panel/js/battle-player.js), run here as it is with a stand-in for SoundCloud's widget: the sound the
// panel asks for (?vol=, { volume }, { muted }) reaches SoundCloud's player, muted being volume 0; and it obeys only the
// panel's own page.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const code = fs.readFileSync(path.join(__dirname, '..', 'panel', 'js', 'battle-player.js'), 'utf8');
const PANEL = 'http://127.0.0.1:3000';

// The page loaded with these query parameters inside a frame of `from`; -> what SoundCloud's widget was told, and how to
// send the page a message as the panel.
async function load(query, from = PANEL) {
  const volumes = [],
    handlers = {},
    listeners = [],
    parent = { postMessage() {} };
  const el = () => ({ append() {} });
  const window = {
    SC: {
      Widget: Object.assign(
        () => ({
          bind: (e, f) => (handlers[e] = f),
          getDuration: (f) => f(200000),
          setVolume: (v) => volumes.push(v),
          play() {},
          pause() {},
          seekTo() {},
        }),
        { Events: { READY: 'ready', PLAY: 'play', PAUSE: 'pause', FINISH: 'finish', PLAY_PROGRESS: 'progress', ERROR: 'error' } },
      ),
    },
  };
  const document = {
    getElementById: el,
    referrer: '',
    createElement: () => ({}),
    head: { append: (s) => s.onload && setImmediate(s.onload) }, // a <script>: "loaded"
  };
  const location = { search: `?${new URLSearchParams(query)}`, port: '3000', ancestorOrigins: [from] };
  Object.assign(window, { document, location, parent });
  vm.runInNewContext(code, {
    window,
    document,
    location,
    parent,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    addEventListener: (type, f) => listeners.push(f),
  });
  await new Promise(setImmediate);
  await new Promise(setImmediate);
  handlers.ready?.();
  const say = (data, origin = PANEL) => listeners.forEach((f) => f({ source: parent, origin, data }));
  return { volumes, say };
}

const SONG = { source: 'soundcloud', link: 'https://soundcloud.com/forss/flickermood' };

test('SoundCloud takes the volume from the panel; muted is volume 0, and unmuted brings the volume back', async () => {
  const p = await load({ ...SONG, vol: '0.4' });
  assert.deepEqual([...new Set(p.volumes)], [40], 'the remembered volume, once the player is ready');
  p.volumes.length = 0;
  p.say({ muted: true });
  p.say({ volume: 0.7 }); // the slider moved while muted: still silent
  p.say({ muted: false });
  p.say({ volume: 2 });
  assert.deepEqual(p.volumes, [0, 0, 70, 100]);
});

test('without ?vol= SoundCloud keeps its own volume; only the panel can change it', async () => {
  const p = await load(SONG);
  assert.deepEqual(p.volumes, []);
  p.say({ volume: 0.1 }, 'https://example.com');
  assert.deepEqual(p.volumes, []);
  const q = await load({ ...SONG, vol: '0.5' }, 'https://example.com'); // inside someone else's page: does nothing
  assert.deepEqual(q.volumes, []);
});
