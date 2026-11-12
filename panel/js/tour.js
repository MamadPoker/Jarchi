// ---------- Welcome tour ----------
// Opens by itself on the first run (then settings.welcomed is saved), and from the Guide. Hello speaks both languages
// and picks the panel's: another one reloads the panel in it, back at Connect. Connect shows the Connections page's own
// Kick and Twitch cards (moved in while it's shown), so their states, Twitch's code and Open buttons all work here too.
// Sidebar isn't in the dialog: the sidebar itself, one group of pages at a time (spotTo). Escape or Skip ends it all,
// but Hello waits for the Privacy Policy.
const TOUR = ['hello', 'connect', 'obs', 'sidebar', 'done'];
const SIDEBAR = TOUR.indexOf('sidebar');
// Sidebar's stops, the sidebar's own groups: [the group's name, its pages, first to last]. Main (the pages on top) and
// More (under the line) have no title in the sidebar. Viewer count is a stop of its own, just after Main.
const SPOTS = [
  ['navMain', ['home', 'alert', 'chat', 'goal']],
  ['navViewers', ['viewers']],
  ['navLive', ['queue', 'events']],
  ['navBot', ['bot']],
  ['navContent', ['luck', 'battle', 'clips']],
  ['navDonations', ['donations']],
  ['navSetup', ['connections', 'appearance', 'settings', 'guide']],
  ['navMore', ['about', 'support']],
];
const obsSize = (id) =>
  id === 'alerts'
    ? [800, 600]
    : id.startsWith('viewers-')
      ? [400, 200]
      : CHAT_KEYS.includes(id)
        ? [settings[id].width, settings[id].height]
        : settings.goals[id].style === 'circle'
          ? [400, 400]
          : [800, 200];
const connCards = () => [$('#kcConnect'), $('#twConnect')].map((b) => b.closest('.box'));
let tourStep = 0,
  spot = 0,
  faStrings;

// A step (and in Sidebar, which stop): the dialog for the others, the sidebar's spotlight for Sidebar.
async function tourTo(n, stop = 0) {
  if (!n) faStrings = await stringsOf('fa'); // Hello's Persian half
  tourStep = n;
  const d = $('#tour');
  (n === SIDEBAR ? d : $('#spot')).close();
  if (n === SIDEBAR) return spotTo(stop);
  renderTour();
  if (!d.open) d.showModal();
  ($('#tourNav').hidden ? $('.tour-langs button:enabled, .tour-agree input') : $('#tourNext')).focus(); // the step's way on
}
function openTour(step = 0) {
  if (!settings.welcomed)
    api('PATCH', '/api/settings', { welcomed: true }).then(
      (s) => (settings = s),
      () => {},
    );
  return tourTo(step);
}

// The sidebar's elements in the stop's group: its pages, the titles among them and the group's own title above them.
function spotGroup() {
  const kids = [...$('.nav').children],
    at = (v) => kids.indexOf($(`.nav-item[data-view="${v}"]`)),
    views = SPOTS[spot][1];
  const a = at(views[0]);
  return kids.slice(kids[a - 1]?.matches('.group-title') ? a - 1 : a, at(views.at(-1)) + 1);
}
function spotTo(i) {
  const s = $('#spot'),
    W = S.panel.welcome,
    [name, views] = SPOTS[i];
  spot = i;
  $('#spotTitle').textContent = S.panel[name];
  $('#spotCount').textContent = fd(`${i + 1}/${SPOTS.length}`);
  $('#spotCount').ariaLabel = tpl(W.stepOf, { n: fd(i + 1), total: fd(SPOTS.length) });
  $('#spotItems').replaceChildren(
    ...views.map((v) =>
      el('li', {}, el('b', { textContent: $(`.nav-item[data-view="${v}"] [data-i18n]`).textContent }), el('span', { textContent: W.pages[v] })),
    ),
  );
  const group = spotGroup();
  group.at(-1).scrollIntoView({ block: 'nearest' }); // a sidebar taller than the window (large text) scrolls to it
  group[0].scrollIntoView({ block: 'nearest' });
  const first = !s.open;
  s.classList.toggle('still', first); // the first stop shows at once, no glide in from the corner
  if (first) s.showModal();
  placeSpot();
  void s.offsetWidth; // (that's where the next glide starts)
  s.classList.remove('still');
  $('#spotNext').focus();
}
// The bright hole around the group, and the popover beside it: right of it, left in Persian, under it where there's no
// room beside it (the narrow layout's sidebar on top). Always inside the window.
// ponytail: the narrow layout's wrapped rows make the hole the group's whole bounding box, other pages included.
function placeSpot() {
  const rs = spotGroup()
      .map((k) => k.getBoundingClientRect())
      .filter((r) => r.width),
    pad = 6,
    gap = 14,
    m = 8;
  const left = Math.min(...rs.map((r) => r.left)) - pad,
    right = Math.max(...rs.map((r) => r.right)) + pad;
  const top = Math.min(...rs.map((r) => r.top)) - pad,
    bottom = Math.max(...rs.map((r) => r.bottom)) + pad;
  Object.assign($('.spot-hole').style, { left: px(left), top: px(top), width: px(right - left), height: px(bottom - top) });
  const pop = $('.spot-pop'),
    w = pop.offsetWidth,
    h = pop.offsetHeight;
  let x = FA ? left - gap - w : right + gap,
    y = top;
  if (x < m || x + w > innerWidth - m) [x, y] = [FA ? right - w : left, bottom + gap];
  Object.assign(pop.style, { left: px(Math.min(Math.max(m, x), innerWidth - w - m)), top: px(Math.min(Math.max(m, y), innerHeight - h - m)) });
}

