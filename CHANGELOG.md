# Changelog

All notable changes to Punchlist. Generated from [Conventional Commits](https://www.conventionalcommits.org/)
by `pnpm changelog`; the version follows [Semantic Versioning](https://semver.org/). Before 1.0.0 a
minor release may break things; every break is listed under **Breaking changes** with what to do.

## [0.2.0] - 2026-10-25

### Breaking changes

- Drop folders; organization is lists and tags. Folder operations (createFolder, renameFolder, deleteFolder, visibleFolders) are gone from core/lists.
- **ui:** Cleaner task rows and grouped views, start date only. Today and Next 7 days place tasks by start date only; a task with only a due date no longer appears there.

### Added

- **store:** Domain store with autosave, multi-tab merge and undo
- **ui:** Task rows, details, lists, sections and smart views
- **ui:** One-click date shortcuts and click-anywhere date picker
- **ui:** Clean date picker popover for date and due
- **ui:** Rename Inbox to Mess Drawer; dates lead the task info line
- **ui:** Show task dates at the right edge of each row
- **ui:** Cleaner task rows and grouped views, start date only
- **ui:** Fixed date column, no list name for Mess Drawer, fuller week
- **dates:** Typed time entry with 24-hour input and smart defaults
- **dates:** Time wheels on touch screens; right-align row dates
- **dates:** Time wheels on tablets too
- **tags:** Nested tags with sidebar tree, tag views, row chips and picker
- **tags:** Color families, custom colors, smart defaults, path nesting
- **tags:** Type whole paths with suggestions and a preview
- **subtasks:** Subtask trees in lists and an editable checklist in details
- **subtasks:** Trees in date and tag views, inherited tags, detach
- **views:** Filter engine, All view, date groups for lists and tags
- **rows:** Name the list on every row in views that mix lists
- **tasks:** Completion date on rows and an editable Completed field
- **views:** View less in the Completed header after View more
- **dates:** Scrolling week calendar with month and year zoom, quick-pick hints
- **dates:** Time spans in the start date picker, +7 / +30 picks, No date
- **dates:** Own SVG icons, next-month pick, Date as default
- **dates:** Outline months in the calendar; spans open on Duration
- **notes:** Rich notes editor (TipTap) behind a RichTextEditor port
- **details:** Wider resizable panel, full screen, footer list and priority
- **details:** Tag pills with remove and add, subtasks below notes; '- [ ] ' checklists
- **schema:** V2 adds task progress; back up and upgrade stored data
- **details:** Animated complete checkbox, start date in the header, progress and won't do menu
- **details:** Priority-colored checkbox, footer tags and created date, progress slider, slash commands
- **sidebar:** Reorder, hide and group views (saved in settings, schema 3); 100% progress completes
- **filters:** Make saved filters from sidebar editing (PL-015)
- **sidebar:** Order lists and tags, pin them to the top (schema 4: tag order)
- Tags fill the bottom bar, Shift+Return confirms, Escape closes, due dates on rows
- Won't do looks different from done, Completed grouped by day, foldable Lists and Tags
- **sidebar:** Drag tags under another parent; fix drops landing above their target
- **rows:** Click a row's date to edit it in place
- **server:** ASP.NET Core skeleton and one-container image
- **server:** Settings from environment with _FILE variants
- **server:** Entity store on SQLite and PostgreSQL
- **sync:** C# HLC and merge matching the web merge
- **server:** Local accounts, sessions and no-login mode
- **sync:** POST /api/sync with cursor and schema check
- **sync:** Client sync engine, sign-in and the sync button
- **server:** Backups, snapshots and the punchlist CLI
- **sync:** Live updates over Server-Sent Events
- **server:** Punchlist admin add-user
- **sharing:** Sharing index and access changes in the change feed
- **sharing:** Sync enforces access, grants and revokes
- **sync:** Devices take refused changes back
- **friends:** Profiles, friend codes and links, lookup
- **friends:** Friends page, friend link screen and sharing ops
- **sharing:** Share dialog for lists
- **sharing:** Assigned to me view
- **sharing:** Assignee picker in task details
- **sharing:** Read-only tasks and lists for viewers
- **sharing:** Assignee avatars on task rows
- **sharing:** Group succession on the server
- **sharing:** Groups, sharing with groups, and dibs
- **sharing:** Assign straight to someone in a group
- **sharing:** Shared with me view
- **friends:** QR code for the friend link
- **sharing:** Invite assignments settle on the server
- **sharing:** Invite on assign from the assignee picker
- **search:** Search titles, notes and tags
- **trash:** Auto-purge after 30 days, delete forever, empty trash
- **lists:** Archived lists group and unarchive
- **filters:** Due-date condition, closed toggle, sidebar counts
- **lists:** Drag tasks to reorder, nest, outdent and move
- **settings:** Palette editor with live colors and reset
- **settings:** Theme mode syncs; due-soon window and calendar length
- **settings:** 12/24-hour clock and week start (schema 5)
- **shortcuts:** Keyboard shortcuts and the ? list
- **quick-add:** Natural language in the add-task bar
- **server:** Roles, permissions and server groups
- **oidc:** Sign in with any OIDC provider
- **oidc:** Link, unbind and move between providers
- **oidc:** Provider sessions end on time and check again
- **admin:** Add, turn off and reset accounts
- **admin:** Admin screens for users, groups and sign-in
- **admin:** Admins set up friendships
- **admin:** Hand shared lists and groups to a new owner
- **admin:** Super admins view the app as someone
- **settings:** Settings from the environment, a config file or the page
- **settings:** Admin > Settings page
- **backup:** Backups, exports and restoring one person over the API
- **backup:** Admin > Backups and restoring the whole server
- **logging:** One log shape, rolling files, log servers and the debug dump
- **audit:** Access and event log with an admin dashboard
- **stats:** Server stats and your own stats
- **setup:** First-run wizard
- **backup:** Weekly schedule and one person's backups from the CLI
- **accounts:** Delete with a grace period, restore, and hand-over first
- **oidc:** Admins link provider accounts by hand; optional email join
- **groups:** Server groups offered for sharing appear in the app
- **dates:** Timed dates follow the viewer's time zone
- **calendar:** Month, week and day calendar with drag, resize and drag-in
- **filters:** Date-state and assignee conditions in saved filters
- **lists:** Move to list, drop onto a task to nest, reorder sections
- **server:** Run as a Windows service or systemd unit; --version, upgrade-db
- Self sign-up with invite links (REGISTRATION)
- **auth:** Sign out of the identity provider too (OIDC_<NAME>_SIGN_OUT)
- Friendships say which admin made them (schema 6)
- **settings:** Apply sign-up, sign-in, backup and retention settings live
- **web:** A floating + button on phones opens the add-task field
- **web:** Choose an icon for a list
- **web:** Download your data as JSON and import a file
- **web:** Say when the server undid a change or took a list away
- **audit:** Sharing changes through sync and scheduled backups as events
- **web:** Sort and group options for lists
- Comments on tasks, with @mentions (schema 7)
- **attachments:** Server file store and local blob store (schema 8)
- **oidc:** Username linking, user mapping and the admin OIDC screen
- **web:** Profile menu in the top right, own time zone, stats page
- **web:** Fold the sidebar away, mini calendar, version, sort and group button
- **web:** Drop sections; lists shared with a group show the group's name
- **web:** Notes without an edit mode, task dates, phone panel, expand to the task form
- **attachments:** Attach files to tasks, synced through the server
- **web:** Pin tasks to the top of their views
- **docker:** Attached files in their own /files volume
- **admin:** Delete now and restore on a deleted account's row; user groups
- **web:** Sort and group every view, and restore its defaults
- **web:** Line icons for lists, in the list's color
- **web:** The mini calendar opens a day's list and folds to a week
- **web:** Leave this year off month and week headings
- **web:** Phone rows on two lines, compact bottom nav, editable More, upgrade card
- **web:** Upcoming agenda and Due dates view (PL-091)
- Pick and order the phone's bottom bar tabs (schema 9)
- **web:** What you share, on the friends and groups page (PL-087)
- New task defaults in Settings (PL-092, schema 10)
- Palette presets in Settings > Colors (PL-018, schema 11)
- Reminders on tasks, TickTick style (PL-061 step A, schema 12)
- Notifications page (PL-061 step B)
- Web Push and server reminders (PL-061 step C)
- **tasks:** Repeating tasks (PL-060)
- Feedback round 2026-10-24
- **calendar:** Our own calendar, Month and Days (PL-093 part 1)
- **calendar:** Drag tasks without holding; grips to stretch from either edge
- **calendar:** Steady Days grid, no scrollbars on phones, big grips on a long hold
- **tasks:** Swipe task rows like TickTick
- **calendar:** Times above a task while it is dragged or stretched
- **calendar:** A hold-and-turn dial for days shown, and a toolbar that holds still
- **calendar:** Month outlines like the date picker, and "Nov 1" on the 1st in Days
- **auth:** Confirm a new password, and an eye to show any password field
- Bigger checkboxes in notes; on phones a row's date sits at the right
- **upcoming:** Swipeable week strip, endless days, start from an earlier day
- **swipe:** Settings > Swipe actions; a full swipe right opens the date
- **colors:** Ten more palettes, soft, bright and earthy
- **profile:** A profile photo, moved and zoomed into its circle (schema 14)
- **views:** Filter Today, Upcoming and the Calendar by lists, tags and saved filters
- **select:** Pick many tasks from the view menu; circles, section circles, action bar
- **lists:** List or Timeline per list; one menu for a list's view and its own actions
- **drag:** Hold and drag tasks in every view; groups set date, priority, tag or list
- **reminders:** TickTick's reminder sheet, custom wheels, constant reminders (schema 15)
- **settings:** The profile photo lives in Settings > Profile
- **settings:** Swipe actions on a sample task, with buttons to reorder, remove and add
- **colors:** Theme colors for lists and tags, and recolor them with the theme
- **undo:** A small round Undo with a timer ring, swiped away sideways
- **reminders:** Dismiss and Snooze on constant reminders
- **profile:** The identity provider's picture fills a profile with none of its own
- Read and write TickTick backups
- Read and write Todoist, Google Tasks, Outlook, iCalendar, Things
- Import from and export for other to-do apps in Settings
- Start over in Settings; import shows it is working; no swipe under a menu

### Fixed

- **ui:** Keep the app frame stable across views
- **ui:** Keep the task list in place when the details panel opens
- **i18n:** Fall back instead of crashing on a missing string
- **dev:** Poll for file changes on Windows
- **dates:** Center +7 / +30 in the calendar icon body
- **dates:** Spans stay intact, readable span fields, smooth calendar scroll
- **dates:** Make today stand out in light mode
- **dates:** Matching quick pick looks like the selected day; brighter month lines in dark; Completed date completes
- **notes:** Themed checklist boxes, https for bare links, save on page hide
- **layout:** List fills wide screens so details stay at the right edge; drop arrow-key resize
- **details:** Subtask lines show their date and open the task menu; calmer sidebar motion; Reset in sidebar editing
- **ui:** Nest preview, Escape leaves notes, Closed view, edit bar fit
- **sync:** Subscribe to change events before announcing the stream
- **sync:** The account's profile beats a device's placeholder
- **schema:** Allow invite assignees in the workspace file
- **store:** Keep changes made just before the page closes
- **store:** A change made while a save waits on storage is kept
- **sync:** End live-update streams when the server stops
- **server:** Print the first admin password to the console, not the logs
- **image:** Ship time zone data so TZ takes effect
- **audit:** Order entries by when requests began
- **logging:** Leave empty fields out of OTLP and Elasticsearch records
- **web:** The service worker leaves sign-in to the server
- **server:** A provider sign-in skips the temporary password
- Handed-over lists no longer stop the app from opening
- **web:** Phone and narrow-window layout from the PL-094 audit
- **web:** Switching light and dark changes the whole page at once
- **tasks:** Chosen repeat weekdays use the accent color
- **server:** The server's own changes no longer lose to fast device clocks
- **web:** Sync notices and an app left behind by the server
- **views:** Tags and saved filters have one three-dot menu, like lists
- **upcoming:** Swiping the strip keeps the weekday; the strip keeps up with the list at once
- **tasks:** Holding a task drags it; only a hold on its checkbox opens the menu
- **settings:** Swipe buttons reorder left and right, as the sample shows them
- **colors:** Recolor only lists one owns and one's own tags; a toggle, not a question
- **profile:** A removed photo gives way to the provider's picture at the next sign-in
- **tasks:** A phone's long press opens no menu from the row; the checkbox's stays open
- Touch drags survive a phone taking the pointer; the provider's picture of any size
- **drag:** No wrong landings, scroll at the edges, Pinned as a group, no lost moves
- Keep TickTick checklists as checklists, and close what is under closed
- **release:** Builds carry the next version, and releases can go through a merge request

### Performance

- **web:** Stay quick with 5,000 tasks

### Documentation

- Note stale string catalogs in open tabs
- Point to the admin screens for waiting sign-ins
- A documentation site for installing, configuring and running Punchlist
- The profile menu, your own time zone and the stats page
- Folding the sidebar, the mini calendar and the sort-and-group button
- Phone rows, editable More page, dates without this year
- Swipe defaults (right completes, full left picks the date)
- Undo, holding tasks, constant reminder actions, theme colors, provider photo

### Changed

- Drop folders; organization is lists and tags
- **web:** Hooks and helpers out of component files


