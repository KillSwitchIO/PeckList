#!/bin/sh
# One shard of the server tests (the server-test job runs three at once):
#   sh scripts/ci/server-test-shard.sh <1|2|3>
# Shards 1 and 2 run the PeckList.Server.Tests classes listed for them in
# server/tests/PeckList.Server.Tests/shards.txt; shard 3 runs every other class of it, plus every
# other test project. A class missing from the list still runs, in shard 3.
# Each runs on xunit's own runner with SERVER_TEST_THREADS threads (default 4): the suite contends
# beyond that (thread pool and GC), so three shards of 4 finish far sooner than one run of 12.
set -eu

shard=${1:-}
case "$shard" in
  1 | 2 | 3) ;;
  *)
    echo "usage: server-test-shard.sh <1|2|3>" >&2
    exit 2
    ;;
esac
threads=${SERVER_TEST_THREADS:-4}
list=server/tests/PeckList.Server.Tests/shards.txt
[ -f "$list" ] || { echo "no $list" >&2; exit 2; }

cd server
if [ "$shard" = 3 ]; then
  dotnet build --configuration Release -nologo -v q
else
  dotnet build tests/PeckList.Server.Tests --configuration Release -nologo -v q
fi

status=0
run() { # project, then runner arguments
  project=$1
  shift
  echo "== $project (shard $shard)"
  (cd "tests/$project" && dotnet "bin/Release/net10.0/$project.dll" -maxthreads "$threads" "$@") || status=1
}

if [ "$shard" = 3 ]; then
  for dir in tests/*/; do
    project=$(basename "$dir")
    [ "$project" = PeckList.Server.Tests ] || run "$project"
  done
  set --
  for class in $(awk '$1 == "1" || $1 == "2" { print $2 }' "../$list"); do
    set -- "$@" -class- "PeckList.Server.Tests.$class"
  done
  run PeckList.Server.Tests "$@"
else
  set --
  for class in $(awk -v shard="$shard" '$1 == shard { print $2 }' "../$list"); do
    set -- "$@" -class "PeckList.Server.Tests.$class"
  done
  [ $# -gt 0 ] || { echo "shard $shard lists no classes in $list" >&2; exit 2; }
  run PeckList.Server.Tests "$@"
fi
exit $status