function renderTour() {
  const W = S.panel.welcome,
    step = TOUR[tourStep],
    body = $('#tourBody'),
    h2 = (text) => el('h2', { textContent: text });
  $('main .connections').prepend(...connCards()); // home again, above the proxy (Connect takes them back)
  $('#tourDots').replaceChildren(...TOUR.map((s) => el('i', { className: s === step ? 'on' : '' })));
  $('#tourDots').ariaLabel = tpl(W.stepOf, { n: fd(tourStep + 1), total: fd(TOUR.length) });
  $('#tourNav').hidden = step === 'hello'; // its language buttons go on
  $('#tourSkip').hidden = step === 'done';
  $('#tourNext').textContent = step === 'done' ? W.finish : S.panel.next;
  body.className = `tour-body tour-${step}`;
  if (step === 'hello') {
    const say = (s) => el('div', { lang: s.lang, dir: s.dir }, h2(s.panel.welcome.hello), el('p', { textContent: s.panel.welcome.about }));
    const agreed = !mustAccept();
    const langs = [
      ['en', 'English'],
      ['fa', 'فارسی'],
    ].map(([lang, name]) =>
      el('button', {
        className: 'primary',
        lang,
        textContent: name,
        disabled: !agreed,
        onclick: async () => {
          if (mustAccept()) await acceptPrivacy(); // saved before a reload into the other language
          if (lang === S.lang) return tourTo(1);
          try {
            sessionStorage.setItem('jarchi.tour', '1');
          } catch {}
          setLang(lang);
        },
      }),
    );
    // "I have read and accept the Privacy Policy" in both languages, each one's link opening the policy in it.
    const agree = (s) => {
      const [a, b] = s.panel.privacyAgree.split('{policy}');
      return el(
        'span',
        { lang: s.lang, dir: s.dir },
        a,
        el('button', { className: 'link', textContent: s.panel.privacyPolicy, onclick: () => showPrivacy(s.lang) }),
        b,
      );
    };
    const box = el('input', { type: 'checkbox', checked: agreed, onchange: () => langs.forEach((b) => (b.disabled = !box.checked)) });
    body.replaceChildren(
      el('img', { className: 'tour-logo', src: '/assets/brand/jarchi-logo-v2.png', alt: 'Jarchi' }),
      say(EN),
      say(faStrings),
      el('div', { className: 'tour-langs' }, ...langs),
      el('label', { className: 'tour-agree' }, box, el('span', { className: 'stack' }, agree(EN), agree(faStrings))),
    );
  }
  if (step === 'connect') body.replaceChildren(h2(W.connectTitle), ...connCards(), el('p', { className: 'tip', textContent: W.profileNote }));
  if (step === 'obs') {
    body.replaceChildren(
      h2(W.obsTitle),
      el('small', { textContent: W.obsHint }),
      el(
        'ul',
        { className: 'tour-links' },
        ...widgetPages()
          .filter(([id]) => widgetOn(id))
          .map(([id, name, url]) =>
            el(
              'li',
              {},
              el('span', { className: 'stack' }, el('b', { textContent: name }), el('code', { dir: 'ltr', textContent: url })),
              el('small', { dir: 'ltr', textContent: fd(obsSize(id).join(' × ')) }),
              copyBtn(name, url),
            ),
          ),
      ),
      el(
        'ol',
        { className: 'steps' },
        ...W.obsSteps.map((text, i) =>
          el('li', { className: 'step' }, el('span', { className: 'step-n', textContent: fd(i + 1) }), el('p', {}, ...rich(text))),
        ),
      ),
    );
  }
  if (step === 'done') {
    const test = $('#homeTest').cloneNode(true); // Home's "Send test alert": a random alert to OBS
    test.id = 'tourTest';
    test.onclick = () => $('#homeTest').click();
    body.replaceChildren(
      svgIn('tour-check', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'),
      h2(W.doneTitle),
      el('p', { textContent: W.doneHint }),
      test,
    );
  }
}

function wireTour() {
  const d = $('#tour'),
    s = $('#spot'),
    W = S.panel.welcome;
  d.ariaLabel = W.title;
  $$('#tourSkip, #spotSkip').forEach((b) => (b.textContent = W.skip));
  $$('#tourBack, #spotBack').forEach((b) => (b.textContent = W.back));
  $('#spotNext').textContent = S.panel.next;
  $('#tourSkip').onclick = () => d.close();
  $('#tourBack').onclick = () => tourTo(tourStep - 1, SPOTS.length - 1); // from Done: Sidebar's last stop
  $('#tourNext').onclick = () => (tourStep < TOUR.length - 1 ? tourTo(tourStep + 1) : d.close());
  d.onclose = () => $('main .connections').prepend(...connCards());
  $('#spotSkip').onclick = () => s.close();
  $('#spotBack').onclick = () => (spot ? spotTo(spot - 1) : tourTo(SIDEBAR - 1));
  $('#spotNext').onclick = () => (spot < SPOTS.length - 1 ? spotTo(spot + 1) : tourTo(SIDEBAR + 1));
  const follow = () => s.open && placeSpot(); // the window resized, the page or the sidebar scrolled
  addEventListener('resize', follow);
  addEventListener('scroll', follow, true);
  $('#tourAgain').onclick = () => openTour();
}
