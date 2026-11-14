#!/bin/sh
# The AppImages (PL-132), made from the portable archives scripts/package.sh left in dist/:
#   pecklist-server-linux-<x64|arm64>.AppImage   the server, started in a terminal (packaging/appimage/server)
#   pecklist-cli-linux-<x64|arm64>.AppImage      the command line (packaging/appimage/cli)
# Each is the AppImage type-2 runtime followed by a squashfs of its folder: no appimagetool, whose
# only builds are a moving "continuous" one. The runtime is a tagged release, checked by SHA-256.
# Adds the AppImages to dist/SHA256SUMS.
#   sh scripts/ci/appimage-build.sh [dist]
# PACKAGE_RIDS: the rids package.sh was asked for (the packages job's variable; empty means its
# default, every rid). Each Linux one must have its archives, or the build stops: a release must
# not go out quietly without an architecture's AppImages.
# Needs: mksquashfs (squashfs-tools), curl, tar. RUNTIME_DIR: a folder that already holds
# runtime-x86_64 and runtime-aarch64 (they are still checked), instead of downloading them.
set -eu

dist=${1:-dist}
root=$(cd "$(dirname "$0")/../.." && pwd)
runtime_tag=20251108
runtime_x86_64=2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d
runtime_aarch64=00cbdfcf917cc6c0ff6d3347d59e0ca1f7f45a6df1a428a0d6d8a78664d87444
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Fixed times and owners inside the image, so a rebuild of the same files gives the same bytes.
export SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH:-$(git -C "$root" log -1 --format=%ct 2>/dev/null || echo 0)}

runtime() { # arch: x86_64 or aarch64
  file="$work/runtime-$1"
  if [ -n "${RUNTIME_DIR:-}" ]; then
    cp "$RUNTIME_DIR/runtime-$1" "$file"
  else
    curl -fsSLo "$file" "https://github.com/AppImage/type2-runtime/releases/download/$runtime_tag/runtime-$1"
  fi
  eval "want=\$runtime_$1"
  echo "$want  $file" | sha256sum -c - >/dev/null || { echo "runtime-$1 does not match its checksum" >&2; exit 1; }
  echo "$file"
}

# One AppImage: $1 its folder, $2 the runtime, $3 the file to write.
pack() {
  mksquashfs "$1" "$work/image.squashfs" -root-owned -noappend -comp zstd -quiet -no-progress
  cat "$2" "$work/image.squashfs" > "$3"
  chmod +x "$3"
  rm "$work/image.squashfs"
  echo "    $(basename "$3")"
}

# The parts every AppImage has at its top: the start script, the desktop entry and the icon.
top() { # folder, packaging/appimage/<kind>, desktop file name
  cp "$root/packaging/appimage/$2/AppRun" "$1/AppRun"
  chmod 755 "$1/AppRun"
  cp "$root/packaging/appimage/$2/$3" "$1/"
  cp "$root/web/public/icons/icon-256.png" "$1/pecklist.png"
  ln -s pecklist.png "$1/.DirIcon"
}

made=""
for rid in linux-x64 linux-arm64; do
  case " ${PACKAGE_RIDS:-linux-x64 linux-arm64} " in
    *" $rid "*) ;;
    *) echo "($rid not in PACKAGE_RIDS: no AppImages for it)"; continue ;;
  esac
  server="$dist/pecklist-server-$rid-portable.tar.gz"
  cli="$dist/pecklist-cli-$rid-portable.tar.gz"
  [ -f "$server" ] && [ -f "$cli" ] || { echo "no $rid archives in $dist, though it was asked for" >&2; exit 1; }
  arch=x86_64
  [ "$rid" = linux-arm64 ] && arch=aarch64
  run=$(runtime "$arch")
  echo "=== AppImages for $rid"

  app="$work/server-$rid"
  mkdir -p "$app/usr/lib"
  tar -xzf "$server" -C "$app/usr/lib"
  mv "$app/usr/lib/pecklist-server-$rid" "$app/usr/lib/pecklist"
  # The archive's install script and unit belong to an install; an AppImage is not one.
  rm -rf "$app/usr/lib/pecklist/examples"
  top "$app" server pecklist-server.desktop
  pack "$app" "$run" "$dist/pecklist-server-$rid.AppImage"

  app="$work/cli-$rid"
  mkdir -p "$app/usr/bin" "$work/cli-unpack"
  tar -xzf "$cli" -C "$work/cli-unpack"
  cp "$work/cli-unpack/pecklist-cli-$rid/pecklist" "$app/usr/bin/pecklist"
  chmod 755 "$app/usr/bin/pecklist"
  rm -rf "$work/cli-unpack"
  top "$app" cli pecklist-cli.desktop
  pack "$app" "$run" "$dist/pecklist-cli-$rid.AppImage"

  made="$made pecklist-server-$rid.AppImage pecklist-cli-$rid.AppImage"
done

if [ -n "$made" ]; then
  # shellcheck disable=SC2086 # the names have no spaces
  (cd "$dist" && sha256sum $made >> SHA256SUMS)
fi
