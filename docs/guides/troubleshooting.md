# Troubleshooting

Start with the logs (`docker logs punchlist`, `journalctl -u punchlist`, or the files in
`/data/logs`) and **Admin > Logs**. For anything you report, attach a
[debug dump](logging.md#debug-dump).

## It does not start

**`Invalid settings:` followed by a list.** Each line names a setting and what is wrong with it. Fix
them all and start again. See [all settings](../configuration/reference.md).

**`SQLite Error 14: unable to open database file`** or **permission denied on `/data`.** The data
folder is not writable by the container's user (uid 1654). With a bind mount:
`sudo chown -R 1654:1654 ./data`, or run as your own user (`user: "1000:1000"`). On Linux native:
`sudo chown -R punchlist:punchlist /var/lib/punchlist`.

**Port already in use.** Another program has 8080. Map another host port (`-p 9000:8080`), or set
`ASPNETCORE_HTTP_PORTS`.

**It starts, but the page is blank or 404.** The web files are missing: on a source build, copy
`web/dist` to `wwwroot` next to the program, or set `WEB_ROOT`.

## Signing in

**I never saw the admin password.** `docker exec punchlist punchlist admin reset-password` prints a
new one. With `ADMIN_PASSWORD` set, that was the password (it is used only when the account is
first made; changing the variable later does nothing).

**"Too many attempts".** Five wrong passwords lock the account for 15 minutes, and each address gets
ten attempts a minute. Wait it out, or sign in another way (single sign-on, a sign-in link from an
admin).

**Single sign-on sends people to `http://...` instead of `https://...`.** The server sees plain HTTP
from the proxy. Set `PUBLIC_URL` to the `https://` address, and make sure the proxy sends
`X-Forwarded-Proto` and is in `TRUSTED_PROXIES`.

**Single sign-on problems**: see [single sign-on](single-sign-on.md#troubleshooting).

## The app

**Changes from another device take a while to show.** Live updates come over `/api/events`. A proxy
that buffers it delays them (the app still syncs every 30 seconds and on focus). See
[reverse proxy](../install/reverse-proxy.md#what-the-proxy-must-do).

**"Install app" is missing, or offline does not work.** Browsers allow both only on HTTPS (or
`localhost`).

**The access log shows the proxy's address for everyone.** Set `TRUSTED_PROXIES` to the proxy's
address; see [trusted proxies](../install/reverse-proxy.md#trusted-proxies).

**"The server could not take one of your changes."** The change was malformed or stamped more
than an hour ahead of the server's clock. It stays on that device, everything else syncs, and it
goes again once it changes. If the app also says the device's clock is ahead or behind, set the
device's date and time to automatic: changes stamped ahead win over newer ones, and ones stamped
behind lose to older ones.

**Stats months are off by a day, or "today" is wrong on the server.** Set `TZ` to your time zone.
The debug dump's `about.json` shows the zone the server uses.

## Notifications do not arrive with the app closed

Turn on **Settings > Notifications > Notify me when PeckList is closed** on each device. Then check:

- **HTTPS**: browsers only take pushes from a site served over HTTPS (`PUBLIC_URL` with `https://`).
- **Getting out**: the server sends pushes to the browsers' push services (Google's, Mozilla's,
  Apple's), so it needs to reach the internet over HTTPS; a firewall that blocks outgoing traffic
  stops them. The log says "A push to one of ...'s devices failed" when one does not go through.
- **iPhone and iPad**: pushes only reach PeckList added to the Home Screen (iOS 16.4 or later);
  turn the setting on from there.
- **Permission**: if the browser or the phone blocks notifications for the site, allow them in its
  settings and turn the switch off and on again.

Reminders still appear while PeckList is open or in the background without any of this.

## Logs to a log server do not arrive

**Admin > Logs > Outputs** shows each output's state, errors and how many entries it dropped. Check
the address from inside the container's network (a name like `loki` only resolves on the same
Docker network), and the credentials.

## Getting more detail

```bash
docker exec punchlist punchlist config show      # every setting and where it comes from
```

Raise the log level for one area without a restart: in **Admin > Settings**, set
`LOG_LEVEL_OVERRIDES` to `PeckList=debug` (or `PeckList.Sync=debug`), reproduce, then remove it.
