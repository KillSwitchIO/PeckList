# Telemetry collector

Punchlist servers send one anonymous usage report a day (on by default, easy to turn off; see the
privacy page once it lands). The collector is the service the project runs to take those reports in
and publish the totals. A Punchlist server never runs it, and nobody self-hosting Punchlist needs
it.

The code is `server/src/Punchlist.Collector`; the report it reads is `TelemetryPing` in
`server/src/Punchlist.Core/Telemetry`.

## What it keeps

- **One row per install per day** (UTC): the day's last report from that install, checked against
  `TelemetryPing` and stored as the checked record, so a field it does not know is dropped, not
  kept. No IP address is read or stored.
- **Daily totals**: installs per version, channel, database, OS, architecture, container, users,
  open tasks, local sign-in and OIDC, for every finished day.
- Reports are kept 90 days; the daily totals made from them stay.

## Endpoints

Everything the internet may reach is under `/api/public/`; everything else is under
`/api/private/`. The proxy in front lets `/api/public/*` through and nothing else.


|  | The same totals as a page for people (no scripts, light and dark).  redirects here. |
| Endpoint        | What it does                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/public/v1/ping` | Takes one report (64 KB at most, 600 a minute in all). `202` when kept, `400` with the field at fault when not.                                                     |
| `GET /api/public/v1/stats` | The public totals: installs that reported in the last 7 days, broken down per dimension. A value fewer than 5 installs share is folded into "other", and "other" is left out when it is that small too. Any site may read it. |
| `GET /api/private/healthz` | `ok` when it is up.                                                                                                                                                |

## Running it

```bash
docker run -d -p 8080:8080 -e COLLECTOR_DB="Host=db;Username=collector;Password=...;Database=collector" \
  registry.gitlab.com/killswitch10/punchlist/collector:edge
```

`COLLECTOR_DB` is a PostgreSQL connection string; the tables are made on start. To keep the
password out of the environment, leave it out of the string and set `COLLECTOR_DB_PASSWORD_FILE` to
a file holding it (a Docker secret, say). CI builds the
image when the collector or the report changes (`collector-image`) and pushes `:edge` and
`:sha-<commit>` from `main`. It belongs behind a TLS proxy that does not log client addresses.
