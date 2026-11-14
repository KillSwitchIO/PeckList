# rpm %post ($1: 1 install, 2 or more upgrade): the user, folders and settings. As Fedora and
# openSUSE packages do, a new install follows the system's preset (normally: not started); the
# upgrade's restart comes from the old package's %postun.
pl_setup
pl_take_over_archive_install
if pl_systemd; then
  systemctl daemon-reload >/dev/null 2>&1 || true
fi
if [ "$1" -eq 1 ]; then
  if pl_systemd; then
    if [ -n "$pl_was_running" ]; then
      systemctl enable --now pecklist.service >/dev/null 2>&1 || true
    else
      systemctl preset pecklist.service >/dev/null 2>&1 || true
    fi
  fi
  pl_first_words
fi
exit 0
