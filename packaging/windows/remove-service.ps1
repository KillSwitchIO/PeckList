<#
.SYNOPSIS
  The uninstaller's service step (PL-132): stop and remove the PeckList service and its firewall
  rule. The uninstaller then removes the program; C:\ProgramData\PeckList stays unless the person
  asks for it to go.
#>
$ErrorActionPreference = 'Continue'
$name = 'PeckList'
$service = Get-Service -Name $name -ErrorAction SilentlyContinue
if ($service) {
    if ($service.Status -ne 'Stopped') {
        Stop-Service -Name $name -Force
        $service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(60))
    }
    sc.exe delete $name | Out-Null
}
Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
exit 0
