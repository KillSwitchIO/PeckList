# --- Shared by the PeckList server package's scripts -----------------------------------------------
# scripts/package.sh puts this in front of each deb and rpm script body in this folder.

pl_systemd() { [ -d /run/systemd/system ]; }

# The archive download's installer (examples/linux/install.sh) wrote this unit. Left in place it
# would hide the package's own unit, so the package takes that install over.
pl_archive_unit=/etc/systemd/system/pecklist.service
pl_archive_install() {
  [ -f "$pl_archive_unit" ] && grep -q '^ExecStart=/opt/pecklist/pecklist' "$pl_archive_unit"
}

# A snapshot by the program installed now (the old one, before an upgrade): the way back if the new
# program's database migration fails. A failed snapshot stops the upgrade; PECKLIST_SKIP_SNAPSHOT=1
# goes on without one.
pl_snapshot() {
  pl_program=$1
  [ -x "$pl_program" ] || return 0
  id pecklist >/dev/null 2>&1 || return 0
  if [ "${PECKLIST_SKIP_SNAPSHOT:-}" = 1 ]; then
    echo "PeckList: no snapshot before this upgrade (PECKLIST_SKIP_SNAPSHOT=1)."
    return 0
  fi
  if ! (
    DB_PATH=/var/lib/pecklist/pecklist.db
    CONFIG_FILE=/etc/pecklist/pecklist.conf
    if [ -r /etc/pecklist/pecklist.env ]; then
      set -a
      . /etc/pecklist/pecklist.env
      set +a
    fi
    # PostgreSQL has no file to look for; SQLite with no file yet has nothing to keep.
    if [ "${DB_PROVIDER:-sqlite}" != postgres ] && [ ! -f "$DB_PATH" ]; then exit 0; fi
    export DB_PATH CONFIG_FILE
    cd /var/lib/pecklist
    echo "PeckList: taking a snapshot before the upgrade..."
    # In its own session with no input: the service user never gets root's terminal.
    setsid -w env HOME=/var/lib/pecklist USER=pecklist LOGNAME=pecklist \
      setpriv --reuid=pecklist --regid=pecklist --init-groups -- "$pl_program" snapshot </dev/null
  ); then
    echo "PeckList: the snapshot before the upgrade failed, so nothing has changed. Fix the cause" \
      "above, or run the upgrade again with PECKLIST_SKIP_SNAPSHOT=1 to go on without one." >&2
    return 1
  fi
}

# The user, the data folder and the settings file. The settings file is copied once, not shipped as
# a config file, so an archive install's /etc/pecklist/pecklist.conf is kept without a question.
# Sets pl_had_data when a database is already there (a reinstall, or a takeover).
pl_had_data=
pl_setup() {
  if [ -f /var/lib/pecklist/pecklist.db ]; then pl_had_data=1; fi
  if command -v systemd-sysusers >/dev/null 2>&1; then
    systemd-sysusers /usr/lib/sysusers.d/pecklist.conf
  elif ! id pecklist >/dev/null 2>&1; then
    useradd --system --user-group --home-dir /var/lib/pecklist --shell /usr/sbin/nologin pecklist
  fi
  if command -v systemd-tmpfiles >/dev/null 2>&1; then
    systemd-tmpfiles --create /usr/lib/tmpfiles.d/pecklist.conf
  else
    install -d -o pecklist -g pecklist -m 750 /var/lib/pecklist
  fi
  if [ ! -f /etc/pecklist/pecklist.conf ]; then
    install -m 640 -g pecklist /usr/share/pecklist/pecklist.conf /etc/pecklist/pecklist.conf
  fi
  chgrp pecklist /etc/pecklist/pecklist.conf /etc/pecklist/pecklist.env
  chmod 640 /etc/pecklist/pecklist.conf /etc/pecklist/pecklist.env
}

# Before the files change (preinst, %pre): /opt/pecklist goes in the takeover, so nothing of the
# admin's may live there: a database moved in, or an override that points the service at it.
pl_check_archive_takeover() {
  pl_archive_install || return 0
  if [ -n "$(find /opt/pecklist -maxdepth 3 -name '*.db*' 2>/dev/null | head -n 1)" ] ||
    grep -qs /opt/pecklist /etc/systemd/system/pecklist.service.d/*.conf; then
    echo "PeckList: /opt/pecklist holds a database, or an override in" \
      "/etc/systemd/system/pecklist.service.d points at it. The package would delete that folder," \
      "so nothing has changed. Move the data to /var/lib/pecklist (and DB_PATH with it), drop" \
      "the override's /opt/pecklist lines, then install again." >&2
    return 1
  fi
}

# Takes over an archive install: its unit and /opt/pecklist go, its settings and data stay.
# Sets pl_was_running when that server was running, so the package starts it again.
pl_was_running=
pl_take_over_archive_install() {
  pl_archive_install || return 0
  echo "PeckList: moving the install in /opt/pecklist over to this package. Settings and data stay."
  if pl_systemd; then
    if systemctl is-active --quiet pecklist; then pl_was_running=1; fi
    systemctl stop pecklist >/dev/null 2>&1 || true
    systemctl disable pecklist >/dev/null 2>&1 || true
  fi
  rm -f "$pl_archive_unit"
  rm -rf /opt/pecklist /opt/pecklist.old /opt/pecklist.new
  if [ -d /etc/systemd/system/pecklist.service.d ]; then
    echo "PeckList: your overrides in /etc/systemd/system/pecklist.service.d still apply. A port set" \
      "there is now overridden by /etc/pecklist/pecklist.env: set ASPNETCORE_HTTP_PORTS there instead."
  fi
  if pl_systemd; then systemctl daemon-reload; fi
}

pl_first_words() {
  if [ -n "$pl_had_data" ]; then
    if pl_systemd && systemctl is-active --quiet pecklist; then
      echo "PeckList is running, on the data already in /var/lib/pecklist."
    else
      echo "PeckList is installed, on the data already in /var/lib/pecklist. Start it: sudo systemctl enable --now pecklist"
    fi
  elif pl_systemd && systemctl is-active --quiet pecklist; then
    echo "PeckList is running on port 8080. The first admin password: sudo journalctl -u pecklist"
  else
    echo "PeckList is installed. Start it: sudo systemctl enable --now pecklist"
    echo "Then the first admin password is in: sudo journalctl -u pecklist"
  fi
  echo "Settings: /etc/pecklist/pecklist.conf and /etc/pecklist/pecklist.env (then: sudo systemctl restart pecklist)"
  echo "Maintenance commands: sudo pecklist-server help"
}

# --- This script ---------------------------------------------------------------------------------
