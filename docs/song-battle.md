[← Jarchi](../README.md) · [Docs](README.md)

# Song Battle

Viewers send their songs on your own battle page at **battle.jarchi.app**, then the songs go head to head on your stream, two by two, and chat votes **1** or **2** until one song is the champion. It's the **Song Battle** page, under **Content**. The battle page is Jarchi Battle, a Jarchi site; nothing goes to it before you accept the Privacy Policy and press **Connect**.

## Connect once

Press **Connect** and sign in with Kick or Twitch on the page that opens in your browser; Jarchi waits on the page until you're in. That's only the first time: Jarchi stays connected (its key is sealed in `data/battle.json`, like the Kick and Twitch logins), and your battle page keeps the same link for every battle: `battle.jarchi.app/<your channel>`.

## Set up a battle

**Battle settings**, kept for the next battle. While a battle takes songs, a change counts for it right away too: raise **Songs in the battle** and late joiners can send theirs. Only the number of songs can't go under the songs already in (take some out first):

- **Topic** (optional), or **A random topic**.
- **Songs in the battle**: 4, 8, 16, 32, 64 or 128. **Songs each viewer can send**: 1 to 3.
- **Links viewers can send**: YouTube, Spotify, SoundCloud. In Jarchi a Spotify song plays only 30 seconds, so Spotify starts off, with a **30 sec** tag.
- **Voting**: **Chat votes** (viewers type 1 or 2 in chat) or **I pick the winner** (no vote: you're the judge).
- **Viewers sign in with Kick or Twitch** (off: guests can send songs too), **Show who sent each song**, **Blur the song covers** (the mouse over one shows it), **Hide a song's name until it plays** (it's "???" until its match is on), **Mods help too** (the mods you add sign in on the battle page and take bad songs or spam off the list).

Then **Open for songs**.

## Share the link

**Invite your viewers** shows your fixed link with **Copy** and its QR code, to show on stream. **Post the link in chat** posts it in your Kick and Twitch chat; Kick and Twitch need one more permission for that, so if Jarchi asks, disconnect and connect them again on **Connections**.

Songs come in live under **Submitted songs**. A song with the same link or name as an earlier one is tagged **Similar**: you decide. **Remove** takes one out, and you can add your own. A battle starts with 2 songs or more: press **Start battle**. **Cancel battle** (click twice) ends it at any time.

## The battle

- Each match puts two songs face to face, each in its own site's player (YouTube's, Spotify's or SoundCloud's) with play, 10 seconds back and forward, a seek bar and full screen (that song's card fills the screen, its buttons too; **Esc** leaves it). YouTube and SoundCloud songs also have a volume slider and mute; each new song starts at the last volume set (kept for next time, in that window's browser). A song that can't play in Jarchi has **Open it on …**.
- **Chat votes**: **Start vote** for 10, 30, 60 or 90 seconds (**End now** stops it early). Viewers type **1** or **2** in Kick or Twitch chat (a Persian or Arabic keyboard's digits count too), one vote each, their last one counts. Who voted is kept only in memory for that vote; the battle keeps the counts. Then **Confirm winner**, **Vote again**, or pick the other song with **This one wins**: the final call is yours.
- **A tie**: a coin takes the place of VS in the middle, and nothing happens until you press it. It opens the lucky coin: **Flip the coin** pauses the songs and spins it in front of everyone (heads, song 1 wins; tails, song 2). Until then, **Vote again** and **This one wins** work as always.
- **Next match** goes on, round by round, up to the final.

## Bracket and Pop out

- **Game | Bracket** tabs while a battle is live and after it. **Bracket** shows every round: each song's cover, name, who sent it (with **Show who sent**; at the end, always) and its votes, the winners lit, 🪙 on a win the coin decided, the match on now and the final in gold; a bye says so.
- After the final, the champion waits for **Reveal the champion** (press it in the panel or the pop-out, both show it): "And the champion is…", then its card with confetti, next to **Who sent what**, every song by how far it got (1, 2, 3, 3, 5…) with who sent it, its wins and votes. Until then the top two stay blurred. It stays until you press **New battle**.
- **Pop out** opens the battle screen in its own window, with its own **فا | EN** switch (it changes only that window's language, so OBS can show another than the panel) and **Always on top** (the desktop app). Add it to OBS as a **Window Capture**.
- Your battle page at battle.jarchi.app follows the battle live: the matches, the vote counts (never who voted) and the champion.
