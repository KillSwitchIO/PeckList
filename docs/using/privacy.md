# Privacy and telemetry

Your tasks stay on your server. Punchlist makes two kinds of request to the internet on its own,
both from the server (never from people's browsers or phones), and both can be turned off:

- **The update check** ([`UPDATE_CHECK`](../configuration/reference.md#update_check)): twice a
  day the server reads the latest release from GitLab.
- **The daily usage report** ([`TELEMETRY`](../configuration/reference.md#telemetry)): once a
  day the server sends an anonymous report to the project, so we know which versions, databases
  and setups are in use and what to keep working. It is on by default.

## The update check

So the app can tell you when a new release is out, the server reads Punchlist's latest release
from GitLab: a minute after it starts, then every 12 hours.

- **What it asks**: one `GET` of
  `https://gitlab.com/api/v4/projects/killswitch10%2Fpunchlist/releases/permalink/latest`,
  with no token, no cookie and no install id. GitLab sees what any web request shows: your
  server's public IP address and a `User-Agent` of `Punchlist/<version>`.
- **What it does with the answer**: keeps the newest version, its date and its release page in
  memory, and shows the notice in the app when it is newer than the server or someone's Android
  app. People's browsers and phones only ever ask your server, never GitLab.
- **Turning it off**: `UPDATE_CHECK=false` in the environment or the settings file, or the
  **Look for new releases** switch in **Admin > Settings > General**. It takes effect at once: the server
  makes no more requests, forgets what it found, and the app shows no notice. Watch for releases
  another way then (the GitLab release feed, Diun, Renovate).

## What the usage report holds

Everything in it is a range or a switch. An admin can see the report exactly as it would go in
**Admin > Settings > Telemetry > See what's sent**.

| Part    | Fields                                                                                                                                                               |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install | A random install id (made on the server's first start; an admin can make a new one), the version, its channel (release, pre-release, edge, dev), days since install |
| Runtime | Operating system family (linux, windows, macos), CPU architecture, whether it runs in a container, the .NET version, SQLite or PostgreSQL, database size range      |
| Setup   | Password sign-in on or off, no-auth mode, how many identity providers, the registration mode, the backup schedule, the update check on or off, API keys in use (a range), any push subscriptions |
| Scale   | Ranges of people, lists, shared lists, open tasks, closed tasks and stored data                                                                                     |

Ranges are 0, 1, 2-5, 6-20, 21-100, 101-500, 501-2000 and more; sizes are under 1 MB, 1-10 MB,
10-100 MB, 100 MB-1 GB, 1-10 GB and more.

## What it never holds

Task, list or tag names, notes, comments, attachments, people's names, usernames or emails, the
server's address or name, identity provider addresses, or any id but the random install id. The
collector does not read or keep the sender's IP address.

## Turning it off

- For the whole server: `TELEMETRY=false`, or `DO_NOT_TRACK=1`, or the switch in **Admin >
  Settings > Telemetry**. Nothing is sent from then on.
- The report goes to [`TELEMETRY_URL`](../configuration/reference.md#telemetry_url); point it at
  your own collector if you run one.

## What the project does with it

The reports are kept 90 days; totals per day are kept after that. The totals are public, with any
value fewer than five installs share left out. The collector's code is in the repository
([telemetry collector](../development/telemetry-collector.md)).
