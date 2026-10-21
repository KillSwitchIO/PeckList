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
  `dotnet Punchlist.Server.dll healthcheck`, since there is no curl inside.

## Behind a reverse proxy

The server reads `X-Forwarded-For` and `X-Forwarded-Proto` from trusted proxies only.
`TRUSTED_PROXIES` takes a comma-separated list of addresses or CIDR ranges; by default it trusts
loopback and the private ranges (10/8, 172.16/12, 192.168/16, fc00::/7), which covers a proxy on
the same host or Docker network.

## Settings

| Variable               | Default                      | Meaning                                                   |
| ---------------------- | ---------------------------- | --------------------------------------------------------- |
| `DB_PROVIDER`          | `sqlite`                     | `sqlite` or `postgres` (PostgreSQL 15+)                   |
| `DB_PATH`              | `/data/punchlist.db`         | The SQLite file                                           |
| `DB_CONNECTION_STRING` | -                            | PostgreSQL connection string (Npgsql format)              |
| `DB_MIGRATE_ON_START`  | `true`                       | Set false when the database user cannot change the schema |
| `TRUSTED_PROXIES`      | private ranges               | Proxies allowed to set forwarded headers                  |
| `WEB_ROOT`             | `wwwroot` next to the server | Where the web build is (only for development)             |

Every setting also accepts `NAME_FILE`, a file holding the value (Docker secrets); one trailing
newline is dropped. Setting both is an error. A bad setting stops the server with a list of what
to fix. More settings (auth) arrive with the rest of milestone 0.4.

## PostgreSQL

[compose.postgres.yaml](compose.postgres.yaml) runs Punchlist with PostgreSQL, passing the
connection string as a secret file. Writers take a transaction-scoped advisory lock, so a shared
PostgreSQL server needs nothing special.
