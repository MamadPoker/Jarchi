-- Team messages (worker.mjs /messages and /admin/messages): Jarchi's team to the streamers, shown in Jarchi. Plain text
-- only: the relay refuses < and > and control characters. Times are ISO 8601 in UTC. Added 2026-11-07; once, from this
-- folder (relay/): npx wrangler d1 migrations apply jarchi-stats --remote
CREATE TABLE IF NOT EXISTS team_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,  -- never reused, so an old view can't count for a new message
  title_en TEXT NOT NULL,
  title_fa TEXT NOT NULL,
  body_en TEXT NOT NULL,
  body_fa TEXT NOT NULL,
  link_label_en TEXT,          -- the optional link: all three set, or all NULL
  link_label_fa TEXT,
  link_url TEXT,               -- https:// only
  style TEXT NOT NULL,         -- info | update | warning
  target TEXT NOT NULL,        -- all | version | dev | install
  target_value TEXT,           -- the version ("1.0.4") or the install id (installs.id) for those two, else NULL
  created_at TEXT NOT NULL,
  expires_at TEXT,             -- NULL: never
  active INTEGER NOT NULL      -- 1, 0 once deactivated
);
-- Which installs saw / closed which message (only installs that have pinged, only messages meant for them).
CREATE TABLE IF NOT EXISTS team_message_views (
  message_id INTEGER NOT NULL REFERENCES team_messages (id) ON DELETE CASCADE,
  install_id TEXT NOT NULL,    -- installs.id
  seen_at TEXT NOT NULL,
  closed_at TEXT,              -- NULL: not closed
  PRIMARY KEY (message_id, install_id)
);
