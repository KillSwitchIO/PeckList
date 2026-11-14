<#
.SYNOPSIS
  Install (or upgrade) PeckList as a Windows service.

.DESCRIPTION
  Run from the unpacked download in an elevated PowerShell:
    Expand-Archive pecklist-server-win-x64-portable.zip -DestinationPath .
    .\pecklist-server-win-x64\examples\install-service.ps1

  Program:  C:\Program Files\PeckList               (replaced on every run)
  Data:     C:\ProgramData\PeckList                 (database, snapshots, logs; kept)
  Settings: C:\ProgramData\PeckList\pecklist.conf   (kept)

  The service runs as its own virtual account, NT SERVICE\PeckList, which may change only the
  data folder. On a first install the script prints the admin password (to change at first
  sign-in). Upgrading is the same command with the newer download.

  An install from before the rename (the Punchlist service, C:\ProgramData\Punchlist) is moved
  over first: the old service goes, and its data and settings move to the new folder.

.PARAMETER Port
  The port the server listens on (all addresses). Default 8080 for a new service; an upgrade keeps
  the service's address unless you give one. Anything else you added to the service's environment
  (HTTPS, a certificate) stays.

.PARAMETER OpenFirewall
  Also allow the port through Windows Defender Firewall (private networks only).
#>
[CmdletBinding()]
param(
    [int]$Port = 0,
    [switch]$OpenFirewall
)
$ErrorActionPreference = 'Stop'

$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this in an elevated PowerShell (Run as administrator).'
}

$source = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $source 'pecklist.exe'))) {
    throw 'Run this from the unpacked download (no pecklist.exe next to it).'
}
$name = 'PeckList'
$program = Join-Path $env:ProgramFiles $name
$data = Join-Path $env:ProgramData $name
$config = Join-Path $data 'pecklist.conf'
$database = Join-Path $data 'pecklist.db'
$exe = Join-Path $program 'pecklist.exe'
$serviceKey = "HKLM:\SYSTEM\CurrentControlSet\Services\$name"

# A service's own account (NT SERVICE\<name>), worked out from the name as Windows does.
function ServiceSid([string]$service) {
    $hash = [Security.Cryptography.SHA1]::Create().ComputeHash([Text.Encoding]::Unicode.GetBytes($service.ToUpperInvariant()))
    'S-1-5-80-' + ((0..4 | ForEach-Object { [BitConverter]::ToUInt32($hash, $_ * 4) }) -join '-')
}

# Anyone can make a folder in C:\ProgramData (or a file in one that keeps its default permissions)
# and would own it: only administrators, SYSTEM, TrustedInstaller and the services' own accounts
# are trusted with the data folder and what is in it.
function Test-TrustedOwner([string]$path) {
    Test-TrustedSid (Get-Acl -LiteralPath $path).GetOwner([Security.Principal.SecurityIdentifier]).Value
}
function Test-TrustedSid([string]$sid) {
    if ($sid -in @('S-1-5-32-544', 'S-1-5-18', (ServiceSid 'TrustedInstaller'), (ServiceSid $name), (ServiceSid 'Punchlist'))) { return $true }
    try {
        return [bool](Get-LocalGroupMember -SID 'S-1-5-32-544' -ErrorAction Stop | Where-Object { $_.SID.Value -eq $sid })
    } catch {
        return $false
    }
}

if (-not (Get-Service -Name $name -ErrorAction SilentlyContinue)) {
    foreach ($folder in $data, (Join-Path $env:ProgramData 'Punchlist')) {
        if ((Test-Path $folder) -and -not (Test-TrustedOwner $folder)) {
            throw "$folder was made by someone other than an administrator, so it is not used. Look at what is in it, move it away (Rename-Item), and run this again."
        }
    }
}
$names = @('pecklist.conf', 'pecklist.db', 'pecklist.db-wal', 'pecklist.db-shm', 'first-admin-password.txt')
$planted = $names |
    Where-Object { (Test-Path (Join-Path $data $_)) -and -not (Test-TrustedOwner (Join-Path $data $_)) }
if ($planted) {
    throw "In $data, $($planted -join ', ') were not made by an administrator or the service. Look at them, move them away, and run this again."
}

# --- Moving over from Punchlist, once ---------------------------------------------------------------
$old = Get-Service -Name 'Punchlist' -ErrorAction SilentlyContinue
$oldData = Join-Path $env:ProgramData 'Punchlist'
if (-not (Get-Service -Name $name -ErrorAction SilentlyContinue) -and ($old -or (Test-Path $oldData))) {
    Write-Host 'Moving the Punchlist install over to PeckList...'
    if ($old) {
        if ($old.Status -ne 'Stopped') {
            Stop-Service -Name 'Punchlist'
            $old.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
        }
        sc.exe delete Punchlist | Out-Null
    }
    Get-NetFirewallRule -DisplayName 'Punchlist' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    # Same drive, so the move is a rename: quick, whatever the size of the data.
    if ((Test-Path $oldData) -and -not (Test-Path $data)) {
        Move-Item $oldData $data
        foreach ($suffix in '', '-wal', '-shm') {
            $was = Join-Path $data "punchlist.db$suffix"
            if (Test-Path $was) { Rename-Item $was "pecklist.db$suffix" }
        }
        $wasConfig = Join-Path $data 'punchlist.conf'
        if (Test-Path $wasConfig) { Rename-Item $wasConfig 'pecklist.conf' }
    }
    $oldProgram = Join-Path $env:ProgramFiles 'Punchlist'
    if (Test-Path $oldProgram) { Remove-Item -Recurse -Force $oldProgram }
}

