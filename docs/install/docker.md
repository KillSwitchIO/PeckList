# Docker

PeckList ships as one image that serves both the web app and the API.

```text
registry.gitlab.com/killswitch10/pecklist
```

## Image tags

| Tag           | What it is                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------- |
| `latest`      | The newest full release, never a pre-release.                                                  |
| `0.2`         | The newest `0.2.x` release: fixes, never a breaking change. Recommended for automatic updates. |
| `0.2.1`       | Exactly that release.                                                                          |
| `rc`          | The newest release candidate (`beta` and `alpha` likewise). To try what comes next.             |
| `edge`        | The current `main` branch, built on every merge. For testing; not for data you care about.     |
| `sha-abc1234` | One `main` commit.                                                                             |

Every image runs on `linux/amd64` and `linux/arm64` (a Raspberry Pi 4 or 5 with a 64-bit OS works).

## Run it

```bash
docker run -d --name pecklist --restart unless-stopped \
  -p 8080:8080 \
  -v pecklist-data:/data \
  -v pecklist-files:/files \
  registry.gitlab.com/killswitch10/pecklist:latest
```

Then read the first admin password with `docker logs pecklist` and open [http://localhost:8080](http://localhost:8080).
For anything longer-lived, use [Docker Compose](docker-compose.md).

To keep settings in a file, pass an env file:

```bash
docker run -d --name pecklist -p 8080:8080 -v pecklist-data:/data -v pecklist-files:/files \
  --env-file pecklist.env registry.gitlab.com/killswitch10/pecklist:latest
```

<details>
<summary>pecklist.env</summary>

```bash
--8<-- "examples/docker/pecklist.env"
```

</details>

## What is inside

- A chiseled .NET base: no shell, no package manager, nothing to log into. Runs as uid **1654**
  (the image's `app` user), never root.
- Listens on port **8080** (`ASPNETCORE_HTTP_PORTS`).
- Keeps its data in **`/data`**: the SQLite database, snapshots (`/data/snapshots`), log files
  (`/data/logs`) and audit archives (`/data/audit`). Mount a volume there.
- Keeps attached files in **`/files`** (`ATTACHMENT_DIR`), apart from the database, since that is the
  folder that grows. Mount a volume there too, on bigger or slower storage if you like; without
  one, Docker makes an anonymous volume that is easy to lose when the container is recreated.
- A health check that runs `pecklist healthcheck` (there is no curl inside); `docker ps` shows
  `healthy` once the server answers.
- The `pecklist` command for maintenance, run with `docker exec`: see the
  [command line reference](../reference/cli.md).

## Data folder permissions

A **named volume** (`-v pecklist-data:/data`) works as is. A **bind mount** of a host folder must
be writable by uid 1654:

```bash
mkdir -p ./data ./files && sudo chown 1654:1654 ./data ./files
```

or run the container as your own user (who then owns the folder): `--user 1000:1000`.

## Secrets

Every setting also reads from a file: add `_FILE` to its name. That is how Docker and Compose
secrets work:

```bash
docker run ... -e ADMIN_PASSWORD_FILE=/run/secrets/admin_password \
  -v ./admin_password:/run/secrets/admin_password:ro ...
```

One trailing newline in the file is ignored. Setting both `NAME` and `NAME_FILE` is an error.
Values can also be [encrypted](../configuration/index.md#encrypted-values).

## Building the image yourself

```bash
git clone https://gitlab.com/killswitch10/pecklist.git && cd pecklist
docker build -t pecklist:local .
# both architectures:
docker buildx build --platform linux/amd64,linux/arm64 -t pecklist:local .
```
