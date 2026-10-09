# Connectors (coming later)

One module per platform goes here (e.g. `kick.js`, `twitch.js`). A connector's only job is to talk to its platform, translate what it receives and call `emitEvent()`:

```js
const { emitEvent } = require('../core/events');

emitEvent({ platform: 'kick', type: 'kicks', user: 'someone', amount: 100, message: 'gg' });
```

- `platform`: `kick` | `twitch`
- `type`: `follow` | `sub` | `resub` | `gift_sub` | `kicks` | `bits` | `raid`
- `amount`: Kicks, bits, gifted sub count or raid viewers. `months` is for resubs.

When an account connects or disconnects, report it with `setConnected('kick', true)` (also from `core/events.js`). Widgets use this list, for example to show the Kick/Twitch badge only when both are connected.

Widgets never talk to connectors directly. Tokens and credentials go in the data directory (gitignored) and never in this repo.
