# Jarchi's Kick relay

A Cloudflare Worker (free plan) for **Connect Kick** in every Jarchi. Kick's login needs the Kick app's secret, and Kick sends follows only as webhooks to one public address; this holds both, so nobody's Jarchi needs a public address or a Kick app of its own. See `worker.mjs` for what each address does. Kick's events aren't stored: a follow goes to the Jarchi connected for that channel right now, or nowhere. Kick tokens and login codes only pass through: never stored (no Room storage, D1 or KV), never logged (no `console` in the worker, Workers Logs off in `wrangler.toml`), never cached (`no-store`), and the Rooms never see one. What it keeps: the usage pings and the support tickets (below).

## Deploy (once)

From this folder, with a Cloudflare account and a Kick app (kick.com → Settings → Developer, needs 2FA on Kick):

```
npx wrangler login
npx wrangler deploy
npx wrangler secret put KICK_CLIENT_ID
npx wrangler secret put KICK_CLIENT_SECRET
```

`deploy` prints the address, `https://jarchi-kick.<your-subdomain>.workers.dev`. In the Kick app:

- **Redirect URL**: `https://jarchi-kick.<your-subdomain>.workers.dev/callback`
- **Enable Webhooks**: on, **Webhook URL**: `https://jarchi-kick.<your-subdomain>.workers.dev/webhook`
- Scopes: reading user information (`user:read`) and subscribing to events (`events:subscribe`)

Then set `JARCHI_RELAY` in `connectors/kick-account.js` to that address (or `KICK_RELAY_URL` in `.env` for a copy of your own).

Opening the address in a browser says `Jarchi Kick relay: running.`

## Usage pings (`POST /ping`)

Once a streamer has accepted Jarchi's Privacy Policy, their Jarchi (`core/stats.js`) sends a small ping here at start, every 5 minutes and when it quits. The relay keeps one row per install in the D1 database `jarchi-stats` (table `installs`, see `schema.sql`): first and last seen, version, installed app or dev run, open, the connected Kick / Twitch channel names, pictures and whether they're live, and the Privacy Policy version accepted and when. Jarchi 1.0.2 on adds connection diagnostics (`diag`; 1.0.1 sends none and is still taken): per platform `never` / `ok` / `failed` with a reason code (`network`, `denied`, `other`), the proxy mode (`off`, `auto`, `manual`) and whether the VPN app finder found a proxy. Codes only: no error texts, addresses or links. All times are UTC (ISO 8601). No IP addresses. Anything else in a ping, a ping over 2 KB, more than 10 pings from one install in 10 minutes, or a new install after 100 new ones in the last hour is refused.

