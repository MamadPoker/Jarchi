# Jarchi's Kick relay

A Cloudflare Worker (free plan) for **Connect Kick** in every Jarchi. Kick's login needs the Kick app's secret, and Kick sends follows only as webhooks to one public address; this holds both, so nobody's Jarchi needs a public address or a Kick app of its own. See `worker.mjs` for what each address does. It stores nothing: a follow goes to the Jarchi connected for that channel right now, or nowhere.

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
