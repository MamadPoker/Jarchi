// ---------- Support ----------
// My tickets on Jarchi's relay (/api/support, core/support.js), once the Privacy Policy is accepted: the list (again
// every 5 minutes and when the page opens; an admin reply not opened yet puts a dot on Support in the sidebar), the New
// ticket form, or one ticket as a chat with its reply box (none while it's closed). Screenshots are made small here
// before they go (shrinkShot). Every 15 seconds while the page is on screen; a new admin reply rings softly (the
// page's sound switch, remembered in this browser).
const support = { tickets: [], error: '', mode: 'list', open: null, loaded: false, asked: 0 }; // mode: list | new | ticket; open: the ticket shown, with its messages; asked: when the list was last asked for
let formShots, replyShots; // the screenshots picked for a new ticket / a reply (wireShots)
const SHOTS = 3,
  SHOT_PX = 1920,
  SHOT_BYTES = 2 * 1024 * 1024,
  SHOT_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const shotUrl = (id, name) => `/api/support/tickets/${id}/images/${name}`;
const statusPill = (s) => el('span', { className: `pill tk-${s}`, textContent: S.panel.ticketStatus[s] });
const TRASH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
// Each category's icon (Data request and any unknown one: the grey bubble), as in Jarchi Admin's colors.
const CAT_ICON = {
  bug: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 8a3 3 0 0 1 6 0"/><rect x="7" y="8" width="10" height="12" rx="5"/><path d="M12 12v8M7 12H4M17 12h3M7.5 16.5 5 18M16.5 16.5 19 18M10.3 5.6 9 4M13.7 5.6 15 4"/></svg>',
  suggestion: POINT_ICON.why, // a light bulb
  question:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .9-1 1.5v.4M12 17h.01"/></svg>',
  data: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  crypto:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M14.8 9.2a2.8 2.8 0 0 0-2.8-1.7c-1.6 0-2.8.9-2.8 2.1 0 2.9 5.6 1.5 5.6 4.5 0 1.2-1.2 2.2-2.8 2.2a2.9 2.9 0 0 1-2.8-1.8M12 6v1.5M12 16.3v1.7"/></svg>',
};
// A category's icon and name (cat-<category> gives its color): the list's badge, the New ticket form's choice.
function catTag(c, cls = '') {
  const known = CAT_ICON[c] ? c : 'data',
    s = svgIn(`cat-${known} ${cls}`, CAT_ICON[known]);
  s.append(S.panel.ticketCats[c] ?? c);
  return s;
}
// Who wrote last (the relay's lastAuthor; an older relay's list: an unread one is the admin's, a lone message mine).
const lastAuthor = (t) => t.lastAuthor ?? (t.unread ? 'admin' : t.messages === 1 ? 'user' : undefined);
const replyState = (t) =>
  t.status === 'closed' || !lastAuthor(t)
    ? ''
    : lastAuthor(t) === 'admin'
      ? el('span', { className: 'pill tk-answered', textContent: S.panel.ticketAnswered })
      : el('span', { className: 'pill tk-waiting', textContent: S.panel.ticketWaiting });
const SOUND = 'jarchi.ticketSound'; // 'off', or on
let audio;
// A new reply: two soft rising notes, made here (no sound file).
function ding() {
  if (remember.get(SOUND) === 'off') return;
  try {
    audio ??= new AudioContext();
    audio.resume();
    const t = audio.currentTime;
    for (const [hz, at] of [
      [880, 0],
      [1320, 0.13],
    ]) {
      const o = new OscillatorNode(audio, { frequency: hz }),
        g = new GainNode(audio, { gain: 0.0001 });
      g.gain.exponentialRampToValueAtTime(0.07, t + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.4);
      o.connect(g).connect(audio.destination);
      o.start(t + at);
      o.stop(t + at + 0.45);
    }
  } catch {}
}

