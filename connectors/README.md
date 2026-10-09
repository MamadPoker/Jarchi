# Connectors

Each connector talks to one platform and translates what it receives into Jarchi's shapes. Widgets never talk to connectors directly.

## Chat (built)

- `twitch-chat.js`: Twitch chat, read anonymously (IRC over WebSocket). `twitch-badges.js` holds Twitch badge images and is the one place the optional Twitch key (`TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` in `.env`) is used.
- `kick-chat.js`: Kick chat over Kick's public Pusher socket. The channel-name lookup uses Kick's website API over HTTP/2 (its firewall blocks HTTP/1.1 clients).

Both export `connect(channel, { onStatus, onMessage, onClear, onChannel })` and return `{ stop() }`. `core/chat.js` starts them from the chat settings, adds 7TV emotes, and puts messages on the event bus with `emitChat()` / `emitChatClear()` (see `core/events.js` for the message shape).

## Alerts and goals (coming with account connections)

A connector for follows, subs, Kicks, bits and raids calls `emitEvent()`:

```js
const { emitEvent } = require('../core/events');

emitEvent({ platform: 'kick', type: 'kicks', user: 'someone', amount: 100, message: 'gg' });
```

- `platform`: `kick` | `twitch`
- `type`: `follow` | `sub` | `resub` | `gift_sub` | `kicks` | `bits` | `raid`
- `amount`: Kicks, bits, gifted sub count or raid viewers. `months` is for resubs.

Alerts and goals both listen to these events, so a connector feeds everything at once. When an account connects or disconnects, report it with `setConnected('kick', true)` (also from `core/events.js`). Widgets use this list, for example to show the Kick/Twitch badge only when both are connected.

Tokens and credentials go in `.env` or the data directory (both gitignored), never in this repo.
