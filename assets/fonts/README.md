# Fonts

Fonts bundled with Jarchi, so they work offline (and in the desktop app later). All are free under the SIL Open Font License 1.1; each folder keeps its `OFL.txt`. Files are unmodified, from Google Fonts' repository (https://github.com/google/fonts, `ofl/`).

| Folder | Font | Used by |
| --- | --- | --- |
| `press-start-2p/` | Press Start 2P | Chat styles Retro, RPG dialog |
| `bangers/` | Bangers | Chat style Comic |
| `fredoka/` | Fredoka (variable) | Chat style Pastel |
| `vazirmatn/` | Vazirmatn (variable) | Chat style Persian tile (Persian and English); alert font |
| `inter/` | Inter (variable) | Chat style Kick default (Kick's own chat font); the Kicks alert's Kick look |
| `manrope/` | Manrope (variable) | The settings panel (Latin text) |
| `lalezar/` | Lalezar | Alert font (Persian and English) |
| `changa/` | Changa (variable) | Alert font (Persian and English) |
| `lemonada/` | Lemonada (variable) | Alert font (Persian and English) |
| `markazi-text/` | Markazi Text (variable) | Alert font (Persian and English) |

The chat fonts are loaded with `@font-face` in `widgets/chat/chat.css` and can be picked as the chat font in any style. The alert fonts (an alert's Text tab: **Font**) are loaded in `widgets/alerts/alerts.css`. The panel loads Manrope and Vazirmatn (its Persian text) in `panel/panel.css`.
