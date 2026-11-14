[← Jarchi](../README.md) · [Docs](README.md)

# Viewer count

How many people watch your Kick and Twitch streams, as an OBS widget (transparent background). One link per count:

| Count | OBS URL |
|---|---|
| Kick | `http://127.0.0.1:3000/widgets/viewers/kick` |
| Twitch | `http://127.0.0.1:3000/widgets/viewers/twitch` |
| Total (Kick + Twitch) | `http://127.0.0.1:3000/widgets/viewers/total` |

Each count needs that account connected on **Connections**. Jarchi asks every 30 seconds, and only while a viewer count page is open (in OBS or the panel's preview). A platform that doesn't answer once keeps its last number, so there's no "Offline" flash.

In OBS: **Sources → + → Browser**, paste the link from **OBS links** on the **Viewer count** page, for example width **400**, height **200**. It fills the box: drag and resize it in OBS to place it.

## Look

- **Styles**: **Jarchi gold**, **Live chart** (a line of the last minutes, up to 15), **Angled bar** and **Comic**. Picking a style (again) brings back its own font and colors.
- **Icon** (Jarchi gold): People, the Kick or Twitch logo, or **Switch**: the people icon and the platform's logo take turns every few seconds (Total: both logos).
- **Number change**: **Roll**, **Flip** and **Fade** move only the digits that changed; **Pop** bounces the whole number.
- **When not live** (or that account isn't connected): show **Offline** in its place, or **Hide** the widget.
- Size, font, number color, background and accent color, and your own CSS (`.viewers`, `.num`, `.card`, `.icon`, `.chart`…).

**Test** in the panel changes the count in the preview, to see the animation, even while you're not live.
