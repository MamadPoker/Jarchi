# Kick gifts

Kick's own Kicks gift images, unmodified, so the Kicks alert can show the gift that was sent without going online. Downloaded from `files.kick.com/kicks/gifts/`, the files kick.com's web app shows for each gift (its `kicksAssets` table): the animated file where Kick has one, else the still one. The gift list and amounts are Kick's (`web.kick.com/api/v1/kicks/gifts`).

| File | Gift | Kicks | Kick's file |
| --- | --- | --- | --- |
| `hell_yeah.webp` | Hell Yeah | 1 | `hell-yeah.webp` (still) |
| `hype.webp` | Hype | 10 | `hype.webp` (still) |
| `skull_emoji.webp` | Skull Emoji | 50 | `skull-emoji.webp` (still) |
| `full_send.webp` | Full Send | 100 | `full-send.webp` (still) |
| `rage_quit.webp` | Rage Quit | 500 | `rage-quit.webp` (animated) |
| `pack_it_up.webp` | Pack It Up | 1,000 | `pack-it-up.webp` (animated) |
| `yap.webp` | YAP | 2,000 | `yap.webp` (animated) |
| `stomp.webp` | Stomp | 5,000 | `stomp.webp` (animated) |
| `flex.webp` | Flex | 10,000 | `flex.webp` (animated) |
| `boooom.webp` | BOOOOOM | 50,000 | `boom.webp` (animated) |

If Kick adds a gift: add its file here (named by its `gift_id`), to `KICK_GIFTS` in `core/settings.js` and its name to `kickGifts` in `i18n/en.json`.
