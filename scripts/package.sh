#!/usr/bin/env bash
# Build the native downloads: a self-contained server (no .NET install needed) with the web app in
# wwwroot, the docs that matter offline, and the service examples. One archive per platform, plus
# SHA256SUMS. File names carry no version (punchlist-linux-x64.tar.gz), so the release's
# "latest" download links never change; `punchlist --version` says which one it is.
#   scripts/package.sh <version> [rid ...]     default rids: linux-x64 linux-arm64 win-x64
# Needs: the .NET 10 SDK, the web build in web/dist (pnpm build), and zip for Windows archives.
# Set REVISION to the commit to stamp it into `punchlist --version`.
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
  name="punchlist-$rid"
  stage="$work/$name"
  echo "=== $name"
  dotnet publish "$root/server/src/Punchlist.Server/Punchlist.Server.csproj" \
    -c Release -r "$rid" --self-contained true \
    -p:Version="$version" -p:SourceRevisionId="${REVISION:-unknown}" \
    -p:DebugType=none -p:GenerateDocumentationFile=false \
    -o "$stage"
  cp -r "$root/web/dist" "$stage/wwwroot"
  cp "$root/README.md" "$root/CHANGELOG.md" "$stage/"
  [ -f "$root/LICENSE" ] && cp "$root/LICENSE" "$stage/"
  mkdir -p "$stage/examples"
  cp "$root/examples/config/punchlist.conf" "$stage/examples/"
  case "$rid" in
    win-*)
      cp "$root/examples/windows/"*.ps1 "$stage/examples/"
      (cd "$work" && zip -qr "$out/$name.zip" "$name")
      ;;
    *)
      cp "$root/examples/linux/punchlist.service" "$root/examples/linux/install.sh" "$stage/examples/"
      chmod +x "$stage/punchlist" "$stage/examples/install.sh"
      tar -C "$work" -czf "$out/$name.tar.gz" "$name"
      ;;
  esac
done

shopt -s nullglob
cd "$out"
sha256sum punchlist-*.tar.gz punchlist-*.zip > SHA256SUMS
cat SHA256SUMS
