# Backups and restore

## Scheduled snapshots

The server writes a full backup, a **snapshot**, on `BACKUP_SCHEDULE` (`daily` by default;
`hourly`, `weekly` or `off`) to `SNAPSHOT_DIR` (`/data/snapshots` in the image). It keeps the
newest `SNAPSHOT_KEEP` (7), plus one from each of the `SNAPSHOT_KEEP_WEEKLY` (4) weeks before
those: with the defaults, a week of dailies and a month of weeklies.

A snapshot is one gzip-compressed JSON file (`pecklist-YYYYMMDD-HHMMSS.json.gz`, about a tenth of
the plain size) with everything: accounts (with password hashes), every task and list,
sharing, and the keys that sign session cookies. **Treat
snapshots like the database itself**: anyone with one can read everyone's data.

Snapshots are consistent: they are taken inside the database, not copied from a file in use.
They also sit next to the database, so they protect against mistakes, not against losing the disk.
Copy them elsewhere: include `/data` (or just `/data/snapshots`) in your machine's backup tool
(restic, borg, Kopia, Duplicati, ...).

Snapshots hold tasks, not the files attached to them. Those live in `ATTACHMENT_DIR` (`/files` in
the image, its own volume), named by their content hash: back that folder up too. Files never
change once written, so an incremental backup tool copies each one once.

## Admin > Backups

- **Backup schedule**: how often, and how many to keep.
- **Take a backup now**, and download any snapshot (`.json.gz`; `gunzip` it to read the JSON).
- **Export** the whole server or one person.
- **Restore** from a file you upload or from one of the scheduled snapshots: the whole server, or
  one person within it. A whole-server restore is applied at the next start, before anything loads,
  and the page offers the restart. Every device then starts over from the restored data at its
  next sync; changes a device made before it noticed are not written over the restored data.

Downloading, exporting and restoring the whole server is for super admins: those files hold every
password hash and the keys that sign sessions. Admins take backups, see the list, and export and
restore people who are not admins; someone an admin restores always comes back as a plain user.
See [users and roles](users-and-roles.md#roles).

A whole-server export made with an API key (such as the client's remote `export`) leaves out the
server's session and one-time secrets, and the passwords saved on the settings page (the mail
password and sign-in providers' client secrets; the other settings stay). Restoring it signs
everyone out, and sign-in links, invites and reset links made before it stop working. Enter those
passwords again on **Admin > Settings** afterwards. An export made signed in, a snapshot and the
server's own `export` command hold everything. Because snapshots hold everything, a key can take
one and list them but not download one: sign in to download it, or use export. Restoring the
whole server always needs someone signed in; a key can restore one person.

## From the command line

```bash
docker exec pecklist pecklist snapshot                                  # a snapshot now
docker exec pecklist pecklist export /data/backup.json                  # full backup to a file
docker exec pecklist pecklist export > backup.json                      # ... or to stdout
docker exec pecklist pecklist import /data/backup.json                  # into an EMPTY database
docker exec pecklist pecklist import /data/backup.json --replace        # delete what is there first
```

`import` refuses a database that already has data unless you pass `--replace`. After an import,
restart the server. A restored backup keeps sessions and every device's sync position, so nobody
has to sign in again or start over (except from an export made with an API key, as above).

:::tip[Windows Git Bash]

Prefix the commands with `MSYS_NO_PATHCONV=1` so `/data/...` paths reach the container
unchanged.

:::

## One person

Export and restore a single person's data (their lists, tasks, tags and settings), for example to
undo a mistake without touching anyone else:

```bash
docker exec pecklist pecklist export --user sam /data/sam.json
docker exec pecklist pecklist import --user /data/sam.json             # put Sam back as the file had it
docker exec pecklist pecklist import --user /data/full-backup.json sam # Sam's part of a full backup
```

Restart after `import --user`. The admin page does the same under **Admin > Users > Export their
data** and **Admin > Backups**.

## Restoring onto a new machine

1. Install PeckList the same way (same version or newer).
2. Before the first start, put the backup file somewhere the server can read.
3. Start once so the database exists, stop, then `pecklist import <file> --replace` (a `.json` export
   or a `.json.gz` snapshot), and start again. Or start it and use **Admin > Backups > Restore** with the upload.

Moving between SQLite and PostgreSQL is `migrate-db`; see [database](../configuration/database.md).

## SQLite file copies

If you prefer copying the database file: stop the server first, then copy `pecklist.db` (and any
`-wal` and `-shm` files next to it). A copy taken while it runs may not open.
