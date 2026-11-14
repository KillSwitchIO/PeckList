<#
.SYNOPSIS
  The installer's service step (PL-132): set up, or upgrade, the PeckList Windows service for the
  program the installer just put in -Program. Not for running by hand: the installer stops the old
  service first and calls this after the files are in.

.DESCRIPTION
  The same service as examples\install-service.ps1 makes from the portable zip: NT SERVICE\PeckList,
  automatic start, restart after a crash, data and settings in C:\ProgramData\PeckList, which only
  administrators, SYSTEM and the service can open. On a first install it sets the admin password and
  writes it to -PasswordFile (administrators only) for the installer's last page and for silent
  installs. An upgrade keeps what an administrator added to the service's environment (HTTPS, a
  certificate, proxies). Everything it does goes to -Log.
  Exit code 0 when the service answers on its port, 1 otherwise.

.PARAMETER Port
  The port to listen on; 0 keeps what an existing service has (8080 for a new one).
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Program,
    [int]$Port = 0,
    [switch]$OpenFirewall,
    [Parameter(Mandatory)][string]$PasswordFile,
    [Parameter(Mandatory)][string]$Log
)
$ErrorActionPreference = 'Stop'

$name = 'PeckList'
$data = Join-Path $env:ProgramData $name
$config = Join-Path $data 'pecklist.conf'
$database = Join-Path $data 'pecklist.db'
$exe = Join-Path $Program 'pecklist.exe'
$serviceKey = "HKLM:\SYSTEM\CurrentControlSet\Services\$name"
$administrators = '*S-1-5-32-544'
$system = '*S-1-5-18'

# Lines wait in memory until the data folder is locked down: nothing is written into a folder
# someone else may own. A failure before that goes to the Windows temp folder instead.
$pending = New-Object Collections.Generic.List[string]
$logReady = $false
function Say([string]$text) {
    $line = "{0:u} {1}" -f (Get-Date), $text
    if ($script:logReady) { Add-Content -Path $Log -Value $line } else { $script:pending.Add($line) }
}
function Open-Log {
    $script:logReady = $true
    if ($script:pending.Count -gt 0) { Add-Content -Path $Log -Value $script:pending }
}

# A service's own account (NT SERVICE\<name>), which owns the database that service made. Worked
# out from the name, as Windows does, so it holds for a service that is gone (Punchlist).
function ServiceSid([string]$service) {
    $hash = [Security.Cryptography.SHA1]::Create().ComputeHash([Text.Encoding]::Unicode.GetBytes($service.ToUpperInvariant()))
    'S-1-5-80-' + ((0..4 | ForEach-Object { [BitConverter]::ToUInt32($hash, $_ * 4) }) -join '-')
}
$serviceSids = @((ServiceSid $name), (ServiceSid 'Punchlist'))

# Who may be trusted with something they own: Administrators, SYSTEM, TrustedInstaller, the service,
# or a member of the local Administrators group. Anyone can make a folder in C:\ProgramData (and a
# file in a folder there that keeps its default permissions), and would own it.
function Test-TrustedOwner([string]$path) {
    Test-TrustedSid (Get-Acl -LiteralPath $path).GetOwner([Security.Principal.SecurityIdentifier]).Value
}
function Test-TrustedSid([string]$sid) {
    if ($sid -in (@('S-1-5-32-544', 'S-1-5-18', (ServiceSid 'TrustedInstaller')) + $serviceSids)) {
        return $true
    }
    try {
        return [bool](Get-LocalGroupMember -SID 'S-1-5-32-544' -ErrorAction Stop | Where-Object { $_.SID.Value -eq $sid })
    } catch {
        return $false
    }
}

# Administrators own everything in the folder, no entry anyone else added survives, and the folder
# grants $grants (inheritance off); its files inherit that. lock-folder.ps1 (next to this script)
# first removes links a /T would follow; what it removed goes to the log once that is open.
$lockReport = @()
function Lock-Folder([string]$path, [string[]]$grants) {
    $said = @(& (Join-Path $PSScriptRoot 'lock-folder.ps1') -Path $path -Grant $grants)
    $script:lockReport += $said
    if ($LASTEXITCODE -ne 0) { throw "Could not lock $path. $($said | Select-Object -Last 1)" }
}

# A file only administrators and SYSTEM can open.
function Lock-File([string]$path) {
    icacls $path /inheritance:r /grant:r "${administrators}:F" "${system}:F" /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not set the permissions on $path." }
}