Set up once (already done for Jarchi's own relay; the database id goes in `wrangler.toml`):

```
npx wrangler d1 create jarchi-stats
npx wrangler d1 execute jarchi-stats --remote --file=schema.sql
npx wrangler deploy
```

To look at the rows: `npx wrangler d1 execute jarchi-stats --remote --command "SELECT * FROM installs ORDER BY last_seen DESC"`.

## Admin API (`/admin/...`)

For Jarchi's admin app (also its support tickets). Every request needs `Authorization: Bearer <ADMIN_KEY>`; the key is a Worker secret (`npx wrangler secret put ADMIN_KEY`) and is never in this repo. After 10 wrong tries from one address in an hour, that address is refused for an hour (right key or not). The address isn't stored, only a hash of it keyed with `ADMIN_KEY` (table `admin_fails`).

| | |
|---|---|
| `GET /admin/stats` | Installs (`installs`: all; `installsInstalled`: the installed app; `installsDev`: dev runs, only those that say so: `installed: false` from Jarchi 1.0.2 on (with `diag`; 1.0.1's isn't trusted, so it counts in `installs` only); `installsNew7Days`: the installed app's first seen in the last 7 days), online now (open and seen in the last 10 minutes), active today and in the last 7 days, live now, installs per version, and the relay's requests per day for the last 30 days (UTC, against Cloudflare's free 100,000 a day). `?tz=` = the admin's time zone in minutes east of UTC (Tehran `210`) for "today"; UTC by default. |
| `GET /admin/history` | The last 30 days (UTC, today included), oldest first: `{ days: [{ day, installed, dev, requests }] }`. `installed` / `dev`: installs active that day (each counted once, by its first ping of the day; the installed app / dev runs, as `installsDev` above), `requests`: the relay's requests that day. `null`: that day wasn't recorded (requests from 2026-10-23, active installs from the day after the columns below were added). Only counts are kept, no ids. |
| `GET /admin/installs` | The installs, newest first, each `{ id, version, installed, open, online, live, kick, twitch, firstSeen, lastSeen, privacy, diag }` (`diag` null: its last ping had none). `?q=` part of a Kick or Twitch channel name, `?limit=` 1-200 (50), `?offset=`. |
| `GET /admin/downloads` | Download counts from GitHub's public API for `MamadPoker/Jarchi` (v1.0.2 on) and `MamadPoker/Jarchi-releases` (v1.0.2 and before), published releases only, each release with its `repo`. A release's `downloads` and the total count only `Jarchi-Setup.exe` (`latest.yml` and the `.blockmap` are Jarchi's own update check); `files` has every file's count. Kept for 10 minutes; while either repo fails, the last full answer. |
| `DELETE /admin/installs/<id>` | Deletes that install's row and which team messages it saw / closed (a data-deletion request). A Jarchi still running with that id adds it again with its next ping. Its support tickets stay (delete them below). |
| `GET /admin/tickets` | Every support ticket, last changed first, each with whose it is (`installId`, `kick`, `twitch`), its message count, `unread` (a message from the streamer not opened yet), `lastAuthor` (`user` / `admin`) and `lastMessageAt`, plus `unread`: how many tickets have one. `?status=open|progress|closed`, `?category=bug|suggestion|question|data|crypto`. |
| `GET /admin/tickets/<id>` | One ticket with its messages (`author` user / admin, `text`, `images`, `at`); opening it marks them read. Screenshots: `GET /admin/tickets/<id>/images/<name>`. |
| `POST /admin/tickets/<id>/messages` | A reply: a `multipart/form-data` form with `message` and/or up to 3 `image` files (as below). |
| `PATCH /admin/tickets/<id>` | `{ "status": "open" | "progress" | "closed" }`. |
| `DELETE /admin/tickets/<id>` | The ticket, its messages and its screenshots. |
| `GET /admin/messages` | Every team message (below), newest first, each with `target`, `active`, `seenBy` and `closedBy` (how many installs saw / closed it; closed counts as seen too). |
| `POST /admin/messages` | A new team message, JSON: `title: { en, fa }`, `body: { en, fa }`, `style` (`info`, `update`, `warning`, `gift`), `target` (`"all"`, `"dev"`, `{ "version": "1.0.4" }` or `{ "install": "<install id>" }`), and optionally `link: { label: { en, fa }, url: "https://..." }`, `code` (one line, the same in both languages, e.g. a gift's activation code) and `expiresAt` (ISO 8601, UTC). Plain text only: `<`, `>` and control characters (but line ends in a body) are refused (`bad_request`). Title up to 120 characters, body 2,000, link label 40, code 64. |
| `PATCH /admin/messages/<id>` | `{ "active": false }` deactivates it (`true` turns it back on). |
| `DELETE /admin/messages/<id>` | The message and its seen / closed records. |
| `GET /admin/codes` | Every exclusive design code (below), newest first: `{ id, design, note, createdAt, install, redeemedAt }`. `id` is the first 12 digits of the code's hash: the code itself is never kept. `install` / `redeemedAt`: `null` until it's redeemed. |
| `POST /admin/codes` | A new code for a design, JSON: `{ "design": "x-<name>", "note": "who it's for" }` (`note` optional, one line of plain text, up to 80 characters). The answer is the same as above plus `code` (`XXXX-XXXX`): **the only time it's shown**. An unknown design is `bad_request`. |

## Team messages (`/messages...`)

Messages from Jarchi's team, written in the admin app (above) and shown in Jarchi. Each request sends `X-Jarchi-Install: <its install id>` and `?version=<its Jarchi version>&installed=1` (the installed app) or `0` (a dev run). An install gets only messages that are active, not expired, not closed by it, and for all installs, for its version, for dev runs or for its id; only installs that have pinged get any (and only they are counted). Plain text only, as stored.

| | |
|---|---|
| `GET /messages` | My messages, newest first: `{ id, title: { en, fa }, body: { en, fa }, link: { label: { en, fa }, url } \| null, code \| null, style, createdAt, expiresAt, seen }`. |
| `POST /messages/<id>/seen` | I saw it. |
| `POST /messages/<id>/closed` | I closed it (seen too): never on my list again. |

A message not meant for that install is `not_found`, like one that isn't there. Errors are JSON `{ "error": "..." }`: `bad_request`, `not_found`, `method`. Kept in the D1 tables `team_messages` and `team_message_views` (install id, when it saw / closed each message), from `migrations/` (`0001_team_messages.sql`, then `0002_team_message_code.sql` for `code`; `0003_chat_designs.sql` is the exclusive designs'). Apply new ones from this folder **before** deploying the worker that uses them (without them `DELETE /admin/installs/<id>` and `POST /admin/messages` fail): `npx wrangler d1 migrations apply jarchi-stats --remote` (it runs only the ones not applied yet).

## Exclusive chat designs (`/designs...`)

Chat looks only some streamers get. A code from Jarchi's team (`POST /admin/codes` above) unlocks one design for the one install that redeems it, for good: the same code fails on any other install. Jarchi asks for the code in its panel (`core/designs.js`). Each request sends `X-Jarchi-Install: <its install id>`; only installs that have pinged (an accepted Privacy Policy) are answered.

| | |
|---|---|
| `POST /designs/redeem` | `{ "code": "XXXX-XXXX" }` (`-`, spaces and case don't matter) → `{ id, name: { en, fa } }`. A wrong code, or one another install redeemed: `bad_code`. 10 tries an hour per install, right or wrong (`rate`). |
| `GET /designs` | My designs: `[{ id, name }]`. |
| `GET /designs/<id>` | One of mine, whole: `{ id, name, look, css }` (`look`: Jarchi's chat options the design sets; `css`: its CSS, which Jarchi checks again before it uses it: no `@import`, no escapes, `url()` only to Jarchi's own `/assets` or a `data:` image or font). Not mine: `not_found`. |

Errors are JSON `{ "error": "..." }`: `bad_request`, `unknown_install`, `bad_code`, `rate`, `not_found`, `method`. Tables (`migrations/0003_chat_designs.sql`): `designs` (the designs themselves), `design_codes` (each code's SHA-256, its design, the admin's note, and the install that redeemed it, when) and `redeem_tries`.

A design's files are **never in this repo** (it's public): a design is added straight to D1 from a file kept elsewhere, e.g. `npx wrangler d1 execute jarchi-stats --remote --file "<its .sql>"` with `INSERT INTO designs (id, name_en, name_fa, data, created_at) VALUES ('x-<name>', ..., '{"look": {...}, "css": "..."}', ...)` (`ON CONFLICT (id) DO UPDATE` to change one; Jarchi downloads its designs again at every start). The id is `x-` and up to 30 of `a-z 0-9 -`; its CSS styles `.style-x-<name>` in the chat widget (`widgets/chat`), whose rows also carry `data-turn` (0-23, the message's order) for a design to take turns with.

## Support tickets (`/support/...`)

The Support page in Jarchi (`core/support.js`, only once the Privacy Policy is accepted). Each install sends `X-Jarchi-Install: <its install id>` and `Authorization: Bearer <its ticket token>`: 64 random hex digits that Jarchi makes for its first ticket and keeps in its settings, never shown. A ticket can only be read with the token it was made with, and an install keeps the token of its first ticket. Only installs that have pinged can make tickets; a ticket keeps the Kick / Twitch channel names of that install's last ping.

| | |
|---|---|
| `GET /support/tickets` | My tickets, last changed first, each with `unread` (an admin reply not opened yet), `lastAuthor` (`user` / `admin`), `lastMessageAt` and `teamSeenAt` (when the team last opened it in the admin app, `GET /admin/tickets/<id>`; `null`: never). |
| `POST /support/tickets` | A new ticket: a `multipart/form-data` form with `category` (`bug`, `suggestion`, `question`, `data`, `crypto`), `subject` (up to 120 characters), `message` (up to 5,000) and up to 3 `image` files. |
| `GET /support/tickets/<id>` | One ticket with its messages; opening it marks the admin's replies read. Screenshots: `GET /support/tickets/<id>/images/<name>`. |
| `POST /support/tickets/<id>/messages` | A message (`message` and/or `image` files). Refused (`closed`) once the ticket is closed. |
| `PATCH /support/tickets/<id>` | `{ "hidden": true }`: takes a closed ticket off my list (`not_closed` otherwise). Nothing is deleted: the admin still sees it (`hiddenByUser`, `hiddenByUserAt`), and reopening it puts it back on the list. |

Screenshots: PNG, JPG or WebP by their bytes (not their names), up to 2 MB each (Jarchi makes big ones smaller first), kept in the KV namespace `jarchi-support-shots` (binding `SHOTS`) as `<ticket id>/<name>`. Limits: 5 new tickets per install a day, 30 messages from an install an hour. Errors are JSON `{ "error": "..." }` (see `worker.mjs`). Tickets and messages are in the D1 tables `tickets` and `ticket_messages` (see `schema.sql`); times are UTC. Cloudflare's free KV takes 1,000 writes a day (one per screenshot) and 1 GB in all.

Set up once (already done for Jarchi's own relay; the id goes in `wrangler.toml`): `npx wrangler kv namespace create jarchi-support-shots`, then run `schema.sql` again and deploy.

The relay counts its own requests per day in the table `requests`. After adding the tables, run `schema.sql` again (it only adds what's missing).

`schema.sql` doesn't add columns to a table that's already there. The `tickets.hidden_by_user_at` column (2026-10-29), once, before deploying the worker that uses it: `npx wrangler d1 execute jarchi-stats --remote --command "ALTER TABLE tickets ADD COLUMN hidden_by_user_at TEXT"`.

The `installs` diagnostics columns (2026-10-29), once, before deploying the worker that uses them (and that worker before a Jarchi that sends `diag`: an older worker refuses its pings): `npx wrangler d1 execute jarchi-stats --remote --command "ALTER TABLE installs ADD COLUMN kick_connect TEXT; ALTER TABLE installs ADD COLUMN kick_reason TEXT; ALTER TABLE installs ADD COLUMN twitch_connect TEXT; ALTER TABLE installs ADD COLUMN twitch_reason TEXT; ALTER TABLE installs ADD COLUMN proxy_mode TEXT; ALTER TABLE installs ADD COLUMN vpn_found INTEGER"`.

The `requests` active-install columns (2026-10-30), once, before deploying the worker that uses them (without them that worker stops counting requests and its pings fail): `npx wrangler d1 execute jarchi-stats --remote --command "ALTER TABLE requests ADD COLUMN active_installed INTEGER; ALTER TABLE requests ADD COLUMN active_dev INTEGER"`.
