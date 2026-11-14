# deb postinst: the user, folders and settings, then the service enabled and (re)started, as Debian
# packages do. The service parts are what dh_installsystemd writes, so a service an admin disabled
# stays disabled across upgrades.
case "$1" in
  configure | abort-upgrade | abort-deconfigure | abort-remove)
    if [ "$1" = configure ]; then
      pl_setup
      pl_take_over_archive_install
    fi
    # Only removes a mask that deb-systemd-helper made when the package was removed.
    deb-systemd-helper unmask pecklist.service >/dev/null || true
    # was-enabled is true for a unit it has never seen, so a new install is enabled.
    if deb-systemd-helper --quiet was-enabled pecklist.service; then
      deb-systemd-helper enable pecklist.service >/dev/null || true
    else
      deb-systemd-helper update-state pecklist.service >/dev/null || true
    fi
    if pl_systemd; then
      systemctl --system daemon-reload >/dev/null || true
      if [ -n "${2:-}" ]; then action=restart; else action=start; fi
      deb-systemd-invoke "$action" pecklist.service >/dev/null || true
    fi
    if [ "$1" = configure ] && [ -z "${2:-}" ]; then pl_first_words; fi
    ;;
esac
exit 0
