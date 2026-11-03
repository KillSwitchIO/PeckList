# Windows

Each [release](https://gitlab.com/killswitch10/pecklist/-/releases) has a self-contained download
for **Windows x64** (Windows 10, 11, Server 2019 and later). Nothing else to install.

## Install as a service

In an **elevated** PowerShell (Run as administrator), from the folder you downloaded to:

```powershell
$base = 'https://gitlab.com/killswitch10/pecklist/-/releases/permalink/latest/downloads'
Invoke-WebRequest "$base/pecklist-win-x64.zip" -OutFile pecklist-win-x64.zip
Invoke-WebRequest "$base/SHA256SUMS" -OutFile SHA256SUMS
# The two hashes must match:
(Get-FileHash pecklist-win-x64.zip -Algorithm SHA256).Hash.ToLower()
Select-String 'win-x64' SHA256SUMS
Expand-Archive pecklist-win-x64.zip -DestinationPath .
& .\pecklist-win-x64\examples\install-service.ps1
```

The script installs and starts the **PeckList** service and prints the admin password to sign in
with (and change). Options: `-Port 9000` for another port, `-OpenFirewall` to allow the port from
your private network.

| Path                                      | What                                                             | On upgrade |
| ----------------------------------------- | ---------------------------------------------------------------- | ---------- |
| `C:\Program Files\PeckList`              | The program                                                      | Replaced   |
| `C:\ProgramData\PeckList\pecklist.conf` | Your settings ([settings file](../configuration/config-file.md)) | Kept       |
| `C:\ProgramData\PeckList`                | Database, snapshots, logs                                        | Kept       |

The service runs as its own virtual account, `NT SERVICE\PeckList`, which may change only the data
folder. It starts with Windows and restarts by itself after a crash.

<details>
<summary>install-service.ps1</summary>

```powershell
--8<-- "examples/windows/install-service.ps1"
```

</details>

## Day to day

```powershell
Get-Service PeckList
Restart-Service PeckList          # after editing C:\ProgramData\PeckList\pecklist.conf
Get-Content C:\ProgramData\PeckList\logs\*.log -Tail 50   # log files (JSON lines)
```

Start, stop and crash messages are also in **Event Viewer > Windows Logs > Application**.

Run CLI commands with the service's settings, in an elevated PowerShell:

```powershell
$env:DB_PATH = 'C:\ProgramData\PeckList\pecklist.db'
$env:CONFIG_FILE = 'C:\ProgramData\PeckList\pecklist.conf'
& 'C:\Program Files\PeckList\pecklist.exe' snapshot
& 'C:\Program Files\PeckList\pecklist.exe' admin reset-password
```

## Upgrade

Run the newer download's `install-service.ps1` the same way: it stops the service, replaces the
program and starts it again. Read [upgrading](../guides/upgrading.md) first.

## Run it by hand

```powershell
cd pecklist-win-x64
$env:ASPNETCORE_HTTP_PORTS = '8080'
.\pecklist.exe
```

The first admin password is printed in that window. Data goes to `.\data`.

## HTTPS

Put a reverse proxy in front ([Caddy for Windows](https://caddyserver.com/docs/install) is the
simplest, see [reverse proxy and HTTPS](reverse-proxy.md)), or give the server a certificate
itself:

```powershell
# In the service's environment (registry) or your session:
ASPNETCORE_URLS=https://+:8443
ASPNETCORE_Kestrel__Certificates__Default__Path=C:\ProgramData\PeckList\cert.pfx
ASPNETCORE_Kestrel__Certificates__Default__Password=...
```

## Uninstall

```powershell
& 'C:\Program Files\PeckList\examples\uninstall-service.ps1'              # keeps your data
& 'C:\Program Files\PeckList\examples\uninstall-service.ps1' -RemoveData  # removes it too
```
