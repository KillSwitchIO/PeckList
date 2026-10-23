# Punchlist

[![pipeline](https://gitlab.com/killswitch10/punchlist/badges/main/pipeline.svg)](https://gitlab.com/killswitch10/punchlist/-/pipelines)
[![release](https://gitlab.com/killswitch10/punchlist/-/badges/release.svg)](https://gitlab.com/killswitch10/punchlist/-/releases)

A self-hosted, offline-first task and calendar app. Lists, subtasks, tags, dates and a calendar you
drag tasks onto, shared with the people you choose, on every device, online or not. One small
server keeps everyone's data, in SQLite or PostgreSQL, and runs as a Docker container or a native
program on Linux and Windows.

> **Status: before 1.0.** In daily use, but a minor version may still change things. Every change
> you need to act on is under **Breaking changes** in the [changelog](CHANGELOG.md). Keep backups.

## Features

- **Tasks**: subtasks, sections, nested tags, priorities, start and due dates, times and spans, rich
  notes and checklists, and one-line quick add (`Call the vet tomorrow 3pm #pets !high`).
- **Views**: Today, Next 7 days, All, Closed, Assigned to me, Shared with me, filters, search, and a
  month/week/day calendar with drag in, move and resize.
- **Offline first**: an installable PWA with a full local copy; changes merge per field across
  devices and people, without conflicts.
- **Sharing**: friends, groups and shared lists with roles; assign tasks to people or groups.
- **For admins**: single sign-on with any OIDC provider (group checks, role and group mapping,
  provider migration), roles and server groups, view-as for support, scheduled backups with
  whole-server and per-person restore, an access and event log, logs to Loki, Elasticsearch,
  Graylog, OpenTelemetry or syslog, usage stats, and settings from the environment, a file or the
  admin page (encrypted secrets supported).

## Quick start

```bash
docker run -d --name punchlist -p 8080:8080 -v punchlist-data:/data \
  registry.gitlab.com/killswitch10/punchlist:latest
docker logs punchlist     # the first admin password, printed once
```

Open <http://localhost:8080>. For real use, see the documentation:

|           |                                                                                                                                                                                                                |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install   | [Docker](docs/install/docker.md) · [Docker Compose](docs/install/docker-compose.md) · [Linux](docs/install/linux.md) · [Windows](docs/install/windows.md) · [From source](docs/install/from-source.md)         |
| Set up    | [First start](docs/getting-started/first-start.md) · [Reverse proxy and HTTPS](docs/install/reverse-proxy.md) · [Single sign-on](docs/guides/single-sign-on.md)                                                |
| Configure | [How settings work](docs/configuration/index.md) · [All settings](docs/configuration/reference.md) · [Settings file](docs/configuration/config-file.md) · [Database](docs/configuration/database.md)           |
| Run it    | [Backups](docs/guides/backups.md) · [Upgrading](docs/guides/upgrading.md) · [Logs and audit](docs/guides/logging.md) · [Security](docs/guides/security.md) · [Troubleshooting](docs/guides/troubleshooting.md) |
| Reference | [Command line](docs/reference/cli.md) · [HTTP API](docs/reference/http-api.md) · [FAQ](docs/faq.md)                                                                                                            |
| Examples  | [`examples/`](examples/): Compose files, a settings file, proxy configs, Linux and Windows service files                                                                                                       |

The same docs are published as a site from `main` (GitLab Pages).

## Downloads

Each [release](https://gitlab.com/killswitch10/punchlist/-/releases) has the image
(`registry.gitlab.com/killswitch10/punchlist:<version>`, amd64 and arm64), self-contained Linux
(x64, arm64) and Windows (x64) downloads, and `SHA256SUMS`.

## Contributing

Issues and merge requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) and
[developing](docs/development/index.md). Report security problems privately: [SECURITY.md](SECURITY.md).

## License

Not chosen yet. Until a license is published here, all rights are reserved.
