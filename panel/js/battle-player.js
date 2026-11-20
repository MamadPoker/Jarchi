// The battle screen's player (battle-player.html): one song in its site's own player (YouTube's, Spotify's or
// SoundCloud's), driven by the panel's buttons (js/battle.js) over postMessage: { play }, { pause }, { seek: seconds }.
// It tells the panel { st: { ready, playing, pos, dur, error } }. Its own page on http://localhost because YouTube
// refuses most music videos (error 150) on a page at http://127.0.0.1, where the panel is, and plays them here. It
// answers only the panel, and does nothing anywhere else.
const q = new URLSearchParams(location.search),
  box = document.getElementById('p'),
  PANEL = [`http://127.0.0.1:${location.port}`, `http://localhost:${location.port}`],
  to = location.ancestorOrigins?.[0] ?? (document.referrer && new URL(document.referrer).origin);
let player = null, // { play, pause, seek(seconds) } once its site's player is ready
  waiting = null, // a command from before that
  st = { ready: false, playing: false, pos: 0, dur: 0, error: false },
  told = 0,
  later;

// To the panel: at once when it starts or stops, else 4 times a second at most (SoundCloud says where it is 30 times).
function tell(patch) {
  const was = st.playing;
  st = { ...st, ...patch };
  clearTimeout(later);
  if (st.playing === was && Date.now() - told < 250) return (later = setTimeout(tell, 250, {}));
  told = Date.now();
  parent.postMessage({ st }, to);
}
const run = (m) => (m.play ? player.play() : m.pause ? player.pause() : Number.isFinite(m.seek) && player.seek(Math.max(0, m.seek)));
function ready(p) {
  player = p;
  tell({ ready: true });
  if (waiting) run(waiting);
  waiting = null;
}
const script = (src) => new Promise((ok, no) => document.head.append(Object.assign(document.createElement('script'), { src, onload: ok, onerror: no })));
const broken = () => tell({ error: true });

function youtube(id) {
  window.onYouTubeIframeAPIReady = () => {
    const YT = window.YT,
      p = new YT.Player(box, {
        videoId: id,
        width: '100%',
        height: '100%',
        playerVars: { rel: 0, playsinline: 1 },
        events: {
          onReady: () => (tell({ dur: p.getDuration() }), ready({ play: () => p.playVideo(), pause: () => p.pauseVideo(), seek: (s) => p.seekTo(s, true) })),
          onStateChange: (e) => tell({ playing: e.data === YT.PlayerState.PLAYING, pos: p.getCurrentTime(), dur: p.getDuration() }),
          onError: broken, // 101 / 150: its owner doesn't let it play outside YouTube
        },
      });
    setInterval(() => st.playing && tell({ pos: p.getCurrentTime() }), 250); // YouTube has no "where it is" event
  };
  script('https://www.youtube.com/iframe_api').catch(broken);
}

// Without Widevine (Jarchi's Electron has none) Spotify's player plays a track's 30-second preview, never all of it.
function spotify(id) {
  window.onSpotifyIframeApiReady = (API) =>
    API.createController(box, { uri: `spotify:track:${id}`, width: '100%', height: '100%' }, (c) => {
      let begun = false; // play() starts from the top: after that, resume() (and play() again once it ended)
      c.addListener('ready', () =>
        ready({
          play: () => (begun && st.pos < st.dur - 0.5 ? c.resume() : c.play(), (begun = true)),
          pause: () => c.pause(),
          seek: (s) => c.seek(s),
        }),
      );
      c.addListener('playback_update', ({ data: d }) => tell({ playing: !d.isPaused, pos: d.position / 1000, dur: d.duration / 1000 }));
    });
  script('https://open.spotify.com/embed/iframe-api/v1').catch(broken);
}

async function soundcloud(url) {
  const f = Object.assign(document.createElement('iframe'), {
    allow: 'autoplay',
    src: `https://w.soundcloud.com/player/?${new URLSearchParams({ url, auto_play: 'false', visual: 'true', show_comments: 'false', hide_related: 'true', show_teaser: 'false', sharing: 'false', buying: 'false', download: 'false' })}`,
  });
  box.append(f);
  try {
    await script('https://w.soundcloud.com/player/api.js');
  } catch {
    return broken();
  }
  const SC = window.SC,
    w = SC.Widget(f),
    E = SC.Widget.Events;
  w.bind(E.READY, () =>
    w.getDuration((d) => (tell({ dur: d / 1000 }), ready({ play: () => w.play(), pause: () => w.pause(), seek: (s) => w.seekTo(s * 1000) }))),
  );
  w.bind(E.PLAY, () => tell({ playing: true }));
  w.bind(E.PAUSE, () => tell({ playing: false }));
  w.bind(E.FINISH, () => tell({ playing: false, pos: st.dur }));
  w.bind(E.PLAY_PROGRESS, (e) => tell({ pos: e.currentPosition / 1000 }));
  w.bind(E.ERROR, broken);
}

if (PANEL.includes(to)) {
  addEventListener('message', (e) => {
    if (e.source !== parent || !PANEL.includes(e.origin) || !e.data || typeof e.data !== 'object') return;
    if (player) run(e.data);
    else waiting = e.data;
  });
  // The link as Jarchi Battle keeps it (one form per site): youtube.com/watch?v=, open.spotify.com/track/, soundcloud.com/.
  let u = null;
  try {
    u = new URL(q.get('link'));
  } catch {}
  const yt = u?.hostname === 'www.youtube.com' && u.searchParams.get('v'),
    sp = u?.hostname === 'open.spotify.com' && u.pathname.match(/^\/track\/([A-Za-z0-9]{22})$/)?.[1];
  if (q.get('source') === 'youtube' && /^[\w-]{11}$/.test(yt || '')) youtube(yt);
  else if (q.get('source') === 'spotify' && sp) spotify(sp);
  else if (q.get('source') === 'soundcloud' && u?.hostname === 'soundcloud.com') soundcloud(u.href);
  else broken();
}
