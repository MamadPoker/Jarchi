# Jarchi

Stream alerts and widgets for OBS, running locally on a streamer's PC, plus a small cloud relay. This glossary covers how Jarchi is released.

## Language

### Releasing

**What's new entry**:
One version's changes, written once in English and once in Persian with one plain line per change, kept in `i18n/changelog.json`. Streamers see it in the app and in the release text.
_Avoid_: changelog, release notes, CHANGELOG.md

**Unreleased entry**:
The What's new entry at the top that has no version number yet. Merged changes collect in it until the next release gives it a version.
_Avoid_: draft notes, next version

**Release**:
A published version: its tag, its GitHub release with the installer, and its What's new entry. Installed apps update only to a published release.
_Avoid_: build, deploy (a release is never a relay deploy)

**No-notes change**:
A change that releases a new version without adding a line to the Unreleased entry, because streamers can't see any difference. It's marked with the `no-notes` label on its PR.

**Big update**:
A change the owner decides is big enough, like a full UI redesign, to raise the middle number of the version (1.0.9 → 1.1.0). It's marked with the `big-update` label on its PR. Every other release only raises the last number.
_Avoid_: major, breaking change
