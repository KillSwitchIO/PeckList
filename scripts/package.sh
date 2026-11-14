#!/usr/bin/env bash
# Build the native downloads (PL-132, PL-133):
#   pecklist-server-<rid>-portable.tar.gz|zip   the self-contained server (no .NET install needed),
#                                                the web app in wwwroot, the service examples
#   pecklist-cli-<rid>-portable.tar.gz|zip      the command line on its own: one trimmed file
#   pecklist_<arch>.deb, pecklist.<arch>.rpm      the server packaged for Debian/Ubuntu and
#   pecklist-cli_<arch>.deb, pecklist-cli.<arch>.rpm  Fedora/RHEL/openSUSE, and the command line
# plus SHA256SUMS. Windows on ARM gets the command line only.
# The names here carry no version: the release adds it to what people download, and keeps these
# names as its "latest" links (scripts/ci/release-page.mjs).
#   scripts/package.sh <version> [rid ...]     default rids: linux-x64 linux-arm64 win-x64 win-arm64
# Needs: the .NET 10 SDK, the web build in web/dist (pnpm build), zip for Windows archives, and nfpm
# for the deb and rpm packages (skipped without it, unless LINUX_PACKAGES=1 makes it required).
# Set REVISION to the commit to stamp it into `pecklist --version`. PACKAGE_TEST_PREVIOUS=1 also
# builds linux-x64 packages at version 0.0.1 into dist/test, for the upgrade test
# (scripts/ci/package-test.sh).
set -euo pipefail

version=${1:?usage: scripts/package.sh <version> [rid ...]}
shift
rids=("$@")
[ ${#rids[@]} -gt 0 ] || rids=(linux-x64 linux-arm64 win-x64 win-arm64)

root=$(cd "$(dirname "$0")/.." && pwd)
out="$root/dist"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

[ -f "$root/web/dist/index.html" ] || { echo "Build the web app first: pnpm build" >&2; exit 1; }
mkdir -p "$out"

packages=false
if command -v nfpm >/dev/null; then
  packages=true
elif [ "${LINUX_PACKAGES:-}" = 1 ]; then
  echo "LINUX_PACKAGES=1 needs nfpm on PATH" >&2
  exit 1
else
  echo "(no nfpm: skipping the deb and rpm packages)"
fi

# The package scripts: each body with the shared functions in front.
scripts="$work/package-scripts"
mkdir -p "$scripts"
for body in "$root"/packaging/linux/scripts/{deb,rpm}-*.sh; do
  { printf '#!/bin/sh\nset -e\n'; cat "$root/packaging/linux/scripts/lib.sh" "$body"; } > "$scripts/$(basename "$body")"
done

# deb and rpm versions: a pre-release's hyphen becomes a tilde, so 0.12.0~rc.1 sorts before 0.12.0.
package_version() { echo "$1" | sed 's/-/~/'; }

# One deb and one rpm of a package. $1: nfpm-server.yaml or nfpm-cli.yaml, $2: the file name
# before the arch (pecklist, pecklist-cli), $3: amd64 or arm64, $4: version, $5: folder.
linux_packages() {
  local config=$1 base=$2 arch=$3 at=$4 into=$5 rpm_arch=x86_64
  [ "$arch" = arm64 ] && rpm_arch=aarch64
  mkdir -p "$into"
  (
    cd "$root"
    # nfpm expands variables in some fields only (not in file paths), so the config is filled here.
    PKG_VERSION=$(package_version "$at") PKG_ARCH=$arch PKG_SCRIPTS=$scripts
    PKG_MAINTAINER=${PKG_MAINTAINER:-PeckList <admin@pecklist.com>}
    local text name filled="$work/$config"
    text=$(<"packaging/linux/$config")
    for name in PKG_VERSION PKG_ARCH PKG_ROOT PKG_CLI PKG_SCRIPTS PKG_MAINTAINER; do
      text=${text//"\${$name}"/${!name-}}
    done
    printf '%s\n' "$text" > "$filled"
    nfpm package --config "$filled" --packager deb --target "$into/${base}_$arch.deb" >/dev/null
    nfpm package --config "$filled" --packager rpm --target "$into/$base.$rpm_arch.rpm" >/dev/null
  )
  echo "    ${base}_$arch.deb, $base.$rpm_arch.rpm"
}

for rid in "${rids[@]}"; do
  exe=pecklist
  case "$rid" in win-*) exe=pecklist.exe ;; esac

  # --- The server (not on Windows on ARM) ---
  if [ "$rid" != win-arm64 ]; then
    name="pecklist-server-$rid"
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
    # The packages take the program as it is, without the archive's install scripts.
    cp -a "$stage" "$work/program-$rid"
    mkdir -p "$stage/examples"
    cp "$root/examples/config/pecklist.conf" "$stage/examples/"
    case "$rid" in
      win-*)
        cp "$root/examples/windows/"*.ps1 "$stage/examples/"
        (cd "$work" && zip -qr "$out/$name-portable.zip" "$name")
        ;;
      *)
        cp "$root/examples/linux/pecklist.service" "$root/examples/linux/install.sh" "$stage/examples/"
        chmod +x "$stage/pecklist" "$stage/examples/install.sh"
        tar -C "$work" -czf "$out/$name-portable.tar.gz" "$name"
        ;;
    esac
  fi

  # --- The command line ---
  cli="pecklist-cli-$rid"
  echo "=== $cli"
  dotnet publish "$root/server/src/PeckList.Cli/PeckList.Cli.csproj" \
    -c Release -r "$rid" -p:DebugType=none -p:GenerateDocumentationFile=false \
    -p:Version="$version" -p:PeckListStamped=true -p:SourceRevisionId="${REVISION:-unknown}" \
    -o "$work/$cli"
  # All in one: the publish is the executable alone, nothing beside it to unpack or install.
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
  cp "$work/$cli/$exe" "$work/$cli-$exe"
  cp "$root/server/src/PeckList.Cli/README.md" "$work/$cli/"
  [ -f "$root/LICENSE" ] && cp "$root/LICENSE" "$work/$cli/"
  case "$rid" in
    win-*) (cd "$work" && zip -qr "$out/$cli-portable.zip" "$cli") ;;
    *)
      chmod +x "$work/$cli/pecklist"
      tar -C "$work" -czf "$out/$cli-portable.tar.gz" "$cli"
      ;;
  esac

  # --- deb and rpm ---
  if $packages && [[ "$rid" == linux-* ]]; then
    arch=amd64
    [ "$rid" = linux-arm64 ] && arch=arm64
    echo "=== packages for $rid"
    PKG_ROOT="$work/program-$rid" linux_packages nfpm-server.yaml pecklist "$arch" "$version" "$out"
    PKG_CLI="$work/$cli-$exe" linux_packages nfpm-cli.yaml pecklist-cli "$arch" "$version" "$out"
    if [ "${PACKAGE_TEST_PREVIOUS:-}" = 1 ] && [ "$rid" = linux-x64 ]; then
      echo "=== packages for the upgrade test (0.0.1)"
      PKG_ROOT="$work/program-$rid" linux_packages nfpm-server.yaml pecklist "$arch" 0.0.1 "$out/test"
      PKG_CLI="$work/$cli-$exe" linux_packages nfpm-cli.yaml pecklist-cli "$arch" 0.0.1 "$out/test"
    fi
  fi
done

shopt -s nullglob
cd "$out"
sha256sum pecklist-*.tar.gz pecklist-*.zip pecklist*.deb pecklist*.rpm > SHA256SUMS
cat SHA256SUMS
