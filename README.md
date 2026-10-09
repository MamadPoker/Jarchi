# Jarchi

Stream alerts for OBS that run locally on your own PC. No account, no central server. Kick and Twitch connections are coming later. For now every alert can be fired with the **Test** buttons.

## Setup

Requires [Node.js](https://nodejs.org/) 20.12 or newer (22 LTS recommended).

```sh
npm install
npm start
```

Then open **http://127.0.0.1:3000** in your browser. That's the settings panel.

Optional: copy `.env.example` to `.env` to change the port or the data folder.

## Add the alerts to OBS

1. In OBS, go to **Sources → + → Browser**, name it e.g. "Jarchi Alerts".
2. URL: `http://127.0.0.1:3000/widgets/alerts` (the panel has a Copy button).
3. Width **1920**, height **1080**.
4. Tick **Control audio via OBS** so alert sounds show up in the OBS mixer.
5. Click OK, then press **Test** in the panel to check it.

Jarchi must be running before OBS loads the source. If you started OBS first, right-click the source and choose **Refresh**. Once loaded, the overlay reconnects by itself if Jarchi restarts.

## Settings

- **Theme**: Neon, Minimal, Fun, Retro, Glass, Fire, Ice, Galaxy or Comic. Each has its own animations, particles and synthesized sounds. All of it is CSS and Web Audio, with no image or sound files.
- **Live preview**: the panel plays each alert exactly as OBS will show it, and replays it whenever you change something.
- **Per alert**:
  - on/off, text with `{user}` `{amount}` `{months}` `{platform}`, duration, minimum amount (Kicks, bits, gift subs)
  - image/GIF/WebM/MP4 (only WebM keeps a transparent background), with an option to play the video's own sound
  - sound: theme default, your own mp3/wav/ogg, or none, plus volume
  - frame: theme style, custom (background, opacity, border, roundness) or off; text above/below/on top of the media; font size and text color
- **Bigger events feel bigger**: follow is small and quick; sub is bigger; gift subs, Kicks and bits grow with the amount (gift subs at 5/20, Kicks and bits at 100/1000) and play longer; raid is the biggest.
- Uploads are checked by their real file type and are limited to 20 MB.
- **Reset to default** per alert, or **Reset everything**.

Settings and uploads live in `data/` (gitignored). Delete that folder to start fresh.

## Project layout

```
server/index.js      HTTP + Socket.IO server, API routes
core/config.js       port and data folder (the one place to change them)
core/events.js       event bus + the normalized event shape
core/settings.js     defaults, user changes, uploads
connectors/          Kick / Twitch go here later (see connectors/README.md)
widgets/<name>/      each widget is a folder, served at /widgets/<name>
panel/               settings panel (served at /)
i18n/en.json         every UI string, panel and overlay
```

Every event, whatever its source, looks like this:

```js
{ id, time, platform: 'kick' | 'twitch' | 'test', type, user, amount, months, message, test }
// type: follow | sub | resub | gift_sub | kicks | bits | raid
```

Connectors only call `emitEvent()`. Widgets only listen for `event` and `settings` on the socket.

## Tests

```sh
npm test
```
