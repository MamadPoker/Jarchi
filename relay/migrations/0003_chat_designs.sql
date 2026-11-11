-- Exclusive chat designs (worker.mjs /designs and /admin/codes): chat looks a code from Jarchi's team unlocks, for the one
-- install that redeems it, for good. A design's files live only here, never in Jarchi's public repo (a row is added with
-- wrangler d1 execute, see README.md). Times are ISO 8601 in UTC. Added 2026-11-11; once, from this folder (relay/):
-- npx wrangler d1 migrations apply jarchi-stats --remote
CREATE TABLE IF NOT EXISTS designs (
  id TEXT PRIMARY KEY,         -- "x-<name>": the chat style's id in Jarchi
  name_en TEXT NOT NULL,
  name_fa TEXT NOT NULL,
  data TEXT NOT NULL,          -- JSON { look, css }: the chat look's values and its CSS (no scripts; Jarchi checks it too)
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS design_codes (
  code_hash TEXT PRIMARY KEY,  -- SHA-256 (hex) of the code, upper case without - or spaces; the code itself is shown once
  design_id TEXT NOT NULL,     -- designs.id
  note TEXT,                   -- the admin's own words (who it's for), or NULL
  created_at TEXT NOT NULL,
  install_id TEXT,             -- NULL until redeemed, then that install's (installs.id) for good
  redeemed_at TEXT
);
CREATE INDEX IF NOT EXISTS design_codes_install ON design_codes (install_id);
-- Redeem tries per install, right or wrong, in a window of an hour (ms since 1970).
CREATE TABLE IF NOT EXISTS redeem_tries (
  install_id TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  tries INTEGER NOT NULL
);
