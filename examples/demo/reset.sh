#!/bin/sh
# The demo server's nightly reset (PL-117): fresh volumes, the seed this image was built with, a
# new start. Run from the folder with compose.yaml, by the reset service's cron or the host's own:
#   0 4 * * * cd /srv/punchlist-demo && sh reset.sh
set -eu
project=punchlist-demo
compose="docker compose -p $project"

echo "$(date -u +%FT%TZ) reset: stopping the server"
$compose stop punchlist
$compose rm -f punchlist
docker volume rm -f "${project}_data" "${project}_files" >/dev/null

# `run` makes the volumes again. --shift-dates moves the seed's tasks so they start from today.
echo "$(date -u +%FT%TZ) reset: loading the seed"
$compose run --rm --no-deps punchlist import /app/demo/seed.json --shift-dates

# On start the server gives the demo accounts their passwords from DEMO_ACCOUNTS.
$compose up -d punchlist
echo "$(date -u +%FT%TZ) reset: done"
