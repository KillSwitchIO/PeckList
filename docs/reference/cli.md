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

In the server program, `pecklist help` prints the maintenance summary below, then the client
commands' help; this page has the detail. Checks in CI keep this page listing every command.

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
job as well as on the server. Every command and option is in the
[client command reference](#client-command-reference) below, made from the same table as the
CLI's own help.

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

On Linux it needs OpenSSL (`libssl3`) for `https://` servers. Nearly every system has it, but a
minimal container image may not: there, install it first (`apt-get install libssl3` on Debian).

On Windows, unzip it and put `pecklist.exe` in a folder on your `PATH`. The server program takes
the same client commands, so on the server itself you can use the one you have.

### Help

`pecklist` on its own lists the commands. `pecklist help`, `pecklist -h` and `pecklist --help`
print everything. Each command and group has its own help, by any of these:

```bash
pecklist tasks              # a group on its own shows its commands
pecklist tasks -h
pecklist help tasks add
pecklist tasks add --help
```

`-h` or `--help` anywhere on a line shows help and runs nothing, so
`pecklist tasks delete 01HX... --help` deletes nothing. A command missing an argument prints its
usage line, and a mistyped command suggests the nearest one (`did you mean tasks?`) without running
anything. Help goes to standard output with exit code `0`; mistakes go to standard error with exit
code `2`.

### Short options and aliases

Common options have a letter, and a letter means the same thing in every command: `-l` list,
`-s` section, `-t` tag, `-a` all, `-d` due, `-p` priority, `-T` title, `-n` notes, `-j` JSON,
`-q` quiet, `-h` help, and `-v` version (on its own). Letters group (`-aj`), and a value can follow
with or without a space (`-l Yard`, `-lYard`, `--list Yard`, `--list=Yard`). `--` ends the options,
so a task can start with a dash: `pecklist add -- "-5 degrees tonight"`. A `-` as the task reads it
from standard input:

```bash
echo "Buy milk #home" | pecklist tasks add -
id=$(pecklist add -q "Call the plumber friday")
```

`tasks ls` is `tasks list`, `tasks rm` is `tasks delete`, and `pecklist add` is `pecklist tasks add`.

### Signing in

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
keyboard without echo, or from standard input when piped (`pecklist login --token < key.txt`). The
CLI never asks for your password.

The key is kept for your user only: on Linux in `~/.config/pecklist/cli.json` (or under
`XDG_CONFIG_HOME`) with mode `600`, which the CLI checks before reading; on Windows in
`%APPDATA%\PeckList\cli.json`, encrypted for your Windows account.

### Which key a command uses

Every command can also take a key without signing in, which suits scripts and CI. The first of
these that is set wins:

1. `--api-key KEY` on the command;
2. `PECKLIST_TOKEN` in the environment;
3. the saved sign-in, for the server it was made on.

**Prefer `PECKLIST_TOKEN` or `login --token`.** A key given as `--api-key KEY` shows in the process
list (`ps`) to other users of the machine, and stays in your shell history. `--api-key` keeps
working, for scripts that already use it. Given to any command but `login`, a key from the flag or
the environment is used for that command only and never saved.

A saved key is only ever sent to the server it was made on. A key from `--api-key` or
`PECKLIST_TOKEN` is not tied to a server: it goes to whichever server the command names
(`--server`, `PECKLIST_SERVER` or the saved one), so check that before running a command with
someone else's address. The CLI refuses `http://` to anything
but this machine unless you add `--insecure-http`, since the key would cross the network as it is.

A key that may only read (`tasks:read`) is refused when a command changes something, and the CLI
says the key lacks `tasks:write`: make a key with that permission, or sign in again.

### Shell completion

`pecklist completion bash`, `zsh`, `fish` and `powershell` print a completion script. Install it
once:

```bash
# bash (with the bash-completion package)
pecklist completion bash > ~/.local/share/bash-completion/completions/pecklist
# zsh: a file named _pecklist in a folder on $fpath, then start a new shell
pecklist completion zsh > "${fpath[1]}/_pecklist"
# fish
pecklist completion fish > ~/.config/fish/completions/pecklist.fish
```

In PowerShell, add `pecklist completion powershell | Out-String | Invoke-Expression` to your
`$PROFILE`.

Tab then completes commands, options and their fixed values (`--status`, `--priority`). After
`-l`, `-s` and `-t` it offers the names of your lists, sections (of the list named earlier on the
line) and tags, asked of the server with your saved sign-in (or `--profile`). That asking never
prompts and never prints an error, and gives up after about a second: signed out, offline or slow,
you get the commands and options only. The names are kept for a minute in
`~/.cache/pecklist` (or under `XDG_CACHE_HOME`; `%LOCALAPPDATA%\PeckList\cache` on Windows), in a
file only you can read (mode `600`); names asked for with a key from `PECKLIST_TOKEN` or
`--api-key` are not kept. Task ids are never completed.

Since Tab runs before you decide to run a line, a key in `PECKLIST_TOKEN` is only sent to
`PECKLIST_SERVER` or your saved server at Tab, never to a `--server` typed (or pasted) on the line.

### Remote admin commands

With `--server` or `--profile` (and always in the client download), `admin add-user`,
`admin set-role`, `admin login-link`, `admin reset-password`, the `oidc` commands, `snapshot`,
`export` and `config show` run on that server through its admin API, rather than on the database
here. The key needs the admin permission (`pecklist login --admin`), and the account's role
decides the rest, as on the admin pages. Each one is in
the event log under the account, with the key that made it. `config key`, `config encrypt`,
`import`, `migrate-db` and `upgrade-db` only run on the server.

A remote `export` is made with a key, so it leaves out the server's session and one-time secrets
and the passwords saved on the settings page: restoring it signs everyone out, and those passwords
are entered again on the settings page. See [backups](../guides/backups.md).

### Profiles, output and exit codes

`--profile NAME` (or `PECKLIST_PROFILE`) keeps several servers or accounts side by side:
`pecklist login --profile work --server https://work.example.com`, then
`pecklist tasks list --profile work`.

`-j` or `--json` prints the API's own JSON, for scripts. Anything that lists things prints an
object with an `items` array, as the API does (`tasks list` gathers every page into it); a command
about one thing prints that thing. `tasks list --json` printed a bare array in 0.10.0, and now
prints `items` like the rest.

Exit codes: `0` done, `1` the command failed, `2` bad usage, `3` not signed in (or the key no longer
works), `4` the account or key is not allowed to do that.

## Client command reference

Made from the CLI's own command table, the one `pecklist help <command>` prints from, so the two
always agree. Every command also takes `-h`, `--help` (show its help and run nothing), `--server URL`,
`--profile NAME`, `--api-key KEY` and `--insecure-http`: see
[which key a command uses](#which-key-a-command-uses). `pecklist -v` or `pecklist --version` prints the
version. Exit codes: 0 done, 1 failed, 2 bad usage, 3 not signed in, 4 not allowed.

### `login`

Sign in: approve a code in the browser, or save an API key. Never a password.

```text
pecklist login [--admin] [--token]
```

Without --token it prints a code and the address of your server's sign-in page, and opens it where it can. Approve the code there and the CLI saves a key named for this machine. Only enter a code you just asked for here.

| Option | What it does |
| --- | --- |
| `--admin` | Ask for the admin permission too (owners and admins). |
| `--token` | Save an API key, read from the keyboard, or from standard input when piped. |

```bash
pecklist login --server https://tasks.example.com
pecklist login --server https://tasks.example.com --admin
pecklist login --server https://tasks.example.com --token < key.txt
```

### `logout`

Revoke this CLI's key on the server and forget it here.

```text
pecklist logout
```

The key in use is revoked, so a key from --api-key or PECKLIST_TOKEN is revoked too. If PECKLIST_TOKEN is set, unset it as well.

```bash
pecklist logout
pecklist logout --profile work
```

### `whoami`

The server, the account, its role and the key's permissions.

```text
pecklist whoami [-j]
```

| Option | What it does |
| --- | --- |
| `-j`, `--json` | Print the API's JSON: one thing as an object, a list of things as `{"items": [...]}`. |

```bash
pecklist whoami
pecklist whoami -j
```

### `tasks`

List, add, change and close tasks.

```text
pecklist tasks <command> [options]
```

| Command | What it does |
| --- | --- |
| [`tasks list`](#tasks-list) (`tasks ls`) | List the open tasks you can see, filtered by list, section, tag, status and due dates. |
| [`tasks add`](#tasks-add) (`add`) | Add a task, reading dates, #tags, ^list, !priority, @person and "every ..." as the app's quick add does. |
| [`tasks show`](#tasks-show) | Show one task. |
| [`tasks edit`](#tasks-edit) | Change a task: only what you name changes. |
| [`tasks done`](#tasks-done) | Close a task. A repeating one moves on to its next date, as in the app. |
| [`tasks reopen`](#tasks-reopen) | Open a closed task again. |
| [`tasks delete`](#tasks-delete) (`tasks rm`) | Move a task to the trash. tasks restore brings it back. |
| [`tasks restore`](#tasks-restore) | Bring a task back from the trash. |

```bash
pecklist tasks list -l Home
pecklist tasks add "Pay rent on the 1st every month ^Home !high"
pecklist tasks done 01HX...
```

### `tasks list`

List the open tasks you can see, filtered by list, section, tag, status and due dates.

```text
pecklist tasks list [options]
pecklist tasks ls [options]
```

| Option | What it does |
| --- | --- |
| `-l`, `--list L` | The list: an id or a name (exact, then a unique start, as ^list matches). |
| `-s`, `--section S` | The section: an id or a name. |
| `-t`, `--tag TAG` | Only tasks with this tag. |
| `--status STATUS` | Only tasks with this status: open (the default), done, wontdo or all. -a is --status all. |
| `--due-before DATE` | Only tasks due before this date. |
| `--due-after DATE` | Only tasks due after this date. |
| `-a`, `--all` | Every status, not only open tasks: the same as --status all. |
| `--deleted` | The trash instead. |
| `-j`, `--json` | Print the API's JSON: one thing as an object, a list of things as `{"items": [...]}`. |

```bash
pecklist tasks list -l Home -t errands
pecklist tasks ls -a --due-before 2026-11-30
pecklist tasks list --deleted -j
```

### `tasks add`

Add a task, reading dates, #tags, ^list, !priority, @person and "every ..." as the app's quick add does.

```text
pecklist tasks add TEXT... [options]
pecklist add TEXT... [options]
```

A single - as TEXT reads the task from standard input (one line). Put -- before a task that starts with a dash.

| Option | What it does |
| --- | --- |
| `-l`, `--list L` | The list to add it to (without one, your inbox). |
| `--plain` | Take the text as the title as it is, without reading dates or tags. |
| `-q`, `--quiet` | Print only the new task's id. |
| `-j`, `--json` | Print the API's JSON: one thing as an object, a list of things as `{"items": [...]}`. |

```bash
pecklist tasks add "Water the plants tomorrow #home" -l Yard
id=$(pecklist add -q "Call the plumber friday !high")
echo "Buy milk #home" | pecklist tasks add -
```

### `tasks show`

Show one task.

```text
pecklist tasks show ID [-j]
```

| Option | What it does |
| --- | --- |
| `-j`, `--json` | Print the API's JSON: one thing as an object, a list of things as `{"items": [...]}`. |

```bash
pecklist tasks show 01HX...
pecklist tasks show 01HX... -j
```

### `tasks edit`

Change a task: only what you name changes.

```text
pecklist tasks edit ID [options]
```

| Option | What it does |
| --- | --- |
| `-T`, `--title TEXT` | The new title. |
| `-n`, `--notes TEXT` | The new notes. |
| `-l`, `--list L` | Move it to this list. |
| `-s`, `--section S` | Move it to this section, or none. |
| `-p`, `--priority LEVEL` | The priority: none, low, medium or high. |
| `-d`, `--due DATE\|none` | The due date (2026-11-30 or 2026-11-30T09:00), or none. |
| `--start DATE\|none` | The start date, or none. |
| `-t`, `--tag TAG` | Add (+name) and remove (-name) tags, comma separated. |
| `--repeat RRULE\|none` | How it repeats (an RRULE such as FREQ=WEEKLY), or none. |
| `--progress 0-100` | Progress in percent. |
| `-j`, `--json` | Print the API's JSON: one thing as an object, a list of things as `{"items": [...]}`. |

```bash
pecklist tasks edit 01HX... -T "Water the roses" -d 2026-12-01
pecklist tasks edit 01HX... --due none -t +errands,-later
pecklist tasks edit 01HX... -p high -l Home -s Garden
```

### `tasks done`

Close a task. A repeating one moves on to its next date, as in the app.

```text
pecklist tasks done ID [--wontdo] [-j]
```

| Option | What it does |
| --- | --- |
| `--wontdo` | Close it as won't do. |
| `-j`, `--json` | Print the API's JSON: one thing as an object, a list of things as `{"items": [...]}`. |

```bash
pecklist tasks done 01HX...
pecklist tasks done 01HX... --wontdo
```

### `tasks reopen`

Open a closed task again.

```text
pecklist tasks reopen ID [-j]
```

| Option | What it does |
| --- | --- |
| `-j`, `--json` | Print the API's JSON: one thing as an object, a list of things as `{"items": [...]}`. |

```bash
pecklist tasks reopen 01HX...
```

### `tasks delete`

Move a task to the trash. tasks restore brings it back.

```text
pecklist tasks delete ID
pecklist tasks rm ID
```

```bash
pecklist tasks delete 01HX...
pecklist tasks rm 01HX...
```

### `tasks restore`

Bring a task back from the trash.

```text
pecklist tasks restore ID [-j]
```

| Option | What it does |
| --- | --- |
| `-j`, `--json` | Print the API's JSON: one thing as an object, a list of things as `{"items": [...]}`. |

```bash
pecklist tasks restore 01HX...
```

### `lists`

Your lists.

```text
pecklist lists <command> [options]
```

| Command | What it does |
| --- | --- |
| [`lists list`](#lists-list) | Show your lists. |
| [`lists add`](#lists-add) | Make a list. |
| [`lists rename`](#lists-rename) | Rename a list. |

```bash
pecklist lists list
pecklist lists add Garden --color "#3a7d44"
```

### `lists list`

Show your lists.

```text
pecklist lists list [-a] [-j]
```

| Option | What it does |
| --- | --- |
| `-a`, `--all` | Archived lists too. |
| `-j`, `--json` | Print the API's JSON: one thing as an object, a list of things as `{"items": [...]}`. |

```bash
pecklist lists list
pecklist lists list -a -j
```

### `lists add`

Make a list.

```text
pecklist lists add NAME [--color #RRGGBB] [-j]
```

| Option | What it does |
| --- | --- |
| `--color #RRGGBB` | The list's colour. |
| `-j`, `--json` | Print the API's JSON: one thing as an object, a list of things as `{"items": [...]}`. |

```bash
pecklist lists add Garden
pecklist lists add Garden --color "#3a7d44"
```

### `lists rename`

Rename a list.

```text
pecklist lists rename L NAME [--color #RRGGBB] [-j]
```

| Option | What it does |
| --- | --- |
| `--color #RRGGBB` | The list's colour. |
| `-j`, `--json` | Print the API's JSON: one thing as an object, a list of things as `{"items": [...]}`. |

```bash
pecklist lists rename Garden "Veg garden"
```

### `sections`

The sections in a list.

```text
pecklist sections <command> [options]
```

| Command | What it does |
| --- | --- |
| [`sections list`](#sections-list) | Show the sections, in one list or in all of them. |
| [`sections add`](#sections-add) | Make a section in a list. |
| [`sections rename`](#sections-rename) | Rename a section. |

```bash
pecklist sections list Garden
pecklist sections add Garden Beds
```

### `sections list`

Show the sections, in one list or in all of them.

```text
pecklist sections list [L] [-j]
```

| Option | What it does |
| --- | --- |
| `-j`, `--json` | Print the API's JSON: one thing as an object, a list of things as `{"items": [...]}`. |

```bash
pecklist sections list
pecklist sections list Garden -j
```

### `sections add`

Make a section in a list.

```text
pecklist sections add L NAME [-j]
```

| Option | What it does |
| --- | --- |
| `-j`, `--json` | Print the API's JSON: one thing as an object, a list of things as `{"items": [...]}`. |

```bash
pecklist sections add Garden Beds
```

### `sections rename`

Rename a section.

```text
pecklist sections rename ID NAME [-j]
```

| Option | What it does |
| --- | --- |
| `-j`, `--json` | Print the API's JSON: one thing as an object, a list of things as `{"items": [...]}`. |

```bash
pecklist sections rename 01HX... "Raised beds"
```

### `tags`

Your tags.

```text
pecklist tags <command> [options]
```

| Command | What it does |
| --- | --- |
| [`tags list`](#tags-list) | Show your tags. Tags named in tasks add or tasks edit are made when needed. |

```bash
pecklist tags list
```

### `tags list`

Show your tags. Tags named in tasks add or tasks edit are made when needed.

```text
pecklist tags list [-j]
```

| Option | What it does |
| --- | --- |
| `-j`, `--json` | Print the API's JSON: one thing as an object, a list of things as `{"items": [...]}`. |

```bash
pecklist tags list
pecklist tags list -j
```

### `people`

Who tasks can be assigned to.

```text
pecklist people <command> [options]
```

| Command | What it does |
| --- | --- |
| [`people list`](#people-list) | Show the people and groups a task can be assigned to, with the id to use. |

```bash
pecklist people list
```

### `people list`

Show the people and groups a task can be assigned to, with the id to use.

```text
pecklist people list [-j]
```

The list has you, your groups and the people you share with. An id is user:... or group:..., as a task's assignees use.

| Option | What it does |
| --- | --- |
| `-j`, `--json` | Print the API's JSON: one thing as an object, a list of things as `{"items": [...]}`. |

```bash
pecklist people list
pecklist people list -j
```

### `completion`

Print the shell completion script for bash, zsh, fish or powershell.

```text
pecklist completion SHELL
```

Tab then completes commands and options, and the names of your lists, sections and tags after -l, -s and -t (asked of the server, for at most a second, and kept for a minute in a file only you can read).

`SHELL` is one of: `bash`, `zsh`, `fish`, `powershell`.

```bash
pecklist completion bash > ~/.local/share/bash-completion/completions/pecklist
pecklist completion zsh > ~/.zfunc/_pecklist
pecklist completion fish > ~/.config/fish/completions/pecklist.fish
```

### `help`

Show help for a command.

```text
pecklist help [COMMAND]...
```

```bash
pecklist help
pecklist help tasks add
```

### Remote admin command options

These run through the admin API (see [remote admin commands](#remote-admin-commands)); each
links to its description with the server's commands.

| Command | Usage | Options |
| --- | --- | --- |
| [`admin add-user`](#admin-add-user) | `pecklist admin add-user USER [--admin]` | `--admin`: Make it an admin |
| [`admin set-role`](#admin-set-role) | `pecklist admin set-role USER ROLE` |  |
| [`admin login-link`](#admin-login-link) | `pecklist admin login-link USER` |  |
| [`admin reset-password`](#admin-reset-password) | `pecklist admin reset-password [USER]` |  |
| [`oidc unlink`](#oidc-unlink) | `pecklist oidc unlink USER [PROVIDER]` |  |
| [`oidc unbind-all`](#oidc-unbind-all) | `pecklist oidc unbind-all PROVIDER` |  |
| [`oidc migration-window`](#oidc-migration-window) | `pecklist oidc migration-window PROVIDER HOURS\|close` |  |
| [`snapshot`](#snapshot) | `pecklist snapshot` |  |
| [`export`](#export) | `pecklist export [FILE] [--user USER]` | `--user USER`: Only this account's data |
| [`config show`](#config-show) | `pecklist config show [-j]` | `--json`: Print the API's JSON: one thing as an object, a list of things as `{"items": [...]}` |
