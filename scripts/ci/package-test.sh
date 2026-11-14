#!/bin/sh
# Installs, upgrades and removes the deb and rpm packages in clean containers, one per distro, with
# systemd running (PL-132). POSIX sh: the CI job runs it in the Docker image, which has no bash.
#   scripts/ci/package-test.sh [dist] [distro ...]
# dist holds the packages from scripts/package.sh, with PACKAGE_TEST_PREVIOUS=1 (dist/test: the same
# program at version 0.0.1, to upgrade from). Distros: debian ubuntu fedora alma opensuse arm64.
# Needs a Docker that runs privileged containers (systemd as PID 1); arm64 needs QEMU binfmt.
set -eu

dist=$(cd "${1:-dist}" && pwd)
[ $# -gt 0 ] && shift
distros=${*:-debian ubuntu fedora alma opensuse arm64}
failed=

say() { printf '\n=== %s\n' "$*"; }
fail() { echo "FAIL ($distro): $*" >&2; exit 1; }

# A clean image of the distro with systemd and curl, started with systemd as PID 1. The Debian and
# Ubuntu images block service starts (policy-rc.d), which a real machine does not. The bases are
# pinned by digest (each a multi-arch index), since the containers run privileged on the runner.
# To move one on: docker buildx imagetools inspect debian:12 --format '{{json .Manifest.Digest}}'
debian_base=debian:12@sha256:268fb24c39bca92d326dd83ea3abebe4a3f7751c804ffef23bb6d857dd343ff8
image_for() {
  case "$1" in
    debian) base=$debian_base; setup='apt-get update -qq && apt-get install -y -qq systemd systemd-sysv curl ca-certificates > /dev/null && rm -f /usr/sbin/policy-rc.d' ;;
    ubuntu) base=ubuntu:24.04@sha256:2198e4c65076e9cb0b3d695219df667c0e3b0072da64ca3c2648aca17dcecaf5; setup='apt-get update -qq && apt-get install -y -qq systemd systemd-sysv curl ca-certificates > /dev/null && rm -f /usr/sbin/policy-rc.d' ;;
    fedora) base=fedora:43@sha256:f01112b9a1f1d0504ad962d9adfa401425033f8ab067e0a821904ebdde5b8ca5; setup='dnf install -y -q systemd curl && dnf clean all' ;;
    alma) base=almalinux:10@sha256:5a4b41a427c9717be8f4ac2a32aa22efbae5f9124fbcb79a6765394f312acfe8; setup='dnf install -y -q systemd && dnf clean all' ;;
    opensuse) base=opensuse/leap:16.0@sha256:a4115e2f5aea9712a7c73974fd94000a034fc3051ef29b5f7722fbf04070dd9d; setup='zypper --non-interactive -q install systemd curl && zypper clean -a' ;;
  esac
  tag="pecklist-package-test:$1"
  printf 'FROM %s\nRUN %s\nSTOPSIGNAL SIGRTMIN+3\nCMD ["/sbin/init"]\n' "$base" "$setup" |
    docker build -q -t "$tag" - > /dev/null
}

# Run a command in the container (as root, with a login shell's PATH).
inside() { docker exec "$container" sh -c "$*"; }

install_pkg() {
  case "$family" in
    deb) inside "DEBIAN_FRONTEND=noninteractive apt-get install -y -qq $* < /dev/null" ;;
    rpm) inside "dnf install -y -q $*" ;;
    suse) inside "zypper --non-interactive -q install --allow-unsigned-rpm $*" ;;
  esac
}

healthy() {
  for _ in $(seq 1 60); do
    if inside 'curl -fsS http://localhost:8080/healthz' > /dev/null 2>&1; then return 0; fi
    sleep 1
  done
  inside 'journalctl -u pecklist --no-pager | tail -40' || true
  fail "the server does not answer /healthz"
}

snapshots() { inside 'ls /var/lib/pecklist/snapshots 2>/dev/null | wc -l'; }

