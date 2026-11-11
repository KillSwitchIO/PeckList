#!/usr/bin/env bash
# Build the native downloads: a self-contained server (no .NET install needed) with the web app in
# wwwroot, the docs that matter offline, and the service examples. One archive per platform, plus
# SHA256SUMS. Beside each server archive, the command line on its own (pecklist-cli-<rid>, PL-133):
# one trimmed, self-contained file with its README and LICENSE.
# The names here carry no version (pecklist-linux-x64.tar.gz): the release adds it to
# what people download, and keeps these names as its "latest" links (scripts/ci/release-page.mjs).
#   scripts/package.sh <version> [rid ...]     default rids: linux-x64 linux-arm64 win-x64
# Needs: the .NET 10 SDK, the web build in web/dist (pnpm build), and zip for Windows archives.
# Set REVISION to the commit to stamp it into `pecklist --version`.
set -euo pipefail

version=${1:?usage: scripts/package.sh <version> [rid ...]}
shift
rids=("$@")
[ ${#rids[@]} -gt 0 ] || rids=(linux-x64 linux-arm64 win-x64)

root=$(cd "$(dirname "$0")/.." && pwd)
out="$root/dist"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

[ -f "$root/web/dist/index.html" ] || { echo "Build the web app first: pnpm build" >&2; exit 1; }
mkdir -p "$out"

for rid in "${rids[@]}"; do
  name="pecklist-$rid"
  stage="$work/$name"
  echo "=== $name"
  dotnet publish "$root/server/src/PeckList.Server/PeckList.Server.csproj" \
    -c Release -r "$rid" --self-contained true \
    -p:Version="$version" -p:PeckListStamped=true -p:SourceRevisionId="${REVISION:-unknown}" \
    -p:DebugType=none -p:GenerateDocumentationFile=false \
    -o "$stage"
  cp -r "$root/web/dist" "$stage/wwwroot"
  cp "$root/README.md" "$root/CHANGELOG.md" "$stage/"
  [ -f "$root/LICENSE" ] && cp "$root/LICENSE" "$stage/"
  mkdir -p "$stage/examples"
  cp "$root/examples/config/pecklist.conf" "$stage/examples/"
  case "$rid" in
    win-*)
      cp "$root/examples/windows/"*.ps1 "$stage/examples/"
      (cd "$work" && zip -qr "$out/$name.zip" "$name")
      ;;
    *)
      cp "$root/examples/linux/pecklist.service" "$root/examples/linux/install.sh" "$stage/examples/"
      chmod +x "$stage/pecklist" "$stage/examples/install.sh"
      tar -C "$work" -czf "$out/$name.tar.gz" "$name"
      ;;
  esac

  cli="pecklist-cli-$rid"
  echo "=== $cli"
  dotnet publish "$root/server/src/PeckList.Cli/PeckList.Cli.csproj" \
    -c Release -r "$rid" -p:DebugType=none -p:GenerateDocumentationFile=false \
    -p:Version="$version" -p:PeckListStamped=true -p:SourceRevisionId="${REVISION:-unknown}" \
    -o "$work/$cli"
  # All in one: the publish is the executable alone, nothing beside it to unpack or install.
  exe=pecklist
  case "$rid" in win-*) exe=pecklist.exe ;; esac
  published=$(ls -A "$work/$cli")
  if [ "$published" != "$exe" ]; then
    echo "the $rid command line is not one file:" $published >&2
    exit 1
  fi
  # And it runs with no .NET to lean on (an empty environment), where this machine can run it.
  if [ "$rid" = linux-x64 ] && [ "$(uname -s)-$(uname -m)" = Linux-x86_64 ]; then
    env -i HOME="$work" "$work/$cli/$exe" --version | grep -q '(client)' \
      || { echo "the $rid command line does not run on its own" >&2; exit 1; }
  fi
  cp "$root/server/src/PeckList.Cli/README.md" "$work/$cli/"
  [ -f "$root/LICENSE" ] && cp "$root/LICENSE" "$work/$cli/"
  case "$rid" in
    win-*) (cd "$work" && zip -qr "$out/$cli.zip" "$cli") ;;
    *)
      chmod +x "$work/$cli/pecklist"
      tar -C "$work" -czf "$out/$cli.tar.gz" "$cli"
      ;;
  esac
done

shopt -s nullglob
cd "$out"
sha256sum pecklist-*.tar.gz pecklist-*.zip > SHA256SUMS
cat SHA256SUMS
