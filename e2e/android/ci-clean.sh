#!/bin/sh
# Removes what CI's Android runs left on the runner's Docker (android-e2e): their containers,
# volumes (the SDK's is about 6 GB), networks and the two images. run.sh cleans up after itself,
# but a canceled or timed-out job is killed before its cleanup runs, and the stack lives on the
# runner's own Docker, not in the job's container (a canceled run once sat there for 24 minutes).
#   sh e2e/android/ci-clean.sh <job id>   one job's leftovers (the job's after_script)
#   sh e2e/android/ci-clean.sh stale      every earlier job's (before a run; android-e2e's
#                                         resource group means no other one is running)
set -u
case "${1:-}" in
  stale) name=pecklist-android-e2e-ci- tag='ci-*' ;;
  '' | *[!0-9]*)
    echo "usage: ci-clean.sh <job id> | stale" >&2
    exit 2
    ;;
  *) name=pecklist-android-e2e-ci-$1- tag="ci-$1" ;;
esac
# Compose names everything <project>-... or <project>_..., and the project is
# pecklist-android-e2e-<owner> (run.sh); the trailing dash keeps job 12 from matching job 123.
containers=$(docker ps -aq --filter "name=^${name%-}[-_]")
[ -z "$containers" ] || docker rm -f $containers > /dev/null 2>&1
volumes=$(docker volume ls -q --filter "name=^${name%-}[-_]")
[ -z "$volumes" ] || docker volume rm $volumes > /dev/null 2>&1
networks=$(docker network ls -q --filter "name=^${name%-}[-_]")
[ -z "$networks" ] || docker network rm $networks > /dev/null 2>&1
# By name, not id: two jobs' builds can be the same image, and removing a name drops only that tag
# (the image goes with its last one).
images=$(docker images --format '{{.Repository}}:{{.Tag}}' \
  --filter "reference=pecklist-android-emulator:$tag" --filter "reference=pecklist-android-specs:$tag")
[ -z "$images" ] || docker image rm $images > /dev/null 2>&1
echo "ci-clean ($1): $(echo $containers | wc -w) containers, $(echo $volumes | wc -w) volumes, $(echo $networks | wc -w) networks, $(echo $images | wc -w) images removed"
