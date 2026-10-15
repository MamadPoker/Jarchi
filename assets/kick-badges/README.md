# Kick badges

Kick's own chat badge icons, unmodified (same shapes and colors). Kick doesn't publish them as image files: kick.com's web app draws them from SVG icon data in its scripts (`https://assets.kick.com/main/_next/static/chunks/…`). Each file here is that icon data written out the way kick.com's icon renderer builds it: `<svg xmlns viewBox fill="none">` + Kick's own SVG body: shapes only, no size, so they stay sharp at any size (the chat widget puts them into the page as SVG). The one change: kick.com's founder icon also has a small PNG texture blended (soft-light) over its "1"; `founder.svg` leaves that layer out so the file has no raster image. Checked against kick.com's scripts again in October 2026: every other file is unchanged.

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
