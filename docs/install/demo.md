# Run a demo server

A demo server is a public PeckList anyone can try without installing anything: they sign up,
or sign in to one of the pre-made accounts, and every night the server forgets it all and starts
again from a seed. [`DEMO_MODE`](../configuration/reference.md#demo_mode) does the rest.

## What demo mode does

- **A banner**, one line at the bottom: "Demo server: resets every night at 04:00, anyone can sign
  up". **Demo accounts** on it lists each pre-made account with its password. Visitors can hide it
  until they close the tab.
- **Open sign-up**, whatever [`REGISTRATION`](../configuration/reference.md#registration) says,
  limited to [`SIGNUP_RATE_LIMIT`](../configuration/reference.md#signup_rate_limit) accounts per
  address an hour.
- **Deleted accounts go at once** ([`ACCOUNT_DELETE_GRACE_DAYS`](../configuration/reference.md#account_delete_grace_days)
  `0`) and **files stay small** ([`ATTACHMENT_MAX_MB`](../configuration/reference.md#attachment_max_mb)
  at most 2).
- **Nothing leaves the server**: no usage report, no release check, no Web Push (reminders still
  show on the device). Only an identity provider or log server you set up yourself is called.
- **No search engines**: every answer says `X-Robots-Tag: noindex, nofollow`, and the page has a
  robots meta tag.
- **Demo accounts** ([`DEMO_ACCOUNTS`](../configuration/reference.md#demo_accounts)) are put back
  at every start as plain users with the listed passwords. Wrong guesses lock nobody out, and
  nobody can change their passwords.

The demo settings are read from the environment only, so nobody turns them off from
the **Admin** pages. Keep the admin password to yourself: visitors never need an admin.

## The seed

Every image carries a seed at `/app/demo/seed.json`, made by that version's own code: three
friends, Sam, Alex and Jordan (`demo-sam`, `demo-alex`, `demo-jordan`), with about 230 tasks in 13
lists, six of them shared with each other (a household, groceries, a trip, a garden, a book club,
a game night), with subtasks, tags, repeats, assignments, comments and a few things in Trash.

```bash
pecklist import /app/demo/seed.json --shift-dates
```

loads it into an empty database. [`--shift-dates`](../reference/cli.md#import) moves every date
on by the days since the seed was made, so Today always has something in it. The seed has no
passwords: `DEMO_ACCOUNTS` gives the three accounts theirs when the server starts, so pick your
own there.

To make a seed yourself (another day, or after changing `web/src/demo/seed.ts`):

```bash
node scripts/demo-seed.mts seed.json --today 2026-11-01
```

## With Docker Compose

[`examples/demo`](https://gitlab.com/killswitch10/pecklist/-/tree/main/examples/demo) has the
server and a `reset` service whose cron runs the nightly reset.

<Tabs>
<TabItem value="compose-yaml" label="compose.yaml">

```yaml
--8<-- "examples/demo/compose.yaml"
```

</TabItem>
<TabItem value="reset-sh" label="reset.sh">

```sh
--8<-- "examples/demo/reset.sh"
```

</TabItem>
</Tabs>

```bash
mkdir pecklist-demo && cd pecklist-demo   # with compose.yaml and reset.sh in it
printf '%s' 'a long admin password' > admin_password.txt
docker compose up -d
sh reset.sh                                  # the first load; then every night at 04:00 UTC
```

Open [http://localhost:8080](http://localhost:8080): the banner is at the bottom, and `demo-sam` with
`try-pecklist-sam` signs you in to Sam's lists.

The reset stops the server, deletes the `data` and `files` volumes, makes them again with the
seed in, and starts the server. It takes a few seconds, and everyone signed in is signed out.

:::warning[The reset service holds the Docker socket]

:::
With `/var/run/docker.sock` mounted, the `reset` container can do anything Docker can on this
host. On a host that runs other things, leave the `reset` service out and run the same script
from the host's cron instead:

    ```cron
    0 4 * * * cd /srv/pecklist-demo && sh reset.sh >> reset.log 2>&1
    ```

Keep [`DEMO_RESET_TIME`](../configuration/reference.md#demo_reset_time) and
[`DEMO_RESET_EVERY`](../configuration/reference.md#demo_reset_every) the same as the schedule
(`RESET_CRON` in the compose file, or your crontab line), in the server's time zone (`TZ`). For an
hourly reset: `DEMO_RESET_EVERY: '60'` and `RESET_CRON: '0 * * * *'`; the banner then says
"resets every hour".

## In front of it

Put it behind a [reverse proxy with HTTPS](reverse-proxy.md) and set
[`PUBLIC_URL`](../configuration/reference.md#public_url) and
[`TRUSTED_PROXIES`](../configuration/reference.md#trusted_proxies), so the sign-up limit counts
real addresses rather than the proxy's. A demo is open to anyone: give it its own machine or
network, apart from anything private.
