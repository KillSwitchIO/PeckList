# Apps, offline and sync

## Install the app

Punchlist is a web app you can install. Once installed it opens in its own window, starts from the
home screen or start menu, and works offline. Installing needs HTTPS (or `localhost`).

| Device                                   | How                                                                  |
| ---------------------------------------- | -------------------------------------------------------------------- |
| Android (Chrome, Edge, Samsung Internet) | The browser offers **Install app**, or menu > **Install app**        |
| iPhone, iPad                             | Safari > **Share** > **Add to Home Screen**                          |
| Windows, macOS, Linux (Chrome, Edge)     | The install icon in the address bar, or menu > **Install Punchlist** |
| Firefox desktop                          | No install; use it in a tab (it still works offline once loaded)     |

## Offline

Each device keeps a full copy of everything its person can see, so the app works without a
connection: add, edit, complete, move. Changes wait on the device and sync when it is back online.

## How sync works

- Every change is stored per field with a timestamp. When two devices change the same task, each
  field keeps its latest value: one person renaming a task while another completes it keeps both
  changes. Tags and similar sets merge item by item.
- A device sends its changes a moment after you stop typing, and asks for others' changes when it
  starts, when it comes back into focus or online, every 30 seconds, and at once when the server
  says something changed (live updates).
- The sync button shows the state (syncing, offline, a problem) and when it last synced.

## Without a server

Opened from a plain web server (or `pnpm dev`), with no Punchlist server behind it, the app keeps
everything in this browser only: no accounts, no sync, no sharing. Clearing the browser's site data
deletes it, so download a copy now and then.

## Your data as a file

**Settings > Your data > Download a copy** saves everything on this device as one JSON file
(`punchlist-2026-10-23.json`). **Import a file** brings one back, into this device or another:

- It adds to what is here, never replaces it. Where both have the same task, the newer edit wins,
  so an old copy cannot undo newer work.
- A file from another person or another device without an account becomes yours, and its Mess
  Drawer tasks move into yours.
- A file from a newer Punchlist is refused until the app updates; an older one is upgraded.
- One import is one step: the undo toast takes it all back.

Signed in to a server, what an import adds syncs like anything else. Server admins have
[whole-server and per-person backups](../guides/backups.md) for everyone's data.

## Signing out

**Sign out** is in the account menu (the sync button). It sends any changes still waiting first,
then signs out.
