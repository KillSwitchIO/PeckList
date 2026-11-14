#!/bin/sh
# Tries the x64 AppImages (PL-132) as someone would, as a plain user in clean Debian and Fedora
# containers:
#   - the server starts in the terminal, says where it is, prints the first admin password, answers
#     /healthz and a sign-in on localhost but not on the container's address, and keeps its data in
#     ~/.local/share/pecklist with mode 700
#   - a maintenance command (help) runs on the same data
#   - the command line answers --version
# Containers have no FUSE, so the AppImages run with APPIMAGE_EXTRACT_AND_RUN=1 (unpacked to a temp
# folder first); on a desktop they mount instead, which is the same files.
#   sh scripts/ci/appimage-test.sh [dist]        (on a host with Docker, as the package test)
set -eu

dist=$(cd "${1:-dist}" && pwd)
# Just the two AppImages, staged once for the containers below.
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
mkdir "$stage/dist"
for file in pecklist-server-linux-x64.AppImage pecklist-cli-linux-x64.AppImage; do
  [ -f "$dist/$file" ] || { echo "no $dist/$file" >&2; exit 1; }
  cp "$dist/$file" "$stage/dist/"
done

# The AppImages are copied into each container, not mounted: in CI the job talks to the host's
# Docker, which cannot see the job's files (package-test.sh copies its packages in the same way).
check() { # name, image, setup
  echo "=== $1"
  container=$(docker create "$2" sh -c "
    set -e
    chmod a+rx /dist /dist/*.AppImage
    $3
    useradd -m tryer
    su tryer -s /bin/sh -c '
      set -e
      cd ~ && export APPIMAGE_EXTRACT_AND_RUN=1
      /dist/pecklist-server-linux-x64.AppImage > server.log 2>&1 &
      started=\$!
      for i in \$(seq 60); do curl -fs http://localhost:8080/healthz >/dev/null 2>&1 && break; sleep 1; done
      curl -fs http://localhost:8080/healthz > /dev/null || { cat server.log; echo \"no /healthz\"; exit 1; }
      grep -q \"PeckList on http://localhost:8080\" server.log || { cat server.log; echo \"no address line\"; exit 1; }
      password=\$(sed -n \"s/^ *password: *//p\" server.log | head -1)
      [ -n \"\$password\" ] || { cat server.log; echo \"no first admin password\"; exit 1; }
      code=\$(curl -s -o /dev/null -w \"%{http_code}\" -H \"Content-Type: application/json\" \
        -d \"{\\\"username\\\":\\\"admin\\\",\\\"password\\\":\\\"\$password\\\"}\" http://localhost:8080/auth/login)
      [ \"\$code\" = 200 ] || { echo \"sign-in answered \$code\"; exit 1; }
      [ -f ~/.local/share/pecklist/pecklist.db ] || { echo \"no database in ~/.local/share/pecklist\"; exit 1; }
      [ \"\$(stat -c %a ~/.local/share/pecklist)\" = 700 ] || { echo \"the data folder is not 700\"; exit 1; }
      ip=\$(getent hosts \$(cat /etc/hostname) | cut -d\" \" -f1 | head -n 1)
      [ -n \"\$ip\" ] || { echo \"no address for this container\"; exit 1; }
      ! curl -fs --max-time 3 http://\$ip:8080/healthz > /dev/null 2>&1 ||
        { echo \"it answers on \$ip, not only on localhost\"; exit 1; }
      echo \"server: /healthz, sign-in, localhost only and ~/.local/share/pecklist (700) ok\"
      # The runtime and the server program (named pecklist) under it; -x matches that name only.
      kill \$started 2>/dev/null || true
      pkill -x pecklist 2>/dev/null || true
      wait 2>/dev/null || true
      /dist/pecklist-server-linux-x64.AppImage help > help.log 2>&1 || { cat help.log; exit 1; }
      grep -qi snapshot help.log || { cat help.log; echo \"help does not list snapshot\"; exit 1; }
      grep -q \"first start\" server.log || { echo \"no first-start line on the first start\"; exit 1; }
      # A file argument is where it was started, not in the data folder.
      /dist/pecklist-server-linux-x64.AppImage export backup.json > export.log 2>&1 || { cat export.log; exit 1; }
      [ -s ~/backup.json ] || { cat export.log; echo \"export backup.json did not land in ~\"; exit 1; }
      echo \"server: maintenance commands (help, export to a relative file) ok\"
      # A relative data folder, started a second time: no doubled path, no first-start line.
      for run in 1 2; do
        PECKLIST_DATA=pl-test ASPNETCORE_URLS=http://localhost:8081 \
          /dist/pecklist-server-linux-x64.AppImage > rel\$run.log 2>&1 &
        started=\$!
        for i in \$(seq 60); do curl -fs http://localhost:8081/healthz >/dev/null 2>&1 && break; sleep 1; done
        curl -fs http://localhost:8081/healthz > /dev/null || { cat rel\$run.log; echo \"no /healthz with a relative folder\"; exit 1; }
        kill \$started 2>/dev/null || true
        pkill -x pecklist 2>/dev/null || true
        wait 2>/dev/null || true
      done
      [ -f ~/pl-test/pecklist.db ] && [ ! -e ~/pl-test/pl-test ] || { ls -R ~/pl-test; echo \"relative PECKLIST_DATA went astray\"; exit 1; }
      ! grep -q \"first start\" rel2.log || { cat rel2.log; echo \"first-start line on a later start\"; exit 1; }
      echo \"server: relative PECKLIST_DATA and the first-start line ok\"
      /dist/pecklist-cli-linux-x64.AppImage --version | tee cli.log
      grep -q \"(client)\" cli.log
      echo \"cli: ok\"
    '
  ")
  status=0
  { docker cp "$stage/dist" "$container:/dist" && docker start -a "$container"; } || status=$?
  docker rm -f "$container" > /dev/null
  return "$status"
}

check debian debian:12@sha256:268fb24c39bca92d326dd83ea3abebe4a3f7751c804ffef23bb6d857dd343ff8 \
  'apt-get update -qq && apt-get install -y -qq --no-install-recommends curl ca-certificates procps > /dev/null'
check fedora fedora:43@sha256:f01112b9a1f1d0504ad962d9adfa401425033f8ab067e0a821904ebdde5b8ca5 \
  'dnf install -y -q curl procps-ng shadow-utils util-linux > /dev/null'
echo "AppImages: all checks passed"
