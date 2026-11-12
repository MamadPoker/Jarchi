// ---------- Exclusive chat designs: the hidden 👀 ----------
// The 👀 on the profile chip shows with Ctrl+Shift+E (by the key's place, so a Persian keyboard works too; again, it hides)
// or by itself when a Design code message comes (socket 'teamMessages'). The very first time, once no other window (a
// message) is open, everything but the eyes is dimmed and they get a softly pulsing gold frame (no words); a click anywhere
// ends it (on the eyes: it opens them), and it never comes again (settings.eyesSeen). The eyes open "Do you have a code?"
// (a message's Use code: with its code in it, ready to send): a code from Jarchi's team unlocks an exclusive chat design
// (core/designs.js), which then shows in Chat styles.
const eyesUi = {}; // wireEyes: show() the eyes, open(code) the popover
let codeMsg = null; // the Design code message whose Use code filled the popover: closed for good once its code works
const plainCode = (c) => String(c).toUpperCase().replace(/[\s-]/g, '');
function wireEyes() {
  const eyes = $('#eyes'),
    pop = $('#redeemPop'),
    spot = $('#eyesSpot'),
    msg = $('#redeemMsg'),
    code = $('#redeemCode');
  let spotWaits = false; // the first time's frame, until the eyes are full size and no other window is open
  const say = (text, bad = false) => Object.assign(msg, { textContent: text, className: `redeem-msg${bad ? ' bad' : ''}` });
  const close = () => (pop.hidden = true);
  // Beside the eyes (the sidebar's other side), its bottom at theirs; below them if there's no room above.
  const open = (given) => {
    spotWaits = false;
    spot.hidden = true;
    say('');
    if (given) code.value = given;
    pop.hidden = false;
    eyes.scrollIntoView({ block: 'nearest' }); // a short window: the chip may be scrolled out of sight
    const r = eyes.getBoundingClientRect(),
      w = pop.offsetWidth,
      h = pop.offsetHeight;
    const x = document.dir === 'rtl' ? r.left - 12 - w : r.right + 12,
      above = r.bottom - h >= 8;
    // Held by its bottom when it's above: a longer answer (the message line) grows it upward, never off the window.
    Object.assign(pop.style, {
      left: `${Math.max(8, Math.min(x, innerWidth - w - 8))}px`,
      top: above ? 'auto' : `${r.bottom + 8}px`,
      bottom: above ? `${Math.max(8, innerHeight - r.bottom)}px` : 'auto',
    });
    code.focus();
    code.setSelectionRange(code.value.length, code.value.length);
  };
  const place = () => {
    if (!spotWaits || eyes.hidden) return;
    const other = $('dialog[open]');
    if (other) return other.addEventListener('close', place, { once: true });
    spotWaits = false;
    const r = eyes.getBoundingClientRect();
    Object.assign($('span', spot).style, { left: `${r.left - 6}px`, top: `${r.top - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px` });
    spot.hidden = false;
  };
  const show = () => {
    eyes.hidden = false;
    eyes.scrollIntoView({ block: 'nearest' }); // a short window: the sidebar scrolls to it
    if (settings.eyesSeen) return;
    settings.eyesSeen = true; // once, for good
    api('PATCH', '/api/settings', { eyesSeen: true }).then(
      (s) => (settings = s),
      () => {},
    );
    spotWaits = true;
    if (getComputedStyle(eyes).animationName === 'none')
      place(); // Reduce animations
    else eyes.addEventListener('animationend', (ev) => ev.animationName === 'eyes-in' && place(), { once: true });
  };
  eyes.onclick = (e) => {
    e.stopPropagation();
    pop.hidden ? open() : close();
  };
  pop.onclick = (e) => e.stopPropagation();
  addEventListener('click', close);
  spot.onclick = (e) => {
    e.stopPropagation();
    spot.hidden = true;
    const r = eyes.getBoundingClientRect();
    if (e.clientX >= r.left - 6 && e.clientX <= r.right + 6 && e.clientY >= r.top - 6 && e.clientY <= r.bottom + 6) open(); // on the eyes
  };
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !pop.hidden) return close();
    if (!e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey || e.code !== 'KeyE') return;
    e.preventDefault();
    if (eyes.hidden) return show();
    eyes.hidden = spot.hidden = true;
    spotWaits = false;
    close();
  });
  const go = async () => {
    const typed = code.value.trim();
    if (!typed) return code.focus();
    $('#redeemGo').disabled = true;
    try {
      const { name } = await api('POST', '/api/designs/redeem', { code: typed });
      say(`✓ ${tpl(S.panel.redeemDone, { name: name[S.lang] ?? name.en })}`);
      code.value = '';
      if (codeMsg && plainCode(codeMsg.code) === plainCode(typed)) teamDone(codeMsg); // its message: used, closed for good
      codeMsg = null;
      reloadChatStyles();
    } catch (err) {
      say(err.message, true);
    } finally {
      $('#redeemGo').disabled = false;
    }
  };
  $('#redeemGo').onclick = go;
  // Enter sends. A block, not "e.key === 'Enter' && go()": an on-handler that returns false cancels the key (1.0.7: nothing
  // could be typed).
  code.onkeydown = (e) => {
    if (e.key === 'Enter') go();
  };
  Object.assign(eyesUi, { show, open });
}
