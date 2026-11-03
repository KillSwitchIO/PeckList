# Command line

The server program is also the maintenance tool. Every command reads the same settings as the
server (environment, `CONFIG_FILE`), and works while the server runs.

<Tabs>
<TabItem value="docker" label="Docker">

```bash
docker exec pecklist pecklist <command>
docker exec -it pecklist pecklist <command>     # for commands that read input
```

</TabItem>
<TabItem value="linux" label="Linux">

```bash
sudo -u pecklist env DB_PATH=/var/lib/pecklist/pecklist.db CONFIG_FILE=/etc/pecklist/pecklist.conf \
  /opt/pecklist/pecklist <command>
```

Or the wrapper from [Linux](../install/linux.md#day-to-day).

</TabItem>
<TabItem value="windows" label="Windows">

```powershell
$env:DB_PATH = 'C:\ProgramData\PeckList\pecklist.db'
$env:CONFIG_FILE = 'C:\ProgramData\PeckList\pecklist.conf'
& 'C:\Program Files\PeckList\pecklist.exe' <command>
```

</TabItem>
</Tabs>

Run with no command (or one the program does not know as a command), it starts the server. Exit
codes: `0` done, `1` the command failed (the reason is printed), `2` invalid settings.

`pecklist help` prints the summary below; this page has the detail. A check in CI keeps this page
listing every command.

```text
Usage: pecklist <command>

  export [file]                 Write a full backup as JSON (to stdout without a file).
  export --user <user> [file]   Write one person's data (to stdout without a file).
  import <file> [--replace] [--shift-dates]
                                Load a backup into an empty database (--replace: delete what is
                                there first; --shift-dates: move its dates on by the days since
                                it was made, for a demo seed).
  import --user <file> [user]   Put one person back as a backup had them (from a whole-server
                                backup, say who). Restart the server afterwards.
  migrate-db --to sqlite --path <file>
  migrate-db --to postgres --connection <connection string>
                                Copy everything into another, empty database.
  upgrade-db                    Apply database schema upgrades and exit (for servers
                                running with DB_MIGRATE_ON_START=false).
  snapshot                      Take a snapshot now (into SNAPSHOT_DIR).
  admin reset-password [user]   Give an account (default: admin) a new password to change at login.
  admin add-user <user> [--admin]
                                Add an account; its generated password must be changed at first login.
  admin set-role <user> <role>  Make an account a user, admin or superadmin.
  admin login-link <user>       Print a one-time sign-in link (24 hours).
  oidc unlink <user> [provider] Detach a user's provider accounts (all, or one provider's).
  oidc unbind-all <provider>    Detach every account from a provider (moving to another).
  oidc migration-window <provider> <hours|close>
                                Until it closes, a first sign-in through the provider joins
                                the account with the same username.
  config key                    Print a new CONFIG_KEY for encrypted values.
  config encrypt [value]        Print the value (or standard input) encrypted with CONFIG_KEY,
                                for the environment or CONFIG_FILE: enc:v1:...
  config show                   Every setting with where it comes from (secrets hidden).
  debug-dump [file]             Write a zip for bug reports: recent logs, settings (secrets
                                hidden), versions and database counts (stdout without a file).
  healthcheck                   Exit 0 when the running server answers /healthz.
  --version                     Print the version and build.

Settings come from the same environment variables as the server.
```

## Backups

### `export`

```bash
pecklist export [file]
pecklist export --user <username> [file]
```

Writes a full backup (every account and all data) as JSON, to the file or to standard output. With
`--user`, only that person's data. See [backups](../guides/backups.md).

### `import`

```bash
pecklist import <file> [--replace] [--shift-dates]
pecklist import --user <file> [username]
```

Loads a full backup into an **empty** database; `--replace` deletes what is there first. With
`--user`, puts one person back as the file had them; from a whole-server backup, say who. Restart
the server afterwards.

`--shift-dates` moves every date in the file's tasks, lists and comments on by the days between
the file's `exportedAt` and today, so a seed made once reads as if made today. The
[demo server](../install/demo.md) loads its seed this way every night.

### `snapshot`

Takes a snapshot now, into `SNAPSHOT_DIR`, and prunes old ones to `SNAPSHOT_KEEP`.

## Database

### `migrate-db`

```bash
pecklist migrate-db --to sqlite --path <file>
pecklist migrate-db --to postgres --connection "<connection string>"
```

Copies everything into another, empty database. Then point `DB_PROVIDER` (and `DB_PATH` or
`DB_CONNECTION_STRING`) at it and restart. See [database](../configuration/database.md).

### `upgrade-db`

Applies database schema upgrades and exits. For servers running with `DB_MIGRATE_ON_START=false`,
whose own database user may not change the schema: run this with one that may, before starting a
new version.

## Accounts

### `admin reset-password`

```bash
pecklist admin reset-password [username]     # default: admin
```

Prints a new password that must be changed at the next sign-in, and ends the account's other
sessions.

### `admin add-user`

```bash
pecklist admin add-user <username> [--admin]
```

Adds an account (a `user`, or an `admin` with `--admin`) and prints its password, to be changed at
the first sign-in.

### `admin set-role`

```bash
pecklist admin set-role <username> <user|admin|superadmin>
```

Changes a role; it applies from the person's next request. The last super admin cannot be demoted.

### `admin login-link`

```bash
pecklist admin login-link <username>
```

Prints a link that signs the person in once, within 24 hours. For someone with no password and no
working provider. Uses `PUBLIC_URL` for the address.

## Single sign-on

### `oidc unlink`

```bash
pecklist oidc unlink <username> [provider]
```

Detaches a person's provider accounts: all of them, or one provider's.

### `oidc unbind-all`

```bash
pecklist oidc unbind-all <provider>
```

Detaches every account from a provider (when moving to another). Accounts and data stay.

### `oidc migration-window`

```bash
pecklist oidc migration-window <provider> <hours>
pecklist oidc migration-window <provider> close
```

Until it closes, a first sign-in through the provider joins the account with the same username.
See [moving to another provider](../guides/single-sign-on.md#moving-to-another-provider).

## Settings

### `config show`

Every setting, its value (secrets hidden) and where it comes from.

### `config key`

Prints a new `CONFIG_KEY` for [encrypted values](../configuration/index.md#encrypted-values).

### `config encrypt`

```bash
pecklist config encrypt 'the secret'
echo -n 'the secret' | pecklist config encrypt
```

Prints the value encrypted with `CONFIG_KEY` (`enc:v1:...`), for the environment or the settings
file. Reading from standard input keeps the secret out of your shell history.

## Diagnostics

### `debug-dump`

```bash
pecklist debug-dump [file]
```

Writes a zip for bug reports: recent logs, settings (secrets hidden), version, time zone, database
counts and health; to standard output without a file. See
[debug dump](../guides/logging.md#debug-dump).

### `healthcheck`

Exits 0 when the running server answers `/healthz` on `ASPNETCORE_HTTP_PORTS`. The image's own
health check.

### `--version`

Prints the version and the commit it was built from: `pecklist 0.2.0+4f1c2e9...`.
