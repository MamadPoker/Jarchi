-- A team message's optional code (relay/worker.mjs, "Team messages"): short plain text the install can copy, e.g. a
-- gift's activation code. Apply BEFORE deploying the relay that writes it: npx wrangler d1 migrations apply jarchi-stats --remote
ALTER TABLE team_messages ADD COLUMN code TEXT;
