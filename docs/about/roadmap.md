# Roadmap

Where PeckList is and where it is going. Plans change; the
[changelog](https://gitlab.com/killswitch10/pecklist/-/blob/main/CHANGELOG.md) is the record of
what actually shipped. Ideas and votes are welcome as
[feature requests](https://gitlab.com/killswitch10/pecklist/-/issues/new?issuable_template=Feature%20request).

## Already here

What the current release does, built up over the 0.x versions:

- **Tasks**: lists, subtasks, nested tags, priorities, start and due dates with times and spans,
  rich notes and checklists, pinned tasks, repeats, reminders, comments and attachments, quick add
  in one line, keyboard shortcuts, search, smart views and saved filters, and a Trash with undo.
- **Calendar**: a continuous month and 1 to 14 days on a time grid, with tasks dragged in, moved
  and stretched.
- **Offline and sync**: a full copy on every device, merged field by field across devices and
  people.
- **Sharing**: friends, groups, shared lists with roles, assignment to people and groups, dibs.
- **Server**: one container or a native program on Linux and Windows, SQLite or PostgreSQL,
  settings from the environment, a file or the admin page, with encrypted secrets.
- **Accounts and sign-in**: local accounts, single sign-on with any OpenID Connect provider (group
  checks, role and group mapping, account linking, moving between providers), roles and server
  groups, account management and view-as for support, a first-start setup.
- **Operations**: scheduled backups with whole-server and per-person restore, logs and log
  shipping, an access and event log, usage stats, an update notice, and an anonymous usage report
  you can turn off ([privacy](../using/privacy.md)).
- **Moving in and out**: imports from TickTick, Todoist, Google Tasks, Microsoft To Do and
  iCalendar, and exports for most of them.
- **Android app**: reminders with the app closed, sign-in through the browser, signed releases.

## Before 1.0

1.0 is the first stable release: from then on, the data format is fixed as the base every later
version reads, and breaking changes wait for a major version.

- **The public name.** "PeckList" is the working name and may change before 1.0.
- **Hardening**: the remaining items from a security and bug audit (the server deciding authorship
  and ownership itself, signing out clearing the device, Android fixes).
- **Testing on real installs**: every install path followed from the docs alone, notifications on
  each platform, imports from real TickTick and Todoist accounts.
- **A public demo server** that anyone can sign up on, reset every night.
- **Distribution**: signed container images, a mirror on a better-known registry, the Android app
  through Obtainium and perhaps IzzyOnDroid and Google Play.
- **Notification categories** on Android (a channel per kind, vibration, mute switches).
- **Documentation and a website** with screenshots and the quick start.
- **Ways to support the project**: donation links and a commercial license for organizations that
  cannot use the AGPL.
- **Still being decided for 1.0**: a Kanban board, the Timeline and Gantt view, and working on a
  linked workspace file.

## After 1.0

Roughly in this order, and none of it promised:

- **Assistants (1.1)**: personal access tokens and an OpenAPI description first, then an MCP
  connector so Claude, ChatGPT and other assistants can work with your own server.
- **Notifications without a server round trip (1.1)**: reminders scheduled on the device, and
  UnifiedPush for phones without Google services.
- **Federation**: sharing between people on different PeckList servers.
- **Habits**, a **Pomodoro** focus timer and an **Eisenhower matrix**.
- **iOS app**: last, since the web app already installs on iPhone and iPad.
