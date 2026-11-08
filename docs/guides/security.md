# Security

## What PeckList does for you

- **Passwords** are hashed (ASP.NET Core Identity's PBKDF2). Five wrong attempts lock an account for
  15 minutes; each address, and each account name, gets ten attempts a minute.
- **Sessions** are HttpOnly, SameSite cookies, signed with keys kept in the database, and always
  `Secure` when `PUBLIC_URL` is https. A session ends after 30 days unused, and 90 days after its
  sign-in however often it is used. Changing a password, turning an account off or deleting it ends
  its sessions at once. A request that changes something is refused when the browser says another
  site sent it (`Sec-Fetch-Site`, or `Origin` from older browsers).
- **Single sign-on** always uses PKCE, checks required groups at every sign-in, and never takes over
  an existing account by username alone. With `LOCAL_LOGIN=disabled` no password works at all.
- **Sign-in settings** (`OIDC_*`, `LOCAL_LOGIN`, `REGISTRATION`, `TRUSTED_PROXIES`, `PUBLIC_URL`) and
  whole-server backups are for super admins only, so an admin cannot widen their own access.
- **Synced data is checked**, not just stored: each record a device sends must match the
  [workspace format](../schema.md) (the same check the apps make) and stay under 256 KB. One that
  does not is set aside on its own; the rest of the sync goes through. The server also decides
  who wrote a record and who it may be shared with, whatever a device claims.
- **Browser protections** come with every answer: a strict Content-Security-Policy (only your
  server's own scripts run), HSTS on HTTPS, no framing by other sites, no content-type guessing and
  a same-origin referrer policy. See [security headers](../install/reverse-proxy.md#security-headers).
- **Logs** never contain passwords, cookies, tokens, secrets or task content; the first admin
  password goes to the console only.
- **Admin actions** are recorded in the [event log](logging.md#access-and-event-log), including
  everything done while viewing the app as someone else.
- **The image** is a chiseled base with no shell or package manager, running as a non-root user.
- **Secrets** can come from files (`NAME_FILE`) or be [encrypted](../configuration/index.md#encrypted-values).

## Should it be on the internet?

It can be: PeckList is built to sit behind HTTPS on a public name. If only you and your household
use it, a VPN (WireGuard, Tailscale, NetBird) in front is still the safer choice: nobody else can
even reach the sign-in page, and every item below matters less. The phone app and the web app work
the same over a VPN.

The rest of this page is for a server people reach over the internet. Each item says whether it is
needed and why.

## Needed

Do these before the server is reachable from the internet.

- [ ] **HTTPS in front, and only the proxy reaches PeckList.** PeckList's own port is plain HTTP:
      passwords and session cookies would cross the internet readable. Put a
      [reverse proxy](../install/reverse-proxy.md) in front and do not publish port `8080` beyond
      it. With Docker Compose, leave `ports:` off the PeckList service.
- [ ] **[`PUBLIC_URL`](../configuration/reference.md#public_url) set to the `https://` address.**
      Invite links, one-time sign-in links and single sign-on callbacks are built from it. Without
      it they are built from whatever host name the request names.
- [ ] **A real password for `admin`, and a normal account for every day.** A generated first
      password must be changed at the first sign-in; one set with
      [`ADMIN_PASSWORD`](../configuration/reference.md#admin_password) is kept as it is, so make it
      long and take it out of the environment after the first start (after that it is read only to
      rescue a server with no super admin). Keep
      `admin` (a super admin) for administration and use a plain account for your tasks, so a
      stolen everyday session cannot change who may sign in.
- [ ] **[`REGISTRATION`](../configuration/reference.md#registration) at `invite` (the default) or
      `closed`.** `open` lets anyone on the internet make an account, and every account can fill
      the disk with attachments. If it must be open, one address makes at most
      [`SIGNUP_RATE_LIMIT`](../configuration/reference.md#signup_rate_limit) accounts an hour
      (5 by default); a public trial belongs on a [demo server](../install/demo.md).
- [ ] **Never `AUTH_MODE=none` on the internet.** It turns sign-in off: everyone who reaches the
      server is its owner. It is only for a proxy that signs people in itself, on a network where
      everyone may see and change everything.
- [ ] **Keep up to date.** Only the latest release gets fixes. Watch the
      [releases](https://gitlab.com/killswitch10/pecklist/-/releases) and read
      [Upgrading](upgrading.md).

## Recommended

Not needed for PeckList to work, but each one closes a real gap for little effort.

- [ ] **[`TRUSTED_PROXIES`](../install/reverse-proxy.md#trusted-proxies) set to the proxy alone.**
      The default believes forwarded headers from every private address, so anything on your LAN,
      VPN or Docker network that can reach port 8080 directly can claim to be any address: in the
      access log, and to get around the per-address sign-in limit. _Not needed_ when nothing but the
      proxy can reach PeckList, as in the Compose example with Caddy.
- [ ] **With single sign-on, [`LOCAL_LOGIN=disabled`](../configuration/reference.md#local_login).**
      Then nobody can guess a password, through the app or straight at the API: there is none to
      guess. Password sessions end at once; provider sessions go on. Keep a way back in for when
      the provider is down: `pecklist admin login-link admin` prints a one-time sign-in link. A
      deleted `admin` stays deleted while another super admin is active, so name an account that
      exists; [Troubleshooting](troubleshooting.md#signing-in) has the other ways back in.
      _Not needed_ when you use passwords only; the attempt limits and lockout above protect
      long passwords well.
- [ ] **Single sign-on settings.** Use `OIDC_<NAME>_REQUIRED_GROUPS` so only the provider's
      PeckList group gets in. Leave `AUTO_CREATE` off unless everyone the provider knows may have
      an account. Turn on `LINK_BY_EMAIL` only if the provider verifies emails, and
      `LINK_BY_USERNAME` only while moving people over, and only if people cannot rename themselves
      at the provider: either would let someone sign into an account that is not theirs. See
      [Single sign-on](single-sign-on.md).
- [ ] **Attachments limits.** [`ATTACHMENT_MAX_MB`](../configuration/reference.md#attachment_max_mb)
      (25 MB by default) caps each file, and
      [`ATTACHMENT_DAILY_MB`](../configuration/reference.md#attachment_daily_mb) (1 GB by default)
      what one person uploads in a day. There is no total per person. Lower them, and watch the
      free space of the `/files` volume, when you do not know everyone with an account.
- [ ] **Backups are as sensitive as the server.** Snapshots and exports hold every password hash
      and the keys that sign sessions: anyone with a copy could sign in as anyone. Keep them as
      private as the database, and encrypt off-site copies.
- [ ] **[`CONFIG_KEY`](../configuration/reference.md#config_key) set, and kept outside the
      database.** With it, the keys that sign sessions and the key that encrypts settings-page
      secrets are kept locked with it, so a copy of the database or a backup alone can neither
      forge a session nor read those secrets. Without it, both keys sit in the same database (and
      the same backup) as what they protect. Keys stored before are locked the first time the
      server starts with it. Keep `CONFIG_KEY` with your other secrets: without it the server
      starts, but people sign in again and settings-page secrets stay locked until it is back.

## Optional

- **A VPN or a sign-in proxy in front** (Pangolin, Authelia, Authentik): strangers never reach
  PeckList's own sign-in. Keep `/api/*` and `/auth/*` reachable for the app, see
  [Others](../install/reverse-proxy.md#others).
- **`OIDC_<NAME>_SESSION_HOURS`** shorter than the default 12 hours, so leaving the provider's
  PeckList group takes effect sooner on open sessions.
- **Logs shipped off the machine** ([Logs and audit](logging.md)), so they survive the server.

## Not needed

- **Security headers or compression at the proxy.** PeckList sends both itself; adding them
  again does no harm (but a `Content-Security-Policy` at the proxy must not replace PeckList's,
  see [security headers](../install/reverse-proxy.md#security-headers)).
- **A web application firewall, fail2ban or Cloudflare's proxy** for PeckList's sake. Sign-in
  attempts are already limited per address and per account. Cloudflare's proxy can also delay live
  updates.
- **Another port than 8080, or hiding the `Server` header.** Neither makes anything harder to
  attack; the proxy is what is reachable anyway.
- **`X-XSS-Protection` or `Expect-CT`.** Obsolete headers that current browsers ignore.
- **HSTS `preload`.** It puts your domain on a list built into browsers that is slow to get off.
  Plain `Strict-Transport-Security` gives the protection that matters here.

## Reporting a vulnerability

Please do not open a public issue. See
[SECURITY.md](https://gitlab.com/killswitch10/pecklist/-/blob/main/SECURITY.md) for how to report
privately and what to expect.
