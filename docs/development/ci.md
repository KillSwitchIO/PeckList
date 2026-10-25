# CI and runners

The pipeline is in [`.gitlab-ci.yml`](https://gitlab.com/killswitch10/punchlist/-/blob/main/.gitlab-ci.yml).

## When it runs

| Pipeline              | Jobs                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Merge request         | `lint` (lint, format, typecheck, versions, docs coverage), `web-test`, `server-test`, `e2e`, `docs`, `container-image` (built, not pushed)                 |
| `main`                | The same, then the `:edge` and `:sha-<commit>` images (version `<next patch>-edge.<commit>`, [releasing](releasing.md#versions)), two devices syncing through that image (`e2e-server`) and the docs site (`pages`). Native downloads on demand (`web-build`, `packages`: manual). |
| Tag `vX.Y.Z+YYYYMMDD` | Checks and tests, release images (`:X.Y.Z`, `:X.Y`, `:latest`), native downloads, and the GitLab release (`release`).                            |
| Run pipeline (web UI) | Like a merge request, on any branch.                                                                                                             |

Pushes to other branches do not start a pipeline; open a merge request.

## Container registry

Images go to the project's registry, `registry.gitlab.com/killswitch10/punchlist`, using the job's
own registry credentials: nothing to configure. Each image is built for `linux/amd64` and
`linux/arm64` (cross-compiled, no emulation), with an SBOM and provenance attached, and the layer
cache kept at `:buildcache`.

While the project is private, pulling needs a login: create a deploy token with `read_registry`
(**Settings > Repository > Deploy tokens**) and `docker login registry.gitlab.com` with it on each
host that pulls.

## Runners

Every job runs on the runner tagged by the `RUNNER_TAG` variable (default `homelab`). It must be a
**Docker executor** that mounts the host's Docker socket (`/var/run/docker.sock`), because the
`container-image` job builds with Docker and the PostgreSQL tests start a container.

### A self-hosted runner

1. In GitLab: the group (or project) > **Build > Runners > New group runner**. Tags: `homelab`.
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

3. Run a pipeline (**Build > Pipelines > Run pipeline**) to check it picks the jobs up.

A runner with 4 GB of RAM and 20 GB of disk is enough; the e2e and container-image jobs are the heaviest.

### GitLab's shared runners

Set the CI/CD variable `RUNNER_TAG` to `saas-linux-medium-amd64` (**Settings > CI/CD > Variables**).
Shared runners use Docker-in-Docker rather than the host socket; the `container-image` and `server-test` jobs
then need a `docker:dind` service, which is not set up here. They use compute minutes.

## Checking a job locally

Every job is a container image plus a script, so it can be run with `docker run` against a checkout,
or with [gitlab-ci-local](https://github.com/firecow/gitlab-ci-local).
