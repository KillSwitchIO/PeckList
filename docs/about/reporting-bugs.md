# Reporting a bug

A good report gets fixed quickly. This page is also the text of the pinned
"How to report a bug" issue on GitLab.

## Before you report

1. **Update.** Only the latest release is supported, and your bug may be fixed already: check
   the [changelog](https://gitlab.com/killswitch10/pecklist/-/blob/main/CHANGELOG.md).
2. **Search** the [open issues](https://gitlab.com/killswitch10/pecklist/-/issues). If yours is
   there, add what you know to it (and a thumbs-up) rather than opening another.
3. **Security problem?** Do not open a public issue. Follow the
   [security policy](https://gitlab.com/killswitch10/pecklist/-/blob/main/SECURITY.md).

## What to include

Open a [new issue with the Bug template](https://gitlab.com/killswitch10/pecklist/-/issues/new?issuable_template=Bug)
and fill in:

- **What happened**: what you did, what you expected, and what happened instead. A screenshot or a
  short screen recording helps a lot.
- **Steps to reproduce**: the shortest list of steps that makes it happen again, starting from
  something anyone can do ("open a list, add a task with a due date, ...").
- **Versions**: the server's (`pecklist --version`, the version label in the sidebar, or `/api/info`), and
  the Android app's if it is involved.
- **How you run it**: Docker, Compose, Linux, Windows or from source; SQLite or PostgreSQL; the
  reverse proxy in front, if any; single sign-on and which provider, if it is about signing in.
- **Where**: the browser and device, or the Android app and phone model.
- **A debug dump**: **Admin > Logs > Download debug dump**, or `pecklist debug-dump`. It carries
  logs, settings and versions, but no task content, passwords or keys. If you are not the admin,
  ask yours for one, or paste the error from the browser's console.

## What not to include

- Passwords, API keys, client secrets, session cookies, or the contents of a backup or snapshot
  (those hold everyone's data and password hashes).
- Other people's tasks or names. If a bug needs data to show, make a small example list, or edit
  the private parts out of an export.

## After you report

You may be asked for more detail or to try a build with a fix; please answer, since a report with
no follow-up usually cannot be fixed. Issues are labelled as they are read: `bug` once confirmed,
`good first issue` and `help wanted` when someone new could take it on.

## The pinned issue

The project keeps an issue pinned on GitLab with this text, so people find it before they report.
Its body, for maintainers to paste:

```markdown
**Before you report:** update to the latest release, search the open issues, and send security
problems privately (see SECURITY.md), never here.

**Open a new issue with the Bug template** and include:

- what you did, what you expected, what happened (a screenshot helps)
- the steps to make it happen again
- the server version (`pecklist --version` or `/api/info`), and the Android app's if involved
- how you run it: Docker, Compose, Linux, Windows or source; SQLite or PostgreSQL; the proxy;
  the SSO provider if it is about signing in
- the browser and device, or the phone model
- a debug dump (Admin > Logs > Download debug dump, or `pecklist debug-dump`): it holds no task
  content, passwords or keys

**Never include** passwords, API keys, client secrets, cookies, backups or other people's data.

The full guide: https://docs.pecklist.com/about/reporting-bugs/

This issue is locked; open a new one for your report.
```
