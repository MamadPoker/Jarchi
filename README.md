# Jarchi

Stream alerts for OBS that run locally on your own PC. No account, no central server. Real Kick alerts come from your Kick channel's public chat (just the channel name, no login); Twitch alerts come later. Every alert can also be fired with the **Test** buttons.

## Setup

Requires [Node.js](https://nodejs.org/) 20.18.1 or newer (22 LTS recommended).

```sh
npm install
npm start
```

Then open **http://127.0.0.1:3000** in your browser. That's the settings panel.

Optional: copy `.env.example` to `.env` to change the port or the data folder.

## Add the alerts to OBS

1. In OBS, go to **Sources → + → Browser**, name it e.g. "Jarchi Alerts".
2. URL: `http://127.0.0.1:3000/widgets/alerts` (the panel's **Copy OBS link** button).
3. Width **1920**, height **1080**.
4. Tick **Control audio via OBS** so alert sounds show up in the OBS mixer.
5. Click OK, then pick an alert in the panel and press **Test in OBS**.

Jarchi must be running before OBS loads the source. If you started OBS first, right-click the source and choose **Refresh**. Once loaded, the overlay reconnects by itself if Jarchi restarts.

## The panel

- **Top bar**: the alert queue (what's playing, how many wait, **Pause / Resume alerts**, **Skip current alert**, **Clear queue**, and a warning when no OBS alerts overlay is open), and **Copy OBS link**.
- **Left column**: **Theme** at the top (opens a page with a live card per theme; click one to use it), then the alerts, each with an on/off switch; **Settings** at the bottom (badge switch, test platform, gap between alerts, connection / proxy, reset everything).
- **Right side**: the selected alert: live preview with Play, its own theme (or the main one), then image/GIF/video, sound and text, **Different media by amount** (Kicks, gifted subs, bits, raid); **More options** opens frame, colors, font size, text position, text alignment (left/center/right), duration, volume, minimum amount and video sound.

## Alerts

- **Theme**: Neon, Minimal, Fun, Retro, Glass, Fire, Ice, Galaxy or Comic. Each has its own animations, particles and soft synthesized sounds. All of it is CSS and Web Audio, with no image or sound files.
- **Live preview**: the panel plays each alert exactly as OBS will show it, and replays it whenever you change something.
- **Per alert**:
  - on/off, text with `{user}` `{amount}` `{months}` `{platform}`, duration, minimum amount (Kicks, bits, gift subs)
  - image/GIF/WebM/MP4 (only WebM keeps a transparent background), with an option to play the video's own sound
  - sound: theme default, your own mp3/wav/ogg, or none, plus volume
  - frame: theme style, custom (background, opacity, border, roundness) or off; text above/below/on top of the media; font size and text color
- **Bigger events feel bigger**: follow is small and quick; sub is bigger; gift subs, Kicks and bits grow with the amount (gift subs at 5/20, Kicks and bits at 100/1000) and play longer; raid is the biggest.
- **Kick/Twitch badge**: only appears when both accounts are connected; it can be switched off in Settings.
- **Different media by amount** (Kicks, gifted subs, bits, raid; off by default): add tiers, each with a minimum amount and its own images/GIFs/videos and sounds (none = the theme's). The highest tier the amount reaches plays; with several files one is picked at random (every open overlay picks the same one). Below the first tier the normal media is used. Each tier has a **Test** button.
- Uploads are checked by their real file type and are limited to 20 MB.
- **Reset to default** per alert, or **Reset everything**.

### Real Kick alerts (no login)

The Kick channel you type in **Widgets → Chat** also brings real alerts, read from Kick's public chat socket. This works with the chat widget switched off too (the switch only hides the chat).

| Kick event | Alert | How |
|---|---|---|
| New sub | Sub | announced in chat |
| Resub (manual) | Resub, with months | announced in chat |
| Resub (automatic renewal) | Resub, with months | Kick only says "subscribed" on the channel socket; Jarchi waits 10 s, then looks up the months |
| Resub shared in chat ("celebration") | Resub, with the viewer's message | the shared message |
| Gifted subs | **One** Gifted subs alert, amount = number of subs | Kick's gift event; a big gift sent in chunks is still one alert |
| Kicks | Kicks, with amount and message | Kick's Kicks event |
| Host (Kick's raid) | Raid, amount = viewers | Kick's host event |
| Follow | not available | Kick's public socket only sends the follower count, not who followed |

Every Kick event has a key (Kick's own id where there is one), so an event that arrives twice (Kick sends some on several sockets) fires once. Sub and Kicks goals count these real events. Twitch alerts aren't connected yet.

### Alert queue

Alerts play one after another from Jarchi itself, not from the OBS page:

- If OBS is closed, alerts wait; when OBS opens the overlay again they continue in order. An alert that was playing when OBS closed plays again.
- If the overlay refreshes, it picks up the alert that's on now with the time it has left (no sound again), so nothing replays.
- Several alerts overlays (e.g. two scenes) each play every alert once, in the same order, at the same time.
- **Settings → Gap between alerts** (seconds). Top bar: **Pause / Resume**, **Skip current alert**, **Clear queue**.

## Connection (proxy)

For VPN users and filtered networks: **Settings → Connection (proxy)**.

- **Use Windows system proxy** (default): whatever Windows (or your VPN app) has set under Settings → Network → Proxy. No proxy set = direct.
- **Manual**: an HTTP or SOCKS5 proxy at an address and port (e.g. the local port of v2rayN or Clash).
- **Off**: always direct.

Everything Jarchi reaches online goes through it: Kick, Twitch, 7TV, and the emotes, badges and profile pictures in chat (OBS loads those through Jarchi). **Test connection** checks Kick, Twitch and 7TV and says in plain words what works and what doesn't. Not supported: proxy login (username/password) and Windows PAC scripts.

## Goals

Two goal widgets, each with its own OBS URL (transparent background):

- **Sub goal**: `http://127.0.0.1:3000/widgets/goal/subs` counts subs, resubs and gifted subs (each gift = 1) from Kick and Twitch.
- **Kicks goal**: `http://127.0.0.1:3000/widgets/goal/kicks` counts Kicks from Kick.

They listen to the same event bus as the alerts, so they'll move by themselves once Kick and Twitch are connected. Until then, test alerts and the panel's buttons move them.

In OBS: **Sources → + → Browser**, paste the goal's URL (the panel has **Copy this goal's OBS link**), width **1000**, height **400**. The goal sits in the middle; use the panel's **Size** option or OBS to scale it.

In the panel (left list → **Widgets**): title, target, current count (−, +, number, **Reset to 0**), **Test**, 6 styles (Classic, Pill, Neon, Circle, Text only, Retro), colors, and **More options** for background, border, corners, size, font, title position, percentage/numbers and the celebration. A style is a starting point: every option works with every style, and **Reset style** brings the style's own look back.

When a goal is reached, the bar switches to the "full" color, plays a short celebration (confetti + glow) and the celebration sound once, and stays full until **Reset to 0** or a new target. Counts above the target keep counting (e.g. 53 / 50). Counts are saved in `data/goals.json`, so they survive restarts. Turning a goal off hides it on stream; it keeps counting.

Settings and uploads live in `data/` (gitignored). Delete that folder to start fresh.

## Chat

Kick and Twitch chat in one box: `http://127.0.0.1:3000/widgets/chat` (transparent background).

1. In the panel, open **Widgets → Chat** and type your **Kick channel** and/or **Twitch channel** (just the names, no login). Each shows Connected / Connecting / Error and reconnects by itself.
2. In OBS: **Sources → + → Browser**, paste the link from **Copy chat OBS link**. Make the source at least as big as the chat's width × height (More options → Box & messages); the chat sits in the top-left corner.
3. **Send test message** and **Send 10 messages** mix in the fancy effects (sub glow, first message, rainbow VIP, mention, emote combo, profile picture); **Show all effects** sends one of each in a row. If an effect is off in the settings, its message still comes, without the effect, and the panel says so.

- 26 styles. Vertical: Classic box, Bubbles, Floating, Neon, Terminal, Retro, Glass, Pop-in, Side column, Cyberpunk, Comic, Gamer HUD, Sticky notes, Pastel, Galaxy, RPG dialog (types out the newest message; optional typing sound), Persian tile (Vazirmatn font, Persian lines right-aligned). Horizontal bars: Ticker, News ticker, Neon strip, Pills, Minimal, LED board, Cyberpunk bar, Pastel candy, Glass bar. The new bars keep looping the recent messages when chat is quiet; **Bar position** puts a bar at the top or bottom of a taller OBS source. A style is a starting point: every option works with every style, **Reset style** brings the style's own look back. Fonts are bundled in `assets/fonts` (free, SIL Open Font License), so they work offline.
- Messages deleted by a moderator, and everything from banned / timed-out users, disappear from the overlay too.
- Emotes: Kick, Twitch and 7TV (the channel's set + global, refreshed every 5 minutes), animated or still.
- Badges and logos come from the platforms: Twitch's own badge images; on Kick, Kick's own badge icons (host, mod, VIP, OG, founder, verified, staff, sub gifter tiers, default subscriber; taken unmodified from kick.com's web app, see `assets/kick-badges/README.md`), the channel's own sub badges and Kick's image badges.
- Chat also goes through the event bus (`chat`, `chatClear`), so other widgets can use it later.

How it reads chat, and what needs a key:

- **Twitch**: anonymous chat (IRC over WebSocket), no key. Optional key (`TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` in `.env`, see `.env.example`) adds every Twitch badge, channels' own sub badges and Twitch profile pictures. Without it, Twitch's common badges show and Twitch avatars are letters.
- **Kick**: Kick's public chat socket, no key. Finding a channel's chatroom by name uses Kick's website API (unofficial; it only answers HTTP/2). If Kick changes that API, the Kick status shows Error. Kick's official API needs an app key and will come with account connections.

## Project layout

```
server/index.js      HTTP + Socket.IO server, API routes
core/config.js       port and data folder (the one place to change them)
core/events.js       event bus + the normalized event shape
core/settings.js     defaults, user changes, uploads (alerts, tiers and goal looks)
core/alerts.js       the alert queue: what plays when, for every overlay
core/net.js          proxy: every outgoing connection goes through it
core/goals.js        goal counters, fed by the event bus
core/store.js        JSON files in the data folder
core/chat.js         runs the chat connectors, adds 7TV emotes, test messages
core/seventv.js      7TV emote sets (cached)
connectors/          Kick and Twitch chat readers (+ Twitch badge images)
assets/              official platform logos (platform-logos), Kick badge icons (kick-badges), bundled fonts (fonts)
widgets/<name>/      each widget is a folder, served at /widgets/<name>
panel/               settings panel (served at /)
i18n/en.json         every UI string, panel and overlay
```

Every event, whatever its source, looks like this:

```js
{ id, time, platform: 'kick' | 'twitch' | 'test', type, user, amount, months, message, test }
// type: follow | sub | resub | gift_sub | kicks | bits | raid
```

Connectors only call `emitEvent()` (with an optional `key`: a repeat of the same key within 6 hours is dropped). Widgets only listen on the socket: `event`, `settings`, `goals` and (chat) `chat` / `chatClear`. The alerts overlay sends `alertsJoin` and then gets `alert` / `alertSkip` from the queue.

## Tests

```sh
npm test
```
