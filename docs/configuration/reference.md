# All settings

Every setting the server reads. **Where** says where it may be set: _any_ means the environment,
the [settings file](config-file.md) or **Admin > Settings**; _env_ means the environment only.
**Live** settings saved on the settings page apply without a restart. Every setting also accepts
`NAME_FILE` (see [secrets in files](index.md#secrets-in-files)).

A check in CI keeps this page in step with the server: a setting missing here fails the build.

## General

### `PUBLIC_URL`

The address people open, such as `https://tasks.example.com`. Single sign-on uses it for the
callback address, and links the server makes (login links, sharing) use it. Without it, the server
uses the address each request came in on. **Default:** none. **Where:** any.

### `ACCOUNT_DELETE_GRACE_DAYS`

Days a deleted account can still be restored. After that, the account and everything it owns are
removed for good. `0` removes at the next hourly check. **Default:** `7`. **Where:** any, live.

### `REGISTRATION`

Who may make their own account with a username and password:

- `open`: anyone who can reach the server, from **Create an account** on the sign-in page.
- `invite`: only people with an invite link an admin made (**Admin > Users > Invite**).
- `closed`: nobody; admins add people. Invite links stop working.

Single sign-on keeps its own switch, [`OIDC_<NAME>_AUTO_CREATE`](#sign-in). An invite link
also lets a new provider account in when that switch is off. With [`LOCAL_LOGIN`](#local_login)
`disabled`, people sign up only through a provider. Admins can always add accounts. **Default:**
`invite`. **Where:** any, live. See [adding people](../guides/users-and-roles.md#adding-people).

### `SIGNUP_RATE_LIMIT`

How many accounts one address may make by signing up in an hour; `0` turns the limit off. Tries
that make no account (a taken name, a short password) do not count, and the ten tries a minute
every sign-in and sign-up route allows still apply on top. Further sign-ups answer
`429 signup_limited` until the hour has passed. Behind a proxy, set
[`TRUSTED_PROXIES`](#trusted_proxies) so the limit counts people, not the proxy. **Default:** `5`.
**Where:** any, live.

### `TZ`

The server's time zone (an IANA name such as `Europe/Berlin`), used for months in stats and for
the server's own "today". It is also the time zone people's apps start out in; each person can
pick their own under **Settings**. **Default:** UTC in the
image, the system's elsewhere. **Where:** env.

## Sign-in

### `AUTH_MODE`

`local`: accounts and sign-in. `none`: no sign-in at all; everyone who reaches the server is the
same single owner. **Default:** `local`. **Where:** env.

### `ADMIN_PASSWORD`

The `admin` account's first password, used only when the account is created at the first start
(12 characters or more). Without it a password is generated and printed once. **Default:**
generated. **Where:** env.

### `LOCAL_LOGIN`

`enabled` or `disabled`. `disabled` turns password sign-in off when everyone uses single
sign-on: the sign-in page has no password form, and the server refuses passwords on every route
(`POST /auth/login`, sign-up and password changes answer `403 local_login_disabled`). Password
sessions already open end at once; provider sessions go on. To get an admin back in, make a
one-time link with [`punchlist admin login-link`](../reference/cli.md#admin-login-link). Needs at
least one provider. `shown` and `hidden`, the names before 0.2.1, still work as `enabled` and
`disabled`. **Default:** `enabled`. **Where:** any, live.

### `OIDC_PROVIDERS`

The identity providers to offer, comma separated: `pocket,keycloak`. Names are letters, digits
and dashes; each gets the settings below with its name in capitals and dashes as underscores
(`pocket-id` becomes `OIDC_POCKET_ID_...`). Needs `AUTH_MODE=local`. **Default:** none.
**Where:** any. Guide: [single sign-on](../guides/single-sign-on.md).

### Per provider: `OIDC_<NAME>_...`

| Setting                       | Default                             | Meaning                                                                                                                             |
| ----------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `OIDC_<NAME>_AUTHORITY`       | required                            | The issuer URL (where `/.well-known/openid-configuration` lives).                                                                   |
| `OIDC_<NAME>_CLIENT_ID`       | required                            | The client id registered for Punchlist.                                                                                             |
| `OIDC_<NAME>_CLIENT_SECRET`   | none                                | The client secret. None: a public client. PKCE is always used.                                                                      |
| `OIDC_<NAME>_DISPLAY_NAME`    | the name                            | The sign-in button's label ("Continue with ...").                                                                                   |
| `OIDC_<NAME>_SCOPES`          | `openid profile email` (+ `groups`) | `groups` is added when a group setting is used. Set this for providers without a `groups` scope.                                    |
| `OIDC_<NAME>_GROUPS_CLAIM`    | `groups`                            | The claim holding group names.                                                                                                      |
| `OIDC_<NAME>_USERNAME_CLAIM`  | `preferred_username`                | Where a new account's username comes from (else the email's first part).                                                            |
| `OIDC_<NAME>_REQUIRED_GROUPS` | none (everyone)                     | Comma list; signing in needs at least one. Checked at every sign-in.                                                                |
| `OIDC_<NAME>_AUTO_CREATE`     | `false`                             | Make an account at a first sign-in. Off: the person waits for an admin's approval.                                                  |
| `OIDC_<NAME>_LINK_BY_EMAIL`   | `false`                             | Join a first sign-in to the one existing account with the same **verified** email.                                                  |
| `OIDC_<NAME>_LINK_BY_USERNAME`| `false`                             | `true`: a first sign-in joins the same-named plain user account with no link to this provider. `all`: admins too.                   |
| `OIDC_<NAME>_USER_MAP`        | none                                | `provideruser=punchlistuser,...`: that provider user always signs into that account, moving an existing link.                       |
| `OIDC_<NAME>_ICON`            | the provider's favicon              | An `https` address or a file: the icon shown on the profile picture of people signed in through it.                                 |
| `OIDC_<NAME>_ROLE_MAP`        | none                                | `group=role,...` with roles `user`, `admin`, `superadmin`. The highest match wins at every sign-in; no match means `user`.          |
| `OIDC_<NAME>_GROUP_MAP`       | none                                | `group=Server group,...`, or `*` to mirror every provider group as a server group.                                                  |
| `OIDC_<NAME>_SIGN_OUT`        | `false`                             | Signing out of Punchlist also ends the provider session. Register `<PUBLIC_URL>/login` as a post-logout redirect URI first.         |
| `OIDC_<NAME>_SESSION_HOURS`   | `12`                                | How long a session from this provider lasts (0 to 720) before the app goes back through the provider. `0`: 30 days, like passwords. |

## Backups

### `BACKUP_SCHEDULE`

How often the server writes a full snapshot: `off`, `hourly`, `daily` or `weekly`. The older name
`SNAPSHOT_SCHEDULE` still works. **Default:** `daily`. **Where:** any, live.

### `SNAPSHOT_KEEP`

How many snapshots to keep; older ones are deleted. At least 1. **Default:** `14`. **Where:** any, live.

### `SNAPSHOT_DIR`

Where snapshots go. **Default:** `snapshots` next to the SQLite file (`/data/snapshots` in the
image). **Where:** env.

## Database

### `DB_PROVIDER`

`sqlite` or `postgres` (PostgreSQL 15 or later). **Default:** `sqlite`. **Where:** env.

### `DB_PATH`

The SQLite file. **Default:** `/data/punchlist.db` in the image, `./data/punchlist.db` elsewhere.
**Where:** env.

### `DB_CONNECTION_STRING`

The PostgreSQL connection string, in [Npgsql's format](https://www.npgsql.org/doc/connection-string-parameters.html):
`Host=db;Username=punchlist;Password=...;Database=punchlist`. Required with `DB_PROVIDER=postgres`.
**Where:** env.

### `DB_MIGRATE_ON_START`

Upgrade the database schema when a newer version starts. Turn off when the database user may not
change the schema, and run the upgrade yourself. **Default:** `true`. **Where:** env.

## Files

### `ATTACHMENT_MAX_MB`

The largest file someone may attach to a task, in megabytes. Bigger uploads are refused and stay
on the device that added them. **Default:** `25`. **Where:** any, live.

### `UPDATE_CHECK`

Look for newer Punchlist releases: twice a day the server reads the latest release from
GitLab (one request, from the server only; people's browsers never call out). When one is newer
than the server or someone's Android app, the menu shows a notice with the release page. Turn it
off to make no such request. **Default:** `true`. **Where:** any, live.

### `ATTACHMENT_DIR`

Where attached files are kept, one file per content hash. Back this folder up with the database.
Files no task uses any more are removed 30 days after the last task let go of them. It is the
folder that grows, so it can sit on other storage than the database: the image keeps it in its own
volume, `/files`. **Default:** `attachments` next to the SQLite file; `/files` in the image.
**Where:** env.

## Telemetry

What the daily usage report holds, and what it never holds: [privacy](../using/privacy.md).

### `TELEMETRY`

Send the anonymous daily usage report: one request a day from the server to the project's
collector, with counts in ranges and switches, never names, titles, addresses or anything people
wrote. Turn it off and nothing is sent. The admin settings page shows the report exactly as it
would go. **Default:** `true`. **Where:** any, live.

### `TELEMETRY_URL`

Where the report goes. **Default:** `https://telemetry.killswitch10.com/api/public/v1/ping` (it moves to the
app's own domain at 1.0). **Where:** any, live.

### `DO_NOT_TRACK`

`1` or `true` turns the report off, like `TELEMETRY=false`, for those who set this
[convention](https://consoledonottrack.com/) across all their tools. **Default:** `false`.
**Where:** environment.

## Demo server

A public trial server that resets every night: see [run a demo server](../install/demo.md).

### `DEMO_MODE`

`true` makes this a demo server. It shows a banner (the nightly reset, that anyone can sign up,
and the [demo accounts](#demo_accounts)) and forces, whatever else is set:
[`REGISTRATION`](#registration) `open`, [`ACCOUNT_DELETE_GRACE_DAYS`](#account_delete_grace_days)
`0`, [`ATTACHMENT_MAX_MB`](#attachment_max_mb) at most `2`, [`TELEMETRY`](#telemetry) and
[`UPDATE_CHECK`](#update_check) off. The server makes no calls out of its own (no usage report,
release check or Web Push; reminders still show on the device). Only the identity providers and
log servers you set up still get calls. Every answer carries `X-Robots-Tag: noindex, nofollow`
and the page a robots meta tag. Needs `AUTH_MODE=local`. **Default:** `false`. **Where:** env.

### `DEMO_ACCOUNTS`

Pre-made accounts the banner shows with their passwords, so visitors can try sharing without
inviting anyone: `demo-sam:try-punchlist-sam,demo-alex:try-punchlist-alex`. Each start makes
them, or puts them back as plain users with these passwords. Wrong guesses lock nobody out, and
nobody can change their password. The names must match the accounts in the seed the nightly
reset loads (the image's seed has `demo-sam`, `demo-alex` and `demo-jordan`); passwords need 12
characters or more. Needs `DEMO_MODE`. **Default:** none. **Where:** env.

### `DEMO_RESET_TIME`

When the nightly reset runs (`HH:mm`, server time), as the banner says it. The reset itself is
the job you schedule (see [run a demo server](../install/demo.md)); keep the two the same.
**Default:** `04:00`. **Where:** env.

## Network

### `TRUSTED_PROXIES`

The proxies allowed to set `X-Forwarded-For` and `X-Forwarded-Proto`: addresses or CIDR ranges,
comma separated. **Default:** loopback and the private ranges (10/8, 172.16/12, 192.168/16,
fc00::/7). **Where:** any. See [reverse proxy](../install/reverse-proxy.md#trusted-proxies).

### `ASPNETCORE_HTTP_PORTS`

The port(s) the server listens on, on all addresses: `8080`, or `8080;9090`. **Default:** `8080`
in the image and in the service examples; `5000` on localhost only when unset elsewhere.
**Where:** env.

### `ASPNETCORE_URLS`

Full listen addresses instead of ports: `http://+:8080`, or `https://+:8443` with a certificate
(`ASPNETCORE_Kestrel__Certificates__Default__Path` and `..._Password`). Overrides
`ASPNETCORE_HTTP_PORTS`. **Where:** env.

## Logs

### `LOG_LEVEL`

The least important entries written: `trace`, `debug`, `information`, `warning`, `error` or
`critical`. **Default:** `information`. **Where:** any, live.

### `LOG_LEVEL_OVERRIDES`

Levels for a category and those under it: `Punchlist.Sync=debug,Microsoft=warning`.
`Microsoft.AspNetCore` and `System.Net.Http.HttpClient` start at `warning`; an override changes
that. **Default:** `Microsoft.AspNetCore=Warning`. **Where:** any, live.

### `LOG_FORMAT`

The console's format: readable `text`, or `json` (one object per line, for log collectors).
**Default:** `text`. **Where:** any, live.

### `LOG_FILES`

Also write JSON lines to files in `LOG_DIR`. **Default:** `true`. **Where:** any, live.

### `LOG_DIR`

Where log files go. **Default:** `logs` next to the SQLite file (`/data/logs`). **Where:** env.

### `LOG_FILE_MAX_MB`

A log file rolls over at midnight UTC or at this size; earlier files are gzipped. **Default:**
`50`. **Where:** any, live.

### `LOG_FILE_KEEP_DAYS`

Archived log files older than this are deleted. **Default:** `14`. **Where:** any, live.

## Log servers

Any number of these at once. Each has its own queue (10,000 entries, retried with growing waits), so
a log server that is down never holds Punchlist up. Guide: [logs and audit](../guides/logging.md).
All are live.

| Setting                | Meaning                                                                          |
| ---------------------- | -------------------------------------------------------------------------------- |
| `LOG_OTLP_ENDPOINT`    | OpenTelemetry collector, OTLP over HTTP (JSON): `http://alloy:4318`              |
| `LOG_OTLP_HEADERS`     | Extra headers: `Authorization=Basic%20...,X-Scope-OrgID=1` (secret)              |
| `LOG_LOKI_URL`         | Grafana Loki: `http://loki:3100`                                                 |
| `LOG_LOKI_USERNAME`    | Loki basic auth user                                                             |
| `LOG_LOKI_PASSWORD`    | Loki basic auth password (secret)                                                |
| `LOG_LOKI_TENANT`      | Loki tenant (`X-Scope-OrgID`)                                                    |
| `LOG_GELF_ADDRESS`     | Graylog GELF input: `udp://graylog:12201`, `tcp://...` or `http://graylog:12201` |
| `LOG_ELASTIC_URL`      | Elasticsearch or OpenSearch: `https://es:9200`                                   |
| `LOG_ELASTIC_INDEX`    | Index or data stream. **Default:** `logs-punchlist-default`                      |
| `LOG_ELASTIC_USERNAME` | Basic auth user                                                                  |
| `LOG_ELASTIC_PASSWORD` | Basic auth password (secret)                                                     |
| `LOG_ELASTIC_API_KEY`  | An API key instead of user and password (secret)                                 |
| `LOG_SYSLOG_ADDRESS`   | Syslog (RFC 5424, facility local0): `udp://rsyslog:514` or `tcp://...`           |

## Access and event log

### `AUDIT_RETENTION_DAYS`

Days the event log keeps entries (sign-ins, admin actions, ...). **Default:** `90`. **Where:** any, live.

### `ACCESS_LOG_RETENTION_DAYS`

Days the request log keeps entries. **Default:** `14`. **Where:** any, live.

### `AUDIT_ARCHIVE`

Before old entries are removed, write them to gzipped JSON lines in `AUDIT_ARCHIVE_DIR`.
**Default:** `false`. **Where:** any, live.

### `AUDIT_ARCHIVE_DIR`

Where those archives go (`audit-<kind>-<time>.jsonl.gz`). **Default:** `audit` next to the SQLite
file. **Where:** env.

## Settings sources

### `CONFIG_FILE`

A [settings file](config-file.md) to read. **Default:** none. **Where:** env.

### `CONFIG_KEY`

The key for `enc:v1:...` [encrypted values](index.md#encrypted-values); make one with
`punchlist config key`. Prefer `CONFIG_KEY_FILE`. **Default:** none. **Where:** env.

## Development

### `WEB_ROOT`

Where the web app's files are. **Default:** `wwwroot` next to the server program. Only for
development, to serve `web/dist` from a checkout. **Where:** env.
