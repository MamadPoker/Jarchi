# Twitch bits gems

Twitch's own default cheer gems, unmodified, so the bits alert and the chat can show them without going online. Downloaded from Twitch's cheermote CDN, the animated dark-background files at Twitch's biggest size (4x, 112×112): `d3aqoihi2n8ty8.cloudfront.net/actions/cheer/dark/animated/<tier>/4.gif`. These are what Twitch shows for the global cheermotes (`Cheer100`, `Kappa1000`…).

| File | Gem | From | Amount color (chat) |
| --- | --- | --- | --- |
| `1.gif` | gray | 1 bit | `#979797` |
| `100.gif` | purple | 100 bits | `#9c3ee8` |
| `1000.gif` | green | 1,000 bits | `#1db2a5` |
| `5000.gif` | blue | 5,000 bits | `#0099fe` |
| `10000.gif` | red | 10,000 bits | `#f43021` |

The bits alert tiers are these amounts (`TIER_AMOUNTS.bits` in `core/settings.js`); the chat picks the gem in `connectors/twitch-chat.js` (`GEMS`) and colors the amount in `widgets/chat/chat.css` (`.gem-<tier>`).
