@echo off
rem PeckList's maintenance commands with the service's settings (PL-132), from an elevated prompt:
rem   pecklist-server snapshot
rem   pecklist-server admin reset-password admin
rem The command line itself is pecklist; this runs the server program next to the service.
net session >nul 2>&1
if errorlevel 1 (
  echo pecklist-server: run this from an elevated prompt ^(Run as administrator^). 1>&2
  exit /b 1
)
setlocal
set "DB_PATH=%ProgramData%\PeckList\pecklist.db"
set "CONFIG_FILE=%ProgramData%\PeckList\pecklist.conf"
"%~dp0..\pecklist.exe" %*
exit /b %errorlevel%
