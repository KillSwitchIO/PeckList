# Upgrading

## Before you upgrade

1. Read the [changelog](https://gitlab.com/killswitch10/pecklist/-/blob/main/CHANGELOG.md) for
   every version between yours and the new one. Before 1.0, a minor version (`0.3` to `0.4`) may
   change things; each one you have to act on is under **Breaking changes**, with what to do.
2. Take a snapshot: **Admin > Backups > Take a backup now**, or `pecklist snapshot`. Going back to
   an older version is only possible by restoring it.
3. Check your version: `pecklist --version`, or `/api/info`.

You can skip versions: the database is upgraded step by step from any older version.

## Docker Compose

```bash
docker compose pull
docker compose up -d
docker compose logs -f pecklist   # watch it start
```

Pin a minor line (`image: ...pecklist:0.2`) to get fixes automatically but choose when to take a
new minor version. Watchtower, Diun or Renovate can tell you when a new release is out.

## Linux and Windows

Run the newer download's `install.sh` or `install-service.ps1`, the same way as installing. Your
settings and data stay. See [Linux](../install/linux.md#upgrade) and
[Windows](../install/windows.md#upgrade).

## The Android app

The Android app runs your server's own copy of the web app, so most server upgrades need nothing
from people's phones. When a release does need a newer app, its changelog section starts with a
**Compatibility** note (`Requires-Android: X.Y.Z`): update the apps first, since an app older than
that is signed out until it updates. Obtainium updates the app by itself; otherwise install the
new `pecklist-android.apk` over the old one ([the Android app](../using/android-app.md#install)).
The first PeckList APK is the one exception: it is a new app beside the old Punchlist app, not an
update of it ([coming from the Punchlist app](../using/android-app.md#install)).

## What happens on start

The server upgrades the database schema before it takes requests (each step in its own
transaction), then serves the new web app. Apps that are open, in a browser or installed, notice
the new version when they next check and show a message with a button to reload into it. Devices
that were offline sync normally when they come back.

If the server's database user may not change the schema (`DB_MIGRATE_ON_START=false`), run
`pecklist upgrade-db` with an owner first; see [database](../configuration/database.md#schema-upgrades).

## If something goes wrong

1. Stop the new version.
2. Move the new version's database aside, or point the old version at a new empty one. An older
   version refuses to start on a database a newer one has upgraded, because it would be running
   old code on a schema it does not know.
3. Restore the snapshot you took into the empty database (`pecklist import <file>`, run by the old
   version), or put back the database file you copied.
4. Start the old version, and [open an issue](https://gitlab.com/killswitch10/pecklist/-/issues)
   with a [debug dump](logging.md#debug-dump).
