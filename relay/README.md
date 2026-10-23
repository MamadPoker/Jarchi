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

Once a streamer has accepted Jarchi's Privacy Policy, their Jarchi (`core/stats.js`) sends a small ping here at start, every 5 minutes and when it quits. The relay keeps one row per install in the D1 database `jarchi-stats` (table `installs`, see `schema.sql`): first and last seen, version, installed app or dev run, open, the connected Kick / Twitch channel names, pictures and whether they're live, and the Privacy Policy version accepted and when. All times are UTC (ISO 8601). No IP addresses. Anything else in a ping, a ping over 2 KB, or more than 10 pings from one install in 10 minutes is refused.

Set up once (already done for Jarchi's own relay; the database id goes in `wrangler.toml`):

```
npx wrangler d1 create jarchi-stats
npx wrangler d1 execute jarchi-stats --remote --file=schema.sql
npx wrangler deploy
```

To look at the rows: `npx wrangler d1 execute jarchi-stats --remote --command "SELECT * FROM installs ORDER BY last_seen DESC"`.
