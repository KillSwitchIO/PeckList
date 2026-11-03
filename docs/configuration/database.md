# Database

PeckList stores everything in one database: **SQLite** (the default, a single file) or
**PostgreSQL** 15 or later.

## Which one

|                     | SQLite                                                      | PostgreSQL                                       |
| ------------------- | ----------------------------------------------------------- | ------------------------------------------------ |
| Setup               | Nothing                                                     | A PostgreSQL server and a database               |
| Good for            | A household, a club, a small company                        | Larger servers, or if you already run PostgreSQL |
| Backups             | PeckList's snapshots, or copy the file while it is stopped | Snapshots, or your usual `pg_dump`               |
| Moving between them | `pecklist migrate-db` either way                           |                                                  |

SQLite is not a toy here: many people syncing at once is fine. Choose PostgreSQL for operational
reasons (your existing backups, a separate database host), not for speed.

## SQLite

```bash
DB_PROVIDER=sqlite             # the default
DB_PATH=/data/pecklist.db      # the default in the image
```

The file sits with its `-wal` and `-shm` companions. Keep it on a local disk: SQLite over NFS or
SMB can corrupt. Copying the file while the server runs can give a broken copy; use
[snapshots](../guides/backups.md) or stop the server first.

## PostgreSQL

```bash
DB_PROVIDER=postgres
DB_CONNECTION_STRING=Host=db;Port=5432;Username=pecklist;Password=...;Database=pecklist
```

Create an empty database owned by the user; PeckList creates its tables at the first start.

```sql
CREATE ROLE pecklist LOGIN PASSWORD '...';
CREATE DATABASE pecklist OWNER pecklist;
```

Use `DB_CONNECTION_STRING_FILE` to keep the password out of the environment
([example](../install/docker-compose.md#postgresql)). Useful connection string parts:
`SSL Mode=Require` for TLS, `Pooling=true;Maximum Pool Size=20`, `Timeout=15`.

Writers take a transaction-scoped advisory lock, so a PostgreSQL server shared with other apps
needs nothing special.

## Schema upgrades

A newer PeckList upgrades the database schema when it starts (`DB_MIGRATE_ON_START=true`). Each
step runs in its own transaction: it either completes or changes nothing, and the next start
carries on from there.

If the server's database user may not change the schema, set `DB_MIGRATE_ON_START=false` and run
the upgrade yourself before starting a new version, with a user that may:

```bash
docker run --rm -e DB_PROVIDER=postgres -e DB_CONNECTION_STRING="Host=db;Username=owner;..." \
  registry.gitlab.com/killswitch10/punchlist:0.2.0 upgrade-db
```

The server does not check the schema when it starts this way, so do not skip this step.

Going back to an older PeckList after an upgrade is not supported: restore the snapshot taken
before (see [upgrading](../guides/upgrading.md)).

## Moving from SQLite to PostgreSQL (or back)

`migrate-db` copies everything (accounts, data, sessions, sync positions) into another, empty
database, while the server keeps running:

```bash
docker exec pecklist pecklist migrate-db --to postgres \
  --connection "Host=db;Username=pecklist;Password=...;Database=pecklist"
```

Then switch the settings (`DB_PROVIDER=postgres`, `DB_CONNECTION_STRING`) and restart. Nobody has
to sign in again or resync. Changes made between the copy and the restart are lost, so do it at a
quiet time, or stop people from using it first. The other way round:

```bash
docker exec pecklist pecklist migrate-db --to sqlite --path /data/pecklist-new.db
```
