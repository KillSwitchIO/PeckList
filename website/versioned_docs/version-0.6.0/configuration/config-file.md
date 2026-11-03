# Settings file

Keep settings in one file instead of many environment variables. Point the server at it with
`CONFIG_FILE`:

<Tabs>
<TabItem value="docker-compose" label="Docker Compose">

```yaml
services:
  pecklist:
    environment:
      CONFIG_FILE: /config/pecklist.conf
    volumes:
      - ./pecklist.conf:/config/pecklist.conf:ro
```

</TabItem>
<TabItem value="linux-service" label="Linux service">

The install script already sets `CONFIG_FILE=/etc/pecklist/pecklist.conf`.

</TabItem>
<TabItem value="windows-service" label="Windows service">

The install script already sets `CONFIG_FILE=C:\ProgramData\PeckList\pecklist.conf`.

</TabItem>
</Tabs>

## Format

The Docker env-file format: one `NAME=value` per line.

- No quotes: `PUBLIC_URL=https://tasks.example.com`, not `"https://..."`. Quotes become part of
  the value.
- No `export`, no spaces around `=`.
- Lines starting with `#` and blank lines are ignored.
- [Encrypted values](index.md#encrypted-values) (`enc:v1:...`) work here.

Environment variables override the file, and the file overrides the settings page. The
environment-only settings (`AUTH_MODE`, `ADMIN_PASSWORD`, `DB_*`, `SNAPSHOT_DIR`, `LOG_DIR`,
`AUDIT_ARCHIVE_DIR`, `WEB_ROOT`, `CONFIG_FILE`, `CONFIG_KEY`) cannot be set in it.

Changes apply at the next restart.

## A complete example

Every setting the file can hold, with its default, commented out. Uncomment what you change.

```bash title="pecklist.conf"
# PeckList settings file. Point the server at it with CONFIG_FILE=/path/to/pecklist.conf.
#
# One NAME=value per line, as in a Docker env file: no quotes, no `export`, `#` starts a comment.
# Environment variables win over this file; this file wins over what an admin saves on the
# settings page. Values can be encrypted: `pecklist config encrypt 'secret'` prints enc:v1:...
# (needs CONFIG_KEY). The meaning of every setting: docs/configuration/reference.md
#
# Everything below shows its default, commented out. Uncomment what you change.

# --- General ---------------------------------------------------------------------------------
# The address people open. Needed for single sign-on; also used in links the server makes.
# PUBLIC_URL=https://tasks.example.com
# Days a deleted account can be restored before it and its data are removed for good.
# ACCOUNT_DELETE_GRACE_DAYS=7
# Who can make their own account: open (anyone), invite (with an invite link) or closed.
# REGISTRATION=invite

# --- Sign-in ---------------------------------------------------------------------------------
# enabled or disabled: turn passwords off when everyone uses single sign-on
# (pecklist admin login-link gets an admin back in).
# LOCAL_LOGIN=enabled
# Identity providers, comma separated. Each name gets its own OIDC_<NAME>_* block.
# OIDC_PROVIDERS=pocket
# OIDC_POCKET_AUTHORITY=https://id.example.com
# OIDC_POCKET_CLIENT_ID=pecklist
# OIDC_POCKET_CLIENT_SECRET=enc:v1:...
# OIDC_POCKET_DISPLAY_NAME=Pocket ID
# OIDC_POCKET_SCOPES=openid profile email groups
# OIDC_POCKET_GROUPS_CLAIM=groups
# OIDC_POCKET_USERNAME_CLAIM=preferred_username
# OIDC_POCKET_REQUIRED_GROUPS=pecklist
# OIDC_POCKET_AUTO_CREATE=false
# OIDC_POCKET_LINK_BY_EMAIL=false
# OIDC_POCKET_ROLE_MAP=pecklist-admins=admin
# OIDC_POCKET_GROUP_MAP=family=Family
# OIDC_POCKET_SESSION_HOURS=12
# OIDC_POCKET_SIGN_OUT=false

# --- Backups ---------------------------------------------------------------------------------
# off, hourly, daily or weekly
# BACKUP_SCHEDULE=daily
# SNAPSHOT_KEEP=14

# --- Network ---------------------------------------------------------------------------------
# Proxies allowed to set X-Forwarded-For/-Proto: addresses or CIDR ranges, comma separated.
# Default: loopback and the private ranges.
# TRUSTED_PROXIES=10.0.0.5

# --- Logs ------------------------------------------------------------------------------------
# trace, debug, information, warning, error or critical
# LOG_LEVEL=information
# LOG_LEVEL_OVERRIDES=Microsoft.AspNetCore=Warning
# text or json (console)
# LOG_FORMAT=text
# LOG_FILES=true
# LOG_FILE_MAX_MB=50
# LOG_FILE_KEEP_DAYS=14

# --- Access and event log --------------------------------------------------------------------
# AUDIT_RETENTION_DAYS=90
# ACCESS_LOG_RETENTION_DAYS=14
# AUDIT_ARCHIVE=false

# --- Sending logs to a log server (any of these) ---------------------------------------------
# LOG_OTLP_ENDPOINT=http://alloy:4318
# LOG_OTLP_HEADERS=Authorization=Basic%20...
# LOG_LOKI_URL=http://loki:3100
# LOG_LOKI_USERNAME=
# LOG_LOKI_PASSWORD=
# LOG_LOKI_TENANT=
# LOG_GELF_ADDRESS=udp://graylog:12201
# LOG_ELASTIC_URL=https://elasticsearch:9200
# LOG_ELASTIC_INDEX=logs-pecklist-default
# LOG_ELASTIC_API_KEY=
# LOG_ELASTIC_USERNAME=
# LOG_ELASTIC_PASSWORD=
# LOG_SYSLOG_ADDRESS=udp://rsyslog:514

# Not here: AUTH_MODE, ADMIN_PASSWORD, DB_*, SNAPSHOT_DIR, LOG_DIR, AUDIT_ARCHIVE_DIR, WEB_ROOT,
# CONFIG_FILE and CONFIG_KEY are read from the environment only.
```

The same file ships in every native download (`examples/pecklist.conf`) and is in the repository
at [`examples/config/pecklist.conf`](https://gitlab.com/killswitch10/pecklist/-/blob/main/examples/config/pecklist.conf).