test_distro() {
  distro=$1
  case "$distro" in
    debian | ubuntu) family=deb; server=pecklist_amd64.deb; cli=pecklist-cli_amd64.deb ;;
    fedora | alma) family=rpm; server=pecklist.x86_64.rpm; cli=pecklist-cli.x86_64.rpm ;;
    opensuse) family=suse; server=pecklist.x86_64.rpm; cli=pecklist-cli.x86_64.rpm ;;
  esac
  say "$distro: image"
  image_for "$distro"
  container="pecklist-package-test-$distro-$$"
  # Its own cgroup namespace, not the host's: on cgroup v2, systemd runs with that and --privileged.
  docker run -d --name "$container" --privileged --cgroupns=private \
    --tmpfs /run --tmpfs /tmp "$tag" > /dev/null
  trap 'docker rm -f "$container" > /dev/null 2>&1 || true' EXIT
  for _ in $(seq 1 30); do
    state=$(inside 'systemctl is-system-running 2>/dev/null' || true)
    case "$state" in running | degraded) break ;; esac
    sleep 1
  done
  docker cp "$dist/." "$container:/packages"
  [ "$family" = deb ] && inside 'apt-get update -qq'

  if [ "$distro" = debian ]; then
    say "$distro: an archive install first, which the package takes over"
    inside 'tar -xzf /packages/pecklist-server-linux-x64-portable.tar.gz -C /root && /root/pecklist-server-linux-x64/examples/install.sh > /dev/null'
    inside 'systemctl is-active --quiet pecklist' || fail "the archive install is not running"
    healthy
    inside 'setpriv --reuid=pecklist --regid=pecklist --init-groups env DB_PATH=/var/lib/pecklist/pecklist.db CONFIG_FILE=/etc/pecklist/pecklist.conf /opt/pecklist/pecklist admin add-user from-archive > /dev/null'
    say "$distro: no takeover while a database lives in /opt/pecklist"
    inside 'mkdir -p /opt/pecklist/data && touch /opt/pecklist/data/moved.db'
    install_pkg "/packages/test/$server" 2> /dev/null && fail "the takeover would have deleted a database"
    inside '[ -f /opt/pecklist/data/moved.db ] && systemctl is-active --quiet pecklist' || fail "the refused takeover changed something"
    # The refused package is left not installed (preinst stops it before any file), so there is
    # nothing to purge; a purge would take the archive install's settings file.
    inside 'dpkg-query -W -f "\${db:Status-Status}" pecklist 2> /dev/null' | grep -qx installed &&
      fail "the refused package shows as installed"
    inside 'rm -r /opt/pecklist/data'
  fi

  say "$distro: install the previous version (0.0.1)"
  install_pkg "/packages/test/$server /packages/test/$cli"
  if [ "$distro" = debian ]; then
    inside '[ ! -e /opt/pecklist ] && [ ! -e /etc/systemd/system/pecklist.service ]' || fail "the archive install was not taken over"
    inside 'systemctl is-active --quiet pecklist' || fail "the taken-over server is not running"
  elif [ "$family" = deb ]; then
    inside 'systemctl is-active --quiet pecklist' || fail "Debian and Ubuntu start the service on install"
  else
    inside 'systemctl is-active --quiet pecklist' && fail "Fedora, RHEL and openSUSE leave the service off on install"
    inside 'systemctl enable --now pecklist'
  fi
  healthy
  inside 'stat -c "%U:%G %a" /var/lib/pecklist' | grep -qx 'pecklist:pecklist 750' || fail "the data folder's owner or mode"
  inside 'stat -c "%G %a" /etc/pecklist/pecklist.conf' | grep -qx 'pecklist 640' || fail "the settings file's group or mode"
  inside 'pecklist-server admin add-user kept-across > /dev/null'
  before=$(snapshots)

  say "$distro: upgrade to this build"
  install_pkg "/packages/$server /packages/$cli"
  [ "$(snapshots)" -gt "$before" ] || fail "no snapshot before the upgrade"
  inside 'systemctl is-active --quiet pecklist' || fail "the service is not running after the upgrade"
  healthy
  inside 'pecklist-server export' | grep -q '"kept-across"' || fail "an account made before the upgrade is gone"
  if [ "$distro" = debian ]; then
    inside 'pecklist-server export' | grep -q '"from-archive"' || fail "the archive install's data is gone"
  fi
  # A password sign-in under the unit's hardening (the system call filter, no capabilities).
  password=$(inside 'pecklist-server admin add-user sign-in-check' | sed -n 's/.*Password: //p')
  inside "curl -fsS -o /dev/null -H 'Content-Type: application/json' -d '{\"username\":\"sign-in-check\",\"password\":\"$password\"}' http://localhost:8080/auth/login" ||
    fail "a password sign-in"
  inside 'journalctl -u pecklist --no-pager' | grep -q 'SECCOMP\|code=killed' && fail "the system call filter stopped the server"
  # For the record: how exposed systemd rates the unit.
  inside 'systemd-analyze security pecklist --no-pager 2>/dev/null | tail -1' || true
  inside 'pecklist -v' | grep -q '(client)' || fail "pecklist -v"
  inside 'pecklist-server snapshot > /dev/null' || fail "pecklist-server snapshot"
  inside 'pecklist-server' | grep -q 'Usage: pecklist' || fail "pecklist-server with no command shows the help"
  inside 'ldconfig -p | grep -q "libssl.so.3"' || fail "OpenSSL 3 is not installed with the package"
  inside '[ -f /usr/share/bash-completion/completions/pecklist ]' || fail "no bash completion"

  say "$distro: remove"
  case "$family" in
    deb) inside 'DEBIAN_FRONTEND=noninteractive apt-get remove -y -qq pecklist pecklist-cli > /dev/null' ;;
    rpm) inside 'dnf remove -y -q pecklist pecklist-cli' ;;
    suse) inside 'zypper --non-interactive -q remove pecklist pecklist-cli' ;;
  esac
  inside 'systemctl is-active --quiet pecklist' && fail "the service still runs after removal"
  inside '[ ! -e /usr/lib/systemd/system/pecklist.service ] && [ ! -e /usr/bin/pecklist ]' || fail "files left after removal"
  inside '[ -f /var/lib/pecklist/pecklist.db ] && [ -f /etc/pecklist/pecklist.conf ]' || fail "removal lost the data or the settings"

  if [ "$family" = deb ]; then
    say "$distro: purge"
    inside 'DEBIAN_FRONTEND=noninteractive apt-get purge -y -qq pecklist > /dev/null'
    inside '[ ! -e /etc/pecklist/pecklist.conf ] && [ ! -e /etc/pecklist/pecklist.env ]' || fail "purge left the settings"
    inside '[ -f /var/lib/pecklist/pecklist.db ]' || fail "purge deleted the database"
  fi

  say "$distro: install again, on the data that stayed"
  install_pkg "/packages/$server"
  inside 'systemctl is-active --quiet pecklist' || inside 'systemctl enable --now pecklist'
  healthy
  inside 'pecklist-server export' | grep -q '"kept-across"' || fail "the data that stayed is not picked up"

  docker rm -f "$container" > /dev/null
  trap - EXIT
  echo "PASS ($distro)"
}

