-- Jarchi's usage stats (worker.mjs POST /ping): one row per install. No IP addresses. Times are ISO 8601 in UTC
-- ("2026-10-23T09:30:00.000Z"), so an admin page can show them in any time zone.
-- Once, from this folder: npx wrangler d1 execute jarchi-stats --remote --file=schema.sql
CREATE TABLE IF NOT EXISTS installs (
  id TEXT PRIMARY KEY,            -- the install's random id (a UUID Jarchi made)
  first_seen TEXT NOT NULL,       -- its first ping
  last_seen TEXT NOT NULL,        -- its last ping (every 5 minutes while Jarchi runs)
  version TEXT NOT NULL,          -- Jarchi's version
  installed INTEGER NOT NULL,     -- 1: the installed app, 0: a dev run
  is_open INTEGER NOT NULL,       -- 0 after its quit ping
  kick_name TEXT,                 -- the connected Kick channel (NULL: none)
  kick_picture TEXT,
  kick_live INTEGER,              -- 1 / 0, NULL: not known
  twitch_name TEXT,               -- the connected Twitch channel (NULL: none)
  twitch_picture TEXT,
  twitch_live INTEGER,
  privacy_version INTEGER NOT NULL,  -- the Privacy Policy version accepted
  privacy_accepted_at TEXT,          -- when it was accepted (NULL: not known)
  window_start INTEGER NOT NULL,  -- rate limit: start of the install's current 10-minute window (ms since 1970, UTC)
  window_pings INTEGER NOT NULL   -- and its pings in it
);
-- New installs in the last hour (the relay's cap on new ids).
CREATE INDEX IF NOT EXISTS installs_first_seen ON installs (first_seen);
