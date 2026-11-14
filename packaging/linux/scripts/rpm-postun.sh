# rpm %postun ($1: 0 removal, 1 or more upgrade): after an upgrade, restart a running service on
# the new program. Data and pecklist.conf always stay; rpm removes an unedited pecklist.env and
# keeps an edited one as pecklist.env.rpmsave.
if pl_systemd; then
  systemctl daemon-reload >/dev/null 2>&1 || true
  if [ "$1" -ge 1 ]; then
    systemctl try-restart pecklist.service >/dev/null 2>&1 || true
  fi
fi
if [ "$1" -eq 0 ]; then
  echo "PeckList removed. Data in /var/lib/pecklist and /etc/pecklist/pecklist.conf are kept" \
    "(an edited pecklist.env as pecklist.env.rpmsave)."
fi
exit 0
