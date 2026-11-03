# PeckList compared

The apps people name most when they look for a task app, and where each one is the better
choice. Written by the PeckList project, so read it with that in mind; corrections are welcome as
an [issue](https://gitlab.com/killswitch10/pecklist/-/issues).

!!! note "Checked on 2026-10-30"
    Prices, limits and features below come from each app's own site on that date (linked under
    [sources](#sources)). They change; check the app's site before you decide.

## At a glance

|                                 | PeckList                          | Todoist                      | TickTick                        | Vikunja                          | Nextcloud Tasks                       | Super Productivity              |
| ------------------------------- | ---------------------------------- | ---------------------------- | ------------------------------- | -------------------------------- | ------------------------------------- | ------------------------------- |
| Runs on your own server         | Yes                                | No                           | No                              | Yes (or their hosted cloud)      | Yes, inside Nextcloud                 | No server needed (local first)  |
| License                         | AGPL-3.0-or-later                  | Proprietary                  | Proprietary                     | AGPL-3.0                         | AGPL-3.0                              | MIT                             |
| Price                           | Free                               | Free plan; Pro $60 a year    | Free plan; Premium $49.99 a year | Free self-hosted; paid cloud     | Free                                  | Free                            |
| Works offline                   | Every device keeps a full copy     | Yes, once signed in          | Yes                             | Web app needs the server         | Depends on the CalDAV client          | Yes                             |
| Shared lists between people     | Friends, groups, roles, assignment | Yes (5 people a project free) | Yes (2 members free)           | Users, teams, share links        | Through Nextcloud sharing             | No (one person, many devices)   |
| Calendar view                   | Month, 1 to 14 days, drag in       | Pro only                     | Year to agenda (more in Premium) | Gantt                            | In the Nextcloud Calendar app         | Schedule planner, timeboxing    |
| Kanban, Gantt, timeline         | Not yet                            | Board layout                 | Kanban, timeline                | Kanban, Gantt, table             | No                                    | Kanban                          |
| Habits, focus timer, matrix     | Not yet                            | No                           | All three                       | No                               | No                                    | Pomodoro, focus mode, matrix    |
| Single sign-on (OIDC)           | Any provider, group and role maps  | Their own accounts           | Their own accounts              | OIDC with team sync, LDAP        | Whatever Nextcloud uses               | No accounts                     |
| Standard sync protocol (CalDAV) | No                                 | No                           | No                              | Yes                              | Yes (it is CalDAV)                    | Basic CalDAV integration        |
| Phone apps                      | Android app; iPhone uses the web app | iOS, Android               | iOS, Android                    | Early official Android app, third-party clients | Any CalDAV app (DAVx5 with jtx Board, Tasks.org, Apple Reminders) | iOS, Android |

## Todoist

**Choose Todoist** if you want the most polished hosted app with the least effort. It has 90 and
more integrations, mature natural-language dates, apps on every platform, AI helpers (Ramble,
Task Assist), and a team plan with admin controls. Nobody has to run a server or think about
backups (Pro and Business keep automatic backups for you).

**Choose PeckList** if your tasks must stay on your own hardware, if you want unlimited projects,
filters and the calendar without a subscription, or if you share with family and friends who
should not each need a paid seat. Todoist's free plan holds five personal projects, three filter
views and no calendar layout. PeckList reads Todoist's backups, so trying it costs an afternoon.

## TickTick

**Choose TickTick** if you use its extras: the habit tracker, the Pomodoro focus timer, the
Eisenhower matrix, the timeline, location reminders, widgets, and native apps for iPhone, iPad,
Android, Windows, macOS and Linux. PeckList borrows much of its feel from TickTick, but does not
have those yet.

**Choose PeckList** if you want TickTick's way of working (smart views, quick add, a calendar you
drag tasks onto, checklists in notes) on a server you control, with no list or task limits
(TickTick Free stops at 9 lists, 99 tasks a list and 2 members a list) and real offline merging.
PeckList imports TickTick's backup file, checklists and won't-do tasks included.

## Vikunja

Vikunja is the closest open-source neighbour: self-hosted, AGPL, shared projects and teams.

**Choose Vikunja** if you want its views (Kanban, Gantt and table besides the list), CalDAV so
other apps can sync, LDAP, share links that work without an account, imports straight from
Todoist, Trello and Microsoft To Do accounts, or a hosted plan from the people who make it. It has
also been around much longer and has a larger community.

**Choose PeckList** if offline matters: Vikunja's web app needs a connection to its server, while
every PeckList device keeps working without one and merges later. PeckList also has an Android
app of its own, a calendar you drag tasks onto, OIDC group checks with role and group mapping and
provider migration, and native Linux and Windows builds as well as the image.

## Nextcloud Tasks

**Choose Nextcloud Tasks** if you already run Nextcloud. There is nothing new to run, sharing
follows your Nextcloud users and groups, and because it is plain CalDAV, any CalDAV app can be the
client: DAVx5 with jtx Board, Tasks.org or OpenTasks on Android, Apple Reminders on iPhone,
Thunderbird on the desktop. No other app on this page fits as many existing clients.

**Choose PeckList** if you do not want Nextcloud just for tasks, or want more than CalDAV carries:
assignment to people and groups, dibs, comments, attachments, saved filters, a calendar built for
planning tasks, and the same app on every device instead of a different client on each.

## Super Productivity

**Choose Super Productivity** if you work alone and want to track time: per-task time tracking,
timesheets, timeboxing, a Pomodoro timer and focus mode, and issues pulled in from Jira, GitHub,
GitLab, Gitea, Linear, OpenProject and others. It needs no server or account at all; sync between
your own devices goes through WebDAV, Dropbox or its own SuperSync (which you can host).

**Choose PeckList** if you share tasks with other people. Super Productivity is built for one
person on many devices; PeckList is built for several people with their own accounts, shared
lists and assignment, plus a server that admins can back up and sign people in to.

## Sources

Read on 2026-10-30:

- Todoist: [pricing](https://todoist.com/pricing) and
  [using Todoist offline](https://todoist.com/help/articles/use-todoist-while-offline-4rbaZw).
- TickTick: [Premium comparison](https://ticktick.com/about/upgrade),
  [features](https://ticktick.com/features) and [downloads](https://ticktick.com/download).
- Vikunja: [home page](https://vikunja.io/), [features](https://vikunja.io/features/),
  [OpenID](https://vikunja.io/docs/openid/),
  [migration](https://vikunja.io/docs/migration-from-third-party-services/), and the community
  thread on [offline access](https://community.vikunja.io/t/offline-access-in-android/2465).
- Nextcloud Tasks: [the app store page](https://apps.nextcloud.com/apps/tasks) and
  [its repository](https://github.com/nextcloud/tasks).
- Super Productivity: [home page](https://super-productivity.com/) and
  [its repository](https://github.com/super-productivity/super-productivity).
