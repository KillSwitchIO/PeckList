#!/bin/sh
# The AUR packages (PL-132) built and installed in a clean Arch container, from the x64 portable
# archives in dist/ (placed where makepkg finds them, so nothing is downloaded):
#   - aur-build.sh writes both folders and their .SRCINFO; makepkg builds them as a plain user
#   - pacman installs them: the pecklist user, /var/lib/pecklist, the settings readable by the user
#   - the server starts as the service would and answers /healthz; pecklist-server runs a
#     maintenance command as the pecklist user
#   - reinstalling (pacman's upgrade path) takes a snapshot first with the installed program
#   - the command line answers --version and has its completions; removing keeps the data
#   - an install from the download archive is taken over (settings kept), unless its /opt folder
#     holds data, which is left alone with a warning
# No systemd runs in the container: the unit itself is tested by the deb and rpm packages
# (package-test.sh), and these packages ship the same file.
#   sh scripts/ci/aur-test.sh [dist] [version]   (on a host with Docker, as the package test)
set -eu

dist=$(cd "${1:-dist}" && pwd)
root=$(cd "$(dirname "$0")/../.." && pwd)
version=${2:-$(sh "$root/scripts/build-version.sh")}
# What the container needs is copied in, not mounted: in CI the job talks to the host's Docker,
# which cannot see the job's files (package-test.sh copies its packages in the same way). From the
# repository, only what aur-build.sh reads; the checkout's dist would be far bigger.
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/dist" "$stage/src/scripts/ci" "$stage/src/examples" "$stage/src/server/tests/PeckList.Client.Tests"
for file in pecklist-server-linux-x64-portable.tar.gz pecklist-cli-linux-x64-portable.tar.gz SHA256SUMS; do
  [ -f "$dist/$file" ] || { echo "no $dist/$file" >&2; exit 1; }
  cp "$dist/$file" "$stage/dist/"
done
cp "$root/scripts/ci/aur-build.sh" "$stage/src/scripts/ci/"
cp -R "$root/packaging" "$stage/src/"
cp -R "$root/examples/config" "$stage/src/examples/"
cp -R "$root/server/tests/PeckList.Client.Tests/Completion" "$stage/src/server/tests/PeckList.Client.Tests/"

