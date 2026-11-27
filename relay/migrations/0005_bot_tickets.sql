-- Bot tickets asked for (worker.mjs POST /bot/ticket), in a window of an hour (ms since 1970): one row per install
-- ("install:<id>") and per Kick user ("user:<Kick user id>"). Rows older than an hour are deleted at the next ticket.
-- Added 2026-11-27; applied by Actions -> Deploy relay before the worker that uses it.
CREATE TABLE IF NOT EXISTS bot_ticket_tries (
  who TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  tries INTEGER NOT NULL
);
