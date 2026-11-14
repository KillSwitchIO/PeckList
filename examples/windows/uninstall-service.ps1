<#
.SYNOPSIS
  Remove the PeckList Windows service and program. Data stays unless -RemoveData.

.DESCRIPTION
  Run in an elevated PowerShell:
    & 'C:\Program Files\PeckList\examples\uninstall-service.ps1'
  C:\ProgramData\PeckList (database, snapshots, settings) is kept; take a copy before -RemoveData.
#>
[CmdletBinding()]
param([switch]$RemoveData)
$ErrorActionPreference = 'Stop'

$name = 'PeckList'
$service = Get-Service -Name $name -ErrorAction SilentlyContinue
if ($service) {
    if ($service.Status -ne 'Stopped') { Stop-Service -Name $name }
    sc.exe delete $name | Out-Null
}
Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
# This script lives in the program folder; remove it from outside.
Set-Location $env:TEMP
Remove-Item -Recurse -Force (Join-Path $env:ProgramFiles $name) -ErrorAction SilentlyContinue
if ($RemoveData) {
    # rd removes a junction or link inside without following it; Remove-Item -Recurse in Windows
    # PowerShell 5.1 would delete what it points at.
    $data = Join-Path $env:ProgramData $name
    cmd /c "rd /s /q `"$data`""
    if (Test-Path $data) { throw "Could not delete all of $data." }
    Write-Host 'Removed PeckList and its data.'
} else {
    Write-Host "Removed PeckList. Your data is still in $(Join-Path $env:ProgramData $name)."
}
