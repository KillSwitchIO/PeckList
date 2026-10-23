# Releasing

Releases are tags on `main`. CI does the rest: images, native downloads, checksums and the GitLab
release with notes.

## Versions

- [Semantic versioning](https://semver.org/). Before 1.0, a minor version may break things; a patch
  never does.
- The tag carries the date as build metadata: `v0.4.0+20261023`. Images are tagged `0.4.0`, `0.4`
  and `latest` (`+` is not allowed in image tags).
- A pre-release (`0.4.0-rc.1`) gets only its exact image tag, no `latest`, and is marked as a
  pre-release.
- The version lives in `web/package.json`, `web/src/core/workspace.ts` (`APP_VERSION`) and
  `server/Directory.Build.props`. `pnpm check:version` checks they agree, and in a tag pipeline
  that they match the tag.

## The changelog

`CHANGELOG.md` is generated from Conventional Commits by [git-cliff](https://git-cliff.org)
(`cliff.toml`): `feat` under **Added**, `fix` under **Fixed**, `perf`, `security`, `docs` and
`refactor` in their own sections; `test`, `ci`, `build`, `chore` and `style` are left out.
Commits marked breaking (`feat!:`, or a `BREAKING CHANGE:` footer with the upgrade steps) are listed
first, under **Breaking changes**, whatever their type. Write commit summaries for the people who
will read the changelog.

`pnpm changelog` regenerates it, with unreleased work under **Unreleased**.

## Making a release

On an up-to-date `main` with a green pipeline:

```bash
pnpm release 0.4.0 --dry-run    # preview the changelog section
pnpm release 0.4.0              # bump versions, regenerate CHANGELOG.md, commit, tag
git show                        # review; amend the changelog wording if needed, then re-tag
git push origin main --follow-tags
```

The tag pipeline then:

1. Runs the checks and tests again, and `check:version` against the tag.
2. Builds and pushes the release images for amd64 and arm64.
3. Builds the native downloads (`punchlist-linux-x64.tar.gz`, `punchlist-linux-arm64.tar.gz`,
   `punchlist-win-x64.zip`) and `SHA256SUMS`.
4. Uploads them to the package registry and creates the release, with the changelog section as its
   notes, the downloads as assets, and the image.

Re-running the `release` job updates the release instead of failing. The newest release's files are
always at `https://gitlab.com/killswitch10/punchlist/-/releases/permalink/latest/downloads/<file>`.

## Checklist

- [ ] The pipeline on `main` is green, including e2e.
- [ ] Breaking changes have upgrade steps in their commit footers (they become the notes).
- [ ] Schema changes have a note in `docs/migrations/`.
- [ ] After the tag pipeline: the release page, `docker pull ...:X.Y.Z`, and a native download's
      `punchlist --version`.
