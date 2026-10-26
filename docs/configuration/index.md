# How settings work

Every setting has a sensible default; a fresh server needs none. When you do set one, it can come
from three places. The first that has it wins:

1. **The environment**: environment variables (Docker `environment:`, `--env-file`, a systemd
   `Environment=`, the Windows service's environment), or `NAME_FILE` pointing at a file.
2. **The settings file** named by `CONFIG_FILE`: `NAME=value` lines. See
   [settings file](config-file.md).
3. **Admin > Settings** in the app: what an admin saves there, stored in the database.

The settings page shows every setting with its value and where it came from. One set in the
environment or the file is greyed out there: it cannot be changed from the page, and it overrides
anything saved there before. Settings that decide who signs in (`OIDC_*`, `LOCAL_LOGIN`,
`REGISTRATION`, `TRUSTED_PROXIES`, `PUBLIC_URL`) are saved by super admins only; admins see them
greyed out, marked _super admins only_.

Some settings are **environment only**, because they are needed before the database opens or they
guard it: `AUTH_MODE`, `ADMIN_PASSWORD`, `DB_*`, `SNAPSHOT_DIR`, `LOG_DIR`, `AUDIT_ARCHIVE_DIR`,
`WEB_ROOT`, `CONFIG_FILE` and `CONFIG_KEY`. The settings file cannot set them either.

The full list is in [all settings](reference.md).

## When a change applies

- These settings saved on the page apply at once: logging (`LOG_*`, including log servers), who
  can join (`REGISTRATION`), local sign-in (`LOCAL_LOGIN`), the backup schedule and how many to
  keep, how long the access and event log is kept (and archiving it), and the grace period for
  deleted accounts. The [reference](reference.md) marks them **live**.
- **Everything else** applies at the next start. The settings page says so and offers
  **Restart now**, which stops the server; Docker's `restart:` policy, systemd's `Restart=` or the
  Windows service's recovery settings bring it back. Started by hand, it stays stopped.
- Changes to the environment or the settings file always need a restart.

## Mistakes

The server checks every setting at start and stops with a list of all the problems at once:

```text
Invalid settings:
  BACKUP_SCHEDULE: 'nightly' is not one of off, hourly, daily, weekly
  OIDC_POCKET_CLIENT_ID is required
```

A value saved on the settings page that stops working (say, after an upgrade) never keeps the
server down: it starts without the page's values and the page says what was wrong.

## Value formats

| Kind    | Examples                     | Notes                                             |
| ------- | ---------------------------- | ------------------------------------------------- |
| Flag    | `true`, `false`              | Also `1`/`0`, `yes`/`no`, `on`/`off`              |
| Number  | `14`                         | Whole numbers; each setting has a minimum         |
| Choice  | `daily`                      | One of the listed words, any case                 |
| List    | `a,b,c`                      | Comma separated; spaces around commas are ignored |
| Map     | `admins=admin,family=Family` | `key=value` pairs, comma separated                |
| Address | `https://tasks.example.com`  | `http` or `https`                                 |

## Secrets in files

Add `_FILE` to any setting's name to read its value from a file. This is how Docker and Compose
secrets work:

```yaml
environment:
  OIDC_POCKET_CLIENT_SECRET_FILE: /run/secrets/oidc_secret
```

One trailing newline in the file is ignored. Setting both `NAME` and `NAME_FILE` is an error.

## Encrypted values

So that a compose file, an env file or the settings file holds nothing readable, values can be
encrypted with a key only the server has:

```bash
docker exec punchlist punchlist config key                 # prints a new key; keep it secret
docker exec -e CONFIG_KEY=<key> punchlist punchlist config encrypt 'the secret'
# prints enc:v1:...
```

Give the server the key (`CONFIG_KEY`, or better `CONFIG_KEY_FILE=/run/secrets/punchlist_key`) and
use the `enc:v1:...` text wherever the value would go:

```text
OIDC_POCKET_CLIENT_SECRET=enc:v1:Q2h...
```

Secrets saved on the settings page are encrypted in the database and never shown again after
saving.

## Seeing what is in effect

```bash
docker exec punchlist punchlist config show
```

lists every setting, its value (secrets hidden) and where it comes from. The admin settings page
shows the same.
