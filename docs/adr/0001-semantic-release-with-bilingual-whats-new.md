# semantic-release picks the version; people write the What's new entry

Releases are cut by semantic-release from squash-merged conventional PR titles, run by hand in two steps: `release` makes the tag, the version commit and a draft; `build-installers` uploads the installer files and then publishes. The streamer-facing What's new (English and Persian, shown in the app and carried in `latest.yml`) can't be generated from commits, so each `feat` / `fix` / `perf` PR writes its lines into an `"unreleased"` entry in `i18n/changelog.json`, and the release stamps that entry with the computed version. Commit-generated notes appear only in a collapsed "Developer changes" block on the GitHub release.

## Considered options

- **Bump `version` and add the entry by hand in a release PR** (simplest, the old habit): rejected because we wanted the version picked from the kind of change, not chosen by hand.
- **Notes in the PR body, parsed by CI**: rejected because it's fragile and the Persian text would never be reviewed in a diff.
- **Publish the release right away, as `ai-job-hunter-app` does**: rejected. A published release without `latest.yml` breaks every installed app's update check, so the release stays a draft until `build-installers` has uploaded all three files.

## Consequences

- `main` accepts PRs only (squash, `✅ CI OK`). The `RELEASE_DEPLOY_KEY` deploy key is the only bypass, for the release commit.
- A release where every change was `no-notes` gets one generic line in both languages, so What's new never shows an empty version.
