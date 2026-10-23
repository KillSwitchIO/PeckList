# First start

## The admin account

With the default `AUTH_MODE=local`, the first start makes one account, `admin`, the server's
**super admin**, and prints its generated password once:

| Running as      | Where the password appears                              |
| --------------- | ------------------------------------------------------- |
| Docker          | `docker logs <container>`                               |
| Linux service   | `journalctl -u punchlist`                               |
| Windows service | The install script prints it (a service has no console) |

It goes to the console only, never to log files or a log server. Sign in and change it: until
you do, the server refuses everything else. To choose it yourself instead, set `ADMIN_PASSWORD`
(12 characters or more) or `ADMIN_PASSWORD_FILE` before the first start. Lost it later?

```bash
docker exec <container> punchlist admin reset-password
```

prints a new one that must be changed at the next sign-in.

## The setup

After the password change a short setup opens. Every step is saved as you go, so **Not now** loses
nothing; **Admin** offers to finish it until you do or dismiss it.

1. **Public address**: the address people open, prefilled with the one in your browser. Needed for
   single sign-on and for links the server makes. Set it to the HTTPS address once you have one.
2. **Sign-in**: optionally an identity provider. The step shows the callback address to register
   with the provider. See [single sign-on](../guides/single-sign-on.md).
3. **Who can join**: saved for self sign-up (not built yet; today an admin adds accounts, or single
   sign-on creates them).

Anything the environment or the [settings file](../configuration/config-file.md) already sets shows
as it is and is skipped. Some choices apply after a restart, which the last step offers.

## Without logins

`AUTH_MODE=none` skips accounts entirely: everyone who can reach the server is the one owner, with
full access to everything. Use it only on a trusted network or behind a proxy that does its own
authentication.

## What next

- [Add people and set roles](../guides/users-and-roles.md)
- [Turn on single sign-on](../guides/single-sign-on.md)
- [Check the backup schedule](../guides/backups.md)
- [Tour the app](../using/index.md)
