// Saved settings from an older Jarchi brought up to this one's shape, one version at a time. removeFile: an upload a
// step drops, deleted at the next save (index.js). -> true when anything changed, so the file needs saving.
const { TYPES } = require('../events');
const { VERSION, TIER_AMOUNTS, PROXY_HOST, proxyPort } = require('./schema');

function migrate(saved, removeFile) {
  const from = saved.version ?? 1;
  if (from < 2) {
    // v1 -> v2: an uploaded sound always played; now soundMode picks the sound, so keep those playing.
    for (const a of Object.values(saved.alerts ?? {})) if (a?.sound && !a.soundMode) a.soundMode = 'custom';
  }
  if (from < 3) {
    // v2 -> v3: free tiers (a list with min, images[], sounds[]) became fixed tiers. Each old tier's first image and sound
    // move to the fixed tier at or below its minimum, turned on; extra files go. Raid's old tiers are ignored (see alert()).
    for (const [t, amounts] of Object.entries(TIER_AMOUNTS)) {
      const o = saved.alerts?.[t];
      if (!Array.isArray(o?.tiers)) continue;
      const fixed = {};
      for (const old of o.tiers) {
        const tier = (fixed[amounts.findLast((a) => a <= old.min) ?? amounts[0]] ??= { on: true });
        for (const [kind, files] of [
          ['image', old.images],
          ['sound', old.sounds],
        ])
          for (const f of files ?? [])
            if (tier[kind]) removeFile(f);
            else tier[kind] = f;
      }
      o.tiers = fixed;
    }
  }
  if (from < 4 && Object.keys(saved).length) {
    // v3 -> v4: "Kick default" became the chat style for new users. Someone who already used Jarchi without picking a
    // style had Classic: keep it.
    (saved.chat ??= {}).style ??= 'classic';
  }
  if (from < 5) {
    // v4 -> v5: the bits tiers became Twitch's gems (1, 100, 1000, 5000, 10000). The old 500 tier's files move to the 100
    // tier where it has none of that kind (else they go), and turn it on if the 500 tier was on.
    const tiers = saved.alerts?.bits?.tiers,
      old = tiers?.[500];
    if (old) {
      const to = (tiers[100] ??= {});
      for (const kind of ['image', 'sound'])
        if (old[kind]) {
          if (to[kind]) removeFile(old[kind]);
          else to[kind] = old[kind];
        }
      to.on ||= !!old.on;
      delete tiers[500];
    }
  }
  if (from < 6) {
    // v5 -> v6: goals split into Kick's and Twitch's, nothing added up. The Sub and Followers goals stay as Kick's (same
    // ids, same OBS links); their "Also count Twitch subs" and Kick/Twitch/Both source go.
    for (const g of Object.values(saved.goals ?? {})) {
      delete g?.countTwitch;
      delete g?.source;
    }
  }
  if (from < 7 && Object.keys(saved).some((k) => k !== 'version')) {
    // v6 -> v7: the welcome tour is for the first run. Someone who already set Jarchi up doesn't get it.
    saved.welcomed ??= true;
  }
  if (from < 8) {
    // v7 -> v8: an alert's one font and one outline/shadow switch became the name's and the message's own. Both keep the
    // old choice.
    for (const a of Object.values(saved.alerts ?? {})) {
      if (a?.font) {
        a.nameFont ??= a.font;
        a.textFont ??= a.font;
        delete a.font;
      }
      if (a?.textShadow === false) a.nameShadow ??= false;
    }
  }
  if (from < 9) {
    // v8 -> v9: one Alert size for every alert (at the top of the Alerts page) became each alert's own (Style tab). Each
    // starts with the old one; a size over 1 (from before the alerts filled the source) was read as 1.
    if (saved.alertSize < 1) for (const t of TYPES) ((saved.alerts ??= {})[t] ??= {}).size ??= Math.max(saved.alertSize, 0.5);
    delete saved.alertSize;
  }
  if (from < 10) {
    // v9 -> v10: the default proxy mode is Off (was Auto), so an install that never chose one is Off now. Auto with the
    // VPN app the streamer said Yes to (proxyFound) is Manual with that proxy: what Yes sets from now on.
    const f = saved.proxyFound;
    if (
      saved.proxyMode === 'auto' &&
      f &&
      proxyPort(f.port) &&
      f.port > 0 &&
      typeof f.host === 'string' &&
      PROXY_HOST.test(f.host) &&
      ['http', 'socks5'].includes(f.type)
    ) {
      Object.assign(saved, { proxyMode: 'manual', proxyType: f.type, proxyHost: f.host, proxyPort: f.port });
    }
    delete saved.proxyFound;
  }
  if (from >= VERSION) return false;
  saved.version = VERSION;
  return true;
}

module.exports = { migrate };
