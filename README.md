# Jarchi

Stream alerts for OBS that run locally on your own PC. No account, no central server. Real Kick and Twitch alerts come from your channels' public chat (just the channel names, no login). Every alert can also be fired with the **Test** buttons.

## Setup

Requires [Node.js](https://nodejs.org/) 20.18.1 or newer (22 LTS recommended).

```sh
npm install
npm start
```

Then open **http://127.0.0.1:3000** in your browser. That's the settings panel.

Or run it as a desktop app with `npm run app` (instead of `npm start`): the panel opens in its own window, and closing the window keeps Jarchi running in the system tray (right-click the tray icon to quit).

Optional: copy `.env.example` to `.env` to change the port or the data folder.

## Add the alerts to OBS

1. In OBS, go to **Sources → + → Browser**, name it e.g. "Jarchi Alerts".
2. URL: `http://127.0.0.1:3000/widgets/alerts` (**Copy OBS link** on the panel's **Alerts** page).
3. Width **800**, height **600**.
4. In the OBS preview, drag the box to where the alerts should show and pull its corners to make it as big as you want. The alert always fills the box, picture and text together, whatever its size or shape, and nothing gets cut off. **Alert size** (Alerts page, 50%–100%) makes it smaller inside the box without touching OBS.
5. Tick **Control audio via OBS** so alert sounds show up in the OBS mixer.
6. Click OK, then pick an alert on the panel's **Alerts** page and press **Test in OBS**.

Jarchi must be running before OBS loads the source. If you started OBS first, right-click the source and choose **Refresh**. Once loaded, the overlay reconnects by itself if Jarchi restarts.

## The panel

- **Sidebar**: **Jarchi** at the top, then one item per page: **Home**, **Alerts**, **Chat**, **Goals**; under **Live**: **Alert queue** (with the number of waiting alerts), **Event log**; under **Setup**: **Connections**, **Appearance**, **Settings** (badge switch, test platform, gap between alerts, connection / proxy, reset everything), **Guide**. Under **Bot**: **Chat bot**; under **Donations**: **Crypto** (crypto donations: viewers will donate in USDT, Bitcoin and more straight to the streamer's own wallet, with their name and message on the alert). Both open a "Coming soon" page for now.
- **Top bar**: the page's title; a warning when a Kick or Twitch connection has been down for over 30 seconds (a click opens where it's set up); **Kick** and **Twitch** with a green dot when their chat connection is up (a click opens Connections); the **Dark / Light** switch; the **فا | EN** language switch.
- **Home**: a banner that says **You're ready to stream** when Kick and Twitch are connected and every widget that's switched on is open in OBS, or lists what's missing, each with **Fix** (opens the right page); **Send test alert** (a random type) and **OBS links** (copy any widget's link). **Live feed**: the last 20 events, newest first (platform, name, what they did, how long ago; test ones say so), filters All / Subs / Kicks / Raids / Follows, **Replay** on each. **Widgets**: the widgets that are switched on (Alerts, Chat and each goal whose switch is on), green while a page of it is open in OBS, with a copy button; **Manage** opens the Goals page. **Goals**: both goals with their bar (they move by themselves). Then alerts today, chat messages today (real ones, not tests; from midnight) and Jarchi's uptime. The feed and today's numbers are kept across restarts in `data/feed.json` and `data/today.json`.
- **Alerts**: the main **Theme** on top (opens a page with a live card per theme; click one to use it, **← Alerts** goes back), **Alert size** (50%–100% of the Browser Source box) and **Copy OBS link**; the alert list, each with an on/off switch; next to it the selected alert: live preview with Play, its own theme (or the main one), then image/GIF/video, sound and text, **Different media by amount** (Kicks, gifted subs, bits); **More options** opens frame, colors, font size, text position, text alignment (left/center/right), duration, volume, minimum amount and video sound.
- **Goals**: Kick | Twitch tabs (logo + name), each with only that platform's goals and its **Sync from …** switch on top (Twitch: **Connect** until the account is connected), each goal with an on/off switch, its count (click it and type another) and **Reset to 0** (click twice), next to the selected goal. **Chat**: the chat widget, with its on/off switch next to the title. Each has its own **Copy OBS link**.
- **Alert queue**: now playing (with a bar for the time left), **Pause / Resume**, **Skip**, **Clear queue** (click twice), the waiting alerts in order (× removes one), the last 10 played (each with **Replay**), and a notice when no OBS alerts overlay is open.
- **?** next to every setting: a short explanation on hover, keyboard focus or a tap.
- **Guide**: Getting started, Add Jarchi to OBS, Alerts, Goals, Chat widget, Alert queue, Proxy & VPN, and If something doesn't work (questions that open their answers). The links in it are this PC's real ones.

### Persian (فارسی)

The **فا | EN** switch (remembered in the browser) puts the whole panel in Persian, right to left, in the bundled Vazirmatn font with Persian digits: the sidebar moves to the right. Fields for links, `{user}`-style variables, channel names and numbers stay left to right. It changes only the panel: alert texts, chat and goals in OBS stay exactly as you wrote them (English by default). Panel strings live in `i18n/en.json` and `i18n/fa.json`; a test fails if `fa.json` misses a key.

## Alerts

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

### Real Kick alerts (no login)

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

### Real Twitch alerts (no login)

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

### Alert queue

Alerts play one after another from Jarchi itself, not from the OBS page:

- If OBS is closed, alerts wait; when OBS opens the overlay again they continue in order. An alert that was playing when OBS closed plays again.
- If the overlay refreshes, it picks up the alert that's on now with the time it has left (no sound again), so nothing replays.
- Several alerts overlays (e.g. two scenes) each play every alert once, in the same order, at the same time.
- **Settings → Gap between alerts** (seconds). The panel's **Alert queue** page shows the queue and has **Pause / Resume**, **Skip**, **Clear queue**, × per waiting alert and **Replay** for the last 10.

## Connection (proxy)

For VPN users and filtered networks: **Settings → Connection (proxy)**.

- **Use Windows system proxy** (default): whatever Windows (or your VPN app) has set under Settings → Network → Proxy. No proxy set = direct.
- **Manual**: an HTTP or SOCKS5 proxy at an address and port (e.g. the local port of v2rayN or Clash).
- **Off**: always direct.

Everything Jarchi reaches online goes through it: Kick, Twitch, 7TV, and the emotes, badges and profile pictures in chat (OBS loads those through Jarchi). **Test connection** checks Kick, Twitch and 7TV and says in plain words what works and what doesn't. Not supported: proxy login (username/password) and Windows PAC scripts.

## Goals

Six goal widgets on two tabs, each with its own OBS URL (transparent background) and on/off switch. Each counts and syncs from its own platform only; nothing is added up across Kick and Twitch.

- **Kick**
  - **Sub goal**: `http://127.0.0.1:3000/widgets/goal/subs` counts Kick subs, resubs and gifted subs (a gift of 5 subs = 5).
  - **Kicks goal**: `http://127.0.0.1:3000/widgets/goal/kicks` counts Kicks.
  - **Followers goal**: `http://127.0.0.1:3000/widgets/goal/followers` (off until you switch it on) shows the followers goal set on your Kick channel, or a number you type.
- **Twitch** (all off until you switch them on)
  - **Sub goal**: `http://127.0.0.1:3000/widgets/goal/twitchSubs` counts Twitch subs, resubs and gifted subs (a gift of 5 subs = 5).
  - **Bits goal**: `http://127.0.0.1:3000/widgets/goal/bits` counts bits.
  - **Followers goal**: `http://127.0.0.1:3000/widgets/goal/twitchFollowers` shows the followers goal set on your Twitch channel, or a number you type.

**Sync from Kick** and **Sync from Twitch** (at the top of each tab on the Goals page, on by default): a goal you also set on that channel shows the channel's own count and target, in the panel (marked **From Kick** / **From Twitch**, read-only) and on stream. Twitch needs the Twitch account connected on **Connections**. For Kick, Jarchi reads `kick.com/api/v2/channels/<channel>/goals` (no login) when it connects and every minute, and takes Kick's live goal events (`GoalProgressUpdateEvent` and the others) from the same public socket as the alerts. A goal with nothing set on Kick stays manual, and its own count goes on underneath. If Kick can't be reached, the last numbers stay.

They listen to the same event bus as the alerts, so they'll move by themselves once Kick and Twitch are connected. Until then, test alerts and the panel's buttons move them.

In OBS: **Sources → + → Browser**, paste the goal's URL (the panel has **Copy OBS link**), width **800**, height **200** (Circle style: **400** × **400**). The goal fills the box: drag and resize it in OBS to place it. Its text is the biggest that fits (**Font size: Auto**, or your own size); the panel's **Size** (50%–100%) makes it smaller inside the box.

In the panel (**Goals**): title, target, current count (−, +, number, **Reset to 0** with a second click to confirm), **Test**, 6 styles (Classic, Pill, Neon, Circle, Text only, Retro), colors, and **More options** for background, border, corners, size, font, title position, percentage/numbers and the celebration. A style is a starting point: every option works with every style, and **Reset style** brings the style's own look back.

When a goal is reached, the bar switches to the "full" color, plays a short celebration (confetti + glow) and the celebration sound once, and stays full until **Reset to 0** or a new target. Counts above the target keep counting (e.g. 53 / 50). Counts are saved in `data/goals.json`, so they survive restarts. Turning a goal off hides it on stream; it keeps counting.

Settings and uploads live in `data/` (gitignored). Delete that folder to start fresh.

## Chat

Kick and Twitch chat in one box: `http://127.0.0.1:3000/widgets/chat` (transparent background).

1. In the panel, open **Chat** and type your **Kick channel** and/or **Twitch channel** (just the names, no login). Each shows Connected / Connecting / Error and reconnects by itself.
2. In OBS: **Sources → + → Browser**, paste the link from **Copy OBS link** on the panel's Chat page. Make the source at least as big as the chat's width × height (More options → Box & messages); the chat sits in the top-left corner.
3. **Send test message** and **Send 10 messages** mix in the fancy effects (sub glow, first message, rainbow VIP, mention, emote combo, profile picture); **Show all effects** sends one of each in a row. If an effect is off in the settings, its message still comes, without the effect, and the panel says so.

- 27 styles. Vertical: **Kick default** (looks like Kick's own chat: its 340px width, Inter font, dark surface, badges before the name, a colon, emotes in the line, Kick's green for mentions, subs, first messages and combos; the style new users start with), Classic box, Bubbles, Floating, Neon, Terminal, Retro, Glass, Pop-in, Side column, Cyberpunk, Comic, Gamer HUD, Sticky notes, Pastel, Galaxy, RPG dialog (types out the newest message; optional typing sound), Persian tile (Vazirmatn font, Persian lines right-aligned). Horizontal bars: Ticker, News ticker, Neon strip, Pills, Minimal, LED board, Cyberpunk bar, Pastel candy, Glass bar. The new bars keep looping the recent messages when chat is quiet; **Bar position** puts a bar at the top or bottom of a taller OBS source. A style is a starting point: every option works with every style, **Reset style** brings the style's own look back. Fonts are bundled in `assets/fonts` (free, SIL Open Font License), so they work offline.
- Messages deleted by a moderator, and everything from banned / timed-out users, disappear from the overlay too.
- Emotes: Kick, Twitch and 7TV (the channel's set + global, refreshed every 5 minutes), animated or still.
- Badges and logos come from the platforms: Twitch's own badge images; on Kick, Kick's own badge icons (host, mod, VIP, OG, founder, verified, staff, sub gifter tiers, default subscriber; taken unmodified from kick.com's web app, see `assets/kick-badges/README.md`), the channel's own sub badges and Kick's image badges. Each at its sharpest (Kick's as SVG, Twitch's 72 px images), as tall as the name times **Badge size**. **Badges: Important only** (the default) shows broadcaster, mod, VIP, OG, founder, sub, verified and staff; **All** shows every badge (gifter tiers, Prime, levels...).
- The platform icon is the official logo, unchanged, on a small dark tile (Kick on black, Twitch on its own dark), so it shows on light boxes too.
- **Make names readable** (on by default, for **Platform color**): a name color that's hard to read on the box (light on light, dark on dark) gets just enough lighter or darker, same color.
- **OG hat** (on by default): Kick viewers with the OG badge get a black "MP" hat (`assets/og-hats`: Cap, Beanie or Fedora), on the first or last letter of the name, with the badges (instead of the OG badge) or on the profile picture.
- Profile pictures (**More options → Fancy effects → Profile pictures**, off by default): Kick viewers show their own picture; a Kick viewer without one (or whose picture can't be looked up) gets one of Kick's own six default pictures (`assets/kick-avatars`, picked by the name, so it's the same one every time). Twitch viewers show their own picture too: with the Twitch key from Twitch's API, without one from [decapi.me](https://decapi.me) (it answers the picture's URL as text), or [api.ivr.fi](https://api.ivr.fi) when decapi fails or is slow. These requests use the proxy setting, and answers are cached like Kick's. A Twitch viewer with no picture found, or whose picture doesn't load, gets a letter circle. A message never waits for its picture: it shows at once with the default picture (or letter) and the real one replaces it when it has loaded.
- Name colors: by default (**Platform color**, every style) each name has the color it has on Kick or Twitch. A viewer without one gets the platform's default: white on Kick (like kick.com), one of Twitch's 15 default colors on Twitch (the same one every time). **Style colors** and **One color** are still options. On light backgrounds, light names keep their color and get a thin dark outline.
- Chat also goes through the event bus (`chat`, `chatClear`), so other widgets can use it later.

How it reads chat, and what needs a key:

- **Twitch**: anonymous chat (IRC over WebSocket), no key. Optional key (`TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` in `.env`, see `.env.example`) adds every Twitch badge and channels' own sub badges, and profile pictures come from Twitch's own API. Without it, Twitch's common badges show and profile pictures come through decapi.me / ivr.fi.
- **Kick**: Kick's public chat socket, no key. Finding a channel's chatroom by name uses Kick's website API (unofficial; it only answers HTTP/2). If Kick changes that API, the Kick status shows Error. Follows need the Kick account connected on **Connections** (Kick's official API, through Jarchi's Kick relay in `relay/`).

## Project layout

```
server/index.js      HTTP + Socket.IO server, API routes
core/config.js       port and data folder (the one place to change them)
core/events.js       event bus + the normalized event shape
core/settings.js     defaults, user changes, uploads (alerts, tiers and goal looks)
core/media.js        uploaded and linked files: 10 MB limit, images shrunk to 512 px, Giphy / Tenor pages
core/alerts.js       the alert queue: what plays when, for every overlay
core/net.js          proxy: every outgoing connection goes through it
core/goals.js        goal counters, fed by the event bus; Kick's own goals with Sync from Kick
core/store.js        JSON files in the data folder
core/chat.js         runs the chat connectors, adds 7TV emotes, test messages
core/seventv.js      7TV emote sets (cached)
core/changelog.js    a version's notes as the release text, and back (What's new)
connectors/          Kick and Twitch chat readers (+ Twitch badge images), the Kick and Twitch accounts
relay/               Jarchi's Kick relay (Cloudflare Worker): Kick's login and follow webhooks for every Jarchi
assets/              official platform logos (platform-logos), Kick badge icons (kick-badges), Kick default profile pictures (kick-avatars), OG hats (og-hats), bundled fonts (fonts)
widgets/<name>/      each widget is a folder, served at /widgets/<name>
panel/               settings panel (served at /)
electron/            the desktop app: window, tray, updates (main.js), the panel's update bridge (preload.js)
build/               installer additions (installer.nsh), its pictures (installerSidebar.bmp, installerHeader.bmp) and notes.js, which makes the release's text (release-notes.md, not in git) from i18n/changelog.json
i18n/en.json         every UI string, panel and overlay (overlays always use it)
i18n/fa.json         the panel in Persian (same keys)
i18n/changelog.json  What's new: each version's changes in English and Persian, newest first
```

Every event, whatever its source, looks like this:

```js
{ id, time, platform: 'kick' | 'twitch' | 'test', type, user, amount, months, message, test }
// type: follow | sub | resub | gift_sub | kicks | bits | raid
```

Connectors only call `emitEvent()` (with an optional `key`: a repeat of the same key within 6 hours is dropped). Widgets only listen on the socket: `event`, `settings`, `goals` and (chat) `chat` / `chatClear`. The alerts overlay sends `alertsJoin` and then gets `alert` / `alertSkip` from the queue.

## Windows installer and updates

```sh
npm run dist      # builds dist/Jarchi-Setup.exe on this PC
npm run release   # builds it and uploads it to a DRAFT release on github.com/MamadPoker/Jarchi-releases
```

For a release: raise `version` in `package.json`, add that version's changes on top of `i18n/changelog.json` (`en` and `fa`: the same changes in both, one plain line each), then run `npm run release` with a GitHub token in `GH_TOKEN` (PowerShell: `$env:GH_TOKEN = "github_pat_…"; npm run release`). The token is a fine-grained one with access to Jarchi-releases only, **Contents: Read and write**. Never put it in a file in this repo. It makes a draft release `v<version>` whose text is those changes (English, then Persian right to left; `build/notes.js` writes it, and puts it on that version's draft too when one is already there), with the installer, its `.blockmap` and `latest.yml` (all three are needed for updates). The installer's name has no version (`Jarchi-Setup.exe`), so https://github.com/MamadPoker/Jarchi-releases/releases/latest/download/Jarchi-Setup.exe always gets the newest one; updates still find each version's files by its tag. Check it on GitHub, then **Publish release**: only then do downloads and installed apps see it, and GitHub makes the tag on Jarchi-releases' own `main`. A version that already has a published release gets no draft (electron-builder skips it): raise the version first.

The installed app looks for a newer release at start and every 4 hours, downloads it in the background and installs it only when the streamer clicks **Restart now** (or quits Jarchi). `npm run app` never updates. The installer is per user (no admin rights), in English or Persian (a list at the start, the Windows language picked), and always installs into a `Jarchi` folder inside the one chosen (E:\ -> E:\Jarchi). Its options are in `package.json` `build` and `build/installer.nsh`, its pictures in `build/installerSidebar.bmp` (164x314) and `build/installerHeader.bmp` (150x57). The data stays in `%APPDATA%\Jarchi`, so updates and reinstalls keep it; uninstalling asks. The installed app also has **Uninstall Jarchi** in Settings (next to Reset everything): it starts this uninstaller with `--keep-app-data` or `--delete-app-data`, so it doesn't ask again, and quits.

## Tests

```sh
npm test
```
