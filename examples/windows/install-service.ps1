<#
.SYNOPSIS
  Install (or upgrade) Punchlist as a Windows service.

.DESCRIPTION
  Run from the unpacked download in an elevated PowerShell:
    Expand-Archive punchlist-win-x64.zip -DestinationPath .
    .\punchlist-win-x64\examples\install-service.ps1

  Program:  C:\Program Files\Punchlist                (replaced on every run)
  Data:     C:\ProgramData\Punchlist                  (database, snapshots, logs; kept)
  Settings: C:\ProgramData\Punchlist\punchlist.conf   (kept)

  The service runs as its own virtual account, NT SERVICE\Punchlist, which may change only the
  data folder. On a first install the script prints the admin password (to change at first
  sign-in). Upgrading is the same command with the newer download.

.PARAMETER Port
  The port the server listens on (all addresses). Default 8080.

.PARAMETER OpenFirewall
  Also allow the port through Windows Defender Firewall (private networks only).
#>
[CmdletBinding()]
param(
    [int]$Port = 8080,
    [switch]$OpenFirewall
)
$ErrorActionPreference = 'Stop'

$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this in an elevated PowerShell (Run as administrator).'
}

$source = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $source 'punchlist.exe'))) {
    throw 'Run this from the unpacked download (no punchlist.exe next to it).'
}
$name = 'Punchlist'
$program = Join-Path $env:ProgramFiles $name
$data = Join-Path $env:ProgramData $name
$config = Join-Path $data 'punchlist.conf'
$database = Join-Path $data 'punchlist.db'
$exe = Join-Path $program 'punchlist.exe'

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
    Copy-Item (Join-Path $PSScriptRoot 'punchlist.conf') $config
}

if (-not $existing) {
    New-Service -Name $name -BinaryPathName ('"' + $exe + '"') -DisplayName 'Punchlist' `
        -Description 'Punchlist tasks and calendar' -StartupType Automatic | Out-Null
    sc.exe config $name obj= "NT SERVICE\$name" | Out-Null
    # Restart after a crash: after 5 seconds, again, then every minute.
    sc.exe failure $name reset= 86400 actions= restart/5000/restart/5000/restart/60000 | Out-Null
}
icacls $data /grant "NT SERVICE\${name}:(OI)(CI)M" /T /Q | Out-Null

# The service's own environment: the port, the database and the settings file.
$environment = @(
    "ASPNETCORE_URLS=http://+:$Port",
    "DB_PATH=$database",
    "CONFIG_FILE=$config"
)
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\$name" -Name Environment `
    -Type MultiString -Value $environment

if ($OpenFirewall -and -not (Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $name -Direction Inbound -Protocol TCP -LocalPort $Port `
        -Action Allow -Profile Private | Out-Null
}

Start-Service -Name $name
& $exe --version

# Wait until it answers (the first start creates the database and the admin account).
$healthy = $false
foreach ($attempt in 1..60) {
    try {
        Invoke-WebRequest -UseBasicParsing "http://localhost:$Port/healthz" -TimeoutSec 2 | Out-Null
        $healthy = $true
        break
    } catch { Start-Sleep -Seconds 1 }
}
if (-not $healthy) {
    throw "The service started but does not answer on port $Port. See Event Viewer > Windows Logs > Application."
}

if ($existing) {
    Write-Host 'Upgraded and running.'
} else {
    # A service has no console for the first-start password, so set one here instead.
    $env:DB_PATH = $database
    $env:CONFIG_FILE = $config
    & $exe admin reset-password admin
    Write-Host "Running on http://localhost:$Port - sign in as admin with the password above."
}
Write-Host "Settings: $config (then: Restart-Service $name)"