function loadTickets() {
  if (mustAccept()) return renderSupport();
  support.asked = Date.now();
  api('GET', '/api/support/tickets')
    .then(
      (list) => {
        // A new admin reply since the last list (not on the first one): a ticket unread with more messages than before.
        const before = new Map(support.tickets.map((t) => [t.id, t.messages]));
        if (support.loaded && list.some((t) => t.unread && t.messages > (before.get(t.id) ?? 0))) ding();
        support.tickets = list;
        support.loaded = true;
        support.error = '';
        // The ticket open on the page right now: a reply shown at once (opening it again); the team seeing it, too.
        const shown = view === 'support' && support.mode === 'ticket' && list.find((t) => t.id === support.open.id);
        if (shown?.unread) openTicket(shown.id);
        else if (shown && shown.teamSeenAt !== support.open.teamSeenAt) {
          support.open.teamSeenAt = shown.teamSeenAt;
          renderThread();
        }
      },
      (err) => (support.error = err.message),
    )
    .finally(renderSupport);
}

function renderSupport() {
  const ok = !mustAccept();
  $('#supportPrivacy').hidden = ok;
  for (const [sel, mode] of [
    ['#ticketsBox', 'list'],
    ['#ticketForm', 'new'],
    ['#ticketView', 'ticket'],
  ])
    $(sel).hidden = !ok || support.mode !== mode;
  $('#ticketList').replaceChildren(
    ...support.tickets.map((t) =>
      el(
        'li',
        {},
        el(
          'button',
          { className: 'ticket-row', onclick: () => openTicket(t.id) },
          el(
            'span',
            { className: 'stack' },
            el('b', { textContent: t.subject, dir: 'auto' }),
            el(
              'span',
              { className: 'tk-tags' },
              statusPill(t.status),
              catTag(t.category, 'pill tk-cat'),
              replyState(t),
              el('small', { textContent: dateTime(Date.parse(t.updatedAt)) }),
            ),
          ),
          t.unread ? el('span', { className: 'pill unread', textContent: S.panel.ticketUnread }) : '',
        ),
        t.status === 'closed' ? hideButton(t.id) : '',
      ),
    ),
  );
  $('#ticketsEmpty').hidden = support.tickets.length > 0 || !!support.error;
  $('#ticketsError').hidden = !support.error;
  $('#ticketsError span').textContent = support.error;
  $('#supportDot').hidden = !ok || !support.tickets.some((t) => t.unread);
}

// A closed ticket's trash button: a second click (twoClick) takes it off my list. Only off the list: the relay keeps it
// for the admin.
function hideButton(id) {
  const label = el('span'),
    b = el('button', { type: 'button', className: 'ghost ticket-hide', title: S.panel.ticketHide, innerHTML: TRASH }, label);
  twoClick(b, label, '', S.panel.ticketHideConfirm, () =>
    api('PATCH', `/api/support/tickets/${id}`, { hidden: true }).then(
      () => {
        support.tickets = support.tickets.filter((t) => t.id !== id);
        renderSupport();
      },
      (err) => toast(err.message, true),
    ),
  );
  return b;
}

function showSupport(mode) {
  support.mode = mode;
  renderSupport();
  if (mode === 'ticket') renderThread();
  if (mode === 'new') $('#ticketForm').subject.focus();
}

async function openTicket(id) {
  if (support.open?.id !== id) {
    // another ticket: not the last one's half-written reply
    $('#replyForm').reset();
    replyShots.clear();
  }
  try {
    support.open = await api('GET', `/api/support/tickets/${id}`); // read now (the relay marks it)
  } catch (err) {
    return toast(err.message, true);
  }
  const t = support.tickets.find((x) => x.id === id);
  if (t) Object.assign(t, { unread: false, lastAuthor: support.open.messages.at(-1)?.author ?? t.lastAuthor });
  showSupport('ticket');
}

