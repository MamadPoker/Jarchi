[← Jarchi](../README.md) · [Docs](README.md)

# Development

## Project layout

```
server/index.js      HTTP server setup, the API guard, what the routes share, accounts filling the chat channels, start and stop
server/routes/       the API routes, one file per area (settings, home, alerts, net, chat, accounts, support, crypto, goals), then widgets.js: what OBS loads
server/sockets.js    Socket.IO: open widget pages, what each one gets when it joins, every change that goes out
core/config.js       port and data folder (the one place to change them)
core/events.js       event bus + the normalized event shape
core/settings/       defaults and rules (schema.js), older versions' settings brought up to date (migrate.js), upload checks (files.js), user changes, undo and uploads (index.js)
core/media.js        uploaded and linked files: 10 MB limit, images shrunk to 512 px, Giphy / Tenor pages
core/alerts.js       the alert queue: what plays when, for every overlay
core/net.js          proxy: every outgoing connection goes through it
core/vpn.js          finds the user's VPN app's local proxy when Kick / Twitch / the relay can't be reached
core/goals.js        goal counters, fed by the event bus; Kick's own goals with Sync from Kick
core/store.js        JSON files in the data folder
core/secrets.js      the Kick and Twitch tokens sealed at rest (installed app), and blanked out of every log line
core/pay.js          Jarchi Pay (the Crypto page): only its public app API; its token sealed in data/pay.json, never plain (a dev run keeps it in memory)
core/chat.js         runs the chat connectors, adds 7TV emotes, test messages
core/seventv.js      7TV emote sets (cached)
core/changelog.js    a version's notes as the release text, and back (What's new)
connectors/          Kick and Twitch chat readers (+ Twitch badge images), the Kick and Twitch accounts
relay/               Jarchi's Kick relay (Cloudflare Worker): Kick's login and follow webhooks for every Jarchi
assets/              official platform logos (platform-logos), Kick badge icons (kick-badges), Kick default profile pictures (kick-avatars), OG hats (og-hats), bundled fonts (fonts)
widgets/<name>/      each widget is a folder, served at /widgets/<name>
panel/               settings panel (served at /): index.html, panel.css, and js/, one classic script per area, loaded in order by index.html
electron/            the desktop app: window, tray, updates (main.js), the panel's update bridge (preload.js)
build/               installer additions (installer.nsh), its pictures (installerSidebar.bmp, installerHeader.bmp), notes.js, which makes the release's text (release-notes.md, not in git) from i18n/changelog.json, release.js (semantic-release's step) and check-pr.js (CI's PR rules)
.github/             workflows: CI (ci.yml), Release (release.yml), Deploy relay (relay.yml), Security (security.yml), PR Labeler (labeler.yml, paths in labeler.yml); PULL_REQUEST_TEMPLATE.md, ISSUE_TEMPLATE/ (bug report, feature request)
i18n/en.json         every UI string, panel and overlay (overlays always use it)
i18n/fa.json         the panel in Persian (same keys)
i18n/changelog.json  What's new: each version's changes in English and Persian, newest first, under the "unreleased" one
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
npm run typecheck      # tsc over the JSDoc types (core, connectors, server, electron, build)
npm run lint           # ESLint (eslint.config.js)
npm run format         # Prettier writes; format:check only looks
npm run check          # all four, as CI runs them
```

`npm install` sets up a Husky pre-push hook (`.husky/pre-push`) that runs `npm run check`. Skip it once with `git push --no-verify`.

PR and commit rules: [releasing.md](releasing.md#pull-requests).
