// What the streamer's Kick and Twitch accounts (kick-account.js, twitch-account.js) do the same way. Their logins and
// event sockets differ (Kick: OAuth through the relay and its socket; Twitch: a device code and EventSub), so only
// these small pieces are shared, not a common base.

/** An Error whose code says why ('expired', 'network'). */
const fail = (code) => Object.assign(new Error(code), { code });

/**
 * fn, but one call at a time: a call while one is under way gets the same promise. A refresh token often works only
 * once, so two refreshes at the same time would end the login.
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {() => Promise<T>}
 */
function single(fn) {
  /** @type {Promise<T> | null} */
  let now = null;
  return () => (now ??= fn().finally(() => (now = null)));
}

/** The tokens to keep from an OAuth token answer; one without expires_in lasts an hour. */
const tokens = (j) => ({ access: j.access_token, refresh: j.refresh_token, expires: Date.now() + (Number(j.expires_in) || 3600) * 1000 });

/** Lost connection: try again in 2 s, 4 s, ... up to a minute. n: the tries so far. */
const backoff = (n) => Math.min(60000, 2000 * 2 ** n);

/**
 * Live now? from stream(): null without an account, or when the platform doesn't say.
 * @param {() => Promise<{ live: boolean } | null>} stream
 */
const liveOf = (stream) => () =>
  stream().then(
    (s) => s?.live ?? null,
    () => null,
  );

module.exports = { fail, single, tokens, backoff, liveOf };