// The open ticket: mine on one side, the admin's on the other, oldest first, scrolled to the newest.
function renderThread() {
  const t = support.open,
    box = $('#ticketThread'),
    closed = t.status === 'closed';
  $('#ticketSubject').textContent = t.subject;
  $('#ticketMeta').textContent = [S.panel.ticketCats[t.category], ltr(`#${t.id}`), dateTime(Date.parse(t.createdAt))].join(' · ');
  Object.assign($('#ticketStatus'), { className: `pill tk-${t.status}`, textContent: S.panel.ticketStatus[t.status] });
  const mine = t.messages.findLastIndex((m) => m.author === 'user');
  box.replaceChildren(
    ...t.messages.flatMap((m, i) => [
      el(
        'li',
        { className: `msg ${m.author === 'user' ? 'me' : 'them'}` },
        el('small', { className: 'who', textContent: m.author === 'user' ? S.panel.ticketYou : S.panel.ticketAdmin }),
        m.text ? el('p', { textContent: m.text, dir: 'auto' }) : '',
        m.images.length
          ? el(
              'span',
              { className: 'msg-shots' },
              ...m.images.map((n) =>
                el('a', { href: shotUrl(t.id, n), target: '_blank', rel: 'noopener' }, el('img', { src: shotUrl(t.id, n), alt: S.panel.ticketShot })),
              ),
            )
          : '',
        el('small', { className: 'when', textContent: dateTime(Date.parse(m.at)) }),
      ),
      ...(i === mine ? receipt(t, m) : []),
    ]),
  );
  box.scrollTop = box.scrollHeight;
  $$('#replyForm textarea, #replyForm button').forEach((e) => (e.disabled = closed));
  $('#replyClosed').hidden = !closed;
}

// Under my last message: Seen (two checks, the time on hover) once the team opened the ticket at or after it (the
// relay's teamSeenAt), else Sent (one check). None from an older relay, which doesn't say.
const SEEN_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12.5l4.5 4.5L17 6.5M13 15.5l1.5 1.5L22 9.5"/></svg>';
function receipt(t, m) {
  if (!('teamSeenAt' in t)) return [];
  const seen = !!t.teamSeenAt && t.teamSeenAt >= m.at;
  const li = el('li', {
    className: `receipt${seen ? ' seen' : ''}`,
    title: seen ? S.panel.ticketSeenAt.replace('{time}', dateTime(Date.parse(t.teamSeenAt))) : '',
  });
  li.innerHTML = seen ? SEEN_ICON : POINT_ICON.collect; // fixed markup: a check
  li.append(seen ? S.panel.ticketSeen : S.panel.ticketSent);
  return [li];
}

// A screenshot as the relay takes it (a PNG, JPG or WebP of at most SHOT_BYTES): one over SHOT_PX on a side, over
// SHOT_BYTES or of another image type is drawn again at most SHOT_PX on a side, as WebP (a lower quality if still too big).
async function shrinkShot(file) {
  const img = await createImageBitmap(file); // not an image: throws
  const k = Math.min(1, SHOT_PX / Math.max(img.width, img.height));
  if (k === 1 && file.size <= SHOT_BYTES && SHOT_TYPES.includes(file.type)) return file;
  const c = el('canvas', { width: Math.round(img.width * k), height: Math.round(img.height * k) });
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  for (const q of [0.9, 0.75, 0.6]) {
    const blob = await new Promise((done) => c.toBlob(done, 'image/webp', q));
    if (blob?.size <= SHOT_BYTES) return blob;
  }
  throw Object.assign(new Error('too big'), { big: true });
}

