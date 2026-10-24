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

Once a streamer has accepted Jarchi's Privacy Policy, their Jarchi (`core/stats.js`) sends a small ping here at start, every 5 minutes and when it quits. The relay keeps one row per install in the D1 database `jarchi-stats` (table `installs`, see `schema.sql`): first and last seen, version, installed app or dev run, open, the connected Kick / Twitch channel names, pictures and whether they're live, and the Privacy Policy version accepted and when. All times are UTC (ISO 8601). No IP addresses. Anything else in a ping, a ping over 2 KB, more than 10 pings from one install in 10 minutes, or a new install after 100 new ones in the last hour is refused.

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
| `GET /admin/stats` | Installs, online now (open and seen in the last 10 minutes), active today and in the last 7 days, live now, installs per version, and the relay's requests per day for the last 30 days (UTC, against Cloudflare's free 100,000 a day). `?tz=` = the admin's time zone in minutes east of UTC (Tehran `210`) for "today"; UTC by default. |
| `GET /admin/installs` | The installs, newest first, each `{ id, version, installed, open, online, live, kick, twitch, firstSeen, lastSeen, privacy }`. `?q=` part of a Kick or Twitch channel name, `?limit=` 1-200 (50), `?offset=`. |
| `GET /admin/downloads` | Download counts per release and per file from GitHub's public API for `MamadPoker/Jarchi-releases` (published releases only), kept for 10 minutes. |
| `DELETE /admin/installs/<id>` | Deletes that install's row (a data-deletion request). A Jarchi still running with that id adds it again with its next ping. Its support tickets stay (delete them below). |
| `GET /admin/tickets` | Every support ticket, last changed first, each with whose it is (`installId`, `kick`, `twitch`), its message count and `unread` (a message from the streamer not opened yet), plus `unread`: how many tickets have one. `?status=open|progress|closed`, `?category=bug|suggestion|question|data`. |
| `GET /admin/tickets/<id>` | One ticket with its messages (`author` user / admin, `text`, `images`, `at`); opening it marks them read. Screenshots: `GET /admin/tickets/<id>/images/<name>`. |
| `POST /admin/tickets/<id>/messages` | A reply: a `multipart/form-data` form with `message` and/or up to 3 `image` files (as below). |
| `PATCH /admin/tickets/<id>` | `{ "status": "open" | "progress" | "closed" }`. |
| `DELETE /admin/tickets/<id>` | The ticket, its messages and its screenshots. |

## Support tickets (`/support/...`)

The Support page in Jarchi (`core/support.js`, only once the Privacy Policy is accepted). Each install sends `X-Jarchi-Install: <its install id>` and `Authorization: Bearer <its ticket token>`: 64 random hex digits that Jarchi makes for its first ticket and keeps in its settings, never shown. A ticket can only be read with the token it was made with, and an install keeps the token of its first ticket. Only installs that have pinged can make tickets; a ticket keeps the Kick / Twitch channel names of that install's last ping.

| | |
|---|---|
| `GET /support/tickets` | My tickets, last changed first, each with `unread` (an admin reply not opened yet). |
| `POST /support/tickets` | A new ticket: a `multipart/form-data` form with `category` (`bug`, `suggestion`, `question`, `data`), `subject` (up to 120 characters), `message` (up to 5,000) and up to 3 `image` files. |
| `GET /support/tickets/<id>` | One ticket with its messages; opening it marks the admin's replies read. Screenshots: `GET /support/tickets/<id>/images/<name>`. |
| `POST /support/tickets/<id>/messages` | A message (`message` and/or `image` files). Refused (`closed`) once the ticket is closed. |

Screenshots: PNG, JPG or WebP by their bytes (not their names), up to 2 MB each (Jarchi makes big ones smaller first), kept in the KV namespace `jarchi-support-shots` (binding `SHOTS`) as `<ticket id>/<name>`. Limits: 5 new tickets per install a day, 30 messages from an install an hour. Errors are JSON `{ "error": "..." }` (see `worker.mjs`). Tickets and messages are in the D1 tables `tickets` and `ticket_messages` (see `schema.sql`); times are UTC. Cloudflare's free KV takes 1,000 writes a day (one per screenshot) and 1 GB in all.

Set up once (already done for Jarchi's own relay; the id goes in `wrangler.toml`): `npx wrangler kv namespace create jarchi-support-shots`, then run `schema.sql` again and deploy.

The relay counts its own requests per day in the table `requests`. After adding the tables, run `schema.sql` again (it only adds what's missing).