# arm64 under QEMU: no systemd (too slow to boot emulated). The package installs, its scripts cope
# without systemd, and the programs run.
test_arm64() {
  distro=arm64
  say "arm64: Debian, emulated"
  docker run --rm --platform linux/arm64 "$debian_base" true > /dev/null 2>&1 ||
    fail "no arm64 binfmt on this runner: this Docker cannot run arm64 containers (register QEMU binfmt: docker run --privileged --rm tonistiigi/binfmt --install arm64)"
  container="pecklist-package-test-arm64-$$"
  docker run -d --name "$container" --platform linux/arm64 "$debian_base" sleep infinity > /dev/null
  trap 'docker rm -f "$container" > /dev/null 2>&1 || true' EXIT
  docker cp "$dist/." "$container:/packages"
  inside 'apt-get update -qq && apt-get install -y -qq curl > /dev/null'
  inside 'DEBIAN_FRONTEND=noninteractive apt-get install -y -qq /packages/pecklist_arm64.deb /packages/pecklist-cli_arm64.deb > /dev/null'
  inside 'pecklist -v' | grep -q '(client)' || fail "pecklist -v"
  inside 'pecklist-server --version > /dev/null' || fail "pecklist-server --version"
  inside 'cd /var/lib/pecklist && set -a && . /etc/pecklist/pecklist.env && set +a && setpriv --reuid=pecklist --regid=pecklist --init-groups /usr/lib/pecklist/pecklist > /tmp/server.log 2>&1 &'
  for _ in $(seq 1 120); do
    if inside 'curl -fsS http://localhost:8080/healthz' > /dev/null 2>&1; then break; fi
    sleep 1
  done
  inside 'curl -fsS http://localhost:8080/healthz' > /dev/null || { inside 'tail -30 /tmp/server.log'; fail "the arm64 server does not answer"; }
  docker rm -f "$container" > /dev/null
  trap - EXIT
  echo "PASS (arm64)"
}

for each in $distros; do
  if [ "$each" = arm64 ]; then
    (test_arm64) || failed="$failed $each"
  else
    (test_distro "$each") || failed="$failed $each"
  fi
done
if [ -n "$failed" ]; then
  echo "Failed:$failed" >&2
  exit 1
fi
echo "All package tests passed: $distros"
