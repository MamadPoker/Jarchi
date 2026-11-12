-- A design code the admin revoked (DELETE /admin/codes/<id>, worker.mjs): it can't be redeemed anymore; an install that
-- redeemed it already keeps its design. ISO 8601 UTC, NULL: not revoked. Added 2026-11-12; once, from this folder (relay/):
-- npx wrangler d1 migrations apply jarchi-stats --remote
ALTER TABLE design_codes ADD COLUMN revoked_at TEXT;
