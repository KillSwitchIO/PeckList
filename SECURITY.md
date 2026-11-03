# Security policy

## Supported versions

Only the latest release gets security fixes. Fixes ship as a new release; there are no backports.

## Reporting a vulnerability

Please **do not** open a public issue. Open a
[confidential issue](https://gitlab.com/killswitch10/punchlist/-/issues/new?issue[confidential]=true)
instead (tick **This issue is confidential**), with:

- what an attacker can do, and what they need first (an account, network access, ...),
- how to reproduce it, with the PeckList version (`punchlist --version`),
- a debug dump if it helps (it holds no task content, passwords or keys).

Reports are answered as soon as possible. Once a fix is released, the changelog credits you unless
you ask otherwise.

## Scope

In scope: the server, the web app, the image, and the install scripts in this repository. Out of
scope: problems that need an admin account to exploit (admins are trusted by design), and
`AUTH_MODE=none`, which by definition lets everyone in.
