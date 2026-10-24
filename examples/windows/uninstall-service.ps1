<#
.SYNOPSIS
  Remove the Punchlist Windows service and program. Data stays unless -RemoveData.

.DESCRIPTION
  Run in an elevated PowerShell:
    & 'C:\Program Files\Punchlist\examples\uninstall-service.ps1'
  C:\ProgramData\Punchlist (database, snapshots, settings) is kept; take a copy before -RemoveData.
#>
[CmdletBinding()]
param([switch]$RemoveData)
$ErrorActionPreference = 'Stop'

$name = 'Punchlist'
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
    Remove-Item -Recurse -Force (Join-Path $env:ProgramData $name)
    Write-Host 'Removed Punchlist and its data.'
} else {
    Write-Host "Removed Punchlist. Your data is still in $(Join-Path $env:ProgramData $name)."
}
