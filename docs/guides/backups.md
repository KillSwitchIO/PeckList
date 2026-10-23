# Backups and restore

## Scheduled snapshots

The server writes a full backup, a **snapshot**, on `BACKUP_SCHEDULE` (`daily` by default;
`hourly`, `weekly` or `off`) to `SNAPSHOT_DIR` (`/data/snapshots` in the image), keeping the newest
`SNAPSHOT_KEEP` (14).

A snapshot is one JSON file with everything: accounts (with password hashes), every task and list,
sharing, and the keys that sign session cookies. **Treat
snapshots like the database itself**: anyone with one can read everyone's data.

Snapshots are consistent: they are taken inside the database, not copied from a file in use.
They also sit next to the database, so they protect against mistakes, not against losing the disk.
Copy them elsewhere: include `/data` (or just `/data/snapshots`) in your machine's backup tool
(restic, borg, Kopia, Duplicati, ...).

## Admin > Backups

- **Take a backup now**, and download any snapshot.
- **Export** the whole server or one person.
- **Restore** from a file you upload or from one of the scheduled snapshots: the whole server, or
  one person within it. A whole-server restore is applied at the next start, before anything loads,
  and the page offers the restart.

## From the command line

```bash
docker exec punchlist punchlist snapshot                                  # a snapshot now
docker exec punchlist punchlist export /data/backup.json                  # full backup to a file
docker exec punchlist punchlist export > backup.json                      # ... or to stdout
docker exec punchlist punchlist import /data/backup.json                  # into an EMPTY database
docker exec punchlist punchlist import /data/backup.json --replace        # delete what is there first
```

`import` refuses a database that already has data unless you pass `--replace`. After an import,
restart the server. A restored backup keeps sessions and every device's sync position, so nobody
has to sign in again or start over.

!!! tip "Windows Git Bash"
    Prefix the commands with `MSYS_NO_PATHCONV=1` so `/data/...` paths reach the container
    unchanged.

## One person

Export and restore a single person's data (their lists, tasks, tags and settings), for example to
undo a mistake without touching anyone else:

```bash
docker exec punchlist punchlist export --user sam /data/sam.json
docker exec punchlist punchlist import --user /data/sam.json             # put Sam back as the file had it
docker exec punchlist punchlist import --user /data/full-backup.json sam # Sam's part of a full backup
```

Restart after `import --user`. The admin page does the same under **Admin > Users > Export their
data** and **Admin > Backups**.

## Restoring onto a new machine

1. Install Punchlist the same way (same version or newer).
2. Before the first start, put the backup file somewhere the server can read.
3. Start once so the database exists, stop, then `punchlist import <file> --replace`, and start
   again. Or start it and use **Admin > Backups > Restore** with the upload.

Moving between SQLite and PostgreSQL is `migrate-db`; see [database](../configuration/database.md).

## SQLite file copies

If you prefer copying the database file: stop the server first, then copy `punchlist.db` (and any
`-wal` and `-shm` files next to it). A copy taken while it runs may not open.
