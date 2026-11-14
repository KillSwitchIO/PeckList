# deb postrm: remove keeps the settings and data; purge removes the settings and keeps the data
# (the database is too precious to go with a package command).
case "$1" in
  remove)
    if [ -x /usr/bin/deb-systemd-helper ]; then
      deb-systemd-helper mask pecklist.service >/dev/null || true
    fi
    echo "PeckList removed. Settings in /etc/pecklist and data in /var/lib/pecklist are kept."
    ;;
  purge)
    if [ -x /usr/bin/deb-systemd-helper ]; then
      deb-systemd-helper purge pecklist.service >/dev/null || true
      deb-systemd-helper unmask pecklist.service >/dev/null || true
    fi
    rm -f /etc/pecklist/pecklist.conf
    rmdir /etc/pecklist 2>/dev/null || true
    echo "PeckList purged. Your data is still in /var/lib/pecklist: delete it yourself when sure."
    ;;
esac
if pl_systemd; then
  systemctl --system daemon-reload >/dev/null || true
fi
exit 0
