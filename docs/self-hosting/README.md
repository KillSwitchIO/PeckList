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

## Sign in with OIDC

Any OpenID Connect provider works: Pocket ID, Authelia, Authentik, Keycloak, Zitadel, Entra ID,
Google and others, several at once. List them in `OIDC_PROVIDERS` and give each a block of
`OIDC_<NAME>_*` settings (the name in capitals, dashes as underscores). Register this redirect URI
with the provider:

```text
https://tasks.example.com/auth/oidc/<name>/callback
```

Set `PUBLIC_URL` to that `https://tasks.example.com` so the address never depends on how a
request came in. The sign-in page then shows a "Continue with ..." button per provider.

```yaml
environment:
  PUBLIC_URL: https://tasks.example.com
  OIDC_PROVIDERS: pocket
  OIDC_POCKET_AUTHORITY: https://id.example.com
  OIDC_POCKET_CLIENT_ID: punchlist
  OIDC_POCKET_CLIENT_SECRET_FILE: /run/secrets/pocket_secret
  OIDC_POCKET_DISPLAY_NAME: Pocket ID
  OIDC_POCKET_REQUIRED_GROUPS: punchlist
  OIDC_POCKET_AUTO_CREATE: 'true'
  OIDC_POCKET_ROLE_MAP: punchlist-admins=admin
  OIDC_POCKET_GROUP_MAP: family=Family
```

| Variable (per provider)       | Default                             | Meaning                                                                                                                                                                              |
| ----------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `OIDC_<NAME>_AUTHORITY`       | required                            | The issuer URL (where `/.well-known/openid-configuration` lives)                                                                                                                     |
| `OIDC_<NAME>_CLIENT_ID`       | required                            | The client registered for Punchlist                                                                                                                                                  |
| `OIDC_<NAME>_CLIENT_SECRET`   | none (public client)                | The client secret; PKCE is always used                                                                                                                                               |
| `OIDC_<NAME>_DISPLAY_NAME`    | the name                            | The button label                                                                                                                                                                     |
| `OIDC_<NAME>_SCOPES`          | `openid profile email` (+ `groups`) | `groups` is added when any group setting is used; set this when the provider has no `groups` scope                                                                                   |
| `OIDC_<NAME>_GROUPS_CLAIM`    | `groups`                            | The claim holding group names                                                                                                                                                        |
| `OIDC_<NAME>_USERNAME_CLAIM`  | `preferred_username`                | Where new accounts get their username (else the email's first part)                                                                                                                  |
| `OIDC_<NAME>_REQUIRED_GROUPS` | none (everyone)                     | Comma list; signing in needs at least one of them. Checked at every sign-in                                                                                                          |
| `OIDC_<NAME>_AUTO_CREATE`     | `false`                             | Make an account on a first sign-in. Off: people wait for an admin to approve them                                                                                                    |
| `OIDC_<NAME>_ROLE_MAP`        | none                                | `group=role,...` with roles `user`, `admin`, `superadmin`; the highest match wins at every sign-in, no match means `user`                                                            |
| `OIDC_<NAME>_GROUP_MAP`       | none                                | `group=Server group,...`, or `*` to mirror every provider group as a server group of the same name                                                                                   |
| `OIDC_<NAME>_SESSION_HOURS`   | `12`                                | How long a session from this provider lasts; then the app goes back through the provider by itself, which checks the required groups and mappings again. `0`: 30 days like passwords |
| `LOCAL_LOGIN`                 | `shown`                             | `hidden` hides the password form; `/login?local` still shows it                                                                                                                      |

A new account never takes over an existing one with the same username: it gets a number after
the name instead. A role map never removes the last super admin. People waiting for approval are
listed at `GET /api/admin/pending-signins` (the admin screens come in 0.6), and
`POST /api/admin/pending-signins/<provider>/<subject>/approve` lets one in.

### Linking accounts and moving providers

Anyone can link a provider account to their Punchlist account under **Settings > Sign-in**, and
unlink one as long as another way to sign in remains. A provider account linked to someone else
cannot be linked again.

To move everyone from one provider to another (say `pocket` to `keycloak`) without losing
accounts:

```bash
# 1. Add the new provider to OIDC_PROVIDERS and restart.
# 2. For a day, a first sign-in through keycloak joins the account with the same username.
docker exec <container> punchlist oidc migration-window keycloak 24
# 3. Detach everyone from the old provider (accounts and data stay).
docker exec <container> punchlist oidc unbind-all pocket
# 4. People sign in with the new provider. Then close the window and remove the old provider.
docker exec <container> punchlist oidc migration-window keycloak close
```

A migration window never joins an account that already has a link to that provider, and it
matches usernames only, so make sure both providers hand out the same usernames.

Someone left with no way to sign in (no password, nothing linked) gets a one-time link that
works for 24 hours:

```bash
docker exec <container> punchlist admin login-link kim
docker exec <container> punchlist oidc unlink kim [provider]
```

The same actions are in the admin API: `/api/admin/providers`, `.../unbind-all`,
`.../migration-window`, `/api/admin/users/<id>/identities` and `/api/admin/users/<id>/login-link`.

Provider notes:

- **Pocket ID, Authelia, Authentik**: send `groups` with the `groups` scope; nothing else to set.
- **Keycloak**: has no `groups` scope. Add a "Group Membership" mapper (full path off) to the
  client's dedicated scope and set `OIDC_<NAME>_SCOPES=openid profile email`.
- **Entra ID**: the groups claim holds group ids, not names; map those ids.

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
to fix. OIDC settings are in [Sign in with OIDC](#sign-in-with-oidc).

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
