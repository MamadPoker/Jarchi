# Connectors

Each connector talks to one platform and translates what it receives into Jarchi's shapes. Widgets never talk to connectors directly.

## Chat (built)

- `twitch-chat.js`: Twitch chat, read anonymously (IRC over WebSocket). `twitch-badges.js` holds Twitch badge images and is the one place the optional Twitch key (`TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` in `.env`) is used.
- `kick-chat.js`: Kick chat over Kick's public Pusher socket (its app key changes now and then, so it's asked from web.kick.com on every connect, like kick.com does). The channel-name lookup uses Kick's website API over HTTP/2 (its firewall blocks HTTP/1.1 clients).

Both export `connect(channel, { onStatus, onMessage, onClear, onChannel })` and return `{ stop() }`. `core/chat.js` starts them from the chat settings, adds 7TV emotes, and puts messages on the event bus with `emitChat()` / `emitChatClear()` (see `core/events.js` for the message shape).

## Alerts and goals

`kick-chat.js` also turns Kick's public socket events into alerts (no login): subs, resubs (also automatic renewals and shared "celebrations"), gifted subs (one alert per gift), Kicks and hosts. It calls `onAlert(alert)`, and `core/chat.js` passes that to `emitEvent()`. See the table at `handle()` for which Kick event becomes which alert. Kick doesn't send follows publicly. `twitch-chat.js` does the same from Twitch's anonymous IRC (see `alertOf()`): subs, resubs, gifted subs (one alert per gift), raids and bits. Twitch follows need a login.

A connector for follows, subs, Kicks, bits and raids calls `emitEvent()`:

```js
const { emitEvent } = require('../core/events');

emitEvent({ platform: 'kick', type: 'kicks', user: 'someone', amount: 100, message: 'gg', key: 'kick:kicks:<Kick transaction id>' });
```

- `platform`: `kick` | `twitch`
- `type`: `follow` | `sub` | `resub` | `gift_sub` | `kicks` | `bits` | `raid`
- `amount`: Kicks, bits, gifted sub count or raid viewers. `months` is for resubs.
- `key` (optional): names the one real event; a repeat of the same key within 6 hours is dropped, so an event that arrives twice alerts once.

Outgoing connections must go through `core/net.js` (the proxy setting): `fetch()` and `WebSocket` already do (global dispatcher); raw sockets use `net.tunnel()` / `net.secure()`.

Alerts and goals both listen to these events, so a connector feeds everything at once. When an account connects or disconnects, report it with `setConnected('kick', true)` (also from `core/events.js`). Widgets use this list, for example to show the Kick/Twitch badge only when both are connected.

Tokens and credentials go in `.env` or the data directory (both gitignored), never in this repo.
