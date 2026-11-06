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
  `0.3.0-rc.1.edge.<commit>`. A commit hash of digits only gets a `g` in front
  (`0.4.1-edge.g03262935`): SemVer forbids a leading zero in a numeric part.
  `scripts/build-version.sh` works this out, for CI and for builds by hand
  (`CI_COMMIT_SHORT_SHA=$(git rev-parse --short HEAD) CI_COMMIT_BRANCH=main sh
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

A release is one image, built once. Nothing is rebuilt when it is published.

1. **Prepare.** On any green `main` pipeline, press `prepare-release` (set `RELEASE_VERSION` to name
   a pre-release or a major), or on your own machine run:

   ```bash
   pnpm release --dry-run               # the version the commits call for, and the changelog section
   git switch -c release/0.4.0
   pnpm release --any-branch --no-tag   # bump versions, copy the docs, regenerate CHANGELOG.md, commit
   git push -u origin release/0.4.0     # and open the merge request, titled chore(release): 0.4.0
   ```

2. **Merge the release merge request.** It runs `release-guard`, `docs` and `approval`, and no test
   suites: the guard fails unless it holds only the version, the changelog and the docs copy, so
   its tree is the last tested one.
3. **Look at the test server.** The merge's pipeline builds the one image, stamped exactly `0.4.0`,
   runs `e2e-server` against it and puts it on the test server. It also builds the native downloads
   and the signed APK, from the web app inside that image, so you can try the APK before publishing.
4. **Press `cut-release`** on that pipeline when you are happy. It checks the commit, the image and
   that the test server took it, then creates the tag `v0.4.0+<date>` and the whole release page in
   one call, as whoever pressed it. Only someone allowed to create `v*` tags can.
5. **The tag's pipeline** builds nothing. `promote-image` puts `:0.4.0`, `:0.4` and `:latest` on the
   digest step 3 built, by copying its manifest, and refuses an image stamped with another version
   or commit. The docs site moves to this version, and the demo follows. The mirror carries the tag
   to GitHub, where a workflow makes the matching release page with links to the files here.

A pre-release (`0.4.0-rc.1`) goes the same way, without `:latest`, the docs copy or the demo. It is
dated just before the latest release, so its page shows a Historical release badge: GitLab's latest
release link goes by date, and the update notice and the install docs read that link.

If the image is wrong on the test server, do not cut it. Fix it on `main` and prepare again: a
version that was never cut is prepared again rather than skipped over. Two builds may then say
`0.4.0`, and only the one you cut gets the name.

A newer merge can overtake a release commit's `deploy-test`. `cut-release` then says so: retry
`deploy-test` on the release commit, which reuses the image.

Re-running a job of the tag's pipeline is safe: `promote-image` copies the same bytes again.
Download names carry no version, so the newest release's files are always at
`https://gitlab.com/killswitch10/pecklist/-/releases/permalink/latest/downloads/<file>`.

### If the new way fails

Set the CI/CD variable `LEGACY_TAG_BUILD=true` and push a tag made with `pnpm release:tag`, and the
tag's pipeline builds and publishes everything itself, as it used to. That image is then not the
one the test server ran.

## Checklist

- [ ] The pipeline on `main` is green.
- [ ] Breaking changes have upgrade steps in their commit footers (they become the notes), and
      `Requires-Android` / `Supports-Web` footers where the apps are affected.
- [ ] Schema changes have a note in `docs/migrations/`.
- [ ] After the tag pipeline: the release page, `docker pull ...:X.Y.Z` has the digest on the page,
      and a native download's `pecklist --version`.
- [ ] The APK installs over the previous release on a phone (same signing key, higher version code).
