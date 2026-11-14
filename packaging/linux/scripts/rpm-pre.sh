# rpm %pre ($1: 1 install, 2 or more upgrade): before the files change, a snapshot by the program
# that is there now.
if [ "$1" -ge 2 ]; then
  pl_snapshot /usr/lib/pecklist/pecklist
elif pl_archive_install; then
  pl_check_archive_takeover
  pl_snapshot /opt/pecklist/pecklist
fi
exit 0
