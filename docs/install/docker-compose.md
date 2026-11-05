# Docker Compose

The recommended way to run PeckList. All examples are in
[`examples/docker`](https://gitlab.com/killswitch10/pecklist/-/tree/main/examples/docker).

## SQLite (the default)

One container, data in a named volume. Good for a household or a small team: SQLite handles many
people comfortably.

```yaml title="compose.yaml"
--8<-- "examples/docker/compose.yaml"
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
--8<-- "examples/docker/compose.caddy.yaml"
```

</TabItem>
<TabItem value="caddyfile" label="Caddyfile">

```text
--8<-- "examples/docker/Caddyfile"
```

</TabItem>
</Tabs>

Behind Traefik instead: [`compose.traefik.yaml`](https://gitlab.com/killswitch10/pecklist/-/blob/main/examples/docker/compose.traefik.yaml).
Other proxies: [reverse proxy and HTTPS](reverse-proxy.md).

## PostgreSQL

For people who already run PostgreSQL or want the database on its own server. Make the secrets
first (the commands are at the top of the file).

```yaml title="compose.postgres.yaml"
--8<-- "examples/docker/compose.postgres.yaml"
```

More in [database](../configuration/database.md), including moving an existing SQLite server to
PostgreSQL.

## Single sign-on

```yaml title="compose.oidc.yaml"
--8<-- "examples/docker/compose.oidc.yaml"
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

The **Restart now** button on the admin pages stops the server; the `restart:` policy in
these files brings it back. Without one, the server stays stopped.
