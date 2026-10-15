# Fonts

Fonts bundled with Jarchi, so they work offline (and in the desktop app later). All are free under the SIL Open Font License 1.1; each folder keeps its `OFL.txt`. Files are unmodified, from Google Fonts' repository (https://github.com/google/fonts, `ofl/`).

| Folder | Font | Used by (chat styles) |
| --- | --- | --- |
| `press-start-2p/` | Press Start 2P | Retro, RPG dialog |
| `bangers/` | Bangers | Comic |
| `fredoka/` | Fredoka (variable) | Pastel |
| `vazirmatn/` | Vazirmatn (variable) | Persian tile (Persian and English) |
| `inter/` | Inter (variable) | Kick default (Kick's own chat font) |
| `manrope/` | Manrope (variable) | The settings panel (Latin text) |

They are loaded with `@font-face` in `widgets/chat/chat.css` and can be picked as the chat font in any style. The panel loads Manrope and Vazirmatn (its Persian text) in `panel/panel.css`.
