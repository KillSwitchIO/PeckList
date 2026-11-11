# Command line

`pecklist` has two sides. The [client commands](#client-commands) (`login`, `tasks`, `lists` and
the rest) work from any machine through the server's [task API](task-api.md), signed in as you;
they come in the server program and in a small download of their own. The rest of this page is the
maintenance side, which runs where the server runs.

The server program is also the maintenance tool. Every command reads the same settings as the
server (environment, `CONFIG_FILE`), and works while the server runs. Commands that change an
account or sign-in (`admin add-user`, `set-role`, `login-link`, `reset-password`, and the `oidc`
ones) leave an entry in the [event log](../guides/logging.md#access-and-event-log), by `shell`, as
the admin pages do.

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
--8<-- "docs/reference/cli-usage.txt"
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
the server afterwards. The file may be plain JSON or a snapshot as written (`.json.gz`).

`--shift-dates` moves every date in the file's tasks, lists and comments on by the days between
the file's `exportedAt` and today, so a seed made once reads as if made today. The
[demo server](../install/demo.md) loads its seed this way every night.

### `snapshot`

Takes a snapshot now, into `SNAPSHOT_DIR`, and prunes old ones to `SNAPSHOT_KEEP` and
`SNAPSHOT_KEEP_WEEKLY`.

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
sessions. An account that is deleted but still in its grace period is refused and left as it is,
since it cannot sign in: restore it under **Admin > Users** first, or name another account.

Once a deleted `admin` is removed at the end of its grace period, it is not made again while another
super admin is active, so this command with no name answers `no user 'admin'`. Name another account,
or use `admin add-user rescue` and then `admin set-role rescue superadmin`, or
`admin login-link <username>`. All of these need a shell on the server: without one, an operator
locked out of the remaining super admin cannot recover by restarting. During the grace period the
command still prints a password, but it cannot sign in until the account is restored from
**Admin > Users**.

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

## Client commands

These talk to a server over HTTPS, as the signed-in account, and can do what that account can do
in the app. They need no settings file or database, so they run from a laptop, a script or a CI
job as well as on the server.

### Getting the client

Each release has `pecklist-cli-linux-x64.tar.gz`, `pecklist-cli-linux-arm64.tar.gz` and
`pecklist-cli-win-x64.zip` beside the server downloads, listed in the same `SHA256SUMS`. Each holds
one self-contained `pecklist` file (no .NET install needed), a README and the licence. It carries
no server: maintenance commands such as `import` or `migrate-db` say so and stop.

```bash
sha256sum --check --ignore-missing SHA256SUMS
tar -xzf pecklist-cli-linux-x64-*.tar.gz
sudo install pecklist-cli-linux-x64/pecklist /usr/local/bin/pecklist
```

On Windows, unzip it and put `pecklist.exe` in a folder on your `PATH`. The server program takes
the same client commands, so on the server itself you can use the one you have.

### `login`

```bash
pecklist login --server https://tasks.example.com
pecklist login --server https://tasks.example.com --admin
pecklist login --server https://tasks.example.com --token
```

With no `--token`, it prints a code and the address of the server's sign-in page (`/cli`), and
opens it in your browser where it can. Sign in there as usual, check the code matches and approve.
That makes an [API key](task-api.md#signing-in) named for this machine, with the tasks permissions; with
`--admin` the page offers the admin permission as well, for owners and admins, and you tick it to
give it. The key is saved here and the CLI is signed in. The code lasts 10 minutes.

:::warning
Only enter a code you just asked for in your own terminal, and only on your own server's page.
Someone who sends you a code and asks you to approve it is asking for a key to your account.
:::

With `--token` it saves an API key you made under Settings > Account > API keys, read from the
keyboard without echo, or from standard input when piped. `--api-key KEY` saves the key given on
the command line. The CLI never asks for your password.

The key is kept for your user only: on Linux in `~/.config/pecklist/cli.json` (or under
`XDG_CONFIG_HOME`) with mode `600`, which the CLI checks before reading; on Windows in
`%APPDATA%\PeckList\cli.json`, encrypted for your Windows account.

#### Which key a command uses

Every command can also take a key without signing in, which suits scripts and CI. The first of
these that is set wins:

1. `--api-key KEY` on the command;
2. `PECKLIST_TOKEN` in the environment;
3. the saved sign-in, for the server it was made on.

A key given by flag or environment is never saved. A flag can end up in your shell history and is
visible to other users of the machine in its process list, so on a shared machine prefer
`PECKLIST_TOKEN` or a saved sign-in.

A saved key is only ever sent to the server it was made on. A key from `--api-key` or
`PECKLIST_TOKEN` is not tied to a server: it goes to whichever server the command names
(`--server`, `PECKLIST_SERVER` or the saved one), so check that before running a command with
someone else's address. The CLI refuses `http://` to anything
but this machine unless you add `--insecure-http`, since the key would cross the network as it is.

### `logout`

Revokes the key in use on the server (picked as above, so a key from `--api-key` or
`PECKLIST_TOKEN` is revoked too) and forgets the saved one here. If you set `PECKLIST_TOKEN`,
unset it as well.

### `whoami`

The server, the account and its role, and the key's permissions.

### `tasks`

```bash
pecklist tasks list --list Home --due-before 2026-11-30
pecklist tasks add "Pay rent on the 1st every month ^Home !high #bills"
pecklist tasks add "Read: 'every day' as a phrase" --plain
pecklist tasks edit 01HX... --due none --tag +errands,-later
pecklist tasks done 01HX...
pecklist tasks delete 01HX...
```

`tasks list` shows the open tasks you can see, filtered by list, section, tag, status and due
dates; `--all` is every status, and `--deleted` lists the trash. `tasks add` reads the text the way the
app's quick add does (dates, `#tags`, `^list`, `!priority`, `@person`, `every ...`), and `--plain`
takes it as the title as it is. `tasks done` on a repeating task moves it to its next date, as in
the app; `--wontdo` closes it as won't do. `delete` moves a task to the trash and `restore` brings
it back.

### `lists`

`lists list` shows your lists (`--all` adds archived ones), `lists add NAME [--color #RRGGBB]`
makes one and `lists rename L NAME` renames one.

### `sections`

`sections list L`, `sections add L NAME` and `sections rename ID NAME`, for the sections in a list.

### `tags`

`tags list` shows your tags. Tags you name in `tasks add` or `tasks edit` that do not exist yet are
made for you.

### Remote admin commands

With `--server` or `--profile` (and always in the client download), `admin add-user`,
`admin set-role`, `admin login-link`, `admin reset-password`, the `oidc` commands, `snapshot`,
`export` and `config show` run on that server through its admin API, rather than on the database
here. The key needs the admin permission (`pecklist login --admin`), and the account's role
decides the rest, as on the admin pages. Each one is in
the event log under the account, with the key that made it. `config key`, `config encrypt`,
`import`, `migrate-db` and `upgrade-db` only run on the server.

### Profiles, output and exit codes

`--profile NAME` (or `PECKLIST_PROFILE`) keeps several servers or accounts side by side:
`pecklist login --profile work --server https://work.example.com`, then
`pecklist tasks list --profile work`. `--json` prints the API's own JSON, for scripts.

Exit codes: `0` done, `1` the command failed, `2` bad usage, `3` not signed in (or the key no longer
works), `4` the account or key is not allowed to do that.
