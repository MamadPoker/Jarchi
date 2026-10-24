# Connectors

Each connector talks to one platform and translates what it receives into Jarchi's shapes. Widgets never talk to connectors directly.

## Chat (built)

- `twitch-chat.js`: Twitch chat, read anonymously (IRC over WebSocket). `twitch-badges.js` holds Twitch badge images and is the one place the optional Twitch key (`TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` in `.env`) is used.
- `kick-chat.js`: Kick chat over Kick's public Pusher socket (its app key changes now and then, so it's asked from web.kick.com on every connect, like kick.com does). The channel-name lookup uses Kick's website API over HTTP/2 (its firewall blocks HTTP/1.1 clients).

Both export `connect(channel, { onStatus, onMessage, onClear, onChannel })` and return `{ stop() }`. `core/chat.js` starts them from the chat settings, adds 7TV emotes, and puts messages on the event bus with `emitChat()` / `emitChatClear()` (see `core/events.js` for the message shape).

## Alerts and goals

`kick-chat.js` also turns Kick's public socket events into alerts (no login): subs, resubs (also automatic renewals and shared "celebrations"), gifted subs (one alert per gift), Kicks and hosts. It calls `onAlert(alert)`, and `core/chat.js` passes that to `emitEvent()`. See the table at `handle()` for which Kick event becomes which alert. Kick doesn't send follows publicly (see the Kick account below). `twitch-chat.js` does the same from Twitch's anonymous IRC (see `alertOf()`): subs, resubs, gifted subs (one alert per gift), raids and bits.

## Twitch account (built)

`twitch-account.js`: the streamer's own Twitch login (Connections page), for follows and the Twitch channel's goals. Twitch's Device Code Flow with Jarchi's own **Public** Twitch app (its Client ID is built in; Connections can set another); no secret, no redirect page. Tokens in `data/twitch.json`, refreshed by themselves. Events come over EventSub's WebSocket (no public address needed): `channel.follow` becomes a Twitch Follow alert, `channel.goal.*` keeps the goal list (Home's Twitch tab, and "Sync from Twitch" in `core/goals.js`). Not connected: nothing runs.

## Kick account (built)

`kick-account.js`: the streamer's own Kick login (Connections page), for follows, and Kick's official sub events (`channel.subscription.new` / `.renewal` / `.gifts`) as a second source beside the public socket: they go through `kick-chat.js` `official()`, which shares the socket's dedupe (same keys and marks), so a sub or gift told by both alerts once and one the socket misses still alerts. Kick's login needs its app's secret and Kick sends follows only as webhooks to a public address, so both go through Jarchi's Kick relay (`relay/`, a free Cloudflare Worker; `KICK_RELAY_URL` in `.env` sets another): the login (OAuth with PKCE) opens through it and comes back to `/api/kick/callback`, codes and refreshes are swapped for tokens there. With that login Jarchi subscribes its own channel to `channel.followed` and keeps a WebSocket open to the relay, which checks Kick's signature on each webhook and hands it to that channel's sockets (it stores nothing). A follow becomes a Kick Follow alert. Tokens in `data/kick.json`. Not connected: nothing runs.

A connector for follows, subs, Kicks, bits and raids calls `emitEvent()`:

```js
const { emitEvent } = require('../core/events');

emitEvent({ platform: 'kick', type: 'kicks', user: 'someone', amount: 100, message: 'gg', key: 'kick:kicks:<Kick transaction id>' });
```

- `platform`: `kick` | `twitch`
- `type`: `follow` | `sub` | `resub` | `gift_sub` | `kicks` | `bits` | `raid`
- `amount`: Kicks, bits, gifted sub count or raid viewers. `months` is for resubs.
- `key` (optional): names the one real event; a repeat of the same key within 6 hours is dropped, so an event that arrives twice alerts once.

Outgoing connections must go through `core/net.js` (the proxy setting): `fetch()` and `WebSocket` already do (global dispatcher); raw sockets use `net.tunnel()` / `net.secure()`. A socket that goes quiet (no answer to pings) is dropped with `net.hangUp(ws)`, not `ws.close()`: on a dead connection `close()` never fires `onclose`, so nothing would reconnect.

Alerts and goals both listen to these events, so a connector feeds everything at once. When an account connects or disconnects, report it with `setConnected('kick', true)` (also from `core/events.js`). Widgets use this list, for example to show the Kick/Twitch badge only when both are connected.

Tokens and credentials go in `.env` or the data directory (both gitignored), never in this repo. A login's tokens go through `store.load(file, ['access', 'refresh'])` / `store.save(file, data, [...])`, which seals them in the installed app (`core/secrets.js`). Every server log line and `events.log` line is redacted (known tokens, `Bearer …`, fields like `access_token`), but never log a token on purpose.
