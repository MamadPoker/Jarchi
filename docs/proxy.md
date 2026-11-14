[← Jarchi](../README.md) · [Docs](README.md)

# Proxy & VPN

For VPN users and filtered networks: **Connections → Proxy**. Jarchi only ever uses the user's own VPN app, never a public proxy.

- **Auto** (default): the VPN app found on this PC that the user said Yes to, else whatever Windows (or the VPN app) has set under Settings → Network → Proxy. Neither = direct. **Look for VPN apps** looks again.
- **Manual**: an HTTP or SOCKS5 proxy at an address and port (e.g. the local port of v2rayN or Clash).
- **Off**: always direct, and Jarchi never looks for a VPN app.

When Kick, Twitch or Jarchi's relay can't be reached (core/vpn.js), Jarchi looks for a VPN app's local proxy: what known VPN programs (v2rayN, NekoRay/NekoBox, Hiddify, NetMod, Clash / Clash Verge, Outline, Psiphon, Shadowsocks…) listen on at 127.0.0.1 (netstat + tasklist), the Windows proxy when it's on this PC, and their usual ports. Each is tested by really reaching Kick through it (only a TLS hello: no logins or tokens). A working one is offered in a popup ("Couldn't connect to Kick. v2rayN was found on this PC. Connect Jarchi through it?"); nothing found = short steps for typing the port in Manual. A proxy that stops working later shows a warning in the top bar; a click looks again.

Only Jarchi's own connections go through it: Kick, Twitch, 7TV, the relay, the emotes, badges and profile pictures in chat (OBS loads those through Jarchi), and the desktop app's update checks. The system's proxy is never changed. **Test connection** checks Kick, Twitch and 7TV and says in plain words what works and what doesn't; the dot next to **Proxy** shows the result. Not supported: proxy login (username/password) and Windows PAC scripts.
