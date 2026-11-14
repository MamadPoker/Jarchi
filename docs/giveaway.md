[← Jarchi](../README.md) · [Docs](README.md)

# Giveaway

A prize wheel, giveaways from Kick and Twitch chat, and a coin flip, on three tabs: **Wheel**, **Giveaway**, **Coin flip**. They live in the panel (there's no OBS link for them). **Pop out** opens the page in its own window for a second monitor, and **Always on top** keeps it above other windows. Everything is saved in `data/luck.json`.

## Wheel

- **My wheels**: up to 30, each with its own name. New installs start with three samples: Punishments, Next game and Sub prizes.
- **Slices**: 2 to 60, each with its text and, with **Separate chance per slice** on, its own chance: very low, low, normal or high. Off, every slice has the same chance.
- **Tick sound** as it passes each slice, and **Remove the winner after** for prizes there's only one of.
- **Spin**, the result, and the last 10 spins.

## Giveaway

Viewers join by typing a word in Kick or Twitch chat.

1. Set it up:
   - **Entry word** (`!join` by default) and **Who can join**: everyone or subs only.
   - **Subs get double chance**: each sub counts twice in the draw.
   - **Entry timer**: manual, 1, 2 or 5 minutes.
   - **How long names spin**: 3, 5 or 10 seconds.
   - **Winners** (1–5) and **Losers** (0–5, just for suspense). **Order**: losers first, then the winner, or random. **After each name**: pause until **Next name**, or back to back.
   - **Previous winners can't join**.
2. **Start giveaway**: the entrants list fills live as viewers type the word (subs marked **SUB ×2**). **Close entries** by hand, or let the timer close them.
3. **Draw**: the names spin and land one by one, losers marked **Eliminated**, winners **Winner**.
4. **Winners' next messages in chat** show under the result, so you know they're watching. **Draw again** draws from the same entrants (without this round's winners while **Previous winners can't join** is on).

## Coin flip

**Flip** a Jarchi coin: heads or tails, a score since the start of the stream (**Reset** sets it back to 0) and the last 10 flips.
