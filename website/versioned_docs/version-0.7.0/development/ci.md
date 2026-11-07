# CI and runners

The pipeline is in [`.gitlab-ci.yml`](https://gitlab.com/killswitch10/pecklist/-/blob/main/.gitlab-ci.yml).

## When it runs

| Pipeline              | Jobs                                                                                                                                                                                                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Merge request         | `lint` (lint, format and typecheck at once, then versions, docs coverage, script tests), `web-test`, `server-test`, `e2e`, `docs`, `container-image` (amd64 only, built, not pushed). `ci-images` first when a tool image's inputs changed. `approval` last ([approval](#approval)).                                                                                                      |
| `main`                | The same, then the `:edge` and `:sha-<commit>` images for amd64 and arm64 (version `<next patch>-edge.<commit>`, [releasing](releasing.md#versions)), two devices syncing through that image (`e2e-server`), the test server updated to it (`deploy-test`), the docs site (`pages`) and the docs in the wiki (`wiki`). By hand: `web-build`, `packages`, `android-release`, `android-apk`. |
| Tag `vX.Y.Z+YYYYMMDD` | No checks or tests (the tag goes on a main commit whose pipeline passed; `pnpm release:tag` refuses otherwise): release images (`:X.Y.Z`, `:X.Y`, `:latest`), native downloads, the signed APK, and the GitLab release (`release`).                                                                                                          |
| Weekly schedule       | `ci-images` rebuilt on current base images, `audit-web` (`pnpm audit`), `audit-server` (vulnerable NuGet packages), `audit-image` (Trivy on `:edge`).                                                                                                                                                                                              |
| Run pipeline (web UI) | Like a merge request, on any branch. `CI_IMAGES_BUILD=true` rebuilds the tool images too.                                                                                                                                                                                                                                                         |

Pushes to other branches do not start a pipeline; open a merge request. A newer push to a branch
cancels the pipeline still running for the old one.

## Approval

GitLab Free has an Approve button on merge requests but cannot require it, so the last job of a
merge request pipeline, `approval`, does: it fails until someone named in `APPROVERS` (set on the
job) has approved, and "Pipelines must succeed" then keeps the merge request from merging.

- Approve while the pipeline is still running and `approval` passes when it gets there.
- Approve after it failed, then retry the `approval` job; a merge request set to merge when the
  pipeline succeeds then merges.
- On Free an approval stays when more commits are pushed. With a `read_api` token in the CI/CD
  variable `APPROVAL_READ_TOKEN` (masked, not protected, since merge request pipelines run on
  unprotected branches), an approval only counts if it came after the last push: unapprove and
  approve again after looking at new commits. Without the token the job reads the approvals
  anonymously, which needs the project to be public.

## What keeps it quick

- **One pnpm store, written once.** Every Node job restores the store from the runner's cache
  (keyed by the lockfile) and only `lint` writes it back, with the eslint and prettier caches.
  The NuGet cache works the same way: `server-test` writes, the others read. Archives use the
  fastest compression (`FF_USE_FASTZIP`, `CACHE_COMPRESSION_LEVEL`).
- **Tool images instead of `apt-get`.** The browsers and the JDK and Android SDK come
  from images built out of [`ci/`](https://gitlab.com/killswitch10/pecklist/-/tree/main/ci)
  into `registry.gitlab.com/killswitch10/pecklist/ci/{browsers,android}` by the
  `ci-images` job: when one of those files changes, weekly, or on demand.
- **Heavy jobs one at a time.** `web-build`, `android-release` and `packages` share a
  `resource_group`, so a release does not run four builds against each other on one runner;
  each finishes in minutes alone where they took the better part of an hour together.
- **Merge requests build less.** The image is amd64 only, without SBOM or provenance; both
  architectures and the attestations come with `main` and tags. The build cache export is
  `mode=min`.
- **A tag does not re-test.** Its commit was tested as `main`; `pnpm release:tag` checks that
  pipeline was green before making the tag.
- Each job has a `timeout`, and the jsdom and browser test jobs retry once on a script failure
  (a stopgap for the timeouts a busy runner causes; a real flake still fails twice).

Per-job timings are in the API: `glab api projects/killswitch10%2Fpecklist/pipelines/<id>/jobs`
lists `duration` and `queued_duration` for each.

## The test server follows main

`deploy-test` runs on `main` after `e2e-server` passed. It starts the project's deployment
pipeline with the image `sha-<commit>`, which puts it on the test server once its own checks pass. Production is never
touched from here: it pins a release version and moves only by hand
([releasing](releasing.md)).

The job needs `GITLAB_API_TOKEN`: a personal access token with the `api` scope, stored as a
masked, protected CI/CD variable (**Settings > CI/CD > Variables**). Without it the job does
not appear. The same token lets `wiki` push.

## The docs in the wiki

`wiki` runs on `main` after `docs` and mirrors `docs/` into the
[project wiki](https://gitlab.com/killswitch10/pecklist/-/wikis/home): the same pages, with
the site-only syntax rewritten for GitLab (`:::` admonitions as alerts, tabs as bold headings,
`--8<--` snippets pasted in) and the links pointed at wiki pages, in the order of
`website/sidebars.json`
(`scripts/wiki-pages.mjs`, tested in `scripts/wiki-pages.test.mjs`). Each page starts with a
line saying where it comes from. The wiki is a copy: edit `docs/`, and the next merge refreshes
it. Pages that leave `docs/` leave the wiki.

The rendered site at [https://docs.pecklist.com](https://docs.pecklist.com) stays the canonical docs: it has the search, the
tabs and the strict link check the wiki cannot give. GitLab Pages builds it from main (`pages`).

## The website and the demo

- The website, [https://pecklist.com](https://pecklist.com), is its own repository: a landing page.
  Its docs links go to this project's wiki.
- `deploy-demo` (release tags, not pre-releases) puts the release on
  [https://demo.pecklist.com](https://demo.pecklist.com), which resets
  every hour (`DEMO_RESET_EVERY`, PL-117).

## Container registry

Images go to the project's registry, `registry.gitlab.com/killswitch10/pecklist`, using the job's
own registry credentials: nothing to configure. Each image is built for `linux/amd64` and
`linux/arm64` (cross-compiled, no emulation), with an SBOM and provenance attached, and the layer
cache kept at `:buildcache`.

While the project is private, pulling needs a login: create a deploy token with `read_registry`
(**Settings > Repository > Deploy tokens**) and `docker login registry.gitlab.com` with it on each
host that pulls.

## Runners

Every job runs on the runner tagged by the `RUNNER_TAG` variable, so set that to your runner's tag
(**Settings > CI/CD > Variables**). It must be a
**Docker executor** that mounts the host's Docker socket (`/var/run/docker.sock`), because the
`container-image` and `ci-images` jobs build with Docker. The PostgreSQL tests use a `postgres`
service in CI (`PECKLIST_TEST_POSTGRES` names it), not a container they start: a container
started through the host's Docker is reached through the bridge gateway, which a host firewall
usually drops.

### A self-hosted runner

1. In GitLab: the group (or project) > **Build > Runners > New group runner**. Tags: the value of `RUNNER_TAG`, say `my-runner`.
   Leave **Run untagged jobs** off. Create it and copy the token (`glrt-...`).
2. On the machine, register it with GitLab Runner 17 or later:

   ```bash
   sudo gitlab-runner register --non-interactive \
     --url https://gitlab.com --token glrt-... \
     --executor docker --docker-image docker:29 \
     --docker-volumes /var/run/docker.sock:/var/run/docker.sock \
     --docker-volumes /cache
   ```

   On NixOS, add an entry to `services.gitlab-runner.services` with
   `authenticationTokenConfigFile` pointing at a root-only file holding `CI_SERVER_URL` and
   `CI_SERVER_TOKEN`, `executor = "docker"`, and the same volumes.

3. Run a pipeline (**Build > Pipelines > Run pipeline**) with `CI_IMAGES_BUILD=true` to build
   the tool images and check that the runner picks the jobs up.

A runner with 4 GB of RAM and 20 GB of disk is enough for one pipeline at a time; the e2e and
container-image jobs are the heaviest. A runner shared with other repositories wants a weekly
`docker system prune` of unused images: a CI host collects one image per tool.

### GitLab's shared runners

Set the CI/CD variable `RUNNER_TAG` to `saas-linux-medium-amd64` (**Settings > CI/CD > Variables**).
Shared runners use Docker-in-Docker rather than the host socket; the `container-image`,
`ci-images` and `server-test` jobs then need a `docker:dind` service, which is not set up here.
They use compute minutes.

## Checking a job locally

Every job is a container image plus a script, so it can be run with `docker run` against a checkout,
or with [gitlab-ci-local](https://github.com/firecow/gitlab-ci-local).

## Dependency updates

[Renovate](https://docs.renovatebot.com/) opens merge requests for updates once a week, run from
a separate project's pipeline schedule (Fridays). The rules are in
`renovate.json`: patches and minors merge themselves once their pipeline passes, which takes an
[approval](#approval) like any merge request; majors (and the Android Gradle setup, which follows
Capacitor's template) also wait for a closer look, related packages
come together (MUI, Tiptap, Capacitor, React, test and lint tools, .NET packages), at most six
are open at a time, and the lockfile is refreshed on Mondays. Base images keep floating on their
major tags (`node:24`, `dotnet/sdk:10.0`), so only a new major shows up for those.
