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

## The Android app

The Android app is the same Punchlist in a native shell, with reminders that arrive on time with
the app closed and sign-in through your real browser. Installing it (from the release page or
with Obtainium), connecting, the browser sign-in and notifications are on their own page:
[the Android app](android-app.md).

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

## Moving from or to another app

**Settings > Your data > Import from another app** reads another app's export. Pick the app, choose
its file, and Punchlist shows what it found (lists, open and closed tasks, tags) and anything it
cannot keep before anything changes. Then pick one:

- **Merge with what you have**: the import lands beside your tasks. With **Add to lists with the
  same name**, an imported "Groceries" goes into your Groceries list instead of a second one.
- **Replace what you have**: your lists, your Mess Drawer's tasks and your tags go to the Trash
  first (lists other people share with you stay). The dialog says how many.

Either way the import is one step, so the undo toast takes it all back, including what Replace put
in the Trash.
Merging a newer export of the same account adds only the tasks that are not here yet; the details
are in [moving from TickTick or Todoist](moving-from-ticktick-or-todoist.md#importing-again).

| App | Import | Export |
|---|---|---|
| TickTick | Its backup (.csv): on the web, Settings > Account > Backup | A backup file TickTick's Import Backup reads |
| Todoist | Settings > Backups (a .zip), or one project's Export as a CSV file | One .csv a list (open tasks), for a project's Import from CSV |
| Google Tasks | Google Takeout with only Tasks (the .zip, or Tasks.json in it) | (Google Tasks imports nothing) |
| Microsoft To Do | Through classic Outlook for Windows: export the Tasks folder as CSV | One .csv a list, to import into Outlook's Tasks |
| iCalendar (.ics) | Tasks (VTODO) from Nextcloud Tasks, Thunderbird, tasks.org, CalDAV apps | One .ics a list |
| Things 3 | (Things exports nothing) | Links that add your open tasks to Things |

What comes over: lists, tasks with their notes, dates and times, priorities, tags, repeats,
reminders, subtasks, and done and won't-do tasks closed as they were (Todoist and Things only deal
in open tasks). What does not:

- **Sections, kanban columns and folders**: Punchlist has none, so their tasks stay in the list.
- **TickTick checklists** stay checklists, in the task's notes, ticked items ticked (and go back
  to TickTick as checklists).
- **Done means done**: a task left open under a completed one (an unticked item of a completed
  TickTick task, say) comes in completed with it.
- **When tasks were made** comes over where the app exports it (TickTick, iCalendar).
- **Todoist comments**: they go into the task's notes.
- **Repeats Punchlist cannot follow** (such as TickTick's "these dates"): the task comes in
  without one.
- **Things**: no priorities or repeats, and a tag only if Things already has one of that name.
  Things takes no file, so open the links in order on the device that has Things: the first
  makes the lists, the rest add up to 250 tasks each.
- **Microsoft To Do**: steps are not in Outlook's file, and To Do keeps one reminder (the first).

Several lists for Todoist, Microsoft To Do or iCalendar download as one .zip; pick one list under
**Lists** to get a single file.

## Signing out

**Log out** is in the profile menu (your picture in the top right). It sends any changes still
waiting first, then signs out. The cloud next to it shows how syncing stands and syncs now.
