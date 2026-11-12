# Changelog

All notable changes to PeckList. Each release adds its section from [Conventional Commits](https://www.conventionalcommits.org/)
with `pnpm release`; the version follows [Semantic Versioning](https://semver.org/). Before 1.0.0 a
minor release may break things; every break is listed under **Breaking changes** with what to do.

## [0.10.1-rc.1] - 2026-11-12

### Fixed

- **deps:** Pin System.Formats.Cbor 9.0.24 for GHSA-vmv3-wvjp-wqpj

## [0.10.0] - 2026-11-11

### Breaking changes

- **settings:** Apps and server reminders use the device's time zone unless TZ is set. Apps, and the reminders the server sends, now use the zone of the device each person is on, unless TZ is set on the server or the person picked a zone under Settings. A server with TZ set behaves as before. An existing install that copied TZ=Etc/UTC from an old example stays on UTC until its owner removes that line.
- **oidc:** LINK_BY_USERNAME matches the username exactly, as mappings do. With OIDC_<NAME>_LINK_BY_USERNAME on, a first sign-in joins an existing account only when the provider's username is that account's name exactly, ignoring only case and spaces around it. A provider that sends an email address, or a name that differs in other ways, no longer joins an account by itself: add a USER_MAP entry for it, or have the person link the provider from their account. People already linked are not affected.
- **links:** Make links from PUBLIC_URL, or from the request only on a home network. A server reached at a public name without PUBLIC_URL no longer makes login links or invites, and its friend codes come without a link, until PUBLIC_URL is set to its address. Servers with PUBLIC_URL, and ones reached at localhost or a home-network name or address, are not affected.
- **oidc:** A migration window matches the username exactly, as LINK_BY_USERNAME does. During a migration window, a first sign-in through the new provider joins an existing account only when the provider's username is that account's name exactly, ignoring only case and spaces around it. A provider that sends an email address, or a name that differs in other ways, no longer joins an account by itself: add a USER_MAP entry for each person, or have each person link the new provider from their account before the move.
- **oidc:** A role from ROLE_MAP lapses unless a sign-in renews it. An admin or super admin role that came from ROLE_MAP now drops to user after ROLE_MAP_RENEW_DAYS (14) without a sign-in through that provider, and their API keys lose it too. This includes, from the first start after the upgrade, a role set by hand on an account linked to such a provider. Anyone who should keep a role without signing in there (an automation account, for example) needs it set by hand with `pecklist admin set-role <name> <role>`, which keeps the role they already have, or set ROLE_MAP_RENEW_DAYS=0 to keep the old behaviour. A role set by hand is leased again if they later sign in through a provider whose ROLE_MAP sets it.

### Added

- **admin:** Admin > Users shows when a leased role lapses
- **api:** Task API v1 with routes, changes feed, quick add and OpenAPI
- **cli:** CLI sign-in by browser approval, client commands and downloads
- **api:** Quick add on the server runs the app's own code

### Fixed

- **logging:** A log output's count changes after its health, and steady four tests
- **oidc:** Say why Unbind all was refused
- **sharing:** Ending a friendship ends every live row between the two
- **settings:** Apps and server reminders use the device's time zone unless TZ is set
- **reminders:** Handle every clock change and isolate failures
- **oidc:** LINK_BY_USERNAME matches the username exactly, as mappings do
- **auth:** Sign-in limits and locks say how long to wait
- **web:** Friend links and admin links on a server without PUBLIC_URL
- **links:** Make links from PUBLIC_URL, or from the request only on a home network
- **oidc:** A migration window matches the username exactly, as LINK_BY_USERNAME does
- **oidc:** Match usernames with only plain spaces trimmed, and leave no stray account
- **auth:** Refuse changes another site sends, and confirm sign-in links with a button
- **links:** Count Tailscale and NetBird names as home-network names
- **reminders:** A snooze from a notification is for the person who pressed it
- **sharing:** Comments and files go to the Trash with their task and come back
- **server:** Used one-time tokens are deleted, and expired ones pruned daily
- **oidc:** A role from ROLE_MAP lapses unless a sign-in renews it
- **web:** Pecky the bird and "All pecked out." replace the old punch wording
- **oidc:** A link to a provider no longer set up is no way in, and each start says so
- **server:** An older server on a newer database stops with one line
- **web:** Copy buttons work on plain http, else select the text
- **server:** Limits on lookups, friend codes, one-time tokens and live streams
- **server:** Notification pushes and provider pictures no longer hold up requests
- **sharing:** A group whose owner left waits for open invitations
- **notifications:** The server reads @mentions as the app shows them
- **sharing:** Someone taken off a list can no longer change their comments, files or sections on it
- **oidc:** A mapping for an account already linked is refused, and a disabled account is not linked
- **settings:** One saved setting that does not work leaves out only that one
- **accounts:** Recovery from the shell is audited and refuses deleted accounts, and a restored super admin is told
- **server:** Text with a NUL character no longer stops sync on PostgreSQL
- **notifications:** No reminders worked out for an app on screen, and freed memory given back sooner
- **sync:** Schema check reads numbers set in code, refuses huge ones
- **sharing:** Moving a task to another list needs owner or editor on both
- **backup:** Key-made exports leave out secrets; keys can't restore the server
- **notifications:** Mentions read U+FEFF and letters beyond U+FFFF as the app does
- **sharing:** Undoing a restore puts it back in the Trash at a fresh time
- **web:** A page that could not load says so in the page area
- **web:** A part of the app that could not load is fetched again

### Documentation

- Troubleshooting entry for links that need PUBLIC_URL
- Pages for the Easter eggs and for what the apps count

## [0.10.0-rc.2] - 2026-11-11

### Added

- **api:** Task API v1 with routes, changes feed, quick add and OpenAPI
- **cli:** CLI sign-in by browser approval, client commands and downloads
- **api:** Quick add on the server runs the app's own code

### Fixed

- **sync:** Schema check reads numbers set in code, refuses huge ones
- **sharing:** Moving a task to another list needs owner or editor on both
- **backup:** Key-made exports leave out secrets; keys can't restore the server
- **notifications:** Mentions read U+FEFF and letters beyond U+FFFF as the app does
- **sharing:** Undoing a restore puts it back in the Trash at a fresh time
- **web:** A page that could not load says so in the page area
- **web:** A part of the app that could not load is fetched again

## [0.10.0-rc.1] - 2026-11-11

### Breaking changes

- **settings:** Apps and server reminders use the device's time zone unless TZ is set. Apps, and the reminders the server sends, now use the zone of the device each person is on, unless TZ is set on the server or the person picked a zone under Settings. A server with TZ set behaves as before. An existing install that copied TZ=Etc/UTC from an old example stays on UTC until its owner removes that line.
- **oidc:** LINK_BY_USERNAME matches the username exactly, as mappings do. With OIDC_<NAME>_LINK_BY_USERNAME on, a first sign-in joins an existing account only when the provider's username is that account's name exactly, ignoring only case and spaces around it. A provider that sends an email address, or a name that differs in other ways, no longer joins an account by itself: add a USER_MAP entry for it, or have the person link the provider from their account. People already linked are not affected.
- **links:** Make links from PUBLIC_URL, or from the request only on a home network. A server reached at a public name without PUBLIC_URL no longer makes login links or invites, and its friend codes come without a link, until PUBLIC_URL is set to its address. Servers with PUBLIC_URL, and ones reached at localhost or a home-network name or address, are not affected.
- **oidc:** A migration window matches the username exactly, as LINK_BY_USERNAME does. During a migration window, a first sign-in through the new provider joins an existing account only when the provider's username is that account's name exactly, ignoring only case and spaces around it. A provider that sends an email address, or a name that differs in other ways, no longer joins an account by itself: add a USER_MAP entry for each person, or have each person link the new provider from their account before the move.
- **oidc:** A role from ROLE_MAP lapses unless a sign-in renews it. An admin or super admin role that came from ROLE_MAP now drops to user after ROLE_MAP_RENEW_DAYS (14) without a sign-in through that provider, and their API keys lose it too. This includes, from the first start after the upgrade, a role set by hand on an account linked to such a provider. Anyone who should keep a role without signing in there (an automation account, for example) needs it set by hand with `pecklist admin set-role <name> <role>`, which keeps the role they already have, or set ROLE_MAP_RENEW_DAYS=0 to keep the old behaviour. A role set by hand is leased again if they later sign in through a provider whose ROLE_MAP sets it.

### Added

- **admin:** Admin > Users shows when a leased role lapses

### Fixed

- **logging:** A log output's count changes after its health, and steady four tests
- **oidc:** Say why Unbind all was refused
- **sharing:** Ending a friendship ends every live row between the two
- **settings:** Apps and server reminders use the device's time zone unless TZ is set
- **reminders:** Handle every clock change and isolate failures
- **oidc:** LINK_BY_USERNAME matches the username exactly, as mappings do
- **auth:** Sign-in limits and locks say how long to wait
- **web:** Friend links and admin links on a server without PUBLIC_URL
- **links:** Make links from PUBLIC_URL, or from the request only on a home network
- **oidc:** A migration window matches the username exactly, as LINK_BY_USERNAME does
- **oidc:** Match usernames with only plain spaces trimmed, and leave no stray account
- **auth:** Refuse changes another site sends, and confirm sign-in links with a button
- **links:** Count Tailscale and NetBird names as home-network names
- **reminders:** A snooze from a notification is for the person who pressed it
- **sharing:** Comments and files go to the Trash with their task and come back
- **server:** Used one-time tokens are deleted, and expired ones pruned daily
- **oidc:** A role from ROLE_MAP lapses unless a sign-in renews it
- **web:** Pecky the bird and "All pecked out." replace the old punch wording
- **oidc:** A link to a provider no longer set up is no way in, and each start says so
- **server:** An older server on a newer database stops with one line
- **web:** Copy buttons work on plain http, else select the text
- **server:** Limits on lookups, friend codes, one-time tokens and live streams
- **server:** Notification pushes and provider pictures no longer hold up requests
- **sharing:** A group whose owner left waits for open invitations
- **notifications:** The server reads @mentions as the app shows them
- **sharing:** Someone taken off a list can no longer change their comments, files or sections on it
- **oidc:** A mapping for an account already linked is refused, and a disabled account is not linked
- **settings:** One saved setting that does not work leaves out only that one
- **accounts:** Recovery from the shell is audited and refuses deleted accounts, and a restored super admin is told
- **server:** Text with a NUL character no longer stops sync on PostgreSQL
- **notifications:** No reminders worked out for an app on screen, and freed memory given back sooner

### Documentation

- Troubleshooting entry for links that need PUBLIC_URL
- Pages for the Easter eggs and for what the apps count

## [0.9.0] - 2026-11-08

### Breaking changes

- **accounts:** Cap passwords at 256 characters, and two small audit items. A password longer than 256 characters no longer signs in. Have an admin reset it (pecklist admin reset-password), or use a reset link. An ADMIN_PASSWORD longer than 256 characters now stops the server at startup: shorten it.
- **accounts:** Limit new passwords to 64 characters. New passwords are limited to 64 characters. Existing longer passwords keep working until the next change. An ADMIN_PASSWORD over 64 characters stops a first start on an empty database: shorten it. A server that already has accounts starts as usual, unless an ADMIN_PASSWORD over 256 characters would be used to give the admin a password, or a demo account's password is over 256: shorten those.
- **oidc:** Map accounts by subject, and usernames only for a first claim. A username mapping to an admin account that has no link to that provider yet no longer applies without OIDC_<NAME>_LINK_BY_USERNAME=all, and a new one cannot be saved. Use a sub: entry in OIDC_<NAME>_USER_MAP, or link the account under Admin > Users. A username mapping now matches the exact name the provider sends, ignoring only case and spaces around it: a provider that sends kim@corp.example needs that written in full, or a sub: entry. A username mapping no longer moves someone who is already linked: use a sub: entry or move the link by hand. A USER_MAP username holding = now stops the start. Accounts already linked are not affected.
- **accounts:** Keep a deleted admin gone, and reserve its name. A deleted admin account is no longer made again at a start while another super admin is active. To get back in from a shell, name another account for admin reset-password or admin login-link, or use admin add-user and then admin set-role. Without a shell, a restart no longer recovers this. Sign-up and a provider's first sign-in can no longer take the name admin. If you removed the admin password on an earlier version and have restarted since, check whether it has a password again, and remove it if so. Check Admin > Users for an admin you did not expect.

### Added

- **calendar:** Add a Year view that shades days by how busy they are
- **support:** Add the Support PeckList card and sidebar heart
- **web:** The Year view scrolls on through the years
- **web:** The comments panel comes up with the finger on a phone
- **web:** Lists and tags can go on the phone's bottom bar
- **web:** The bottom bar is picked from the sidebar's own rows

### Fixed

- **trash:** Won't-do tasks count from their real date too
- **web:** Mangled links, the hourly update check, phone Month title
- **accounts:** Cap passwords at 256 characters, and two small audit items
- **oidc:** Record every role a sign-in changes
- **web:** Keep the end date on phones, passkeys off IP hosts, no blank wait
- **accounts:** Limit new passwords to 64 characters
- **oidc:** Map accounts by subject, and usernames only for a first claim
- **ci:** Let the weekly scheduled pipeline be created
- **audit:** Cut text on a character boundary
- A thumbs up from a notification leaves one comment
- **accounts:** Keep an admin without a password that way at a start
- Unfriending offers to remove what you shared with them
- Quick add counts today from the person's time zone
- **oidc:** Refuse to remove a provider that still has accounts linked
- **android:** A notification press does not act again after a restart
- **sharing:** Use the live friendship when an ended one also exists
- **sharing:** Keep an ended friendship ended
- **web:** Leaving a page Firefox keeps no longer stops all saving
- **web:** A failed fetch of a part of the app is tried again
- **web:** The arrows of Month or Days move the Year view along
- **accounts:** Keep a deleted admin gone, and reserve its name
- **web:** The bottom bar never saves more than four tabs
- **oidc:** Unbind all takes a super admin when another admin is linked

### Documentation

- Say the websites record visits, and what session replays show
- Say how work lands in CLAUDE.md
- Describe the project's hosting in general terms only
- Say how to get back in when the admin account is gone

## [0.9.0-rc.1] - 2026-11-08

### Breaking changes

- **accounts:** Cap passwords at 256 characters, and two small audit items. A password longer than 256 characters no longer signs in. Have an admin reset it (pecklist admin reset-password), or use a reset link. An ADMIN_PASSWORD longer than 256 characters now stops the server at startup: shorten it.
- **accounts:** Limit new passwords to 64 characters. New passwords are limited to 64 characters. Existing longer passwords keep working until the next change. An ADMIN_PASSWORD over 64 characters stops a first start on an empty database: shorten it. A server that already has accounts starts as usual, unless an ADMIN_PASSWORD over 256 characters would be used to give the admin a password, or a demo account's password is over 256: shorten those.
- **oidc:** Map accounts by subject, and usernames only for a first claim. A username mapping to an admin account that has no link to that provider yet no longer applies without OIDC_<NAME>_LINK_BY_USERNAME=all, and a new one cannot be saved. Use a sub: entry in OIDC_<NAME>_USER_MAP, or link the account under Admin > Users. A username mapping now matches the exact name the provider sends, ignoring only case and spaces around it: a provider that sends kim@corp.example needs that written in full, or a sub: entry. A username mapping no longer moves someone who is already linked: use a sub: entry or move the link by hand. A USER_MAP username holding = now stops the start. Accounts already linked are not affected.
- **accounts:** Keep a deleted admin gone, and reserve its name. A deleted admin account is no longer made again at a start while another super admin is active. To get back in from a shell, name another account for admin reset-password or admin login-link, or use admin add-user and then admin set-role. Without a shell, a restart no longer recovers this. Sign-up and a provider's first sign-in can no longer take the name admin. If you removed the admin password on an earlier version and have restarted since, check whether it has a password again, and remove it if so. Check Admin > Users for an admin you did not expect.

### Added

- **calendar:** Add a Year view that shades days by how busy they are
- **support:** Add the Support PeckList card and sidebar heart
- **web:** The Year view scrolls on through the years
- **web:** The comments panel comes up with the finger on a phone
- **web:** Lists and tags can go on the phone's bottom bar
- **web:** The bottom bar is picked from the sidebar's own rows

### Fixed

- **trash:** Won't-do tasks count from their real date too
- **web:** Mangled links, the hourly update check, phone Month title
- **accounts:** Cap passwords at 256 characters, and two small audit items
- **oidc:** Record every role a sign-in changes
- **web:** Keep the end date on phones, passkeys off IP hosts, no blank wait
- **accounts:** Limit new passwords to 64 characters
- **oidc:** Map accounts by subject, and usernames only for a first claim
- **ci:** Let the weekly scheduled pipeline be created
- **audit:** Cut text on a character boundary
- A thumbs up from a notification leaves one comment
- **accounts:** Keep an admin without a password that way at a start
- Unfriending offers to remove what you shared with them
- Quick add counts today from the person's time zone
- **oidc:** Refuse to remove a provider that still has accounts linked
- **android:** A notification press does not act again after a restart
- **sharing:** Use the live friendship when an ended one also exists
- **sharing:** Keep an ended friendship ended
- **web:** Leaving a page Firefox keeps no longer stops all saving
- **web:** A failed fetch of a part of the app is tried again
- **web:** The arrows of Month or Days move the Year view along
- **accounts:** Keep a deleted admin gone, and reserve its name
- **web:** The bottom bar never saves more than four tabs
- **oidc:** Unbind all takes a super admin when another admin is linked

### Documentation

- Say the websites record visits, and what session replays show
- Say how work lands in CLAUDE.md
- Describe the project's hosting in general terms only
- Say how to get back in when the admin account is gone

## [0.8.0] - 2026-11-06

### Added

- **release:** Every download says its version

### Fixed

- **ci:** Pre-releases list newest first and never become the latest
- **trash:** The clean-up waits for a sync, and the menu shows the icon

## [0.8.0-rc.2] - 2026-11-06

### Added

- **settings:** Lay Settings out by subject
- **admin:** Lay Admin out by subject, each setting on the page about it
- **api-keys:** Revoked keys clear out after 7 days
- **trash:** Pick how long deleted and won't-do tasks stay
- **brand:** The wireframe bird icon, and PeckList Forest as the default colors
- **release:** An image tag for each pre-release type
- **trash:** Group the Trash by the day things were deleted
- **trash:** Completed tasks follow Clean up after

### Fixed

- **admin:** Name every server setting and its choices in plain words
- **android:** The check-in backs off, keeps unsynced reminders, quotes its page
- **android:** Ask natively before a page moves the app, and per-server trust
- **trash:** A purge erases comments, files, tag names and task details
- **ci:** A pre-release does not become the latest release
- **order:** Keys stay short however long a list gets
- **friends:** Handles follow the server's address
- **android:** A test APK says its real version, not 0.1.0
- **web:** A synced device finds its account again after opening offline
- **android:** Reminders are handed over when they change, not at every sync
- **trash:** What others own sits apart, and only its owner erases it

### Documentation

- **ci:** What to do when a pipeline job goes red
- A merge request must be up to date with main
- A Support button in the top bar, and Ko-fi links

## [0.8.0-rc.1] - 2026-11-05

### Breaking changes

- **server:** Trust forwarded headers from loopback and the container's networks. A reverse proxy on another machine, not on a network the container is on, is no longer trusted by default. Set TRUSTED_PROXIES to its address, or every request seems to come from the proxy.

### Added

- **backups:** Compressed snapshots and batched access-log writes
- **accounts:** Password reset links by email, with mail provider presets
- **accounts:** Native passkeys, with no identity provider in between
- **telemetry:** The apps usage counts, crash reports and Android capture
- **admin:** Grey out what a picked mail provider fills in
- **telemetry:** Report schema 3 with the machine, sizes, rows and country
- **calendar:** Weekday names on the month, and Unscheduled shown on asking
- **attachments:** A daily upload allowance per person

### Fixed

- **e2e:** Match the sign-in username field by word
- **tests:** Test servers never send reports to the real collector
- **admin:** The test email saves the email settings typed first
- **auth:** Secure cookie, a 90-day session cap, keys locked with CONFIG_KEY
- **web:** Push links stay on the server, and the zip reader checks its archive
- **sync:** Check pushed entities against the workspace schema and a size cap
- **web:** Keep asking a server that did not answer at the first load
- **server:** Trust forwarded headers from loopback and the container's networks
- **sync:** A device from before a restore writes nothing over the restored data
- **server:** Refuse to start on a database a newer version upgraded

## [0.7.0] - 2026-11-04

### Breaking changes

- **server:** /api/info no longer answers the old name to Punchlist apps. The Punchlist Android app (0.5.0 and older) no longer connects. Install the PeckList app, sign in, then remove Punchlist; let Punchlist sync any offline changes before upgrading the server.

### Added

- **server:** Optional visit counts with Umami
- **docs:** Docusaurus instead of MkDocs, with versions

### Fixed

- **demo:** The demo accounts say which is the username and the password
- **server:** /api/info no longer answers the old name to Punchlist apps

### Documentation

- Count visits to docs.pecklist.com with Umami
- The vault's PeckList folder in CLAUDE.md

## [0.6.0] - 2026-11-03

### Added

- **demo:** Reset on any schedule, hourly or nightly
- **mail:** The server sends email over SMTP, with a test button
- **ci:** Each release goes to the public demo
- **auth:** A Google sign-in preset with Google's own button
- **telemetry:** Totals private, reports to telemetry.pecklist.com
- The app is called PeckList
- **android:** The app is com.killswitch10.pecklist
- **server:** Pecklist everywhere the server names itself
- **web:** The web app keeps its things under pecklist

### Fixed

- **calendar:** Days gone by show what was done on them
- **server:** Apps from before the rename still connect

### Documentation

- The docs live at pecklist.com/docs

### Changed

- **server:** The .NET code is PeckList.*

## [0.5.0] - 2026-11-02

### Added

- **notes:** Every line a checkbox, and checkboxes back to lines
- **android:** Manage notification sounds and vibration on the phone
- **android:** Tasks made without a server go along when connecting
- **android:** Reminder buttons complete without opening the app
- **web:** The bird checks tasks off
- **web:** Drag a heading with its section in the notes

### Fixed

- **views:** Pinned tasks with no date show in Pinned on Today and Upcoming
- **notes:** Bigger checklist boxes, a toolbar that stays on top, its own icon for every line
- **ci:** A commit hash of digits only still makes a valid build version
- **day:** The day page rows no longer repeat its date
- **tasks:** A title typed on a phone is kept when the panel closes
- **web:** Repeating tasks show on their dates to come
- **web:** A checklist with a title goes back to lines
- **web:** Repeating tasks ask just this date or every date
- **web:** A repeating task's dates to come can be ticked and swiped

## [0.4.0] - 2026-10-31

### Added

- Demo server mode (DEMO_MODE) and a sign-up limit per address
- **api:** An OpenAPI document and a Swagger UI page for the HTTP API

### Fixed

- **sharing:** The server sets author and owner, and shares only with people you know
- **import:** Fixtures, schema check, dedupe and Todoist repeats
- **admin:** Viewing as someone only looks, never writes
- **accounts:** Removing an account hands its shared lists and groups on
- **server:** Provider pictures, file checks and migration joins stay inside their bounds
- **notes:** Links in notes are web and mail addresses only
- **admin:** The admin pages fit a phone and scroll where they must
- **sync:** Signing out clears the device
- **sync:** A first sign-in asks before the device's own tasks join the account
- **tasks:** A swipe in a picker over the details no longer opens the comments

### Performance

- **sharing:** A write looks only at what depends on it
- **sync:** A feed page ends at about 4 MB of JSON
- **server:** Listen while the sharing index loads
- **sharing:** The index keeps only the fields it reads
- **sharing:** Load the index in seconds and give the memory back
- **sharing:** Tasks and the rest are kept as plain fields

### Documentation

- Pages for 1.0 (why, comparison, imports, Android, help)
- **import:** The guide as imports work since !112

## [0.3.0] - 2026-10-30

### Added

- **telemetry:** The collector for servers' daily usage reports
- **telemetry:** The server sends an anonymous usage report once a day
- **telemetry:** Public routes under /api/public, password from a file
- **android:** A share link lets the app through a Pangolin gate
- **telemetry:** A public status page, and the bare address leads to it
- **notifications:** Channels per kind, vibration, insistent constant reminders, and switches

### Fixed

- **release:** Features make a minor release, fixes a patch
- **tasks:** Say a task is being looked for until the first sync
- **auth:** Log which cookies the app gate hands back

## [0.2.10] - 2026-10-30

### Added

- **notifications:** A button on every notice, and news while the app is open
- Hide the Closed group (long press on its header, or Settings)

### Fixed

- **renovate:** Base images keep floating, no pins to exact tags
- **sync:** Time requests out, and start over when a sync has hung

## [0.2.9] - 2026-10-29

### Added

- API keys, mutual TLS in the Android app, timeline and date fixes

### Fixed

- Undo on a mouse click; the empty check plays once per arrival
- **fun:** Today's fireworks only on Today, once a day on arrival or when its last task is done there
- **interchange:** TickTick all-day spans end on their last day, not the day after
- **interchange:** TickTick export writes repeats and checklists as TickTick does
- Keep the Node and pnpm ranges Renovate pinned
- **release:** The tag check sends GITLAB_TOKEN while the project is private

## [0.2.8] - 2026-10-28

### Added

- Version marks, release notice, edge menu, quicker search, icons

## [0.2.7] - 2026-10-28

### Added

- **fun:** All fifteen Easter eggs, each with its trigger
- **fun:** The dog naps on +, disco is a 2-second flash, typewriter on renames
- **views:** Our logo flips to a check on empty views; Closed shows its count
- Lists and tags settings page, BM25 search, feedback fixes

### Fixed

- **fun:** Search words always set off their egg
- **fun:** The characters say their own line, not the found line again
- **tasks:** A running span is today's, and a new task's title is ready to type
- **tasks:** History as a timeline, dates split, panel as tall as the task

## [0.2.6] - 2026-10-28

### Added

- **lists:** Icon picker with search, 260 icons and 370 emoji
- **theme:** 14 more palettes, the loud and pretty ones washing the page
- **notifications:** Comments, group tasks and dibs, with buttons
- **history:** Each task's history, under its comments
- **fun:** Two hidden surprises

### Fixed

- **calendar:** Hold to move, free scrolling, undo, 1 to 12 weeks
- **app:** + on desktop, full view on phones, Select all, quieter title
- **menu:** Drag by the grip, Search movable, counts beside views
- **search:** Results are the usual task rows
- **lists:** A few search results wrap instead of standing in a column

### Documentation

- The PL-107 round in the tour and the API reference

## [0.2.5] - 2026-10-27

### Added

- **calendar:** The plain circle for going to today (R-FB-87)
- **tasks:** A light outline on the subtask or notes item under the mouse
- **tasks:** The title wraps; Pin is in the ... menu only
- **reminders:** Days early at any time for timed tasks; one list in Settings
- **icon:** The checklist in purple and grey (R-FB-84)

### Fixed

- **tasks:** A blank task opened in the full form stays out of the lists
- **sync:** Quick saves, and half an emoji no longer stalls the sync
- **store:** A tab no longer reloads its own save
- **storage:** Take in what a tab of an older version saves
- **layout:** The page column scrolls, not the window, on wider screens
- **settings:** New-task reminder and times as on a task

### Performance

- **web:** Make each date formatter once
- **views:** The local day of a closed task is worked out once
- **sync:** Take in a server answer by what changed
- **storage:** Keep the workspace one IndexedDB record per entity
- **views:** Long closed lists draw as they scroll near
- **calendar:** One set of styles for the day cells and task lines
- **web:** Pages split off the first load, fetched ahead when idle
- **sync:** Take a run of data-only pages in together
- **server:** Bigger sync pages, brotli that packs smaller than gzip

### Documentation

- **development:** Coding standards page
- How the app stays quick with thousands of tasks
- **standards:** Point the performance habits at how the app stays quick

### Changed

- **server:** One copy of the helpers endpoints had copied from each other
- **server:** One shape for server-made entities and background jobs
- **web:** Shared pieces for what the pages had copied from each other
- The last two copies, in the notification store and the sign-in forms

### revert

- **layout:** The window scrolls again on every screen

## [0.2.4] - 2026-10-26

### Fixed

- **mobile:** Leave the web build's .gz and .br copies out of the APK

## [0.2.3] - 2026-10-26

### Added

- **server:** Send security headers and compressed answers itself
- **mobile:** Snooze picker, pull to sync, and servers behind a sign-in page
- **tasks:** Pin subtasks too
- **settings:** Swipe right shows Complete and Pin; calendar length 1 hour
- **sidebar:** The mini calendar always starts folded to this week
- **tasks:** The + button opens the new task screen
- **reminders:** Choose the time all-day reminders come at (schema 16)
- **profile:** The version at the bottom of the profile menu
- **calendar:** A header like Upcoming's, with a date picker on the title
- **calendar:** Outline the day a dragged task will land on
- **tasks:** Drag subtasks to reorder them in task details
- **notes:** A handle on each list item in the notes to move it

### Fixed

- **web:** Compile the workspace validator at build time
- **web:** A sheet opened from the expanded task form shows on top of it
- **tasks:** The Title label in task details is no longer cut off
- **drag:** A task moved within its own day stays where it is put

## [0.2.2] - 2026-10-26

### Breaking changes

- **admin:** An admin can no longer make themselves a super admin. Admins (not super admins) can no longer change sign-in settings or download, export or restore the whole server. Make whoever does those a super admin: punchlist admin set-role <user> superadmin.

### Added

- **server:** Provider sign-in handoff for the Android app
- Android app shell (Capacitor) with server connect
- **mobile:** Back button, offline start page, icon and launch screen
- **mobile:** Reminders as Android notifications
- **mobile:** Link a provider account from Settings through a Chrome tab
- **mobile:** Background check-in for notifications with the app closed
- **mobile:** Complete and Snooze on reminders; status bar, Back, leaving a server

### Fixed

- **admin:** An admin can no longer make themselves a super admin
- **sync:** One bad change no longer stops a device syncing
- **mobile:** Run the Gradle wrapper by full path on Windows
- **mobile:** Sign in inside the app on servers without app sign-in
- **mobile:** Keep an older server's provider sign-in inside the app
- **trash:** Purge only trash in lists I own

### Documentation

- What to set before putting Punchlist on the internet

## [0.2.1] - 2026-10-26

### Breaking changes

- **auth:** LOCAL_LOGIN=disabled turns password sign-in off everywhere. LOCAL_LOGIN takes enabled or disabled. shown and hidden still work, but hidden now means disabled: the API refuses passwords and password sessions end, and /login?local no longer shows the form. Use `punchlist admin login-link <user>` to get an admin in.

### Fixed

- **auth:** LOCAL_LOGIN=disabled turns password sign-in off everywhere

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


