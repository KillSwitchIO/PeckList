# Security

## What Punchlist does for you

- **Passwords** are hashed (ASP.NET Core Identity's PBKDF2). Five wrong attempts lock an account for
  15 minutes; each address gets ten attempts a minute.
- **Sessions** are HttpOnly, SameSite cookies, signed with keys kept in the database. Changing a
  password, turning an account off or deleting it ends its sessions at once.
- **Single sign-on** always uses PKCE, checks required groups at every sign-in, and never takes over
  an existing account by username alone.
- **Logs** never contain passwords, cookies, tokens, secrets or task content; the first admin
  password goes to the console only.
- **Admin actions** are recorded in the [event log](logging.md#access-and-event-log), including
  everything done while viewing the app as someone else.
- **The image** is a chiseled base with no shell or package manager, running as a non-root user.
- **Secrets** can come from files (`NAME_FILE`) or be [encrypted](../configuration/index.md#encrypted-values).

## Checklist

- [ ] **HTTPS** in front, with [`PUBLIC_URL`](../configuration/reference.md#public_url) set to the
      `https://` address. Never put the plain HTTP port on the internet.
- [ ] **Change the first admin password** (the server insists), and do not use the `admin` account
      every day: give yourself a normal account and keep `admin` for administration.
- [ ] **Trust only your proxy**: set [`TRUSTED_PROXIES`](../install/reverse-proxy.md#trusted-proxies)
      to its address if anything but your proxy can reach Punchlist from a private range.
- [ ] **Single sign-on**: use `REQUIRED_GROUPS`, leave `AUTO_CREATE` off unless the provider only
      has people you trust, and keep `LINK_BY_EMAIL` off unless the provider verifies emails.
- [ ] **Backups are sensitive**: snapshots and exports hold password hashes and session keys.
      Keep them as private as the database, and encrypt off-site copies.
- [ ] **Keep up to date**: only the latest release gets fixes. Watch the
      [releases](https://gitlab.com/killswitch10/punchlist/-/releases).
- [ ] **Not on the internet?** Even better: reach it over a VPN (WireGuard, Tailscale, NetBird).
- [ ] `AUTH_MODE=none` only on a network where everyone may see and change everything.

## Reporting a vulnerability

Please do not open a public issue. See
[SECURITY.md](https://gitlab.com/killswitch10/punchlist/-/blob/main/SECURITY.md) for how to report
privately and what to expect.
