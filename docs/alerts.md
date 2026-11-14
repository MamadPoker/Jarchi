[← Jarchi](../README.md) · [Docs](README.md)

# Alerts

- **Theme**: Neon, Minimal, Fun, Retro, Glass, Fire, Ice, Galaxy, Comic, Simple or None. Each has its own animations, particles and soft synthesized sounds (Simple has none of the effects: light text on a soft dark box that just fades in and out). **None** has no box, no background and no effects at all: just your image/GIF (no picture at all if you didn't add one) and white text with a dark outline and shadow, so it reads on any game. All of it is CSS and Web Audio, with no image or sound files.
- **Live preview**: the panel plays each alert exactly as OBS will show it, and replays it whenever you change something.
- **Per alert**:
  - on/off, text with `{user}` `{amount}` `{months}` `{platform}`, duration, minimum amount (Kicks, bits, gift subs; Kicks start at 10 so floods of 1-Kick taps stay out of the queue, while the Kicks goal still counts them)
  - image/GIF/WebM/MP4 (only WebM keeps a transparent background), with an option to play the video's own sound. It always fits a fixed picture area (whole, never cropped or stretched), whatever its own pixel size; **Recommended: square, 512×512, under 3 MB**
  - every image/GIF and sound has **Upload** and **Paste a link**: Jarchi downloads a link once, keeps the file and treats it like an upload. A Giphy or Tenor page link works too (Jarchi takes the GIF on the page, or its MP4 if the GIF is over 10 MB)
  - sound: theme default, your own mp3/wav/ogg, or none, plus volume
  - frame: theme style, custom (background, opacity, border, roundness) or off; text above/below/on top of the media
  - **Text style**, with the live preview: the viewer's **name** and the **message** (the rest of the text, and the viewer's message under it) each have their own color (the theme's or your own), font (the theme's, or Vazirmatn, Lalezar, Changa, Lemonada or Markazi Text: all with Persian and English letters), bold on/off and outline/shadow on/off. One font size for the whole line (**Auto**, the default: the biggest that fits, so it's always readable; or your own size, made smaller only if it wouldn't fit). **Reset** brings the theme's look back
  - a long name gets smaller to stay on one line
