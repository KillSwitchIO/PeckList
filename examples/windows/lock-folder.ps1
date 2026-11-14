<#
.SYNOPSIS
  Lock a PeckList folder (PL-132): administrators own everything in it, no permission entry anyone
  else added survives, and the folder grants only what -Grant says, which everything in it inherits.

.DESCRIPTION
  Used by install-service.ps1 for the data folder, and by the installer for the program folder and
  the data folder. Not for running by hand.

  icacls /T follows directory junctions, and anyone may make one, so there is no /T: the tree is
  walked without following links, and each folder is taken (owner, then permissions reset to
  inherit) before it is looked at, so nothing can be added to it afterwards. Junctions, symbolic
  links and other reparse points are deleted (the link only, never what it points at), and so is the
  extra name of a hard-linked file. Each is reported. The folder itself must not be a link, and never
  inherits from its parent while this runs.

  -Check only looks: exit 3 when the folder is there, has something in it and is owned by someone
  other than an administrator (an install would leave what they put there in place).

  Output: one line per thing done ("Removed the link <path>", "Removed the hard link <path>",
  "Took <file> from <owner SID or unknown>"). Exit 0, 1 on a failure (the last line says why), 3 for
  -Check.

.PARAMETER Grant
  icacls grants for the folder, as '*S-1-5-32-544:(OI)(CI)F'. Several may be given, or one string
  with commas (as powershell -File passes them).
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Path,
    [string[]]$Grant = @(),
    [switch]$Check
)
$ErrorActionPreference = 'Stop'
$reparse = [IO.FileAttributes]::ReparsePoint
$directory = [IO.FileAttributes]::Directory
$Grant = @($Grant | ForEach-Object { $_ -split ',' } | Where-Object { $_ })

function Invoke-Icacls([string[]]$arguments) {
    & icacls.exe @arguments | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "icacls $($arguments -join ' ') failed ($LASTEXITCODE)." }
}

# Administrators, SYSTEM, TrustedInstaller, or a member of the local Administrators group.
function Test-TrustedOwner([string]$item) {
    $sid = (Get-Acl -LiteralPath $item).GetOwner([Security.Principal.SecurityIdentifier]).Value
    if ($sid -in 'S-1-5-32-544', 'S-1-5-18', 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464') { return $true }
    try {
        return [bool](Get-LocalGroupMember -SID 'S-1-5-32-544' -ErrorAction Stop | Where-Object { $_.SID.Value -eq $sid })
    } catch {
        return $false
    }
}

try {
    if ($Check) {
        if ([IO.Directory]::Exists($Path) -and
            ([IO.Directory]::EnumerateFileSystemEntries($Path) | Select-Object -First 1) -and
            -not (Test-TrustedOwner $Path)) {
            Write-Output "$Path is not empty and was made by someone other than an administrator."
            exit 3
        }
        exit 0
    }
    if (-not [IO.Directory]::Exists($Path)) { throw "$Path is not a folder." }
    if ([IO.File]::GetAttributes($Path) -band $reparse) { throw "$Path is a link, not a folder." }
    if ($Grant.Count -eq 0) { throw 'No -Grant given.' }

    # The folder itself first, without /T. It never inherits from its parent at any point (anyone
    # may add files to C:\ProgramData), so nothing new can appear in it while this runs. Then any
    # entry someone else added to it goes too.
    $granted = @($Grant | ForEach-Object {
            $who = ($_ -split ':')[0].TrimStart('*')
            if ($who -like 'S-1-*') { $who } else { ([Security.Principal.NTAccount]$who).Translate([Security.Principal.SecurityIdentifier]).Value }
        })
    Invoke-Icacls @($Path, '/setowner', '*S-1-5-32-544', '/Q')
    Invoke-Icacls (@($Path, '/inheritance:r', '/grant:r') + $Grant + '/Q')
    $acl = [IO.Directory]::GetAccessControl($Path, 'Access')
    $foreign = @($acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]) |
            Where-Object { $_.IdentityReference.Value -notin $granted })
    if ($foreign) {
        $foreign | ForEach-Object { $acl.RemoveAccessRuleSpecific($_) }
        [IO.Directory]::SetAccessControl($Path, $acl)
    }

    # The walk, following no links. Each folder below is taken before it is looked at: owned by
    # administrators (so whoever made it can no longer change its permissions) and reset to inherit
    # from its parent, already locked. Nothing new can appear in a folder once it has been looked at.
    $pending = New-Object 'Collections.Generic.Stack[string]'
    $pending.Push($Path)
    while ($pending.Count -gt 0) {
        $folder = $pending.Pop()
        if ($folder -ne $Path) {
            Invoke-Icacls @($folder, '/setowner', '*S-1-5-32-544', '/Q')
            Invoke-Icacls @($folder, '/reset', '/Q')
        }
        foreach ($entry in @([IO.Directory]::EnumerateFileSystemEntries($folder))) {
            $attributes = [IO.File]::GetAttributes($entry)
            if ($attributes -band $reparse) {
                if ($attributes -band $directory) { [IO.Directory]::Delete($entry, $false) } else { [IO.File]::Delete($entry) }
                Write-Output "Removed the link $entry"
            } elseif ($attributes -band $directory) {
                $pending.Push($entry)
            } elseif ((Get-Item -LiteralPath $entry -Force).LinkType -eq 'HardLink') {
                [IO.File]::Delete($entry)
                Write-Output "Removed the hard link $entry"
            } else {
                # A file: owned by administrators with only the inherited entries, or made so. One
                # taken from another owner is reported with that owner, so the caller can tell
                # whether someone put it there while it ran.
                $owner = 'unknown'
                try {
                    $fileAcl = [IO.File]::GetAccessControl($entry)
                    $owner = $fileAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value
                    $fine = $owner -eq 'S-1-5-32-544' -and
                        -not $fileAcl.AreAccessRulesProtected -and
                        $fileAcl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]).Count -eq 0
                } catch [UnauthorizedAccessException] {
                    $fine = $false
                }
                if (-not $fine) {
                    Invoke-Icacls @($entry, '/setowner', '*S-1-5-32-544', '/Q')
                    Invoke-Icacls @($entry, '/reset', '/Q')
                    if ($owner -ne 'S-1-5-32-544') { Write-Output "Took $entry from $owner" }
                }
            }
        }
    }
    exit 0
} catch {
    Write-Output "FAILED: $($_.Exception.Message)"
    exit 1
}
