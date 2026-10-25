#!/bin/sh
# The version a build carries (POSIX sh: the CI jobs run it in the Docker and .NET images, which
# have no Node). From GitLab's variables, or the same names set by hand:
#   a release tag (CI_COMMIT_TAG=v0.2.0+20261025)   0.2.0, exactly the tag
#   the default branch (main), between releases       0.2.1-edge.<sha>: the next patch, so it sorts
#                                                      after the release it follows, before the next
#   any other branch or merge request                 0.2.1-dev.<sha>
# The current version is the one in server/Directory.Build.props (`pnpm check:version` keeps the
# other places equal). While it is a pre-release (0.3.0-rc.1), builds after it are
# 0.3.0-rc.1.edge.<sha>: after that rc, before 0.3.0.
#   CI_COMMIT_TAG=... CI_COMMIT_BRANCH=main CI_DEFAULT_BRANCH=main CI_COMMIT_SHORT_SHA=abc1234 \
#     sh scripts/build-version.sh
set -eu

if [ -n "${CI_COMMIT_TAG:-}" ]; then
  echo "$CI_COMMIT_TAG" | sed 's/^v//; s/+.*//'
  exit 0
fi

# VERSION_PROPS: another file to read it from (the tests).
props=${VERSION_PROPS:-$(dirname "$0")/../server/Directory.Build.props}
current=$(sed -n 's:.*<Version>\(.*\)</Version>.*:\1:p' "$props")
[ -n "$current" ] || { echo "no <Version> in $props" >&2; exit 1; }
sha=${CI_COMMIT_SHORT_SHA:?CI_COMMIT_SHORT_SHA is not set}

if [ "${CI_COMMIT_BRANCH:-}" = "${CI_DEFAULT_BRANCH:-main}" ]; then
  channel=edge
else
  channel=dev
fi

case "$current" in
  *-*)
    echo "$current.$channel.$sha"
    ;;
  *)
    major=$(echo "$current" | cut -d. -f1)
    minor=$(echo "$current" | cut -d. -f2)
    patch=$(echo "$current" | cut -d. -f3)
    echo "$major.$minor.$((patch + 1))-$channel.$sha"
    ;;
esac
