# rpm %preun ($1: 0 removal, 1 or more upgrade): stop and disable the service on removal only.
if [ "$1" -eq 0 ] && pl_systemd; then
  systemctl disable --now pecklist.service >/dev/null 2>&1 || true
fi
exit 0
