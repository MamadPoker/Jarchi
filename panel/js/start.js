(async () => {
  EN = await (await fetch('/i18n/en.json')).json();
  S = FA ? await (await fetch('/i18n/fa.json')).json() : EN;
  try {
    [
      settings,
      samples,
      goalData,
      { styles: chatStyles, fonts: chatFonts, exclusive: chatExclusive },
      chatStatus,
      home,
      hist.list,
      twitch,
      kick,
      privacy,
      changelog,
      viewerData,
    ] = await Promise.all([
      api('GET', '/api/settings'),
      api('GET', '/api/samples'),
      api('GET', '/api/goals'),
      api('GET', '/api/chat/styles'),
      api('GET', '/api/chat/status'),
      api('GET', '/api/home'),
      api('GET', '/api/history'),
      api('GET', '/api/twitch'),
      api('GET', '/api/kick'),
      fetch('/i18n/privacy.json').then((r) => r.json()),
      fetch('/i18n/changelog.json')
        .then((r) => r.json())
        .then((l) => l.filter((c) => c.version !== 'unreleased')),
      api('GET', '/api/viewers'),
    ]);
  } catch (err) {
    return toast(err.message, true);
  }
  build();
  if (settings.lang !== S.lang)
    api('PATCH', '/api/settings', { lang: S.lang }).then(
      (s) => (settings = s),
      () => {},
    ); // a crypto alert's hidden name, in this language
  // Back from a language switch: open what was open.
  let back;
  try {
    back = JSON.parse(sessionStorage.getItem('jarchi.back'));
    sessionStorage.removeItem('jarchi.back');
  } catch {}
  const [v, key] = back ?? [location.hash.slice(1)]; // or a page in the address (/#connections: back from Kick's login)
  if (location.hash) history.replaceState(null, '', location.pathname);
  const ok =
    v === 'alert'
      ? key in settings.alerts
      : v === 'goal'
        ? key in settings.goals
        : v === 'theme' || v === 'news' || $$('.nav-item').some((b) => b.dataset.view === v);
  select(ok ? v : 'home', ok ? key : undefined);
  if (POP) return; // the Luck pop-out: no What's new, tour or Privacy Policy of its own (the panel has them)
  followUpdates(); // after that first page: What's new by itself after an update
  // The welcome tour: the first run, or back from its language pick (at that step). Else a newer Privacy Policy than
  // the one accepted (also for those who had the tour before there was one).
  let tour;
  try {
    tour = sessionStorage.getItem('jarchi.tour');
    sessionStorage.removeItem('jarchi.tour');
  } catch {}
  if (tour || !settings.welcomed) openTour(Number(tour));
  else if (mustAccept()) showPrivacy(S.lang, true);
})();
