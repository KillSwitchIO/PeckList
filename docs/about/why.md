# Why PeckList

PeckList is a task and calendar app you run yourself, built to feel like the polished hosted
apps (TickTick, Todoist) rather than like a database with a form in front of it. It was written by
someone who used TickTick every day and wanted the same comfort on a server of their own, for a
household and a few friends.

## What it is for

- **Your tasks on your server.** One small program serves the app and keeps everyone's data, in
  SQLite or PostgreSQL. It runs as a Docker container, or as a native program on Linux and
  Windows with no Docker at all. Nothing about your tasks leaves it.
- **Offline for real.** Every device keeps a full copy of what its person can see. On a plane, in
  a basement or with the server down for an upgrade, you add, edit, complete and move tasks as
  usual. Changes merge field by field when the device is back: one person renaming a task while
  another completes it keeps both changes. There is no "which copy wins" dialog, because there is
  nothing to choose.
- **Sharing with the people you pick.** Friends, groups and shared lists with roles; assign a task
  to a person or a whole group, and let someone call dibs on it. Sharing is by person and list,
  not by "workspace", so a family list and a work list can sit side by side with different people
  in each.
- **A calendar you plan on.** Drag tasks from the list onto a day or a time, stretch them over a
  span, and see the week as it really is.
- **Quick to type.** `Call the vet tomorrow 3pm #pets !high` is a whole task: date, time, tag and
  priority in one line.
- **Grown-up administration.** Single sign-on with any OpenID Connect provider (group checks,
  role and group mapping, moving between providers), roles and server groups, scheduled backups
  with whole-server and per-person restore, an access and event log, and logs to Loki,
  Elasticsearch, Graylog, OpenTelemetry or syslog.
- **Easy to leave, easy to arrive.** Import from TickTick, Todoist, Google Tasks, Microsoft To Do
  and iCalendar files; export back to most of them. See
  [moving from TickTick or Todoist](../using/moving-from-ticktick-or-todoist.md).
- **Free software.** [AGPL-3.0-or-later](https://gitlab.com/killswitch10/punchlist/-/blob/main/LICENSE),
  developed in the open on GitLab.

## Who it suits

- You self-host already (a home server, a NAS, a VPS) and want tasks to live there too.
- You share tasks with a partner, a family or a small team, and want each person to have their own
  account and their own private lists next to the shared ones.
- You want the app to work with no signal, on a phone, without thinking about it.
- You already run an identity provider (Pocket ID, Authentik, Authelia, Keycloak, Entra ID) and
  want one more app behind it.

## Who it does not suit (yet)

Honest limits, so you do not find them the hard way:

- **No iPhone app.** iPhone and iPad use the web app, installed to the Home Screen. It works
  offline, and Safari delivers web push reminders only to an installed web app on iOS 16.4 or
  later. A native iOS app is on the
  [roadmap](roadmap.md), last.
- **No habits, Pomodoro timer or Eisenhower matrix.** TickTick has all three; PeckList plans them
  for after 1.0.
- **No Kanban board and no Gantt chart** yet.
- **No CalDAV.** PeckList does not speak CalDAV, so Apple Reminders, Thunderbird or tasks.org
  cannot sync with it directly. iCalendar files import and export.
- **English only** for now.
- **No hosted version.** You need somewhere to run it. A public demo server is planned for 1.0.
- **Before 1.0.** It is in daily use, but a minor version may still change things. Every change you
  need to act on is under **Breaking changes** in the
  [changelog](https://gitlab.com/killswitch10/punchlist/-/blob/main/CHANGELOG.md).

How it stacks up against the apps people usually name: [comparison](comparison.md).
