# deb preinst: before the files change, a snapshot by the program that is there now.
case "$1" in
  install)
    if pl_archive_install; then
      pl_check_archive_takeover
      pl_snapshot /opt/pecklist/pecklist
    fi
    ;;
  upgrade)
    pl_snapshot /usr/lib/pecklist/pecklist
    ;;
esac
exit 0
