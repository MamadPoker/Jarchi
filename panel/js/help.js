// ---------- Help ("?") and Guide text ----------
// `code` stays left to right (links, {user}), **bold** names a button; {alertsUrl}-style names become this PC's links.
const LINKS = {
  panelUrl: location.origin,
  alertsUrl: `${location.origin}/widgets/alerts`,
  chatUrl: `${location.origin}/widgets/chat`,
  goalSubsUrl: `${location.origin}/widgets/goal/subs`,
  goalKicksUrl: `${location.origin}/widgets/goal/kicks`,
};
const rich = (s) =>
  tpl(s, LINKS)
    .replace(/ × /g, '\u00a0×\u00a0')
    .split('`')
    .flatMap((part, i) =>
      i % 2 // "420 × 600" stays on one line
        ? [el('code', { dir: 'ltr', textContent: part })]
        : part.split('**').map((t, j) => (j % 2 ? el('b', { textContent: t }) : t)),
    );
const helpText = (key) => key.split('.').reduce((o, k) => o?.[k], S.help);

// A "?" after a setting's label (data-help="alert.volume" -> S.help.alert.volume). Its text is the "?"'s
// description for screen readers, and one shared tooltip shows it while the mouse is on the "?", on keyboard focus or a tap.
// The "?" is a <span role="button">, not a <button>: a <label> belongs to its first <button> or <input>, so a <button>
// "?" would take the row's clicks (and focus) away from the row's own switch or field.
let helpCount = 0;
function addHelp(host) {
  const text = helpText(host.dataset.help);
  if (!text) return;
  const desc = el('span', { id: `help-${++helpCount}`, hidden: true, textContent: tpl(text, LINKS).replace(/`|\*\*/g, '') });
  const q = el('span', { className: 'help', tabIndex: 0, textContent: S.panel.helpMark }, desc);
  q.dataset.tip = text;
  q.setAttribute('role', 'button');
  q.setAttribute('aria-label', S.panel.help);
  q.setAttribute('aria-describedby', desc.id);
  host.append(q);
}
// To the side of the "?" (left in English, right in Persian), on the other side if there's no room, inside the window.
function showTip(q) {
  const tip = $('#tip'),
    gap = 8;
  tip.replaceChildren(...rich(q.dataset.tip));
  Object.assign(tip.style, { left: '0px', top: '0px' }); // measured at full width, not squeezed by where it was last
  tip.hidden = false;
  const r = q.getBoundingClientRect(),
    w = tip.offsetWidth,
    h = tip.offsetHeight;
  const left = r.left - gap - w,
    right = r.right + gap;
  const fitsLeft = left >= gap,
    fitsRight = right + w <= innerWidth - gap;
  const x = FA ? (fitsRight || !fitsLeft ? right : left) : fitsLeft || !fitsRight ? left : right;
  Object.assign(tip.style, {
    left: `${Math.min(Math.max(gap, x), innerWidth - w - gap)}px`,
    top: `${Math.min(Math.max(gap, r.top + r.height / 2 - h / 2), innerHeight - h - gap)}px`,
  });
}
const hideTip = () => ($('#tip').hidden = true);
function wireHelp() {
  const helpOf = (e) => e.target.closest?.('.help');
  addEventListener('mouseover', (e) => helpOf(e) && showTip(helpOf(e)));
  addEventListener('mouseout', (e) => {
    if (helpOf(e) && !helpOf(e).contains(e.relatedTarget)) hideTip();
  }); // left the "?"
  addEventListener('focusin', (e) => helpOf(e) && showTip(helpOf(e)));
  addEventListener('focusout', (e) => helpOf(e) && hideTip());
  addEventListener('click', (e) => {
    if (!helpOf(e)) return hideTip(); // a tap anywhere else closes it
    e.preventDefault(); // inside a <label>: don't flip its switch
    showTip(helpOf(e));
  });
  addEventListener('scroll', hideTip, true);
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideTip();
    if (helpOf(e) && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      showTip(helpOf(e));
    } // a role="button": Space doesn't scroll
  });
}

// Guide page: the topic list, then the topic: intro, numbered step cards, a tip, and questions that open their answers.
function renderGuide() {
  $$('#guideTopics button').forEach((b) => b.setAttribute('aria-current', String(b.dataset.topic === topic)));
  const t = S.guide.topics[topic];
  $('#guideBody').replaceChildren(
    el('h2', { textContent: t.title }),
    el('p', { className: 'guide-intro' }, ...rich(t.intro)),
    t.steps.length
      ? el(
          'ol',
          { className: 'steps' },
          ...t.steps.map(([title, text], i) =>
            el(
              'li',
              { className: 'step' },
              el('span', { className: 'step-n', textContent: fd(i + 1) }),
              el('div', {}, el('b', { textContent: title }), el('p', {}, ...rich(text))),
            ),
          ),
        )
      : '',
    t.tip ? el('aside', { className: 'tip' }, el('b', { textContent: S.guide.tip }), el('p', {}, ...rich(t.tip))) : '',
    ...(t.faq ?? []).map(({ q, a }) =>
      el('details', { className: 'faq' }, el('summary', { textContent: q }), el('ul', {}, ...a.map((line) => el('li', {}, ...rich(line))))),
    ),
  );
}

// The panel's language (top bar, Appearance, the welcome tour): the page reloads in it and comes back to what was open.
function setLang(lang) {
  if (lang === S.lang) return;
  remember.set('jarchi.lang', lang);
  try {
    sessionStorage.setItem('jarchi.back', JSON.stringify([view, { alert: cur, goal: curGoal, guide: topic }[view]]));
  } catch {}
  location.reload();
}

// ---------- Privacy Policy ----------
// i18n/privacy.json, in English and Persian, with its version. The tour's Hello doesn't go on (or close) before it's
// accepted; one newer than the version accepted (settings.privacyAccepted) opens by itself to Accept, as "Privacy
// Policy updated" ("Privacy Policy" for someone who never accepted one). The popup switches between the two languages.
const mustAccept = () => settings.privacyAccepted < privacy.version;
const acceptPrivacy = () =>
  api('PATCH', '/api/settings', { privacyAccepted: privacy.version }).then(
    (s) => (settings = s),
    () => {},
  );
// A language's strings: the panel's, English (always loaded) or Persian (fetched once, for an English panel).
const stringsOf = async (lang) => (lang === S.lang ? S : lang === 'en' ? EN : (faStrings ??= await (await fetch('/i18n/fa.json')).json()));
const POINT_ICON = {
  // privacy.json's icons, one per point
  collect: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  never: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>',
  why: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"/></svg>',
  where: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 19a5 5 0 0 1-.6-10A6.5 6.5 0 0 1 18.8 10.5 4.25 4.25 0 0 1 17.5 19z"/></svg>',
  choice: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/></svg>',
};
async function showPrivacy(lang = S.lang, accept = false) {
  const d = $('#privacy');
  d.classList.toggle('accept', accept);
  $('#privacyAgree').hidden = !accept;
  $('#privacyCheck').checked = false;
  $('#privacyOk').disabled = accept; // until it's ticked
  $('#privacyOk').onclick = () => (accept && acceptPrivacy(), d.close());
  await renderPrivacy(lang);
  d.showModal();
}
async function renderPrivacy(lang) {
  const d = $('#privacy'),
    p = privacy[lang],
    P = (await stringsOf(lang)).panel,
    accept = d.classList.contains('accept');
  Object.assign(d, { lang, dir: lang === 'fa' ? 'rtl' : 'ltr' });
  $$('input[name=privacyLang]', d).forEach((r) => (r.checked = r.value === lang));
  $('#privacyTitle').textContent = !accept ? p.title : settings.privacyAccepted ? P.privacyUpdated : P.privacyPolicy;
  $('#privacyVersion').textContent = tpl(P.version, { version: fd(privacy.version, lang === 'fa') });
  $('#privacyText').replaceChildren(
    el('p', { textContent: p.intro }),
    el(
      'ul',
      { className: 'privacy-points' },
      ...p.items.map(([what, text], i) =>
        el(
          'li',
          { className: `pt-${privacy.icons[i]}` },
          svgIn('pt-icon', POINT_ICON[privacy.icons[i]]),
          el('span', { className: 'stack' }, el('b', { textContent: what }), el('span', { textContent: text })),
        ),
      ),
    ),
  );
  $('#privacyAgree span').textContent = tpl(P.privacyAgree, { policy: P.privacyPolicy });
  $('#privacyOk').textContent = accept ? P.privacyAccept : P.updateClose;
}
// Escape doesn't close what waits for the policy to be accepted: the Accept popup, or the tour's Hello (the policy
// opened from it still closes). On keydown, not cancel: a dialog that opened by itself, before any click, can't stop
// its cancel event.
addEventListener('keydown', (e) => {
  const p = $('#privacy'),
    held = p.open ? p.classList.contains('accept') : $('#tour').open && TOUR[tourStep] === 'hello' && mustAccept();
  if (e.key === 'Escape' && held) e.preventDefault();
});
