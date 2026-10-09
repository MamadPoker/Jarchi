// Default alert sounds, synthesized with the Web Audio API. No audio files.
window.JarchiSounds = (() => {
  let ctx;

  // Semitone steps per event type; bigger events get longer phrases.
  const PHRASES = {
    follow: [0, 7],
    sub: [0, 4, 7],
    resub: [0, 4, 7, 12],
    gift_sub: [0, 4, 7, 12, 16],
    kicks: [0, 7, 12, 16, 19],
    bits: [0, 7, 12, 16, 19],
    raid: [0, 0, 7, 7, 12, 12],
  };
  const THEMES = {
    neon: { root: 220, wave: 'sawtooth', step: 0.09, len: 0.4, detune: 10, filter: true, echo: true },
    minimal: { root: 523.25, wave: 'sine', step: 0.15, len: 1.1 },
    fun: { root: 392, wave: 'triangle', step: 0.08, len: 0.28, slide: true, boing: true },
  };

  function note(t, freq, at, len, out) {
    for (const det of t.detune ? [-t.detune, t.detune] : [0]) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = t.wave;
      osc.detune.value = det;
      osc.frequency.setValueAtTime(t.slide ? freq * 0.75 : freq, at);
      if (t.slide) osc.frequency.exponentialRampToValueAtTime(freq, at + 0.06);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.5, at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, at + len);
      osc.connect(g);
      if (t.filter) {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(500, at);
        lp.frequency.exponentialRampToValueAtTime(5000, at + len);
        g.connect(lp).connect(out);
      } else g.connect(out);
      osc.start(at);
      osc.stop(at + len + 0.05);
    }
  }

  function play(theme, type, volume) {
    ctx ??= new AudioContext();
    ctx.resume().catch(() => {}); // OBS allows autoplay; a normal browser tab needs a click first
    const t = THEMES[theme] ?? THEMES.neon;
    const now = ctx.currentTime + 0.02;
    const out = ctx.createGain();
    out.gain.value = volume * 0.4;
    out.connect(ctx.destination);
    if (t.echo) {
      const delay = ctx.createDelay();
      const fb = ctx.createGain();
      delay.delayTime.value = 0.18;
      fb.gain.value = 0.3;
      out.connect(delay).connect(fb).connect(delay);
      delay.connect(ctx.destination);
    }
    const phrase = PHRASES[type] ?? PHRASES.follow;
    phrase.forEach((semi, i) => note(t, t.root * 2 ** (semi / 12), now + i * t.step, t.len, out));
    if (t.boing) note({ wave: 'sine', slide: true }, t.root * 2, now + phrase.length * t.step, 0.5, out);
  }

  return { play };
})();
