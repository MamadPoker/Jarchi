// Default alert sounds, synthesized with the Web Audio API. No audio files.
// Kept soft on purpose: every note is low-passed with a gentle attack, levels are low, and everything
// goes through a master low-pass and a light compressor. No noise bursts, nothing piercing.
// play(theme, type, tier, volume) returns a handle with pause(), so an alert can cut its own sound.
window.JarchiSounds = (() => {
  let ctx, master, noise;

  const LEVEL = 0.16; // overall loudness at volume 100%
  // Each theme is an instrument. root = base pitch (Hz), step = seconds between notes, cutoff = tone filter (Hz),
  // gain = balance between themes (bright waves get less).
  const VOICES = {
    neon: { root: 220, wave: 'sawtooth', cutoff: 900, detune: 6, len: 0.55, step: 0.12, echo: 0.22, gain: 0.73 },
    minimal: { root: 523.25, wave: 'sine', cutoff: 3000, partial: 2, len: 1.1, step: 0.16, gain: 0.55 },
    fun: { root: 392, wave: 'triangle', cutoff: 2400, slide: 0.88, len: 0.35, step: 0.11, gain: 0.8, bloop: true },
    retro: { root: 262, wave: 'square', cutoff: 1300, chiptune: true, len: 0.16, step: 0.1, gain: 0.58 },
    glass: { root: 523.25, wave: 'sine', cutoff: 3200, partial: 2.76, len: 1.6, step: 0.14, echo: 0.22, gain: 0.36 },
    fire: { root: 196, wave: 'sawtooth', cutoff: 700, len: 0.6, step: 0.13, gain: 0.78, whoosh: true },
    ice: { root: 659.25, wave: 'sine', cutoff: 3200, partial: 3.01, len: 1.1, step: 0.11, echo: 0.2, gain: 0.35, sparkle: true },
    galaxy: { root: 196, wave: 'sawtooth', cutoff: 520, detune: 8, attack: 0.18, len: 1.3, step: 0.16, echo: 0.28, gain: 0.77, sweep: true },
    comic: { root: 330, wave: 'triangle', cutoff: 2200, slide: 0.7, len: 0.24, step: 0.1, gain: 0.93, bloop: true },
    simple: { root: 440, wave: 'sine', cutoff: 1800, len: 0.6, step: 0.13, gain: 0.6 }, // plain sine notes, no extras
    kick: { root: 783.99, wave: 'sine', cutoff: 2600, partial: 2, len: 0.5, step: 0.075, echo: 0.12, gain: 0.5 }, // the Kicks alert's Kick look
  };

  // Short major-key phrases (semitones above the root). Tier 0..4 adds a note or two for bigger events.
  const PHRASES = {
    follow: () => [7, 12],
    sub: () => [0, 4, 7],
    resub: () => [0, 4, 7, 12],
    gift_sub: (t) => [0, 4, 7, 9, 12, 16].slice(0, 2 + t),
    kicks: (t) => [0, 7, 12, 16, 19].slice(0, 2 + t),
    bits: (t) => [12, 9, 7, 4, 7, 12].slice(0, 2 + t),
    raid: () => [0, 4, 7, 12, 16],
    kick_gift: () => [0, 7, 12], // short and soft: a quick rising chime
  };
  const hz = (v, semi) => v.root * 2 ** (semi / 12);

  function setup() {
    ctx = new AudioContext();
    const lp = ctx.createBiquadFilter();
    const comp = ctx.createDynamicsCompressor();
    lp.type = 'lowpass';
    lp.frequency.value = 4500;
    comp.threshold.value = -24;
    comp.knee.value = 24;
    comp.ratio.value = 3;
    master = lp;
    lp.connect(comp).connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  function tone(out, v, f, at, len, gain = 1) {
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    const detunes = v.detune ? [-v.detune, v.detune] : [0];
    lp.type = 'lowpass';
    lp.frequency.value = v.cutoff ?? 2500;
    lp.Q.value = 0.5; // no resonant peak
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain / detunes.length, at + (v.attack ?? 0.02));
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    g.connect(lp).connect(out);
    for (const det of detunes) {
      const o = ctx.createOscillator();
      o.type = v.wave;
      o.detune.value = det;
      o.frequency.setValueAtTime(v.slide ? f * v.slide : f, at);
      if (v.slide) o.frequency.exponentialRampToValueAtTime(f, at + 0.08);
      if (v.chiptune) o.frequency.setValueAtTime(f * 2, at + len / 2); // 8-bit octave flick
      o.connect(g);
      o.start(at);
      o.stop(at + len + 0.05);
    }
    if (v.partial) tone(out, { wave: 'sine', cutoff: v.cutoff }, f * v.partial, at, len * 0.5, gain * 0.15); // bell/glass overtone
  }

  // A soft, low-passed breath of air (fire, galaxy). Quiet on purpose.
  function air(out, at, len, from, to) {
    const src = ctx.createBufferSource();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    src.buffer = noise;
    src.loop = true;
    f.type = 'lowpass';
    f.frequency.setValueAtTime(from, at);
    f.frequency.exponentialRampToValueAtTime(to, at + len);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.12, at + len * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    src.connect(f).connect(g).connect(out);
    src.start(at);
    src.stop(at + len);
  }

  // Soft low drum: a sine that drops in pitch, with a short fade-in so it never clicks.
  function thump(out, at, gain) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(110, at);
    o.frequency.exponentialRampToValueAtTime(55, at + 0.3);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.4);
    o.connect(g).connect(out);
    o.start(at);
    o.stop(at + 0.45);
  }

  // A few gentle high bell notes.
  function sparkle(out, v, at, count) {
    const notes = [19, 21, 24, 26, 28];
    for (let i = 0; i < count; i++) {
      tone(out, { wave: 'sine', cutoff: 4000, attack: 0.01 }, hz(v, notes[i % notes.length]), at + i * 0.09, 0.5, 0.18);
    }
  }

  function play(theme, type, tier, volume) {
    if (!ctx) setup();
    ctx.resume().catch(() => {}); // OBS allows autoplay; a normal browser tab needs a click first
    const v = VOICES[theme] ?? VOICES.neon;
    const bus = ctx.createGain();
    const out = ctx.createGain();
    bus.gain.value = volume * LEVEL * v.gain;
    bus.connect(out);
    out.connect(master);
    if (v.echo) { // soft echo: each repeat is quieter and darker
      const delay = ctx.createDelay();
      const fb = ctx.createGain();
      const dark = ctx.createBiquadFilter();
      delay.delayTime.value = 0.25;
      fb.gain.value = v.echo;
      dark.type = 'lowpass';
      dark.frequency.value = 1500;
      bus.connect(delay).connect(dark).connect(fb).connect(delay);
      dark.connect(out);
    }

    let t = ctx.currentTime + 0.03;
    if (type === 'raid') { // a soft drum roll that builds up, then the tune
      for (let i = 0; i < 8; i++) thump(bus, t + i * 0.11, 0.15 + i * 0.06);
      t += 0.95;
      thump(bus, t, 0.8);
    }
    if (type === 'kicks') thump(bus, t, 0.7);
    if (v.whoosh) air(bus, t, 0.7, 200, 900);
    if (v.sweep) air(bus, t, 1.2, 150, 700);

    const notes = PHRASES[type]?.(tier) ?? PHRASES.follow();
    notes.forEach((semi, i) => tone(bus, v, hz(v, semi), t + i * v.step, v.len));
    t += notes.length * v.step;

    // Bigger events land on a gentle chord; raid adds a low root under it.
    if (tier >= 1) {
      const chord = tier >= 3 ? [12, 16, 19, 24] : [12, 16, 19];
      for (const semi of chord) tone(bus, v, hz(v, semi), t, Math.max(v.len * 2, 1.2), 0.35);
    }
    if (tier === 4) tone(bus, { ...v, wave: 'sine', detune: 0 }, hz(v, -12), t, 1.6, 0.6);
    if (type === 'bits' || v.sparkle) sparkle(bus, v, t, 2 + tier);
    if (v.bloop) tone(bus, { wave: 'sine', cutoff: 2000, slide: 0.6 }, hz(v, 12), t + 0.15, 0.3, 0.4);

    return { pause: () => out.disconnect() };
  }

  return { play };
})();
