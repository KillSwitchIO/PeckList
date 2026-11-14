# Windows

Each [release](https://gitlab.com/killswitch10/pecklist/-/releases) has an installer for **Windows
x64** (Windows 10, 11, Server 2019 and later; it also runs on Windows on ARM): the server as a
Windows service and the `pecklist` command line, with everything they need built in. A portable zip
is there too, for running the server from a folder.

## Install

Download `pecklist-setup-<version>-x64.exe` from the release page and run it. Both parts are ticked:

- **Server (Windows service):** the **PeckList** service, started now and with Windows.
- **Command line:** `pecklist` on PATH (the arm64 build on Windows on ARM). Untick the server for
  the command line alone.

Choose the port (8080 unless you change it) and whether to allow it through the firewall on private
networks. The last page shows the **admin password** to sign in with at `http://localhost:8080`;
you choose your own at the first sign-in. The password is also in
`C:\ProgramData\PeckList\first-admin-password.txt`, readable by administrators only, and stops working
once you change it.

### "Windows protected your PC"

The installer is not code-signed, so SmartScreen stops it the first time: choose **More info**, then
**Run anyway**. To check the file first, compare its hash with `SHA256SUMS` from the same release:

```powershell
$hash = (Get-FileHash .\pecklist-setup-0.12.0-x64.exe -Algorithm SHA256).Hash.ToLower()
$listed = ((Select-String 'pecklist-setup-0.12.0-x64.exe' .\SHA256SUMS).Line -split '\s+')[0]
$hash -eq $listed   # True: the file is the one the release lists
```

### "An Application Control policy has blocked this file"

If Windows says an Application Control policy blocked the file, Smart App Control is on and doesn't
trust this unsigned build, and there is no **Run anyway**. Run the server in
[Docker Desktop](docker.md) instead, or the [command line](../reference/cli.md) inside WSL (the
Linux download). Signed Store builds may come after 1.0.

### Silent install

For scripts and remote installs, from an elevated prompt:

```powershell
.\pecklist-setup-0.12.0-x64.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /PORT=8080 /OPENFIREWALL
Get-Content C:\ProgramData\PeckList\first-admin-password.txt
```

`/COMPONENTS="cli"` installs the command line alone. The exit code is 0 when it worked, and 10 when the
files went in but the service did not start: `C:\ProgramData\PeckList\setup-service.log` says why.
An install into a folder of your own (`/DIR=`) is locked like `C:\Program Files`: only administrators
may change it. To change what is installed (from both parts to the command line alone, say),
uninstall first: running the installer again with fewer parts leaves the others in place.

### winget

Each final release is offered to winget as two packages, `PeckList.PeckList` (the installer) and
`PeckList.CLI` (the command line alone, as one file). Once a release's manifests are accepted there:

```powershell
winget install PeckList.PeckList
winget install PeckList.CLI
```

Install one or the other: the installer has the command line too.

## Where things are

| Path                                    | What                                                             | On upgrade | On uninstall |
| --------------------------------------- | ---------------------------------------------------------------- | ---------- | ------------ |
| `C:\Program Files\PeckList`             | The server                                                       | Replaced   | Removed      |
| `C:\Program Files\PeckList\bin`         | `pecklist` and `pecklist-server`, on PATH                        | Replaced   | Removed      |
| `C:\ProgramData\PeckList\pecklist.conf` | Your settings ([settings file](../configuration/config-file.md)) | Kept       | Kept         |
| `C:\ProgramData\PeckList`               | Database, snapshots, logs                                        | Kept       | Kept         |

The service runs as its own virtual account, `NT SERVICE\PeckList`, which may change only the data
folder. Only administrators and the service can open that folder. The service restarts by itself
after a crash.

Installing again after an uninstall picks up the kept data as it was, with your admin password. If
someone other than an administrator made `C:\ProgramData\PeckList` before the first install, the
installer does not use it: it renames it to `PeckList.untrusted-<date>` and starts a new one.
Settings or database files in the data folder that an administrator or the service did not make are
not used either: a copy goes to `<file>.untrusted-<date>`, the settings file starts again from the
example, and `setup-service.log` says so.

## Day to day

```powershell
Get-Service PeckList
Restart-Service PeckList          # after editing C:\ProgramData\PeckList\pecklist.conf
Get-Content C:\ProgramData\PeckList\logs\*.log -Tail 50   # log files (JSON lines)
```

Start, stop and crash messages are also in **Event Viewer > Windows Logs > Application**.

Maintenance commands run against the service's database with `pecklist-server`, in an elevated
prompt:

```powershell
pecklist-server snapshot
pecklist-server admin reset-password admin
```

`pecklist` itself is the [command line](../reference/cli.md), for any server:
`pecklist login --server http://localhost:8080`.

## Upgrade

Run the newer release's installer. It stops the service, replaces the program, keeps your port,
settings, data and anything you added to the service's environment (such as HTTPS below), and starts
it again. Read [upgrading](../guides/upgrading.md) first.

A service made with the portable zip's `install-service.ps1` upgrades the same way: the installer
takes it over and keeps its data.

## Uninstall

**Settings > Apps > PeckList > Uninstall.** It removes the service and the program, then asks whether
to delete the data too (no, unless you say so). A silent uninstall
(`"C:\Program Files\PeckList\unins000.exe" /VERYSILENT`) always keeps the data.

## HTTPS

Put a reverse proxy in front ([Caddy for Windows](https://caddyserver.com/docs/install) is the
simplest, see [reverse proxy and HTTPS](reverse-proxy.md)), or give the server a certificate itself,
in the service's environment (the `Environment` value under
`HKLM\SYSTEM\CurrentControlSet\Services\PeckList`, then `Restart-Service PeckList`):

```text
ASPNETCORE_URLS=https://+:8443
ASPNETCORE_Kestrel__Certificates__Default__Path=C:\ProgramData\PeckList\cert.pfx
```

Export the certificate as a `.pfx` **without a password** into `C:\ProgramData\PeckList`, which only
administrators and the service can open. A password in the service's environment would be readable
by every user of the computer, since anyone can read a service's settings.

## Portable

`pecklist-server-win-x64-portable.zip` is the server in a folder, with nothing to install. Run it by
hand:

```powershell
Expand-Archive pecklist-server-win-x64-portable.zip -DestinationPath .
cd pecklist-server-win-x64
$env:ASPNETCORE_HTTP_PORTS = '8080'
.\pecklist.exe
```

The first admin password is printed in that window, and data goes to `.\data`. The zip also has
`examples\install-service.ps1`, which makes the same service as the installer from an elevated
PowerShell (`-Port 9000`, `-OpenFirewall`), and `examples\uninstall-service.ps1` (`-RemoveData` to
delete the data too).

The command line alone is `pecklist-cli-win-x64-portable.zip` (or `-win-arm64-`): one
`pecklist.exe`, nothing to install.

<details>
<summary>install-service.ps1</summary>

```powershell
--8<-- "examples/windows/install-service.ps1"
```

</details>
