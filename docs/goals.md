[← Jarchi](../README.md) · [Docs](README.md)

# Goals

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