echo "=== arch ($version)"
container=$(docker create \
  archlinux:base@sha256:d4594bb2300cba11f41c2f27923eb56f63d9988909c402f9c95517d1e362c899 bash -c '
  set -euo pipefail
  chmod -R a+rX /src /dist
  pacman -Syu --noconfirm --needed base-devel curl > /dev/null
  useradd -m builder
  runuser -u builder -- sh /src/scripts/ci/aur-build.sh /dist/SHA256SUMS /home/builder/aur "$0" "v$0+00000000"
  cd /home/builder/aur
  pkgver=$(sed -n "s/^pkgver=//p" pecklist-bin/PKGBUILD)
  cp /dist/pecklist-server-linux-x64-portable.tar.gz "pecklist-bin/pecklist-server-linux-x64-portable-$pkgver.tar.gz"
  cp /dist/pecklist-cli-linux-x64-portable.tar.gz "pecklist-cli-bin/pecklist-cli-linux-x64-portable-$pkgver.tar.gz"
  grep -q "pkgname = pecklist-bin" pecklist-bin/.SRCINFO
  grep -q "pkgname = pecklist-cli-bin" pecklist-cli-bin/.SRCINFO
  chown -R builder: /home/builder/aur
  for name in pecklist-bin pecklist-cli-bin; do
    su builder -c "cd /home/builder/aur/$name && makepkg --noconfirm --needed > build.log 2>&1" ||
      { cat "$name/build.log"; exit 1; }
  done
  pacman -U --noconfirm pecklist-bin/*.pkg.tar.zst pecklist-cli-bin/*.pkg.tar.zst > install.log 2>&1 ||
    { cat install.log; exit 1; }
  grep -q "systemctl enable --now pecklist" install.log || { cat install.log; echo "no start hint"; exit 1; }
  id pecklist > /dev/null
  [ "$(stat -c %U:%G /var/lib/pecklist)" = pecklist:pecklist ] || { echo "/var/lib/pecklist is not the user'"'"'s"; exit 1; }
  for file in pecklist.conf pecklist.env; do
    [ "$(stat -c %a:%G /etc/pecklist/$file)" = 640:pecklist ] || { echo "/etc/pecklist/$file: $(stat -c %a:%G /etc/pecklist/$file)"; exit 1; }
  done
  echo "install: user, data folder and settings ok"

  # The service'"'"'s start, by hand: its user, folder and environment file.
  (
    cd /var/lib/pecklist && set -a && . /etc/pecklist/pecklist.env && set +a &&
      exec setpriv --reuid=pecklist --regid=pecklist --init-groups -- /usr/lib/pecklist/pecklist
  ) > server.log 2>&1 &
  started=$!
  for i in $(seq 60); do curl -fs http://localhost:8080/healthz > /dev/null 2>&1 && break; sleep 1; done
  curl -fs http://localhost:8080/healthz > /dev/null || { cat server.log; echo "no /healthz"; exit 1; }
  grep -qi password server.log || { cat server.log; echo "no first admin password"; exit 1; }
  [ -f /var/lib/pecklist/pecklist.db ] || { echo "no database in /var/lib/pecklist"; exit 1; }
  kill "$started"; wait "$started" 2> /dev/null || true
  echo "server: /healthz and /var/lib/pecklist ok"
  pecklist-server help > help.log 2>&1 || { cat help.log; exit 1; }
  grep -qi snapshot help.log || { cat help.log; echo "help does not list snapshot"; exit 1; }
  echo "server: pecklist-server ok"

  before=$({ ls /var/lib/pecklist/snapshots 2> /dev/null || true; } | wc -l)
  pacman -U --noconfirm pecklist-bin/*.pkg.tar.zst > upgrade.log 2>&1 || { cat upgrade.log; exit 1; }
  grep -q "snapshot before the upgrade" upgrade.log || { cat upgrade.log; echo "no snapshot taken"; exit 1; }
  after=$({ ls /var/lib/pecklist/snapshots 2> /dev/null || true; } | wc -l)
  [ "$after" -gt "$before" ] || { cat upgrade.log; echo "no new snapshot file"; exit 1; }
  grep -q "systemctl restart pecklist" upgrade.log || { cat upgrade.log; echo "no restart hint"; exit 1; }
  [ "$(stat -c %G /etc/pecklist/pecklist.conf)" = pecklist ] || { echo "settings lost their group"; exit 1; }
  echo "upgrade: snapshot first, settings kept ok"

  pecklist --version | tee cli.log
  grep -q "(client)" cli.log
  [ -f /usr/share/bash-completion/completions/pecklist ] && [ -f /usr/share/zsh/site-functions/_pecklist ]
  echo "cli: ok"

  pacman -R --noconfirm pecklist-bin pecklist-cli-bin > remove.log 2>&1 || { cat remove.log; exit 1; }
  [ -f /var/lib/pecklist/pecklist.db ] || { echo "removing deleted the data"; exit 1; }
  [ ! -e /usr/lib/pecklist/pecklist ] && [ ! -e /usr/bin/pecklist ]
  echo "remove: program gone, data kept ok"

  # An install from the download archive, as its install.sh leaves it: the program in /opt, its own
  # unit in /etc/systemd/system, the settings file it made, the data in /var/lib/pecklist.
  archive() {
    rm -rf /opt/pecklist && mkdir -p /opt/pecklist
    tar -xzf /dist/pecklist-server-linux-x64-portable.tar.gz -C /opt/pecklist --strip-components=1
    printf "[Service]\nExecStart=/opt/pecklist/pecklist\n" > /etc/systemd/system/pecklist.service
  }
  archive
  echo "# kept from the archive install" >> /etc/pecklist/pecklist.conf
  pacman -U --noconfirm pecklist-bin/*.pkg.tar.zst > takeover.log 2>&1 || { cat takeover.log; exit 1; }
  grep -q "moving the install in /opt/pecklist over" takeover.log || { cat takeover.log; echo "no takeover"; exit 1; }
  grep -q "snapshot before the upgrade" takeover.log || { cat takeover.log; echo "no snapshot by the archive program"; exit 1; }
  [ ! -e /opt/pecklist ] && [ ! -e /etc/systemd/system/pecklist.service ] ||
    { cat takeover.log; echo "the archive install is still there"; exit 1; }
  grep -q "kept from the archive install" /etc/pecklist/pecklist.conf || { echo "its settings file was replaced"; exit 1; }
  [ "$(stat -c %a:%G /etc/pecklist/pecklist.conf)" = 640:pecklist ] || { echo "settings mode after takeover"; exit 1; }
  echo "takeover: archive install moved over, settings and data kept ok"

  # One whose /opt/pecklist holds a database is left alone, with a warning.
  pacman -R --noconfirm pecklist-bin > /dev/null 2>&1
  archive
  mkdir -p /opt/pecklist/data && echo data > /opt/pecklist/data/pecklist.db
  pacman -U --noconfirm pecklist-bin/*.pkg.tar.zst > kept.log 2>&1 || { cat kept.log; exit 1; }
  grep -q "so it was left as it is" kept.log || { cat kept.log; echo "no warning about /opt data"; exit 1; }
  [ -f /opt/pecklist/data/pecklist.db ] && [ -f /etc/systemd/system/pecklist.service ] ||
    { cat kept.log; echo "an archive install with data was touched"; exit 1; }
  echo "takeover: archive install with data in /opt left alone, with a warning ok"
' "$version")
status=0
{ docker cp "$stage/dist" "$container:/dist" && docker cp "$stage/src" "$container:/src" &&
  docker start -a "$container"; } || status=$?
docker rm -f "$container" > /dev/null
[ "$status" = 0 ] || exit "$status"
echo "AUR packages: all checks passed"
