# Self-hosting

Early notes; the full guide comes with milestone 0.9. Punchlist runs as one container that serves
the web app and the API (ADR-0002 in the project spec).

## Run it

```bash
docker build -t punchlist:dev .
docker run -d -p 8080:8080 -v punchlist-data:/data punchlist:dev
```

Then open http://localhost:8080. A compose example is in [compose.yaml](compose.yaml).

## The image

- Chiseled .NET base: no shell, no package manager. Runs as uid 1654 (`app`).
- Listens on 8080 (`ASPNETCORE_HTTP_PORTS`).
- Data lives in `/data`. A named volume works out of the box; a bind-mounted folder must be
  owned by uid 1654, or run the container as your own uid with `user:`.
- Health: `GET /healthz`. The image's own health check runs
  `punchlist healthcheck`, since there is no curl inside.

## First start

With the default `AUTH_MODE=local`, the first start creates the `admin` account and prints its
generated password once in the logs (`docker logs <container>`). Log in and change it; the API
refuses everything else until you do. Set `ADMIN_PASSWORD` (or `ADMIN_PASSWORD_FILE`) to choose
it instead. `AUTH_MODE=none` skips logins entirely: anyone who can reach the server has full access,
so keep it to a trusted network.

The `admin` account is the server's super admin. Roles are `user`, `admin` (manages users,
groups, settings, backups, logs and stats) and `superadmin` (all of that, plus managing admins).
There is always at least one active super admin.

Five wrong passwords lock an account for 15 minutes, and each address gets ten login attempts a
minute. Sessions are HttpOnly cookies that last 30 days of use; changing a password ends the other
sessions.

## Behind a reverse proxy

The server reads `X-Forwarded-For` and `X-Forwarded-Proto` from trusted proxies only.
`TRUSTED_PROXIES` takes a comma-separated list of addresses or CIDR ranges; by default it trusts
loopback and the private ranges (10/8, 172.16/12, 192.168/16, fc00::/7), which covers a proxy on
the same host or Docker network.

## Settings

| Variable               | Default                      | Meaning                                                   |
| ---------------------- | ---------------------------- | --------------------------------------------------------- |
| `AUTH_MODE`            | `local`                      | `local` (accounts) or `none` (no login, one user)         |
| `ADMIN_PASSWORD`       | generated                    | The first admin password (12+ characters)                 |
| `DB_PROVIDER`          | `sqlite`                     | `sqlite` or `postgres` (PostgreSQL 15+)                   |
| `DB_PATH`              | `/data/punchlist.db`         | The SQLite file                                           |
| `DB_CONNECTION_STRING` | -                            | PostgreSQL connection string (Npgsql format)              |
| `DB_MIGRATE_ON_START`  | `true`                       | Set false when the database user cannot change the schema |
| `SNAPSHOT_SCHEDULE`    | `daily`                      | `daily`, `hourly` or `off`                                |
| `SNAPSHOT_DIR`         | `snapshots` by the database  | Where snapshots go                                        |
| `SNAPSHOT_KEEP`        | `14`                         | How many snapshots to keep                                |
| `TRUSTED_PROXIES`      | private ranges               | Proxies allowed to set forwarded headers                  |
| `WEB_ROOT`             | `wwwroot` next to the server | Where the web build is (only for development)             |

Every setting also accepts `NAME_FILE`, a file holding the value (Docker secrets); one trailing
newline is dropped. Setting both is an error. A bad setting stops the server with a list of what
to fix. More settings (auth) arrive with the rest of milestone 0.4.

## Backups

The server writes a full backup to `SNAPSHOT_DIR` (default: `snapshots` next to the SQLite file,
so `/data/snapshots`) on the `SNAPSHOT_SCHEDULE` (`daily` by default, `hourly`, or `off`), keeping
the newest `SNAPSHOT_KEEP` (14). Each is one readable JSON file holding everything: accounts (with
password hashes, so keep the files private), tasks and lists, and the keys that sign login cookies.

The `punchlist` command in the container does the rest, while the server runs:

```bash
docker exec <container> punchlist export /data/backup.json
docker exec <container> punchlist import /data/backup.json            # into an empty database
docker exec <container> punchlist import /data/backup.json --replace  # delete what is there first
docker exec <container> punchlist snapshot
docker exec <container> punchlist admin reset-password [username]
docker exec <container> punchlist admin add-user <username> [--admin]   # prints a password to change at first login
docker exec <container> punchlist admin set-role <username> <user|admin|superadmin>
docker exec <container> punchlist migrate-db --to postgres --connection "Host=db;Username=...;Password=...;Database=punchlist"
```

`migrate-db` copies everything into another empty database (SQLite or PostgreSQL); then point
`DB_PROVIDER` and `DB_PATH` or `DB_CONNECTION_STRING` at it and restart. A restored backup keeps
sessions and every device's sync position, so nobody has to sign in or resync.

On Windows Git Bash, prefix commands with `MSYS_NO_PATHCONV=1` so `/data/...` paths reach the
container unchanged.

## PostgreSQL

[compose.postgres.yaml](compose.postgres.yaml) runs Punchlist with PostgreSQL, passing the
connection string as a secret file. Writers take a transaction-scoped advisory lock, so a shared
PostgreSQL server needs nothing special.
