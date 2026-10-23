# Settings file

Keep settings in one file instead of many environment variables. Point the server at it with
`CONFIG_FILE`:

=== "Docker Compose"

    ```yaml
    services:
      punchlist:
        environment:
          CONFIG_FILE: /config/punchlist.conf
        volumes:
          - ./punchlist.conf:/config/punchlist.conf:ro
    ```

=== "Linux service"

    The install script already sets `CONFIG_FILE=/etc/punchlist/punchlist.conf`.

=== "Windows service"

    The install script already sets `CONFIG_FILE=C:\ProgramData\Punchlist\punchlist.conf`.

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

```bash title="punchlist.conf"
--8<-- "examples/config/punchlist.conf"
```

The same file ships in every native download (`examples/punchlist.conf`) and is in the repository
at [`examples/config/punchlist.conf`](https://gitlab.com/killswitch10/punchlist/-/blob/main/examples/config/punchlist.conf).
