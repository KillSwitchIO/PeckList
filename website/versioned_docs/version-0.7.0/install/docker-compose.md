# Docker Compose

The recommended way to run PeckList. All examples are in
[`examples/docker`](https://gitlab.com/killswitch10/pecklist/-/tree/main/examples/docker).

## SQLite (the default)

One container, data in a named volume. Good for a household or a small team: SQLite handles many
people comfortably.

```yaml title="compose.yaml"
# PeckList with SQLite (the default): one container, data in a named volume.
#   docker compose up -d
#   docker compose logs pecklist      # the first admin password is printed here, once
# Then open http://localhost:8080. Docs: docs/install/docker-compose.md

services:
  pecklist:
    image: registry.gitlab.com/killswitch10/pecklist:latest
    container_name: pecklist
    restart: unless-stopped
    ports:
      - '8080:8080'
    volumes:
      - pecklist-data:/data
      # Attached files, apart from the database.
      - pecklist-files:/files
    environment:
      # Months in stats and "today" on the server follow this time zone.
      TZ: Etc/UTC
      # The address people open, once it is behind a reverse proxy with HTTPS.
      # PUBLIC_URL: https://tasks.example.com
      # Choose the first admin password instead of reading it from the logs (12+ characters).
      # ADMIN_PASSWORD_FILE: /run/secrets/admin_password

volumes:
  pecklist-data:
  pecklist-files:
```

```bash
docker compose up -d
docker compose logs pecklist   # the first admin password, printed once
```

Open [http://localhost:8080](http://localhost:8080). Read [first start](../getting-started/first-start.md) for what comes
next.

:::note[Data in a folder instead of a volume]

[`compose.bind-mount.yaml`](https://gitlab.com/killswitch10/pecklist/-/blob/main/examples/docker/compose.bind-mount.yaml)
keeps the data in `./data` and attached files in `./files` (point that one at bigger storage if
you like). Both folders must belong to uid 1654 (`sudo chown 1654:1654 data files`), or run the
container as your own user with `user:`.

:::

## With HTTPS (Caddy)

Caddy gets and renews a certificate by itself. Point a DNS name at the machine, open ports 80 and
443, and put the name in both files.

<Tabs>
<TabItem value="compose-caddy-yaml" label="compose.caddy.yaml">

```yaml
# PeckList behind Caddy with automatic HTTPS (Let's Encrypt).
# Point a DNS name at this machine, open ports 80 and 443, put the name in Caddyfile and below, then:
#   docker compose -f compose.caddy.yaml up -d
# Only Caddy is published; PeckList is reachable on the compose network alone.

services:
  pecklist:
    image: registry.gitlab.com/killswitch10/pecklist:latest
    container_name: pecklist
    restart: unless-stopped
    volumes:
      - pecklist-data:/data
      # Attached files, apart from the database.
      - pecklist-files:/files
    environment:
      TZ: Etc/UTC
      PUBLIC_URL: https://tasks.example.com

  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - '80:80'
      - '443:443'
      - '443:443/udp'
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config

volumes:
  pecklist-data:
  pecklist-files:
  caddy-data:
  caddy-config:
```

</TabItem>
<TabItem value="caddyfile" label="Caddyfile">

```text
# Used by compose.caddy.yaml. Replace the name with yours.
# PeckList sends its own security headers and compressed answers: nothing else is needed here.
tasks.example.com {
	reverse_proxy pecklist:8080
}
```

</TabItem>
</Tabs>

Behind Traefik instead: [`compose.traefik.yaml`](https://gitlab.com/killswitch10/pecklist/-/blob/main/examples/docker/compose.traefik.yaml).
Other proxies: [reverse proxy and HTTPS](reverse-proxy.md).

## PostgreSQL

For people who already run PostgreSQL or want the database on its own server. Make the secrets
first (the commands are at the top of the file).

```yaml title="compose.postgres.yaml"
# PeckList with PostgreSQL 15+ instead of the built-in SQLite.
# Secrets come from files (every setting also works as NAME_FILE). Make them first:
#   mkdir -p secrets
#   openssl rand -hex 24 > secrets/db_password
#   printf 'Host=db;Username=pecklist;Password=%s;Database=pecklist' "$(cat secrets/db_password)" > secrets/db_connection
#   docker compose -f compose.postgres.yaml up -d

services:
  pecklist:
    image: registry.gitlab.com/killswitch10/pecklist:latest
    container_name: pecklist
    restart: unless-stopped
    ports:
      - '8080:8080'
    environment:
      TZ: Etc/UTC
      DB_PROVIDER: postgres
      DB_CONNECTION_STRING_FILE: /run/secrets/db_connection
    secrets:
      - db_connection
    volumes:
      # Snapshots, logs and audit archives still go to /data, attached files to /files.
      - pecklist-data:/data
      # Attached files, apart from the database.
      - pecklist-files:/files
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: pecklist
      POSTGRES_DB: pecklist
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    volumes:
      - db-data:/var/lib/postgresql/data
    secrets:
      - db_password
    healthcheck:
      test: ['CMD', 'pg_isready', '-U', 'pecklist']
      interval: 10s
      retries: 5

secrets:
  db_password:
    file: secrets/db_password
  db_connection:
    file: secrets/db_connection

volumes:
  pecklist-data:
  pecklist-files:
  db-data:
```

More in [database](../configuration/database.md), including moving an existing SQLite server to
PostgreSQL.

## Single sign-on

```yaml title="compose.oidc.yaml"
# PeckList with single sign-on through an OpenID Connect provider (Pocket ID here; any works).
# Register this redirect URI with the provider:  https://tasks.example.com/auth/oidc/pocket/callback
# Put the client secret in a file first:  mkdir -p secrets && echo 'the-secret' > secrets/oidc_secret
# Docs: docs/guides/single-sign-on.md

services:
  pecklist:
    image: registry.gitlab.com/killswitch10/pecklist:latest
    container_name: pecklist
    restart: unless-stopped
    ports:
      - '8080:8080'
    volumes:
      - pecklist-data:/data
      # Attached files, apart from the database.
      - pecklist-files:/files
    environment:
      TZ: Etc/UTC
      PUBLIC_URL: https://tasks.example.com
      OIDC_PROVIDERS: pocket
      OIDC_POCKET_AUTHORITY: https://id.example.com
      OIDC_POCKET_CLIENT_ID: pecklist
      OIDC_POCKET_CLIENT_SECRET_FILE: /run/secrets/oidc_secret
      OIDC_POCKET_DISPLAY_NAME: Pocket ID
      # Only members of this group may sign in; new ones get an account by themselves.
      OIDC_POCKET_REQUIRED_GROUPS: pecklist
      OIDC_POCKET_AUTO_CREATE: 'true'
      # Members of pecklist-admins become admins at every sign-in.
      OIDC_POCKET_ROLE_MAP: pecklist-admins=admin
      # No passwords at all, in the app or the API (pecklist admin login-link gets an admin back in).
      # LOCAL_LOGIN: disabled
    secrets:
      - oidc_secret

secrets:
  oidc_secret:
    file: secrets/oidc_secret

volumes:
  pecklist-data:
  pecklist-files:
```

Provider by provider: [single sign-on](../guides/single-sign-on.md).

## Everyday commands

```bash
docker compose pull && docker compose up -d       # upgrade (read the changelog first)
docker compose logs -f pecklist                  # follow the logs
docker compose exec pecklist pecklist --version
docker compose exec pecklist pecklist snapshot  # a backup now
docker compose restart pecklist                  # after changing a setting that needs it
```

The **Restart now** button on the admin settings page stops the server; the `restart:` policy in
these files brings it back. Without one, the server stays stopped.
