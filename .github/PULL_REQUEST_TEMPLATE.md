## Summary

<!-- What does this PR do? One or two sentences. The PR title is the commit on main: `<type>(<scope>): <what>`. -->

## Type of change

- [ ] `feat`: new feature (patch release; add the `big-update` label for a minor one, 1.0.9 → 1.1.0)
- [ ] `fix`: bug fix (patch release)
- [ ] `perf`: performance improvement (patch release)
- [ ] `refactor`: refactor, no feature or fix
- [ ] `docs`: documentation only
- [ ] `test`: tests only
- [ ] `build`: dependencies, installer, build scripts
- [ ] `ci`: GitHub Actions
- [ ] `chore`: maintenance

## What's new (feat / fix / perf)

- [ ] Added this change to the `"unreleased"` entry at the top of `i18n/changelog.json`: one plain line for streamers in `en`, the same line in `fa`, and its `types`
- [ ] Or streamers see no difference: the `no-notes` label is on this PR

## Changes

<!-- What changed and why, as a bullet list. -->

-

## Testing

- [ ] Ran `npm test`
- [ ] Tried it in the app or panel (`npm run app` / `npm start`), and in OBS for widget changes
- [ ] Added or updated tests for new logic

## Screenshots / recordings

<!-- For panel, widget or installer changes: before and after. -->

## Checklist

- [ ] New UI strings are in both `i18n/en.json` and `i18n/fa.json`
- [ ] No secrets, tokens or `.env` values in the diff
- [ ] Relay: a D1 change is a new file in `relay/migrations/`, and the PR says it needs **Deploy relay** after merging