- **Bigger events feel bigger**: follow is small and quick; sub is bigger; gift subs, Kicks and bits grow with the amount (gift subs at 5/20, Kicks and bits at 100/1000) and play longer; raid is the biggest.
- **Kick/Twitch badge**: only appears when both accounts are connected; it can be switched off in Settings.
- **Kicks: Kick's own look** (the default; **Look → Use theme** brings the theme back): Kick's image of the gift that was sent, big and centered (animated where Kick has an animation), and under it "{user} sent {amount} Kicks" in Kick's font, the name white and bold, the amount and "Kicks" in Kick's green, with a soft shadow and no box. A clean pop-in and fade-out and a short, soft chime. An uploaded image/GIF/video (the alert's own or a tier's) replaces the gift; **Remove** brings the gift back. The gift images are in `assets/kick-gifts`, so they work offline.
- **Different media by amount** (off by default), with fixed, ready-made tiers:
  - **Kicks**: Kick's own gifts: Hell Yeah 1, Hype 10, Skull Emoji 50, Full Send 100, Rage Quit 500, Pack It Up 1,000, YAP 2,000, Stomp 5,000, Flex 10,000, BOOOOOM 50,000 (from Kick's gift list, `web.kick.com/api/v1/kicks/gifts`, the same as in kick.com's web app).
  - **Gifted subs**: 1, 5, 10, 20, 50, 100. **Bits**: 1, 100, 1,000, 5,000, 10,000, Twitch's own gems: a bits alert without its own file shows the gem for the amount (`assets/twitch-bits`). Raid always uses its one alert.
  - Each tier: on/off, its own image/GIF/video and sound (none = the theme's), and **Test**. An amount plays its own tier; if that tier is off, the closest lower tier that's on plays, or else the normal media. Uploading a file turns its tier on.
- Uploads and links are checked by their real file type and are limited to 10 MB. Images and GIFs bigger than 512 px on their longest side are made 512 px (`core/media.js`, with sharp); GIFs and animated WebP stay animated, smaller ones are kept exactly as they are.
- **Reset to default** per alert, or **Reset everything**.

## Real Kick alerts (no login)

The Kick channel you type in **Chat** also brings real alerts, read from Kick's public chat socket. This works with the chat widget switched off too (the switch only hides the chat).

| Kick event | Alert | How |
|---|---|---|
| New sub | Sub | announced in chat; Jarchi waits 0.5 s in case it's part of a gift (up to 3 s while several viewers subscribe at once, which looks like a gift) |
| Resub (manual) | Resub, with months | announced in chat (same wait) |
| Resub (automatic renewal) | Resub, with months | Kick only says "subscribed" on the channel socket (in October 2026 every Kick sub came only this way); Jarchi looks up the months, with the same wait |
| Resub shared in chat ("celebration") | Resub, with the viewer's message | the shared message |
| Gifted subs | **One** Gifted subs alert, amount = number of subs | Kick's gift event; a big gift sent in chunks is still one alert, and the viewers who got the subs get no Sub alert of their own |
| Kicks | Kicks, with amount and message | Kick's Kicks event |
| Host (Kick's raid) | Raid, amount = viewers | Kick's host event |
| Follow | not available | Kick's public socket only sends the follower count, not who followed |

Every Kick event has a key (Kick's own id where there is one), so an event that arrives twice (Kick sends some on several sockets) fires once. Sub and Kicks goals count these real events.

## Real Twitch alerts (no login)

The Twitch channel in **Chat** brings real alerts the same way, from Twitch's anonymous chat connection.

| Twitch event | Alert | How |
|---|---|---|
| New sub | Sub | Twitch's sub notice |
| Resub | Resub, with months and the viewer's message | Twitch's resub notice (sent when the viewer shares it) |
| Gifted subs to the community | **One** Gifted subs alert, amount = number of subs | Twitch's gift notice; the per-viewer notices that follow it make no alert |
| Sub gifted to one viewer | Gifted subs, amount 1 | Twitch's gift notice |
| Raid | Raid, amount = viewers | Twitch's raid notice |
| Bits | Bits, with amount and message | a chat message with bits (Twitch's cheer words like Cheer100 are left out of the alert's message; in the chat widget they show as Twitch's gem and the amount) |
| Follow | not available | needs a Twitch login |

In a shared chat, the other channels' events don't make alerts here. The Twitch Sub goal and the Bits goal count these.

**Event log**: `data/logs/events.log` keeps the last 500 alert events exactly as Kick and Twitch sent them (subs, gifts, Kicks, raids, Twitch bits; not chat messages), one per line with the local time. Look there when an alert looked wrong. Each alert that started on an alerts page (OBS or a browser) also leaves a `timing` line there and in the server window: when the event reached Jarchi (`received`), then how long Jarchi took to decide it (`check`: a Kick sub waits a moment for a gift), how long it waited in the queue (`queue`: the alert before it, the gap, no alerts page open, paused) and how long until the page started it (`overlay`). Replays leave none. Follows can't be logged: neither public connection sends them.

## Alert queue

Alerts play one after another from Jarchi itself, not from the OBS page:

- If OBS is closed, alerts wait; when OBS opens the overlay again they continue in order. An alert that was playing when OBS closed plays again.
- If the overlay refreshes, it picks up the alert that's on now with the time it has left (no sound again), so nothing replays.
- Several alerts overlays (e.g. two scenes) each play every alert once, in the same order, at the same time.
- **Settings → Gap between alerts** (seconds). The panel's **Alert queue** page shows the queue and has **Pause / Resume**, **Skip**, **Clear queue**, × per waiting alert and **Replay** for the last 10.
