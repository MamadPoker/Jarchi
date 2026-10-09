// Default alert sounds, synthesized with the Web Audio API. No audio files.
// play(theme, type, tier, volume) returns a handle with pause(), so an alert can cut its own sound.
window.JarchiSounds = (() => {
  let ctx, comp, noise;

  // Each theme is an instrument. root = base pitch (Hz), step = seconds between notes, extras add flavor.
  const VOICES = {
    neon: { root: 220, wave: 'sawtooth', detune: 9, cutoff: 900, len: 0.32, step: 0.085, echo: 0.32, gain: 0.3 },
    minimal: { root: 523.25, wave: 'sine', len: 0.9, step: 0.13, gain: 0.5, partial: 2 },
    fun: { root: 392, wave: 'triangle', slide: 0.7, len: 0.24, step: 0.075, gain: 0.55, boing: true },
    retro: { root: 262, wave: 'square', chiptune: true, len: 0.1, step: 0.065, gain: 0.17 },
    glass: { root: 523.25, wave: 'sine', partial: 2.76, len: 1.4, step: 0.11, echo: 0.3, gain: 0.42 },
    fire: { root: 147, wave: 'sawtooth', cutoff: 700, len: 0.38, step: 0.09, gain: 0.3, whoosh: true },
    ice: { root: 784, wave: 'triangle', partial: 3.01, len: 0.8, step: 0.07, echo: 0.28, gain: 0.3, sparkle: true },
    galaxy: { root: 196, wave: 'sawtooth', detune: 14, cutoff: 600, attack: 0.08, len: 0.9, step: 0.12, echo: 0.42, gain: 0.26, sweep: true },
    comic: { root: 330, wave: 'square', slide: 0.5, len: 0.15, step: 0.08, gain: 0.2, pop: true },
  };

  // Notes (semitones above the root) per event type. Tier 0..4 lengthens the amount-based ones.
  const PHRASES = {
    follow: () => [12, 19],
    sub: () => [0, 4, 7, 12],
    resub: () => [0, 4, 7, 12, 16],
    gift_sub: (t) => [0, 4, 7, 12, 16, 19, 24].slice(0, 3 + t),
    kicks: (t) => [0, 7, 12, 16, 19, 24].slice(0, 2 + t),
    bits: (t) => [24, 19, 16, 12, 16, 19, 24, 28].slice(0, 3 + t),
    raid: () => [0, 4, 7, 12, 7, 12, 16, 19, 24],
  };
  const hz = (v, semi) => v.root * 2 ** (semi / 12);

  function setup() {
    ctx = new AudioContext();
    comp = ctx.createDynamicsCompressor(); // keeps stacked notes from clipping
    comp.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  function tone(out, v, f, at, len, gain = 1) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.6 * gain, at + (v.attack ?? 0.008));
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    if (v.cutoff) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(v.cutoff, at);
      lp.frequency.exponentialRampToValueAtTime(v.cutoff * 6, at + len * 0.6);
      g.connect(lp).connect(out);
    } else g.connect(out);
    for (const det of v.detune ? [-v.detune, v.detune] : [0]) {
      const o = ctx.createOscillator();
      o.type = v.wave;
      o.detune.value = det;
      o.frequency.setValueAtTime(v.slide ? f * v.slide : f, at);
      if (v.slide) o.frequency.exponentialRampToValueAtTime(f, at + 0.07);
      if (v.chiptune) o.frequency.setValueAtTime(f * 2, at + len / 2); // 8-bit octave flick
      o.connect(g);
      o.start(at);
      o.stop(at + len + 0.05);
    }
    if (v.partial) tone(out, { wave: 'sine', attack: 0.004 }, f * v.partial, at, len * 0.5, gain * 0.25); // bell/glass overtone
  }

  function hiss(out, at, len, { type = 'bandpass', from = 800, to = from, q = 1, gain = 0.5 } = {}) {
    const src = ctx.createBufferSource();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    src.buffer = noise;
    src.loop = true;
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(from, at);
    f.frequency.exponentialRampToValueAtTime(to, at + len);
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    src.connect(f).connect(g).connect(out);
    src.start(at);
    src.stop(at + len);
  }

  // Bass drum: a sine that drops in pitch.
  function thump(out, at, gain = 1) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(150, at);
    o.frequency.exponentialRampToValueAtTime(42, at + 0.3);
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.4);
    o.connect(g).connect(out);
    o.start(at);
    o.stop(at + 0.45);
  }

  // Quick high pings, like glitter.
  function sparkle(out, v, at, count) {
    const scale = [0, 2, 4, 7, 9];
    for (let i = 0; i < count; i++) {
      const semi = 24 + scale[Math.floor(Math.random() * 5)] + 12 * Math.floor(Math.random() * 2);
      tone(out, { wave: 'sine', attack: 0.003 }, hz(v, semi), at + i * 0.05 + Math.random() * 0.02, 0.25, 0.3);
    }
  }

  function play(theme, type, tier, volume) {
    if (!ctx) setup();
    ctx.resume().catch(() => {}); // OBS allows autoplay; a normal browser tab needs a click first
    const v = VOICES[theme] ?? VOICES.neon;
    const bus = ctx.createGain();
    const out = ctx.createGain();
    bus.gain.value = volume * v.gain;
    bus.connect(out);
    out.connect(comp);
    if (v.echo) {
      const delay = ctx.createDelay();
      const fb = ctx.createGain();
      delay.delayTime.value = 0.22;
      fb.gain.value = v.echo;
      bus.connect(delay).connect(fb).connect(delay);
      delay.connect(out);
    }

    let t = ctx.currentTime + 0.03;
    if (type === 'raid') { // drum roll that speeds up, then a big hit
      for (let i = 0; i < 16; i++) hiss(bus, t + i * 0.065 * (1 - i / 34), 0.06, { type: 'highpass', from: 2500, gain: 0.2 + i * 0.03 });
      t += 0.85;
      thump(bus, t, 1.3);
    }
    if (type === 'kicks') thump(bus, t, 1);
    if (v.whoosh) hiss(bus, t, 0.5 + tier * 0.1, { from: 300, to: 3500, q: 0.8, gain: 0.5 });
    if (v.sweep) hiss(bus, t, 0.9, { type: 'lowpass', from: 200, to: 4000, gain: 0.25 });
    if (v.pop) hiss(bus, t, 0.08, { type: 'highpass', from: 1500, gain: 0.8 });
    if (v.whoosh || v.sweep) t += 0.12;

    const notes = PHRASES[type]?.(tier) ?? PHRASES.follow();
    notes.forEach((semi, i) => {
      tone(bus, v, hz(v, semi), t + i * v.step, v.len);
      if (v.chiptune && i % 2 === 0) hiss(bus, t + i * v.step, 0.03, { type: 'highpass', from: 6000, gain: 0.15 }); // hi-hat tick
    });
    t += notes.length * v.step;

    // Bigger events land on a chord; the biggest also get a drum hit.
    if (tier >= 1) {
      const chord = tier >= 3 ? [12, 16, 19, 24, 28] : [12, 16, 19, 24];
      for (const semi of chord) tone(bus, v, hz(v, semi), t, Math.max(v.len * 2.5, 0.8), 0.45);
    }
    if (tier >= 3) thump(bus, t, 0.9);
    if (type === 'bits' || v.sparkle) sparkle(bus, v, t, 5 + tier * 2);
    if (v.boing) tone(bus, { wave: 'sine', slide: 0.3 }, hz(v, 12), t + 0.1, 0.45, 0.8);
    if (v.pop && tier >= 2) { // slide whistle
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.setValueAtTime(v.root, t);
      o.frequency.exponentialRampToValueAtTime(v.root * 4, t + 0.4);
      g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      o.connect(g).connect(bus);
      o.start(t);
      o.stop(t + 0.5);
    }

    return { pause: () => out.disconnect() };
  }

  return { play };
})();
