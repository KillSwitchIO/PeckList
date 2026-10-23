#!/usr/bin/env bash
# Install (or upgrade) the native Linux download as a systemd service. Run it from the unpacked
# archive as root:
#   tar -xzf punchlist-linux-x64.tar.gz
#   sudo punchlist-linux-x64/examples/install.sh
#
#   /opt/punchlist            the program (replaced on every run)
#   /etc/punchlist            punchlist.conf, your settings (kept)
#   /var/lib/punchlist        the database, snapshots and logs (kept)
#
# Upgrading is the same command with the newer archive; your settings and data stay.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo)." >&2; exit 1; }
command -v systemctl >/dev/null || { echo "This script needs systemd." >&2; exit 1; }

here=$(cd "$(dirname "$0")" && pwd)
app=$(cd "$here/.." && pwd)
[ -x "$app/punchlist" ] || { echo "Run this from the unpacked download (no punchlist next to it)." >&2; exit 1; }

if ! id punchlist >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/punchlist --shell /usr/sbin/nologin punchlist
fi
install -d -o punchlist -g punchlist -m 750 /var/lib/punchlist
install -d -m 755 /etc/punchlist

upgrading=false
if systemctl is-active --quiet punchlist; then
  upgrading=true
  echo "Stopping the running server for the upgrade..."
  systemctl stop punchlist
fi

rm -rf /opt/punchlist.new
cp -a "$app" /opt/punchlist.new
rm -rf /opt/punchlist.old
[ -d /opt/punchlist ] && mv /opt/punchlist /opt/punchlist.old
mv /opt/punchlist.new /opt/punchlist
chown -R root:root /opt/punchlist
chmod 755 /opt/punchlist/punchlist

if [ ! -f /etc/punchlist/punchlist.conf ]; then
  install -m 640 -g punchlist "$here/punchlist.conf" /etc/punchlist/punchlist.conf
fi
install -m 644 "$here/punchlist.service" /etc/systemd/system/punchlist.service
systemctl daemon-reload
systemctl enable --now punchlist
rm -rf /opt/punchlist.old

/opt/punchlist/punchlist --version
if $upgrading; then
  echo "Upgraded and started. Check it: systemctl status punchlist"
else
  echo "Started on port 8080. The first admin password is in: journalctl -u punchlist"
  echo "Settings: /etc/punchlist/punchlist.conf (then: systemctl restart punchlist)"
fi
