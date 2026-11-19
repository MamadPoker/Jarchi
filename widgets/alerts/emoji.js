// An emoji played with an animation over the whole overlay, as Jarchi Pay's donation page plays it in its preview
// (Jarchi Pay's donate.css and donate.js preview()), its sizes scaled from that preview's 760 x 427.5 screen to this
// overlay (--k in alerts.css). burst: it pops up big, then bursts into 26 small ones; rain: 40 fall from the top;
// rocket: 14 fly up from the bottom. emoji: { char, image (its picture's URL; none, or one that doesn't load: the
// character) }. play() returns when what comes after it (a crypto alert) should start, in ms: LEAD, the same in
// core/alerts.js. It knows nothing about donations.
window.JarchiEmoji = (() => {
  const LEAD = { burst: 1500, rain: 1800, rocket: 1700 };
  const R = (a, b) => a + Math.random() * (b - a);

  function play(box, { char, image }, animation) {
    const k = Math.min(innerWidth / 760, innerHeight / 427.5),
      px = (n) => `${n * k}px`,
      fx = Object.assign(document.createElement('div'), { className: 'emoji-fx' });
    fx.style.setProperty('--k', String(k));
    // The emoji at a size: its picture, or the character.
    const one = (size) => {
      const t = Object.assign(document.createElement('span'), { className: 'fe', textContent: char });
      t.style.fontSize = size;
      if (!image) return t;
      const img = Object.assign(new Image(), { className: 'fe', src: image, alt: char, draggable: false });
      img.onerror = () => img.replaceWith(t);
      img.style.width = img.style.height = size;
      return img;
    };
    // One of the small ones: its class (the motion), its place and size, and its own --x / --y / --r.
    const bit = (cls, style, vars = {}) => {
      const p = Object.assign(document.createElement('span'), { className: cls });
      Object.assign(p.style, style);
      for (const v in vars) p.style.setProperty(v, vars[v]);
      p.append(one('1em'));
      fx.append(p);
    };
    if (animation === 'burst') {
      const big = Object.assign(document.createElement('div'), { className: 'big1 pl' });
      big.append(one(px(170)));
      fx.append(big);
      setTimeout(() => {
        for (let i = 0; i < 26; i++) {
          const a = Math.random() * Math.PI * 2,
            d = R(160, 420);
          bit('prt', { fontSize: px(R(18, 48)) }, { '--x': px(Math.cos(a) * d), '--y': px(Math.sin(a) * d), '--r': `${R(-360, 360)}deg` });
        }
      }, 1150);
    } else if (animation === 'rain')
      for (let i = 0; i < 40; i++)
        bit(
          'fx rain',
          { left: `${R(0, 96)}%`, fontSize: px(R(20, 46)), animationDuration: `${R(1.2, 2.2)}s`, animationDelay: `${R(0, 1)}s` },
          { '--r': `${R(-200, 200)}deg` },
        );
    else
      for (let i = 0; i < 14; i++)
        bit('fx rk', { left: `${R(5, 90)}%`, fontSize: px(R(26, 60)), animationDelay: `${R(0, 0.7)}s` }, { '--x': px(R(-120, 120)) });
    box.append(fx);
    setTimeout(() => fx.remove(), 3500); // every piece is gone by then
    return LEAD[animation] ?? LEAD.rocket;
  }

  return { LEAD, play };
})();
