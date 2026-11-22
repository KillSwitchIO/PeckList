#!/bin/sh
# The upgrade test's starting point (PL-132): a release's x64 deb and rpm packages, downloaded from
# its release page the way people get them. Those files sit in the package registry, which any job
# token of the project can write, and package-test installs them in privileged containers. So
# SHA256SUMS is checked against its Sigstore bundle first (the identity docs/install/verifying.md
# gives people, through scripts/ci/sigstore.sh verify), then every package against SHA256SUMS.
#   sh scripts/ci/package-previous.sh <out> <this build's version>
# It writes the four packages under their plain names, plus VERSION with the release's version.
#
# Which release: the latest. If it has no bundle (signing is allowed to miss a release while
# Sigstore is down) or is this build's own version (a release commit's job run again after its
# release is out), the newest earlier final release that has a bundle, and it says which. A bundle
# that does not verify, or a package that does not match, stops the job: that is never skipped.
#
# PREVIOUS_DOWNLOADS: the latest release's downloads folder. PREVIOUS_RELEASES: the releases list
# (GitLab's API). PREVIOUS_PAGES: where a tag's page is, <PREVIOUS_PAGES>/<tag>/downloads. Each may
# also be a plain file:// URL of a local folder (file:///C:/... on Windows, not percent-encoded),
# for trying it offline and for the script tests.
# POSIX sh: the CI job runs it in the Docker image, which has busybox wget and no curl; the Node
# image (the script tests in lint) has neither, and Node's fetch does the downloading there.
set -eu

usage='usage: package-previous.sh <out> <this build version>'
out=${1:?$usage}
this=${2:?$usage}
pages=${PREVIOUS_PAGES:-https://gitlab.com/killswitch10/pecklist/-/releases}
latest=${PREVIOUS_DOWNLOADS:-$pages/permalink/latest/downloads}
releases=${PREVIOUS_RELEASES:-https://gitlab.com/api/v4/projects/killswitch10%2Fpecklist/releases?per_page=50}
here=$(cd "$(dirname "$0")" && pwd)
names='pecklist_amd64.deb pecklist-cli_amd64.deb pecklist.x86_64.rpm pecklist-cli.x86_64.rpm'

fail() {
  echo "package-previous: $*" >&2
  exit 1
}

download() { # url file
  case "$1" in
    file://*)
      # A local folder: the path, without a leading slash before a Windows drive (file:///C:/...).
      path=${1#file://}
      case "$path" in /[A-Za-z]:/*) path=${path#/} ;; esac
      cp "$path" "$2" 2> /dev/null
      ;;
    *)
      if command -v curl > /dev/null; then
        curl -fsSL -o "$2" "$1" 2> /dev/null
      elif command -v wget > /dev/null; then
        wget -q -O "$2" "$1" 2> /dev/null
      else
        node -e 'fetch(process.argv[1]).then(async (r) => { if (!r.ok) throw new Error(`${r.status}`); require("fs").writeFileSync(process.argv[2], Buffer.from(await r.arrayBuffer())); }).catch(() => process.exit(1))' "$1" "$2"
      fi
      ;;
  esac
}

# Three tries a little apart.
fetch() { # url file
  for wait in 2 5 0; do
    download "$1" "$2" && return 0
    [ "$wait" = 0 ] || sleep "${PREVIOUS_RETRY_WAIT:-$wait}"
  done
  rm -f "$2"
  return 1
}

work=$(mktemp -d "${TMPDIR:-/tmp}/package-previous.XXXXXX")
trap 'rm -rf "$work"' EXIT

# One release: 0 when its packages are in $out, 3 when it has no bundle, 4 when it is this build's
# version. Anything untrustworthy ends the script here.
try_release() { # downloads
  rm -f "$work/SHA256SUMS" "$work/SHA256SUMS.sigstore.json"
  fetch "$1/SHA256SUMS" "$work/SHA256SUMS" || fail "no SHA256SUMS at $1"
  tried=$(sed -n 's/^[0-9a-f]\{64\}  pecklist_\([^_]*\)_amd64\.deb$/\1/p' "$work/SHA256SUMS")
  [ -n "$tried" ] || fail "SHA256SUMS at $1 names no versioned server deb"
  fetch "$1/SHA256SUMS.sigstore.json" "$work/SHA256SUMS.sigstore.json" || return 3
  sh "$here/sigstore.sh" verify "$work/SHA256SUMS" || fail "SHA256SUMS of $tried is not the pipeline's"
  [ "$tried" != "$this" ] || return 4
  mkdir -p "$out"
  for name in $names; do
    line=$(awk -v name="$name" '$2 == name' "$work/SHA256SUMS")
    [ -n "$line" ] || fail "SHA256SUMS of $tried lists no $name"
    fetch "$1/$name" "$out/$name" || fail "could not download $name of $tried"
    printf '%s\n' "$line" | (cd "$out" && sha256sum -c - > /dev/null) ||
      { rm -f "$out/$name"; fail "$name of $tried does not match SHA256SUMS"; }
  done
  printf '%s\n' "$tried" > "$out/VERSION"
  return 0
}

passed_over() { # why
  case "$1" in
    3) echo "Release $tried has no SHA256SUMS.sigstore.json (signed while Sigstore was down?): its packages cannot be trusted, so passing over it." ;;
    4) echo "Release $tried is this build's own version, so passing over it." ;;
  esac
}

status=0
try_release "$latest" || status=$?
if [ "$status" != 0 ]; then
  passed_over "$status"
  skip=$tried
  # Final releases only, newest first as GitLab lists them. Tags carry no commas or quotes.
  fetch "$releases" "$work/releases.json" || fail "could not read the releases list at $releases"
  tags=$(tr ',' '\n' < "$work/releases.json" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' |
    grep -E '^v[0-9]+\.[0-9]+\.[0-9]+(\+[0-9A-Za-z.]+)?$' || true)
  found=
  for tag in $tags; do
    version=$(echo "$tag" | sed 's/^v//; s/+.*//')
    [ "$version" != "$skip" ] && [ "$version" != "$this" ] || continue
    status=0
    try_release "$pages/$(echo "$tag" | sed 's/+/%2B/g')/downloads" || status=$?
    [ "$status" = 0 ] && { found=$tag; break; }
    passed_over "$status"
  done
  [ -n "$found" ] || fail "no earlier final release with a signed SHA256SUMS to upgrade from"
fi
echo "The upgrade test starts from $(cat "$out/VERSION") (checked against its signed SHA256SUMS)."