try {
    Say "Setting up $name from $Program"
    $existing = Get-Service -Name $name -ErrorAction SilentlyContinue
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

    # --- A folder someone else made before the first install ------------------------------------
    # Its owner could plant a database or settings, or read what goes in later: set it aside unread
    # (an administrator can look at it) and start a new one.
    if (-not $existing -and (Test-Path $data) -and -not (Test-TrustedOwner $data)) {
        $aside = "$name.untrusted-$stamp"
        Rename-Item -LiteralPath $data $aside
        Say "$data was made by someone other than an administrator: set aside as $aside, not used"
    }

    # --- Moving over from Punchlist, once (as install-service.ps1 does) -------------------------------
    $old = Get-Service -Name 'Punchlist' -ErrorAction SilentlyContinue
    $oldData = Join-Path $env:ProgramData 'Punchlist'
    if (-not $existing -and ($old -or (Test-Path $oldData))) {
        Say 'Moving the Punchlist install over'
        if ($old) {
            if ($old.Status -ne 'Stopped') {
                Stop-Service -Name 'Punchlist' -Force
                $old.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
            }
            sc.exe delete Punchlist | Out-Null
        }
        Get-NetFirewallRule -DisplayName 'Punchlist' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
        if ((Test-Path $oldData) -and -not (Test-Path $database)) {
            if (-not $old -and -not (Test-TrustedOwner $oldData)) {
                # No Punchlist service, and a folder an administrator did not make: not data to adopt.
                Say "$oldData was made by someone other than an administrator: left where it is, not used"
            } else {
                New-Item -ItemType Directory -Force -Path $data | Out-Null
                # Each entry moves as it is (a link stays a link, and the data folder's lock removes
                # it); the emptied folder goes without a recursive delete, which would follow links.
                Get-ChildItem -LiteralPath $oldData -Force | Move-Item -Destination $data
                try { [IO.Directory]::Delete($oldData, $false) } catch { Say "Left $oldData in place: $($_.Exception.Message)" }
                foreach ($suffix in '', '-wal', '-shm') {
                    $was = Join-Path $data "punchlist.db$suffix"
                    if (Test-Path $was) { Rename-Item $was "pecklist.db$suffix" }
                }
                $wasConfig = Join-Path $data 'punchlist.conf'
                if (Test-Path $wasConfig) { Rename-Item $wasConfig 'pecklist.conf' }
            }
        }
        $oldProgram = Join-Path $env:ProgramFiles 'Punchlist'
        if (Test-Path $oldProgram) { Remove-Item -Recurse -Force $oldProgram }
    }

    if ($existing -and $existing.Status -ne 'Stopped') {
        Stop-Service -Name $name -Force
        $existing.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(60))
    }

    # The service first: its account, NT SERVICE\PeckList, exists only once the service does.
    $binary = '"' + $exe + '"'
    if (-not $existing) {
        New-Service -Name $name -BinaryPathName $binary -DisplayName 'PeckList' `
            -Description 'PeckList tasks and calendar' -StartupType Manual | Out-Null
        sc.exe failure $name reset= 86400 actions= restart/5000/restart/5000/restart/60000 | Out-Null
    }
    # An install made by install-service.ps1, or one in another folder: point it at this program.
    sc.exe config $name binPath= $binary obj= "NT SERVICE\$name" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not set up the service.' }

    # --- The data folder: administrators, SYSTEM and the service only ----------------------------
    # Before anything is read from it or written to it, and before the service makes the database.
    New-Item -ItemType Directory -Force -Path $data | Out-Null
    # A folder made by an older install-service.ps1 kept C:\ProgramData's permissions, where any user
    # may add files: settings, a database or a password file someone else put there are not used.
    $names = @('pecklist.conf', 'pecklist.db', 'pecklist.db-wal', 'pecklist.db-shm', (Split-Path $PasswordFile -Leaf))
    $planted = @()
    foreach ($file in $names) {
        $path = Join-Path $data $file
        if ((Test-Path -LiteralPath $path) -and -not (Test-TrustedOwner $path)) { $planted += $file }
    }
    Lock-Folder $data @("${administrators}:(OI)(CI)F", "${system}:(OI)(CI)F", "NT SERVICE\${name}:(OI)(CI)M")
    Open-Log
    foreach ($line in $lockReport) { Say $line }
    # One of those files made by someone else after the check above, before the lock took it.
    foreach ($line in $lockReport) {
        if ($line -match '^Took (.+) from (\S+)$' -and -not (Test-TrustedSid $Matches[2])) {
            $file = Split-Path $Matches[1] -Leaf
            if ((Split-Path $Matches[1] -Parent) -eq $data -and $file -in $names -and $file -notin $planted) { $planted += $file }
        }
    }
    # Now administrators own them and no one else has an entry: a copy goes aside for an administrator
    # to look at, the settings file becomes the example in place (its name is never left empty), and
    # the rest go.
    foreach ($file in $planted) {
        $path = Join-Path $data $file
        if (-not (Test-Path -LiteralPath $path)) { continue }  # a link, which the lock removed
        Copy-Item -LiteralPath $path (Join-Path $data "$file.untrusted-$stamp")
        if ($file -eq 'pecklist.conf') {
            [IO.File]::WriteAllBytes($path, [IO.File]::ReadAllBytes((Join-Path $Program 'examples\pecklist.conf')))
        } else {
            Remove-Item -LiteralPath $path -Force
        }
        Say "$file was not made by an administrator or the service: not used, a copy is in $file.untrusted-$stamp"
    }
    # The reset gave the password file the folder's list: back to administrators only.
    if (Test-Path $PasswordFile) { Lock-File $PasswordFile }

    # A first install: the settings file from the example.
    if (-not (Test-Path -LiteralPath $config)) {
        Copy-Item (Join-Path $Program 'examples\pecklist.conf') $config
    }

    # --- The service's environment --------------------------------------------------------------
    # DB_PATH and CONFIG_FILE are the installer's. ASPNETCORE_URLS is written only for a new service,
    # one without it, or when a port was asked for; every other line an administrator added stays.
    $current = @((Get-ItemProperty -Path $serviceKey -Name Environment -ErrorAction SilentlyContinue).Environment |
            Where-Object { $_ })
    $urls = $current | Where-Object { $_ -like 'ASPNETCORE_URLS=*' } | Select-Object -First 1
    if ($Port -ne 0 -or -not $urls) {
        if ($Port -eq 0) { $Port = 8080 }
        $urls = "ASPNETCORE_URLS=http://+:$Port"
    }
    $kept = @($current | Where-Object { $_ -notmatch '^(ASPNETCORE_URLS|DB_PATH|CONFIG_FILE)=' })
    Set-ItemProperty -Path $serviceKey -Name Environment -Type MultiString -Value (@(
            $urls,
            "DB_PATH=$database",
            "CONFIG_FILE=$config"
        ) + $kept)
    # The first address it listens on, for the checks below: http://+:8080, https://+:8443, ...
    $first = ($urls -replace '^ASPNETCORE_URLS=', '').Split(';')[0].Trim()
    if ($first -notmatch '^(https?)://[^/]*:(\d+)/?$') { throw "Cannot tell the port from $urls." }
    $scheme = $Matches[1]
    $Port = [int]$Matches[2]
    Say "Listening on $first"

    # A rule there already (an earlier install, maybe on another port) follows the port; a new one
    # only when asked for.
    $rule = Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue
    if ($rule) {
        $filter = $rule | Get-NetFirewallPortFilter
        if (@($filter.LocalPort) -notcontains "$Port") {
            $filter | Set-NetFirewallPortFilter -LocalPort $Port
            Say "The firewall rule now opens port $Port"
        }
    } elseif ($OpenFirewall) {
        New-NetFirewallRule -DisplayName $name -Direction Inbound -Protocol TCP -LocalPort $Port `
            -Action Allow -Profile Private | Out-Null
        Say 'Opened the firewall for private networks'
    }

    # No database yet: a first install, so the admin password is set below. A database kept from an
    # uninstall, or moved over from Punchlist, keeps its own.
    $freshDatabase = -not (Test-Path $database)

    # Automatic only now that it is all in place: a restart half way through starts nothing.
    sc.exe config $name start= auto | Out-Null
    Start-Service -Name $name
    # Over http, /healthz; over https (its certificate may be one this computer does not trust), that
    # the port takes connections.
    $healthy = $false
    foreach ($attempt in 1..90) {
        try {
            if ($scheme -eq 'http') {
                Invoke-WebRequest -UseBasicParsing "http://localhost:$Port/healthz" -TimeoutSec 2 | Out-Null
                $healthy = $true
            } else {
                $client = New-Object Net.Sockets.TcpClient
                try { $healthy = $client.ConnectAsync('localhost', $Port).Wait(2000) -and $client.Connected } finally { $client.Dispose() }
            }
        } catch { $healthy = $false }
        if ($healthy) { break }
        Start-Sleep -Seconds 1
    }
    if (-not $healthy) { throw "The service started but does not answer on port $Port." }
    Say 'The service answers'

    if ($freshDatabase) {
        $env:DB_PATH = $database
        $env:CONFIG_FILE = $config
        $said = & $exe admin reset-password admin 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0 -or $said -notmatch 'New password for admin: (\S+)') {
            throw 'Could not set the admin password.'
        }
        # A new file, locked down before the password goes in, so it is never readable by anyone else.
        if (Test-Path $PasswordFile) { Remove-Item -LiteralPath $PasswordFile -Force }
        Set-Content -Path $PasswordFile -Value '' -Encoding ascii
        Lock-File $PasswordFile
        Set-Content -Path $PasswordFile -Value $Matches[1] -Encoding ascii
        Say "The admin password is in $PasswordFile"
    }
    exit 0
} catch {
    if (-not $logReady) { $Log = Join-Path $env:windir 'Temp\pecklist-setup-service.log'; Open-Log }
    Say "FAILED: $($_.Exception.Message) (line $($_.InvocationInfo.ScriptLineNumber): $($_.InvocationInfo.Line.Trim()))"
    exit 1
}
