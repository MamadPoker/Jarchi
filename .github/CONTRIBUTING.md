# Contributing to Jarchi

Thanks for helping make Jarchi better for streamers. Bug reports, ideas and pull requests are all welcome.

## Report a bug or share an idea

- **Bug**: [open a bug report](https://github.com/MamadPoker/Jarchi/issues/new?template=bug_report.md). Say what you did, what happened, and add the lines from `data/logs/events.log` if an alert looked wrong.
- **Idea**: [open a feature request](https://github.com/MamadPoker/Jarchi/issues/new?template=feature_request.md).
- **Security problem**: please don't open an issue. See [SECURITY.md](SECURITY.md).

Streamers can also write from inside the app: **Support** in the panel.

## Run it from source

Requires [Node.js](https://nodejs.org/) 20.18.1 or newer (22 LTS recommended).

```sh
npm install
npm start          # the panel at http://127.0.0.1:3000
npm run app        # or as the desktop app
```

`npm install` also sets up a pre-push hook that runs `npm run check` (Prettier, ESLint, `tsc` and the tests), the same as CI.

Where things are: [docs/development.md](../docs/development.md). The rules every change follows, for people and AI agents alike: [AGENTS.md](../AGENTS.md).

## The code

- Plain Node.js, CommonJS, no build step. Types are JSDoc, checked by `npm run typecheck`. No `.ts` files ([why](../docs/adr/0002-type-check-js-with-jsdoc.md)).
- The Node standard library and what `package.json` already has come before a new dependency.
- Comments explain *why*, in plain sentences.
- Every UI string goes in both `i18n/en.json` and `i18n/fa.json` (a test fails if Persian misses one).
- A behaviour change comes with its test (`test/*.test.js`, `node --test`).

## Pull requests

Every change reaches `main` as a pull request, squashed into one commit whose message is the PR's title: a conventional commit (`feat: …`, `fix(relay): …`, `chore: …`; CI checks it, `build/check-pr.js`). Types: `feat fix perf refactor docs test build ci chore revert`.

A `feat`, `fix` or `perf` PR also adds its change on top of `i18n/changelog.json`, in the `"unreleased"` entry (`en` and `fa`: the same change in both, one plain line each, written for streamers, and its `types`), or gets the `no-notes` label when streamers see no difference.

Never raise `version` or tag by hand: releases are made from GitHub Actions ([docs/releasing.md](../docs/releasing.md)).

Before you open the PR:

- [ ] `npm run check` passes
- [ ] You tried it in the panel, and in OBS for widget changes
- [ ] No secrets, tokens or `.env` values in the diff
