# Jarchi's Kick relay

A Cloudflare Worker (free plan) for **Connect Kick** in every Jarchi. Kick's login needs the Kick app's secret, and Kick sends follows only as webhooks to one public address; this holds both, so nobody's Jarchi needs a public address or a Kick app of its own. See `worker.mjs` for what each address does. Kick's events aren't stored: a follow goes to the Jarchi connected for that channel right now, or nowhere. The one thing it keeps is the usage pings (below).

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

For Jarchi's admin app. Every request needs `Authorization: Bearer <ADMIN_KEY>`; the key is a Worker secret (`npx wrangler secret put ADMIN_KEY`) and is never in this repo. After 10 wrong tries from one address in an hour, that address is refused for an hour (right key or not). The address isn't stored, only a hash of it keyed with `ADMIN_KEY` (table `admin_fails`).

| | |
|---|---|
| `GET /admin/stats` | Installs, online now (open and seen in the last 10 minutes), active today and in the last 7 days, live now, installs per version, and the relay's requests per day for the last 30 days (UTC, against Cloudflare's free 100,000 a day). `?tz=` = the admin's time zone in minutes east of UTC (Tehran `210`) for "today"; UTC by default. |
| `GET /admin/installs` | The installs, newest first, each `{ id, version, installed, open, online, live, kick, twitch, firstSeen, lastSeen, privacy }`. `?q=` part of a Kick or Twitch channel name, `?limit=` 1-200 (50), `?offset=`. |
| `GET /admin/downloads` | Download counts per release and per file from GitHub's public API for `MamadPoker/Jarchi-releases` (published releases only), kept for 10 minutes. |
| `DELETE /admin/installs/<id>` | Deletes that install's row (a data-deletion request). A Jarchi still running with that id adds it again with its next ping. |

The relay counts its own requests per day in the table `requests`. After adding the tables, run `schema.sql` again (it only adds what's missing).
