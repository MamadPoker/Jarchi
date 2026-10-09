# Kick badges

Kick's own chat badge icons, unmodified (same shapes and colors). Kick doesn't publish them as image files: kick.com's web app draws them from SVG icon data in its scripts (`https://assets.kick.com/main/_next/static/chunks/…`). Each file here is that icon data written out the way kick.com's icon renderer builds it: `<svg xmlns viewBox fill="none">` + Kick's own SVG body. The only addition is the `xmlns:xlink` namespace declaration in `founder.svg`, which a standalone SVG file needs for its embedded image.

| File | Kick badge (icon name in kick.com's code) |
| --- | --- |
| `broadcaster.svg` | Host (`HostBadge`) |
| `moderator.svg` | Moderator (`ModeratorBadge`) |
| `vip.svg` | VIP (`VIPBadge`) |
| `og.svg` | OG (`OGBadge`) |
| `founder.svg` | Founder (`FounderBadge`) |
| `subscriber.svg` | Subscriber, Kick's default for channels without their own sub badges (`SubscriberBadge`) |
| `verified.svg` | Verified (`VerifiedBadge`) |
| `staff.svg` | Staff (`StaffBadge`) |
| `bot.svg` | Bot (`BotBadge`) |
| `sidekick.svg` | Sidekick (`SidekickBadge`) |
| `trainwreckstv.svg` | The trainwreckstv channel badge (inline in kick.com's badge list) |
| `sub_gifter-N.svg` | Sub gifter tiers (`Gift1` … `Gift5000`): kick.com shows tier N for N up to the next tier's gift count |

A channel's own subscriber badges are not here: they come from Kick for each channel (`files.kick.com`).

These icons belong to Kick and are only used to show the same badges Kick shows in its chat.
