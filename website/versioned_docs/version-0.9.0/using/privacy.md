# Privacy and telemetry

Your tasks stay on your server. PeckList makes two kinds of request to the internet on its own,
both from the server (never from people's browsers or phones), and both can be turned off:

- **The update check** ([`UPDATE_CHECK`](../configuration/reference.md#update_check)): twice a
  day the server reads the latest release from GitLab.
- **The daily usage report** ([`TELEMETRY`](../configuration/reference.md#telemetry)): once a
  day the server sends an anonymous report to the project, so we know which versions, databases
  and setups are in use and what to keep working. It is on by default.

Visit counts are different: they are off unless you set up [`UMAMI_URL`](../configuration/reference.md#umami_url),
and then people's browsers report page views to **your** Umami server, not to the project. If
you turn it on, say so to the people who use your server. With
[`UMAMI_RECORDER`](../configuration/reference.md#umami_recorder) it also records sessions, and
those replays show what is on screen, people's task titles included.

## These websites

The websites are not the app you run, and they do record visits. pecklist.com,
selfhosted.pecklist.com, docs.pecklist.com and demo.pecklist.com use
[Umami](https://umami.is/), run by the project at `stats.pecklist.com`, with no third-party
analytics:

- **Page views**, with no cookies. Your IP address is not kept: Umami hashes it with a salt that
  changes, for counting unique visitors, and reads your country from it.
- **Session replays**: the pages you see, your clicks and your scrolling, recorded so the project
  can see where people get stuck. Form fields are hidden, but other text on the page is recorded.
  **On the demo, that includes tasks you add once they show on screen**, so keep real details out
  of it.

Cloudflare sits in front of these sites, and the [support page](https://pecklist.com/support/)
loads Ko-fi's tip panel. None of this applies to a server you run yourself unless you set it up.

## The update check

So the app can tell you when a new release is out, the server reads PeckList's latest release
from GitLab: a minute after it starts, then every 12 hours.

- **What it asks**: one `GET` of
  `https://gitlab.com/api/v4/projects/killswitch10%2Fpecklist/releases/permalink/latest`,
  with no token, no cookie and no install id. GitLab sees what any web request shows: your
  server's public IP address and a `User-Agent` of `PeckList/<version>`.
- **What it does with the answer**: keeps the newest version, its date and its release page in
  memory, and shows the notice in the app when it is newer than the server or someone's Android
  app. People's browsers and phones only ever ask your server, never GitLab.
- **Turning it off**: `UPDATE_CHECK=false` in the environment or the settings file, or the
  **Look for new releases** switch in **Admin > General**. It takes effect at once: the server
  makes no more requests, forgets what it found, and the app shows no notice. Watch for releases
  another way then (the GitLab release feed, Diun, Renovate).

## What the usage report holds

Everything in it is a range or a switch. An admin can see the report exactly as it would go in
**Admin > General > Telemetry > See what's sent**.

| Part    | Fields                                                                                                                                                               |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install | A random install id (made on the server's first start; an admin can make a new one), the version, its channel (release, pre-release, edge, dev), days since install |
| Runtime | Operating system family (linux, windows, macos), CPU architecture, whether it runs in a container, the .NET version, SQLite or PostgreSQL, database size range      |
| Setup   | Password sign-in on or off, no-auth mode, how many identity providers and whether each is a preset (Google) or another, the registration mode, the backup schedule, the update check on or off, API keys in use (a range), any push subscriptions, email off or on and the mail provider preset's name (Gmail, SendGrid, ...; "custom" for any other server), passkeys on or off, whether `PUBLIC_URL` is HTTPS, whether `TRUSTED_PROXIES` is set, which log outputs are on (file, OTLP, Loki, GELF, Elasticsearch, syslog), crash reports on or off, demo mode |
| Scale   | Ranges of people, lists, shared lists, open tasks, closed tasks and stored data                                                                                     |
| Machine | Processor count, the memory the server may use (a container's limit when it has one) and the memory it uses, its average processor use since it started, how long it has run, the kernel's version (major.minor, such as 6.12), the container runtime (Docker, Podman, Kubernetes), and the time zone setting (such as `Europe/Berlin`). All ranges but the last three |
| Storage | Size ranges of the database, attachments, snapshots and log files, and of the free space where the data lives |
| Rows    | A range for each kind of record: synced records by collection (tasks, lists, tags, comments, ...) and the server's own tables (accounts, passkeys, notifications, the event log, ...) |
| Apps    | From the people who share (see below), added up on the server: how many people and devices, devices by kind (browser tab, installed app or Android app; browser and system family; phone, tablet or desktop; light or dark; the language's two letters), how often each view and feature on a fixed list was used, errors by fingerprint, and the median time to start, sync and search. All ranges |

Ranges are 0, 1, 2-5, 6-20, 21-100, 101-500, 501-2000 and more; sizes are under 1 MB, 1-10 MB,
10-100 MB, 100 MB-1 GB, 1-10 GB and more.

### What the apps count

The web app and the Android app count a fixed list of things and send the counts to **your
server**, never anywhere else; the server adds them into its next daily report. The list: each
view opened (Today, Inbox, Upcoming, Due dates, All, Calendar, a day, Search, Completed, Trash, a
list, a tag, a saved filter, Assigned, Shared, Friends, Notifications, Stats, Settings), tasks
added and completed, which quick-add words were used (a date, a tag, a list, a priority), drag to
reschedule, undo, keyboard shortcuts, swipes and the easter eggs. The Android app adds how late
each reminder showed against when it was due (on time, under a minute, under five minutes, later)
and whether the three things reminders need are allowed (notifications, exact alarms, no battery
limits), as on or off. Each device also says which version of the web app it runs, and the
Android app its own version, so the report shows how many devices run each. An **error fingerprint** is a
short hash of the error's kind and the place in the app's code it came from: never its message,
and never your server's address. A device sends its counts at most every six hours, with a random
device id that stays on your server (only the number of devices goes on).

Nothing is counted on a server that sends no report, or for someone who turned **Settings > Your data > Usage
stats > Share anonymous usage stats** off: that one switch covers all their devices, and the server
drops counts that arrive anyway.

### Crash reports

When the app hits an error it cannot get past, it shows **Something went wrong** with a **Reload**
button and, on a server that takes them, offers to send a **crash report** to the project. You see
the report in full first (**See what it holds**) and choose: **Send** (this one), **Don't send**,
**Always send** (this one and later ones, without asking) or **Never send** (no reports, and it
turns your usage sharing off too). In the Android app, a crash or a freeze (the "app isn't
responding" kind) is noticed by the app itself and offered the same way, as **PeckList closed
unexpectedly**, the next time you open it. The same choice is under **Settings > Your data > Usage stats > Crash
reports**, for all your devices.

A report holds the app's version and channel, the device's kind (as above), the error's kind, its
fingerprint and the stack: where in the app's code it broke, with every web address, query,
email and long id taken out, on your device and again on the server. It goes through your server,
which adds its random install id; if the project's collector cannot be reached, the server keeps
the report and tries again within the hour.

The server's own unhandled errors are kept for its admins in **Admin > General > Telemetry**,
with the last 50 warnings of its log (redacted as every log line is), and go to the project only
when an admin sends one. [`CRASH_REPORTS=false`](../configuration/reference.md#crash_reports)
turns crash reports off for everyone: nothing is offered, kept or sent.

## What it never holds

Task, list or tag names, notes, comments, attachments, people's names, usernames or emails, the
server's address or name, identity provider addresses, or any id but the random install id. The
collector does not read or keep the sender's IP address. It keeps the **country** the report came
from, which Cloudflare (in front of the collector) works out and passes on as two letters; the
address it was worked out from never reaches the collector.

## Turning it off

- For the whole server: `TELEMETRY=false`, or `DO_NOT_TRACK=1`, or the switch in **Admin >
  General > Telemetry**. Nothing is sent from then on, and the apps stop counting.
- For yourself: **Settings > Your data > Usage stats**. Your devices stop counting and your counts are left
  out of the server's report.
- The report goes to [`TELEMETRY_URL`](../configuration/reference.md#telemetry_url); point it at
  your own collector if you run one.

## What the project does with it

The reports are kept 90 days; totals per day are kept after that. Only the project sees them: the
collector takes reports from the internet and shows its totals on the project's own network, nowhere
else. The collector's code is in the repository
([telemetry collector](../development/telemetry-collector.md)).
