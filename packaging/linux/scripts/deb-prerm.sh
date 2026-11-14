# deb prerm: stop the service on removal. An upgrade leaves it running; postinst restarts it.
if [ "$1" = remove ] && pl_systemd; then
  deb-systemd-invoke stop pecklist.service >/dev/null || true
fi
exit 0
