# Security policy

## Supported versions

Only the [latest release](https://github.com/MamadPoker/Jarchi/releases/latest) gets security fixes. The installed app updates itself, so streamers get a fix with the next release.

## Report a vulnerability

Please **don't open a public issue**. Report it privately on GitHub instead:

**[Report a vulnerability →](https://github.com/MamadPoker/Jarchi/security/advisories/new)**

Include what's affected (the app, the panel, an OBS widget, the Kick relay in `relay/`), the steps to reproduce it, and the version (**About** in the panel). The report stays private between you and the maintainers until a fix is out, and you'll be credited in the advisory if you'd like.

## How Jarchi keeps things safe

- The local server only listens on `127.0.0.1`: nothing on your network can reach the panel or the widgets.
- In the installed app, the Kick and Twitch logins are encrypted at rest with a key that Windows encrypts for your Windows user (DPAPI), and blanked out of every log line.
- Jarchi's Kick relay never logs or stores Kick tokens or login codes.
- Proxy support only ever uses your own VPN app, never a public proxy, and never changes your system's proxy.
- Uploads and links are checked by their real file type and limited to 10 MB.
