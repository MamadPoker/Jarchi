// The player page (battle-player.html) of the battle screen and ClipQ: one song or clip in its site's own player
// (YouTube's, Spotify's, SoundCloud's; Kick's clips as a video, with hls.js; Twitch's and Instagram's embeds), driven by
// the panel's buttons (js/battle.js, js/clipq.js) over postMessage: { play } or { pause }, { seek: seconds }, { volume:
// 0..1 }, { muted }, in one message or several. ?vol= and ?muted=1 set the sound, ?play=1 starts it once it's ready.
// It tells the panel { st: { ready, playing, ended, pos, dur, ar (a video's width / height), error } }. Its own page on
// http://localhost because YouTube refuses most music videos (error 150) on a page at http://127.0.0.1, where the panel
// is, and plays them here. It answers only the panel, and does nothing anywhere else.
const q = new URLSearchParams(location.search),
  box = document.getElementById('p'),
  PANEL = [`http://127.0.0.1:${location.port}`, `http://localhost:${location.port}`],
  to = location.ancestorOrigins?.[0] ?? (document.referrer && new URL(document.referrer).origin);
let player = null, // { play, pause, seek(seconds), volume(0..1), mute(on) } once its site's player is ready
  waiting = {
    ...(q.has('vol') && { volume: Number(q.get('vol')), muted: q.get('muted') === '1' }),
    ...(q.get('play') === '1' && { play: true }),
  }, // what to do once it is: the commands from before that
  st = { ready: false, playing: false, ended: false, pos: 0, dur: 0, error: false },
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
function run(m) {
  if (Number.isFinite(m.volume)) player.volume(Math.min(1, Math.max(0, m.volume)));
  if (typeof m.muted === 'boolean') player.mute(m.muted);
  if (Number.isFinite(m.seek)) player.seek(Math.max(0, m.seek));
  if (m.play) player.play();
  else if (m.pause) player.pause();
}
function ready(p) {
  player = { volume() {}, mute() {}, ...p }; // Spotify's and SoundCloud's sound stays theirs
  tell({ ready: true });
  run(waiting);
  waiting = {};
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
          onReady: () => (
            tell({ dur: p.getDuration() }),
            ready({
              play: () => p.playVideo(),
              pause: () => p.pauseVideo(),
              seek: (s) => p.seekTo(s, true),
              volume: (v) => p.setVolume(v * 100),
              mute: (on) => (on ? p.mute() : p.unMute()),
            })
          ),
          onStateChange: (e) =>
            tell({ playing: e.data === YT.PlayerState.PLAYING, ended: e.data === YT.PlayerState.ENDED, pos: p.getCurrentTime(), dur: p.getDuration() }),
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

// A clip's own video. Kick's are HLS (.ts pieces), which Chromium doesn't play by itself: hls.js does, from Jarchi
// (/js/hls.js, the hls.js package's file).
async function video(src) {
  const v = Object.assign(document.createElement('video'), { playsInline: true });
  v.onloadedmetadata = () => {
    tell({ dur: v.duration, ar: v.videoWidth / v.videoHeight });
    ready({
      play: () => v.play().catch(() => {}), // a browser that wants a click first: it stays paused
      pause: () => v.pause(),
      seek: (s) => (v.currentTime = Math.min(s, v.duration || s)),
      volume: (x) => (v.volume = x),
      mute: (on) => (v.muted = on),
    });
  };
  v.onplay = () => tell({ playing: true, ended: false });
  v.onpause = () => tell({ playing: false });
  v.onended = () => tell({ playing: false, ended: true, pos: v.duration });
  v.ontimeupdate = () => tell({ pos: v.currentTime });
  box.append(v);
  try {
    await script('/js/hls.js');
  } catch {
    return broken();
  }
  const Hls = window.Hls;
  if (!Hls?.isSupported()) return broken();
  const h = new Hls();
  h.on(Hls.Events.ERROR, (e, d) => d.fatal && broken());
  h.loadSource(src);
  h.attachMedia(v);
}

// Twitch's clip embed takes no commands and tells nothing (tested): it plays with its own buttons. Play loads it again,
// playing. Twitch wants the page's host as parent, and the panel's (127.0.0.1): it checks every frame above it.
function twitch(slug) {
  const f = Object.assign(document.createElement('iframe'), { allow: 'autoplay; fullscreen' });
  const at = (play) =>
    (f.src = `https://clips.twitch.tv/embed?${new URLSearchParams({ clip: slug, autoplay: String(play) })}&parent=localhost&parent=127.0.0.1`);
  box.append(f);
  ready({ play: () => at(true), pause() {}, seek() {} });
  if (!f.src) at(false);
}
// Instagram's embed: the same, with no way to start it from here at all.
const instagram = (link) => box.append(Object.assign(document.createElement('iframe'), { src: `${link}embed/`, allow: 'autoplay; encrypted-media' }));

if (PANEL.includes(to)) {
  addEventListener('message', (e) => {
    if (e.source !== parent || !PANEL.includes(e.origin) || !e.data || typeof e.data !== 'object') return;
    if (player) run(e.data);
    else waiting = { ...waiting, ...(e.data.play && { pause: false }), ...(e.data.pause && { play: false }), ...e.data };
  });
  // The link as Jarchi Battle and ClipQ (core/clipq.js) keep it, one form per site: youtube.com/watch?v=,
  // open.spotify.com/track/, soundcloud.com/; Kick's clip video, clips.twitch.tv/<slug>, instagram.com/(p|reel)/<code>/.
  let u = null;
  try {
    u = new URL(q.get('link'));
  } catch {}
  const yt = u?.hostname === 'www.youtube.com' && u.searchParams.get('v'),
    sp = u?.hostname === 'open.spotify.com' && u.pathname.match(/^\/track\/([A-Za-z0-9]{22})$/)?.[1],
    tw = u?.hostname === 'clips.twitch.tv' && u.pathname.match(/^\/([\w-]+)$/)?.[1];
  if (q.get('source') === 'youtube' && /^[\w-]{11}$/.test(yt || '')) youtube(yt);
  else if (q.get('source') === 'spotify' && sp) spotify(sp);
  else if (q.get('source') === 'soundcloud' && u?.hostname === 'soundcloud.com') soundcloud(u.href);
  else if (q.get('source') === 'kick' && u?.hostname === 'clips.kick.com' && u.pathname.endsWith('.m3u8')) video(u.href);
  else if (q.get('source') === 'twitch' && tw) twitch(tw);
  else if (q.get('source') === 'instagram' && u?.hostname === 'www.instagram.com' && /^\/(p|reel)\/[\w-]+\/$/.test(u.pathname)) instagram(u.href);
  else broken();
}
