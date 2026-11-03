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
**Admin > Settings**. Keep the admin password to yourself: visitors never need an admin.

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
# A public demo server that resets on a schedule, nightly here (PL-117). Docs: docs/install/demo.md
#   printf '%s' 'a long admin password' > admin_password.txt
#   docker compose up -d && docker compose exec reset sh /demo/reset.sh   # load the seed now
# Then open http://localhost:8080 and sign in as demo-sam / try-pecklist-sam.
name: pecklist-demo

services:
  pecklist:
    image: registry.gitlab.com/killswitch10/pecklist:latest
    restart: unless-stopped
    ports:
      - '8080:8080'
    volumes:
      # Both are deleted and made anew at every reset: keep nothing here you want back.
      - data:/data
      - files:/files
    secrets:
      - admin_password
    environment:
      TZ: Etc/UTC
      DEMO_MODE: 'true'
      # The seed's three people, with the passwords the banner shows.
      DEMO_ACCOUNTS: demo-sam:try-pecklist-sam,demo-alex:try-pecklist-alex,demo-jordan:try-pecklist-jordan
      # As the banner says it; keep them the same as RESET_CRON below. For an hourly reset:
      # DEMO_RESET_EVERY: '60' here and RESET_CRON: '0 * * * *' below.
      DEMO_RESET_TIME: '04:00'
      DEMO_RESET_EVERY: '1440'
      # The operator's own way in. Visitors never get an admin.
      ADMIN_PASSWORD_FILE: /run/secrets/admin_password
      # Behind a reverse proxy with HTTPS (the sign-up limit counts the real addresses):
      # PUBLIC_URL: https://demo.example.com
      # TRUSTED_PROXIES: 172.16.0.0/12

  # The reset: stop the server, make its volumes anew, load the seed, start it again.
  # It drives Docker through the socket, which is as good as root on this host; run reset.sh from
  # the host's own cron instead if you would rather not (see the docs).
  reset:
    image: docker:27.5.1-cli
    restart: unless-stopped
    # The same path as on the host, so the compose file it drives resolves as it does here.
    working_dir: ${PWD}
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - .:${PWD}:ro
      - ./reset.sh:/demo/reset.sh:ro
    environment:
      # When, as a cron line (UTC): nightly at 04:00. Hourly is '0 * * * *'.
      RESET_CRON: '0 4 * * *'
    entrypoint:
      - sh
      - -c
      - echo "$$RESET_CRON cd $$PWD && sh /demo/reset.sh" > /etc/crontabs/root && exec crond -f -l 6

volumes:
  data:
  files:

secrets:
  admin_password:
    file: ./admin_password.txt
```

</TabItem>
<TabItem value="reset-sh" label="reset.sh">

```sh
#!/bin/sh
# The demo server's nightly reset (PL-117): fresh volumes, the seed this image was built with, a
# new start. Run from the folder with compose.yaml, by the reset service's cron or the host's own:
#   0 4 * * * cd /srv/pecklist-demo && sh reset.sh
set -eu
project=pecklist-demo
compose="docker compose -p $project"

echo "$(date -u +%FT%TZ) reset: stopping the server"
$compose stop pecklist
$compose rm -f pecklist
docker volume rm -f "${project}_data" "${project}_files" >/dev/null

# `run` makes the volumes again. --shift-dates moves the seed's tasks so they start from today.
echo "$(date -u +%FT%TZ) reset: loading the seed"
$compose run --rm --no-deps pecklist import /app/demo/seed.json --shift-dates

# On start the server gives the demo accounts their passwords from DEMO_ACCOUNTS.
$compose up -d pecklist
echo "$(date -u +%FT%TZ) reset: done"
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
