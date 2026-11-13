#!/bin/sh
# The AUR packages (PL-132), from packaging/aur: one folder each, ready to push to the AUR as it is.
#   out/pecklist-bin/       the server: PKGBUILD, pecklist.install, the unit, settings, sysusers...
#   out/pecklist-cli-bin/   the command line: PKGBUILD and the shell completions
# The PKGBUILDs download the release's portable archives and check them against the SHA-256 sums in
# the given SHA256SUMS (a release's, or dist/SHA256SUMS from the packages job). The other files are
# copies of the deb and rpm packages' own, so all three install the server the same way.
#   sh scripts/ci/aur-build.sh <SHA256SUMS> <out> <version> <tag>
#     version  0.12.0 (a pre-release such as 0.12.0-rc.1 becomes pkgver 0.12.0rc1, which pacman
#              sorts before 0.12.0; the AUR only ever gets final releases)
#     tag      the release's tag, v0.12.0+20261201: the download links name it
# With makepkg on the PATH (Arch), it also writes each folder's .SRCINFO, which the AUR needs.
# makepkg refuses to run as root, even for that: run this as a plain user.
set -eu

sums=$1
out=$2
version=$3
tag=$4
root=$(cd "$(dirname "$0")/../.." && pwd)
linux="$root/packaging/linux"

# Both go into the PKGBUILD (which makepkg sources as a shell script) and through sed: only the
# exact shapes, nothing that could quote, substitute or split.
printf '%s\n' "$version" | grep -Eqx '[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?' ||
  { echo "not a version: $version" >&2; exit 1; }
printf '%s\n' "$tag" | grep -Eqx 'v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?(\+[0-9A-Za-z.]+)?' ||
  { echo "not a release tag: $tag" >&2; exit 1; }

pkgver=$(printf '%s' "$version" | sed -e 's/+.*//' -e 's/-rc\./rc/' -e 's/-/_/g')
# + in a URL path is safe, but GitLab's release links want it escaped.
tag_url=$(printf '%s' "$tag" | sed 's/+/%2B/g')

sum_of() { # the archive's line in SHA256SUMS
  line=$(grep -E "^[0-9a-f]{64}  \*?$1\$" "$sums" | head -n 1)
  [ -n "$line" ] || { echo "no $1 in $sums" >&2; exit 1; }
  printf '%s' "${line%% *}"
}

sum_local() { sha256sum "$1" | cut -d' ' -f1; }

# One package folder: $1 the package, $2 the archive's name part (server or cli), then the local
# source files in PKGBUILD order.
package() {
  name=$1
  part=$2
  shift 2
  dir="$out/$name"
  # One sum a line, lined up under the first: sha256sums=('...'
  #                                                     '...')
  common=""
  for file in "$@"; do
    [ -z "$common" ] || common="$common
           "
    common="$common'$(sum_local "$dir/$file")'"
  done
  x64=$(sum_of "pecklist-$part-linux-x64-portable.tar.gz")
  arm64=$(sum_of "pecklist-$part-linux-arm64-portable.tar.gz")
  {
    sed -e "/^@SUMS@\$/,\$d" -e "s/@PKGVER@/$pkgver/" -e "s/@TAG@/$tag_url/" \
      "$root/packaging/aur/$name/PKGBUILD.in"
    echo "sha256sums=($common)"
    echo "sha256sums_x86_64=('$x64')"
    echo "sha256sums_aarch64=('$arm64')"
    sed -e "1,/^@SUMS@\$/d" "$root/packaging/aur/$name/PKGBUILD.in"
  } > "$dir/PKGBUILD"
  if ! command -v makepkg >/dev/null 2>&1; then
    echo "(no makepkg: no .SRCINFO for $name)"
  elif [ "$(id -u)" -eq 0 ]; then
    echo "(root: makepkg will not run, so no .SRCINFO for $name)"
  else
    (cd "$dir" && makepkg --printsrcinfo > .SRCINFO)
  fi
  echo "    $dir (pkgver $pkgver)"
}

rm -rf "$out/pecklist-bin" "$out/pecklist-cli-bin"
mkdir -p "$out/pecklist-bin" "$out/pecklist-cli-bin"

server="$out/pecklist-bin"
cp "$linux/pecklist.service" "$linux/pecklist.env" "$linux/pecklist-server" "$server/"
cp "$linux/sysusers.conf" "$server/pecklist.sysusers"
cp "$linux/tmpfiles.conf" "$server/pecklist.tmpfiles"
cp "$root/examples/config/pecklist.conf" "$server/pecklist.conf"
cat "$linux/scripts/lib.sh" "$root/packaging/aur/pecklist-bin/pecklist.install.in" > "$server/pecklist.install"
package pecklist-bin server \
  pecklist.service pecklist.env pecklist-server pecklist.sysusers pecklist.tmpfiles pecklist.conf

cli="$out/pecklist-cli-bin"
completion="$root/server/tests/PeckList.Client.Tests/Completion"
cp "$completion/pecklist.bash" "$completion/pecklist.fish" "$completion/pecklist.zsh" "$cli/"
package pecklist-cli-bin cli pecklist.bash pecklist.fish pecklist.zsh
