// semantic-release (.github/workflows/release.yml, action: release): the squashed PR titles on main since the last tag
// pick the version: feat / fix / perf (even with "!" or BREAKING CHANGE) make a patch release, and only a PR with the
// big-update label makes a minor one (build/release.js asks GitHub); nothing makes a major one. The highest one of the
// two plugins' answers wins. build/release.js also writes the release text and stamps the Unreleased What's new entry; the GitHub release stays a draft until build-installers uploads the installer,
// its .blockmap and latest.yml into it and publishes it (a published release without them breaks updates).
module.exports = {
  branches: ['main'],
  tagFormat: 'v${version}',
  plugins: [
    ['@semantic-release/commit-analyzer', { preset: 'conventionalcommits', releaseRules: [{ breaking: true, release: 'patch' }, { type: 'feat', release: 'patch' }] }],
    './build/release.js',
    ['@semantic-release/git', { assets: ['package.json', 'package-lock.json', 'i18n/changelog.json'], message: 'chore(release): ${nextRelease.version} [skip ci]' }],
    ['@semantic-release/github', { draftRelease: true, successComment: false, failComment: false, releasedLabels: false }],
  ],
};
