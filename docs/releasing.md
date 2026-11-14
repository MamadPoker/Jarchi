[← Jarchi](../README.md) · [Docs](README.md)

# Releasing

Pull request rules (titles, What's new lines): [CONTRIBUTING.md](../.github/CONTRIBUTING.md#pull-requests).

## Windows installer and updates

```sh
npm run dist      # builds dist/Jarchi-Setup.exe on this PC (to try it; releases are built on GitHub)
```

For a release, two runs of **Actions → Release → Run workflow** on `main` (`.github/workflows/release.yml`):

1. **action: release** (tick **dry-run** first to see the version and the text). semantic-release (`release.config.js`, `build/release.js`) picks the version from the PR titles since the last release (`feat`, `fix` or `perf` → 1.0.9, a PR with the `big-update` label → 1.1.0, anything else makes no release; the label can still be added after merging, before the release), gives the `"unreleased"` entry that version (with one plain line if no PR had notes) under a new empty one, commits `chore(release): <version>` to `main`, tags it and makes a draft release "v<version>". Its text is the What's new (English, then Persian right to left), then the PR titles folded under **Developer changes**.
2. **action: build-installers** (version blank = the newest tag). It builds the installer from that tag on Windows and uploads `Jarchi-Setup.exe`, its `.blockmap` and `latest.yml` into the draft (all three are needed for updates; `latest.yml` carries the What's new only, `build/notes.js`), checks all three are there and publishes the release. Only then do downloads and installed apps see it.

No token on anyone's PC: the workflow makes the release "Jarchi v<version>" with the owner's `RELEASE_TOKEN` (so it says MamadPoker released it), and pushes the release commit with the `RELEASE_DEPLOY_KEY` deploy key (the only push `main`'s ruleset allows). Both are secrets of the `release` environment. The installer isn't signed yet. Its name has no version (`Jarchi-Setup.exe`), so https://github.com/MamadPoker/Jarchi/releases/latest/download/Jarchi-Setup.exe always gets the newest one; updates still find each version's files by its tag.

The relay deploys the same way, by hand: **Actions → Deploy relay** (`.github/workflows/relay.yml`) applies the new `relay/migrations` and then deploys the worker (**dry-run**: lists them and builds it). PRs that change `relay/` check it builds; `.github/workflows/security.yml` runs CodeQL and flags risky new dependencies; Dependabot opens one grouped PR a week.

Up to v1.0.2 the releases were on MamadPoker/Jarchi-releases, and v1.0.1 and older still look for updates there (their built-in `app-update.yml`). So v1.0.2 is published there too, with the very same three files from `dist/` (one build: `latest.yml`'s checksum must match the installer), and it stays there for good: from it, those copies update to v1.0.2, which looks on MamadPoker/Jarchi. Never delete Jarchi-releases or its v1.0.2.

The installed app looks for a newer release at start and every 30 minutes (and right away with **Check for updates** on the About page), downloads it in the background and installs it only when the streamer clicks **Restart now** (or quits Jarchi). `npm run app` never updates. The installer is per user (no admin rights), in English or Persian (a list at the start, the Windows language picked), and always installs into a `Jarchi` folder inside the one chosen (E:\ -> E:\Jarchi). Its options are in `package.json` `build` and `build/installer.nsh`, its pictures in `build/installerSidebar.bmp` (164x314) and `build/installerHeader.bmp` (150x57). The data stays in `%APPDATA%\Jarchi`, so updates and reinstalls keep it; uninstalling asks. The Kick and Twitch logins in it (`data\kick.json`, `data\twitch.json`: their access and refresh tokens) and the Support page's ticket token (`settings.json`) are encrypted with a key in `data\secrets.key`, which Windows itself encrypts for this Windows user (Electron safeStorage, DPAPI); older plain ones are encrypted at the first start, nobody is logged out. Copied to another PC or Windows user, they can't be read: connect again there. Dev runs (`npm start`, `npm run app`) keep `./data` in plain text, as before. The installed app also has **Uninstall Jarchi** in Settings (next to Reset everything): it starts this uninstaller with `--keep-app-data` or `--delete-app-data`, so it doesn't ask again, and quits.