// A message's screenshots (the New ticket form's, a reply's) in `box`: up to SHOTS, each with its preview and a remove
// button; also pasted ones (Ctrl+V in `field`). -> { list: [{ blob, url }], clear() }
function wireShots(box, field) {
  const list = [];
  const input = el('input', { type: 'file', accept: SHOT_TYPES.join(','), multiple: true, hidden: true });
  const add = el('button', { type: 'button', className: 'shot-add', textContent: S.panel.ticketAddShot, onclick: () => input.click() });
  const draw = () =>
    box.replaceChildren(
      ...list.map((s, i) => {
        const x = el('button', {
          type: 'button',
          className: 'shot-x',
          title: S.panel.ticketRemoveShot,
          onclick: () => {
            URL.revokeObjectURL(s.url);
            list.splice(i, 1);
            draw();
          },
        });
        x.innerHTML = POINT_ICON.never; // ✕
        x.setAttribute('aria-label', S.panel.ticketRemoveShot);
        return el('span', { className: 'shot' }, el('img', { src: s.url, alt: '' }), x);
      }),
      ...(list.length < SHOTS ? [add] : []),
      input,
    );
  const take = async (files) => {
    for (const f of files) {
      if (list.length >= SHOTS) {
        toast(S.errors.support_too_many_images, true);
        break;
      }
      try {
        const blob = await shrinkShot(f);
        list.push({ blob, url: URL.createObjectURL(blob) });
      } catch (err) {
        toast(S.errors[err.big ? 'support_image_too_large' : 'support_bad_image'], true);
      }
    }
    draw();
  };
  input.onchange = () => {
    take([...input.files]);
    input.value = '';
  };
  field.addEventListener('paste', (e) => {
    const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    take(files);
  });
  draw();
  return { list, clear: () => (list.splice(0).forEach((s) => URL.revokeObjectURL(s.url)), draw()) };
}

// A form (a new ticket, a reply) and its screenshots -> the ticket as it is now, or nothing (the error toasted).
async function sendForm(url, form, shots) {
  const data = new FormData(form),
    btn = $('button[type=submit]', form);
  shots.list.forEach((s, i) => data.append('image', s.blob, `screenshot-${i + 1}`));
  btn.disabled = true;
  btn.textContent = S.panel.ticketSending;
  try {
    return await api('POST', url, data);
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = S.panel.ticketSend;
  }
}

function wireSupport() {
  const form = $('#ticketForm'),
    reply = $('#replyForm');
  $('#ticketCats').append(
    ...Object.keys(S.panel.ticketCats).map((v, i) =>
      el('label', {}, el('input', { type: 'radio', name: 'category', value: v, defaultChecked: !i }), catTag(v)),
    ),
  );
  const catHint = () => ($('#ticketCatHint').textContent = S.panel.ticketCatHints[form.category.value]);
  $('#ticketCats').onchange = catHint;
  catHint();
  // The sound for a new reply: on unless switched off here.
  const sound = $('#ticketSound'),
    drawSound = () => {
      const on = remember.get(SOUND) !== 'off';
      sound.setAttribute('aria-pressed', on);
      sound.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="${on ? 'M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13' : 'M16 9.5l5 5M21 9.5l-5 5'}"/></svg>`;
    };
  Object.assign(sound, { title: S.panel.ticketSound, onclick: () => (remember.set(SOUND, remember.get(SOUND) === 'off' ? 'on' : 'off'), drawSound(), ding()) });
  sound.setAttribute('aria-label', S.panel.ticketSound);
  drawSound();
  formShots = wireShots($('#ticketShots'), form.message);
  replyShots = wireShots($('#replyShots'), reply.message);
  $('#ticketNew').onclick = () => showSupport('new');
  $$('.ticket-back').forEach((b) => (b.onclick = () => showSupport('list'))); // a half-written ticket stays for later
  $('#ticketsRetry').onclick = loadTickets;
  $('#supportPrivacyOpen').onclick = () => showPrivacy(S.lang, true);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const t = await sendForm('/api/support/tickets', form, formShots);
    if (!t) return;
    form.reset();
    formShots.clear();
    catHint();
    support.open = t;
    showSupport('ticket');
    loadTickets();
  };
  reply.onsubmit = async (e) => {
    e.preventDefault();
    if (!reply.message.value.trim() && !replyShots.list.length) return reply.message.focus();
    const t = await sendForm(`/api/support/tickets/${support.open.id}/messages`, reply, replyShots);
    if (!t) return;
    reply.reset();
    replyShots.clear();
    support.open = t;
    renderThread();
    loadTickets();
  };
  loadTickets();
  // Every 15 seconds while Support is on screen (not in the tray or minimized), else every 5 minutes.
  setInterval(() => ((view === 'support' && !document.hidden) || Date.now() - support.asked >= 5 * 60e3) && loadTickets(), 15e3);
}
