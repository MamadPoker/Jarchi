[← Jarchi](../README.md) · [Docs](README.md)

# Getting started

## Setup

Requires [Node.js](https://nodejs.org/) 20.18.1 or newer (22 LTS recommended).

```sh
npm install
npm start
```

Then open **http://127.0.0.1:3000** in your browser. That's the settings panel.

Or run it as a desktop app with `npm run app` (instead of `npm start`): the panel opens in its own window, and closing the window keeps Jarchi running in the system tray (right-click the tray icon to quit).

Optional: copy `.env.example` to `.env` to change the port or the data folder.

Settings and uploads live in `data/` (gitignored in a dev run, `%APPDATA%\Jarchi` in the installed app). Delete that folder to start fresh.

## Add the alerts to OBS

1. In OBS, go to **Sources → + → Browser**, name it e.g. "Jarchi Alerts".
2. URL: `http://127.0.0.1:3000/widgets/alerts` (**Copy OBS link** on the panel's **Alerts** page).
3. Width **800**, height **600**.
4. In the OBS preview, drag the box to where the alerts should show and pull its corners to make it as big as you want. The alert always fills the box, picture and text together, whatever its size or shape, and nothing gets cut off. **Alert size** (Alerts page, 50%–100%) makes it smaller inside the box without touching OBS.
5. Tick **Control audio via OBS** so alert sounds show up in the OBS mixer.
6. Click OK, then pick an alert on the panel's **Alerts** page and press **Test in OBS**.

Jarchi must be running before OBS loads the source. If you started OBS first, right-click the source and choose **Refresh**. Once loaded, the overlay reconnects by itself if Jarchi restarts.
