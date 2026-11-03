#!/usr/bin/env bash
# Install (or upgrade) the native Linux download as a systemd service. Run it from the unpacked
# archive as root:
#   tar -xzf pecklist-linux-x64.tar.gz
#   sudo pecklist-linux-x64/examples/install.sh
#
#   /opt/pecklist            the program (replaced on every run)
#   /etc/pecklist            pecklist.conf, your settings (kept)
#   /var/lib/pecklist        the database, snapshots and logs (kept)
#
# Upgrading is the same command with the newer archive; your settings and data stay. An install
# from before the rename (Punchlist: /opt/punchlist, /etc/punchlist, /var/lib/punchlist, the
# punchlist user and service) is moved over to the new names first, data and settings included.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo)." >&2; exit 1; }
command -v systemctl >/dev/null || { echo "This script needs systemd." >&2; exit 1; }

here=$(cd "$(dirname "$0")" && pwd)
app=$(cd "$here/.." && pwd)
[ -x "$app/pecklist" ] || { echo "Run this from the unpacked download (no pecklist next to it)." >&2; exit 1; }

# --- Moving over from Punchlist, once ------------------------------------------------------------
if [ ! -d /var/lib/pecklist ] && { [ -d /var/lib/punchlist ] || [ -f /etc/systemd/system/punchlist.service ]; }; then
  echo "Moving the Punchlist install over to PeckList..."
  upgrading_from_punchlist=true
  if systemctl is-active --quiet punchlist; then systemctl stop punchlist; fi
  systemctl disable punchlist >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/punchlist.service
  systemctl daemon-reload
  if id punchlist >/dev/null 2>&1 && ! id pecklist >/dev/null 2>&1; then
    usermod -l pecklist -d /var/lib/pecklist punchlist
    if getent group punchlist >/dev/null; then groupmod -n pecklist punchlist; fi
  fi
  if [ -d /var/lib/punchlist ]; then
    mv /var/lib/punchlist /var/lib/pecklist
    # The database and its write-ahead files, together (the server is stopped).
    for suffix in "" -wal -shm; do
      if [ -f "/var/lib/pecklist/punchlist.db$suffix" ]; then
        mv "/var/lib/pecklist/punchlist.db$suffix" "/var/lib/pecklist/pecklist.db$suffix"
      fi
    done
  fi
  if [ -f /etc/punchlist/punchlist.conf ] && [ ! -f /etc/pecklist/pecklist.conf ]; then
    install -d -m 755 /etc/pecklist
    sed -e 's#/var/lib/punchlist/punchlist\.db#/var/lib/pecklist/pecklist.db#g' \
        -e 's#/var/lib/punchlist#/var/lib/pecklist#g' \
        /etc/punchlist/punchlist.conf > /etc/pecklist/pecklist.conf
    echo "Settings moved to /etc/pecklist/pecklist.conf; the old file stays in /etc/punchlist until you remove it."
  fi
  rm -rf /opt/punchlist
fi

if ! id pecklist >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/pecklist --shell /usr/sbin/nologin pecklist
fi
install -d -o pecklist -g pecklist -m 750 /var/lib/pecklist
chown -R pecklist:pecklist /var/lib/pecklist
install -d -m 755 /etc/pecklist

upgrading=${upgrading_from_punchlist:-false}
if systemctl is-active --quiet pecklist; then
  upgrading=true
  echo "Stopping the running server for the upgrade..."
  systemctl stop pecklist
fi

rm -rf /opt/pecklist.new
cp -a "$app" /opt/pecklist.new
rm -rf /opt/pecklist.old
[ -d /opt/pecklist ] && mv /opt/pecklist /opt/pecklist.old
mv /opt/pecklist.new /opt/pecklist
chown -R root:root /opt/pecklist
chmod 755 /opt/pecklist/pecklist

if [ ! -f /etc/pecklist/pecklist.conf ]; then
  install -m 640 -g pecklist "$here/pecklist.conf" /etc/pecklist/pecklist.conf
else
  chmod 640 /etc/pecklist/pecklist.conf
  chgrp pecklist /etc/pecklist/pecklist.conf
fi
install -m 644 "$here/pecklist.service" /etc/systemd/system/pecklist.service
systemctl daemon-reload
systemctl enable --now pecklist
rm -rf /opt/pecklist.old

/opt/pecklist/pecklist --version
if $upgrading; then
  echo "Upgraded and started. Check it: systemctl status pecklist"
else
  echo "Started on port 8080. The first admin password is in: journalctl -u pecklist"
  echo "Settings: /etc/pecklist/pecklist.conf (then: systemctl restart pecklist)"
fi