$existing = Get-Service -Name $name -ErrorAction SilentlyContinue
if ($existing -and $existing.Status -ne 'Stopped') {
    Write-Host 'Stopping the running service for the upgrade...'
    Stop-Service -Name $name
    $existing.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
}

New-Item -ItemType Directory -Force -Path $data | Out-Null
if (Test-Path $program) { Remove-Item -Recurse -Force $program }
Copy-Item -Recurse -Path $source -Destination $program
if (-not (Test-Path $config)) {
    Copy-Item (Join-Path $PSScriptRoot 'pecklist.conf') $config
}

if (-not $existing) {
    New-Service -Name $name -BinaryPathName ('"' + $exe + '"') -DisplayName 'PeckList' `
        -Description 'PeckList tasks and calendar' -StartupType Automatic | Out-Null
    sc.exe config $name obj= "NT SERVICE\$name" | Out-Null
    # Restart after a crash: after 5 seconds, again, then every minute.
    sc.exe failure $name reset= 86400 actions= restart/5000/restart/5000/restart/60000 | Out-Null
}
# The data folder holds the database and its secrets: administrators, SYSTEM and the service only.
# Administrators own all of it, no entry anyone else added survives, and its files inherit the list.
# lock-folder.ps1 (next to this script) first removes links that would lead the lock elsewhere.
$said = @(& (Join-Path $PSScriptRoot 'lock-folder.ps1') -Path $data `
        -Grant '*S-1-5-32-544:(OI)(CI)F', '*S-1-5-18:(OI)(CI)F', "NT SERVICE\${name}:(OI)(CI)M")
$said | ForEach-Object { Write-Host $_ }
if ($LASTEXITCODE -ne 0) { throw "Could not lock $data." }
# One of those files made by someone else after the check above, before the lock took it.
$late = @($said | Where-Object { $_ -match '^Took (.+) from (\S+)$' -and -not (Test-TrustedSid $Matches[2]) -and
        (Split-Path $Matches[1] -Parent) -eq $data -and (Split-Path $Matches[1] -Leaf) -in $names } |
        ForEach-Object { Split-Path ($_ -replace '^Took (.+) from \S+$', '$1') -Leaf })
if ($late) {
    throw "In $data, $($late -join ', ') appeared while this ran, made by someone other than an administrator or the service. Look at them, move them away, and run this again."
}

# The service's own environment: the address (kept on an upgrade unless -Port is given), the
# database and the settings file. Every other line, such as HTTPS settings, stays.
$current = @((Get-ItemProperty -Path $serviceKey -Name Environment -ErrorAction SilentlyContinue).Environment | Where-Object { $_ })
$urls = $current | Where-Object { $_ -like 'ASPNETCORE_URLS=*' } | Select-Object -First 1
if ($Port -ne 0 -or -not $urls) {
    if ($Port -eq 0) { $Port = 8080 }
    $urls = "ASPNETCORE_URLS=http://+:$Port"
}
$first = ($urls -replace '^ASPNETCORE_URLS=', '').Split(';')[0].Trim()
if ($first -notmatch '^(https?)://[^/]*:(\d+)/?$') { throw "Cannot tell the port from $urls." }
$scheme = $Matches[1]
$Port = [int]$Matches[2]
Set-ItemProperty -Path $serviceKey -Name Environment -Type MultiString -Value (@(
        $urls,
        "DB_PATH=$database",
        "CONFIG_FILE=$config"
    ) + @($current | Where-Object { $_ -notmatch '^(ASPNETCORE_URLS|DB_PATH|CONFIG_FILE)=' }))

# A rule there already (an earlier run, maybe on another port) follows the port; a new one only with
# -OpenFirewall.
$rule = Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue
if ($rule) {
    $filter = $rule | Get-NetFirewallPortFilter
    if (@($filter.LocalPort) -notcontains "$Port") { $filter | Set-NetFirewallPortFilter -LocalPort $Port }
} elseif ($OpenFirewall) {
    New-NetFirewallRule -DisplayName $name -Direction Inbound -Protocol TCP -LocalPort $Port `
        -Action Allow -Profile Private | Out-Null
}

# No database yet: a first install. A database kept from before keeps its admin password.
$freshDatabase = -not (Test-Path $database)
Start-Service -Name $name
& $exe --version

# Wait until it answers (the first start creates the database and the admin account): /healthz over
# http; over https (a certificate this computer may not trust), that the port takes connections.
$healthy = $false
foreach ($attempt in 1..60) {
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
if (-not $healthy) {
    throw "The service started but does not answer on port $Port. See Event Viewer > Windows Logs > Application."
}

if (-not $freshDatabase) {
    Write-Host 'Upgraded and running: the database and its accounts are as they were.'
} else {
    # A service has no console for the first-start password, so set one here instead.
    $env:DB_PATH = $database
    $env:CONFIG_FILE = $config
    & $exe admin reset-password admin
    Write-Host "Running on ${scheme}://localhost:$Port - sign in as admin with the password above."
}
Write-Host "Settings: $config (then: Restart-Service $name)"
