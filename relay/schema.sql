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
  window_pings INTEGER NOT NULL,  -- and its pings in it
  -- Connection diagnostics (the ping's diag), all NULL when its last ping had none. Added 2026-10-29; a database made
  -- before needs, once: ALTER TABLE installs ADD COLUMN for each of the six (see README.md)
  kick_connect TEXT,              -- never | ok | failed
  kick_reason TEXT,               -- network | denied | other when failed, else NULL
  twitch_connect TEXT,
  twitch_reason TEXT,
  proxy_mode TEXT,                -- off | auto | manual
  vpn_found INTEGER               -- the VPN app finder found a proxy: 1 / 0, NULL: it hasn't looked
);
-- New installs in the last hour (the relay's cap on new ids).
CREATE INDEX IF NOT EXISTS installs_first_seen ON installs (first_seen);

-- Admin API (worker.mjs /admin): wrong keys per source, for its lockout. Not the address: a hash of it keyed with ADMIN_KEY.
CREATE TABLE IF NOT EXISTS admin_fails (
  source TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,  -- start of its current hour of wrong tries (ms since 1970, UTC)
  fails INTEGER NOT NULL,         -- wrong tries in it
  blocked_until INTEGER NOT NULL  -- refused until then (ms), 0: not blocked
);
-- The relay's own requests per day (UTC), for the admin app (Cloudflare's free plan: 100,000 a day).
CREATE TABLE IF NOT EXISTS requests (
  day TEXT PRIMARY KEY,  -- "2026-10-23"
  count INTEGER NOT NULL
);

-- Support tickets (worker.mjs /support and /admin/tickets): an install's tickets with Jarchi's admin, each a thread of
-- messages. Screenshots are in KV (SHOTS) as "<ticket id>/<name>", their names listed in the message.
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,         -- 8 hex digits, random ("3F9A1C2B")
  install_id TEXT NOT NULL,    -- the install that made it (installs.id)
  token_hash TEXT NOT NULL,    -- SHA-256 of that install's ticket token: only it can read the ticket
  kick_name TEXT,              -- the install's Kick / Twitch channels when it was made (from its last ping), NULL: none
  twitch_name TEXT,
  category TEXT NOT NULL,      -- bug | suggestion | question | data
  subject TEXT NOT NULL,
  status TEXT NOT NULL,        -- open | progress | closed
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,    -- its last message or status change
  user_read_at TEXT,           -- when the install / the admin last opened it (NULL: never): newer messages from the
  admin_read_at TEXT,          -- other side are unread
  hidden_by_user_at TEXT       -- when the install took it off its list (closed tickets only), NULL: on it. Nothing deleted:
                               -- the admin still sees it. Added 2026-10-29; a database made before needs, once:
                               -- ALTER TABLE tickets ADD COLUMN hidden_by_user_at TEXT
);
CREATE INDEX IF NOT EXISTS tickets_install ON tickets (install_id, created_at);
CREATE TABLE IF NOT EXISTS ticket_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id TEXT NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
  author TEXT NOT NULL,        -- user | admin
  body TEXT NOT NULL,
  images TEXT NOT NULL,        -- JSON list of its screenshots' names ("<32 hex>.png"), up to 3
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ticket_messages_ticket ON ticket_messages (ticket_id, created_at);
