# Releasing

Releases are tags on `main`. CI does the rest: images, native downloads, checksums and the GitLab
release with notes.

## Versions

- [Semantic versioning](https://semver.org/). Before 1.0, a minor version may break things; a patch
  never does.
- **What a release holds decides its number.** Any feature (a `feat` commit) since the last tag
  makes it a **minor** release (`0.2.10` to `0.3.0`); only fixes, dependency and version bumps,
  docs and chores make it a **patch** (`0.2.10` to `0.2.11`). From 1.0 on, a breaking change
  (`type!:` or a `BREAKING CHANGE:` footer) makes it a major; before 1.0 it counts as a feature.
  `pnpm release` with no version works this out from the commits, and refuses a version that
  breaks the rule (a major, such as `1.0.0`, is always named by hand).
- The tag carries the date as build metadata: `v0.4.0+20261023`. Images are tagged `0.4.0`, `0.4`
  and `latest` (`+` is not allowed in image tags).
- A pre-release (`0.4.0-rc.1`) gets only its exact image tag, no `latest`, and is marked as a
  pre-release.
- The version lives in `web/package.json`, `web/src/core/workspace.ts` (`APP_VERSION`) and
  `server/Directory.Build.props`. `pnpm check:version` checks they agree, and in a tag pipeline
  that they match the tag.
- Builds between releases carry the **next** patch, so they sort after the release they follow and
  before the next one: after `0.2.0`, `main` builds `0.2.1-edge.<commit>` and other branches
  `0.2.1-dev.<commit>`. After a pre-release such as `0.3.0-rc.1` they are
  `0.3.0-rc.1.edge.<commit>`. `scripts/build-version.sh` works this out, for CI and for builds by
  hand (`CI_COMMIT_SHORT_SHA=$(git rev-parse --short HEAD) CI_COMMIT_BRANCH=main sh
  scripts/build-version.sh`).
- Bump the version with each release; nothing else moves it. Until something is released, every
  build says the last version (that is how everything up to 0.2.0 said `0.1.0-edge`).

## The changelog

`CHANGELOG.md` is generated from Conventional Commits by [git-cliff](https://git-cliff.org)
(`cliff.toml`): `feat` under **Added**, `fix` under **Fixed**, `perf`, `security`, `docs` and
`refactor` in their own sections; `test`, `ci`, `build`, `chore` and `style` are left out.
Commits marked breaking (`feat!:`, or a `BREAKING CHANGE:` footer with the upgrade steps) are listed
first, under **Breaking changes**, whatever their type. Write commit summaries for the people who
will read the changelog.

`pnpm changelog` regenerates it, with unreleased work under **Unreleased**.

### Compatibility

A release that needs people to update the Android app, or that stops serving old web apps, says
so at the top of its section, under **Compatibility**. The lines come from commit footers:

```text
feat(sync)!: pages carry the server clock

Requires-Android: 0.3.0
Supports-Web: 0.2.9
```

- `Requires-Android: X.Y.Z`: the Android app must be X.Y.Z or newer before this server is
  updated (an older app is signed out until it updates).
- `Supports-Web: X.Y.Z`: the oldest web app this server still serves; an older one updates itself
  on its next load, so this is for people who pin an app build.

Write the footer on the commit that makes it true (the one that changes the sync protocol, the
app's API, or the schema), so the next release carries it. A release without either footer makes
no claim: nothing changed in what it needs.

## Making a release

On an up-to-date `main` with a green pipeline:

```bash
pnpm release --dry-run          # the version the commits call for, and the changelog section
pnpm release                    # bump versions, regenerate CHANGELOG.md, commit, tag
pnpm release 1.0.0              # a major, named by hand
git show                        # review; amend the changelog wording if needed, then re-tag
git push origin main --follow-tags
```

### Through a merge request

`main` is protected, so the usual way is a merge request:

```bash
git switch -c release/0.4.0
pnpm release --any-branch --no-tag   # bump versions, regenerate CHANGELOG.md, commit
git push -u origin release/0.4.0           # open the merge request, review, merge
git switch main && git pull
pnpm release:tag                            # tag main's head with the version and its notes
git push origin v0.4.0+<date>               # the tag `pnpm release:tag` printed
```

`pnpm release:tag` checks that main holds one version in every file, that it is not tagged yet,
that `CHANGELOG.md` has its section (which becomes the tag message and the release notes), and
that the commit's `main` pipeline passed: the tag pipeline builds and publishes without running
the checks and tests again (`--skip-pipeline-check` if you know better). While the project is
private, the check needs `GITLAB_TOKEN` set to a token that can read it (the API answers 404
without one).

The tag pipeline then:

1. Runs `check:version` against the tag (the checks and tests ran on `main`).
2. Builds and pushes the release images for amd64 and arm64.
3. Builds the native downloads (`punchlist-linux-x64.tar.gz`, `punchlist-linux-arm64.tar.gz`,
   `punchlist-win-x64.zip`) and `SHA256SUMS`.
4. Builds the signed Android app, `punchlist-android.apk`, and adds it to the downloads and
   `SHA256SUMS` ([Android app](android.md#release-signing)).
5. Uploads them to the package registry and creates the release, with the changelog section as its
   notes, the downloads as assets, and the image.

Re-running the `release` job updates the release instead of failing. The newest release's files are
always at `https://gitlab.com/killswitch10/punchlist/-/releases/permalink/latest/downloads/<file>`.

## Checklist

- [ ] The pipeline on `main` is green, including e2e.
- [ ] Breaking changes have upgrade steps in their commit footers (they become the notes), and
      `Requires-Android` / `Supports-Web` footers where the apps are affected.
- [ ] Schema changes have a note in `docs/migrations/`.
- [ ] After the tag pipeline: the release page, `docker pull ...:X.Y.Z`, and a native download's
      `punchlist --version`.
- [ ] The APK installs over the previous release on a phone (same signing key, higher version code).
