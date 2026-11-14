<#
.SYNOPSIS
  The Windows installer's test (PL-132), on GitLab's hosted Windows runner: install silently, use it,
  install again over the top, uninstall, and check what stays.
    powershell -File scripts/ci/windows-test.ps1 dist-windows\pecklist-setup-x64.exe

.DESCRIPTION
  1. A first install on port 8090: the service runs as NT SERVICE\PeckList and starts with Windows,
     /healthz answers, the admin password from the installer signs in, pecklist and
     pecklist-server are on PATH, and a snapshot can be taken.
  2. The installer again, without /PORT: the port, the password file and the snapshot are kept, and
     the service comes back.
  3. A silent uninstall: the service, the program and the PATH entry are gone; the data stays.
  4. Installed again onto that data: the admin password is not reset.
#>
param([Parameter(Mandatory)][string]$Installer)
$ErrorActionPreference = 'Stop'

$program = Join-Path $env:ProgramFiles 'PeckList'
$bin = Join-Path $program 'bin'
$data = Join-Path $env:ProgramData 'PeckList'
$passwordFile = Join-Path $data 'first-admin-password.txt'
$port = 8090
$failures = 0

function Check([string]$what, [bool]$ok) {
    if ($ok) { Write-Host "ok   $what" } else { Write-Host "FAIL $what"; $script:failures++ }
}

function Show-Logs {
    foreach ($log in (Join-Path $data 'setup-service.log'), 'install-1.log', 'install-2.log', 'install-3.log', 'install-4.log', 'install-5.log', 'install-6.log') {
        if (Test-Path $log) { Write-Host "--- $log"; Get-Content $log -Tail 60 }
    }
    Get-ChildItem (Join-Path $data 'logs') -Filter *.log -ErrorAction SilentlyContinue |
        ForEach-Object { Write-Host "--- $($_.FullName)"; Get-Content $_.FullName -Tail 30 }
}

function Install([string]$log, [string[]]$extra) {
    $arguments = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/LOG=$log") + $extra
    $process = Start-Process -FilePath (Resolve-Path $Installer) -ArgumentList $arguments -Wait -PassThru
    return $process.ExitCode
}

function Healthy([int]$on) {
    foreach ($attempt in 1..30) {
        try {
            $answer = Invoke-WebRequest -UseBasicParsing "http://localhost:$on/healthz" -TimeoutSec 2
            if ($answer.StatusCode -eq 200) { return $true }
        } catch { Start-Sleep -Seconds 1 }
    }
    return $false
}

function MachinePath { [Environment]::GetEnvironmentVariable('Path', 'Machine') }

# A standard user, to own what an attacker would plant before an install (a throwaway machine).
function TestUserSid {
    if (-not (Get-LocalUser -Name 'pltest' -ErrorAction SilentlyContinue)) {
        $secret = ConvertTo-SecureString ([Guid]::NewGuid().ToString('N') + 'aA1!') -AsPlainText -Force
        New-LocalUser -Name 'pltest' -Password $secret -AccountNeverExpires | Out-Null
    }
    return (Get-LocalUser -Name 'pltest').SID.Value
}

# A folder or file the test user made and owns, with full control.
function Plant([string]$path, [string]$sid, [switch]$Folder) {
    if ($Folder) { New-Item -ItemType Directory -Force -Path $path | Out-Null } else { Set-Content -Path $path -Value 'planted' }
    icacls $path /setowner "*$sid" /Q | Out-Null
    icacls $path /grant "*${sid}:(F)" /Q | Out-Null
}

function OwnerSid([string]$path) { (Get-Acl -LiteralPath $path).GetOwner([Security.Principal.SecurityIdentifier]).Value }

# The SIDs an item's list grants anything to.
function GrantedSids([string]$path) {
    (Get-Acl -LiteralPath $path).Access | ForEach-Object { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value }
}

function ServiceEnvironment { @((Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Services\PeckList' -Name Environment).Environment) }

# The status of a sign-in as admin (PowerShell 5.1 throws on anything but 2xx).
function SignIn([string]$with) {
    $body = @{ username = 'admin'; password = $with } | ConvertTo-Json
    try {
        return [int](Invoke-WebRequest -UseBasicParsing -Method Post -ContentType 'application/json' -Body $body `
            -Uri "http://localhost:$port/auth/login").StatusCode
    } catch {
        if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
        return -1
    }
}

function Uninstall([string]$from = $program) {
    # The uninstaller hands over to a copy of itself and returns at once: wait for the work instead.
    Start-Process -FilePath (Join-Path $from 'unins000.exe') -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -Wait
    $key = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{530B9A5D-13F1-4119-8162-394E031D1A11}_is1'
    foreach ($attempt in 1..60) {
        if (-not (Test-Path (Join-Path $from 'unins000.exe')) -and -not (Get-Service PeckList -ErrorAction SilentlyContinue) -and -not (Test-Path $key)) { return }
        Start-Sleep -Seconds 1
    }
}

try {
    # --- 0. A standard user made the data folder first, with settings of their own -----------------
    $user = TestUserSid
    Plant $data $user -Folder
    Plant (Join-Path $data 'pecklist.conf') $user

    # --- 1. First install ---------------------------------------------------------------------------
    $code = Install 'install-1.log' @("/PORT=$port")
    $aside = @(Get-ChildItem $env:ProgramData -Directory -Filter 'PeckList.untrusted-*')
    Check "the folder the user made was set aside ($($aside.Name -join ', '))" ($aside.Count -eq 1)
    Check 'the data folder is owned by Administrators' ((OwnerSid $data) -eq 'S-1-5-32-544')
    Check 'the user who made the old one has no access' (-not ((GrantedSids $data) -contains $user))
    Check 'their settings file is not used' ((Get-Content (Join-Path $data 'pecklist.conf') -Raw) -notmatch '^planted')
    Check "first install exits 0 (was $code)" ($code -eq 0)
    $service = Get-CimInstance Win32_Service -Filter "Name='PeckList'"
    Check 'the PeckList service exists' ($null -ne $service)
    Check 'it runs' ($service.State -eq 'Running')
    Check 'it starts with Windows' ($service.StartMode -eq 'Auto')
    Check "it runs as NT SERVICE\PeckList (was $($service.StartName))" ($service.StartName -eq 'NT SERVICE\PeckList')
    Check "it answers on port $port" (Healthy $port)

    $password = (Get-Content $passwordFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    Check 'the admin password file was written' (-not [string]::IsNullOrWhiteSpace($password))
    $acl = (Get-Acl $passwordFile).Access | ForEach-Object { $_.IdentityReference.Value }
    Check "only administrators and SYSTEM may read it ($($acl -join ', '))" (-not ($acl -match 'Users|PeckList'))
    $dataAcl = (Get-Acl $data).Access | ForEach-Object { $_.IdentityReference.Value }
    Check "the data folder is not open to Users ($($dataAcl -join ', '))" (-not ($dataAcl -match 'Users'))
    $status = SignIn $password
    Check "the admin password signs in (status $status)" ($status -eq 200)

    Check 'the bin folder is on the machine PATH' ((MachinePath) -split ';' -contains $bin)
    $env:Path = (MachinePath) + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    $version = (& pecklist --version 2>&1 | Out-String).Trim()
    Check "pecklist runs: $version" ($LASTEXITCODE -eq 0 -and $version -match '\(client\)')
    $snapshot = (& pecklist-server snapshot 2>&1 | Out-String).Trim()
    Check "pecklist-server snapshot runs: $snapshot" ($LASTEXITCODE -eq 0)
    $snapshots = @(Get-ChildItem (Join-Path $data 'snapshots') -File -ErrorAction SilentlyContinue)
    Check "a snapshot is in the data folder ($($snapshots.Count))" ($snapshots.Count -ge 1)

    # --- 2. The installer again, over the top -------------------------------------------------------
    # An administrator's own lines in the service's environment, and an address in another form,
    # as the HTTPS section of the docs has people do: an upgrade keeps them.
    $custom = @("ASPNETCORE_URLS=http://localhost:$port") + @(ServiceEnvironment | Where-Object { $_ -notlike 'ASPNETCORE_URLS=*' }) + 'PECKLIST_TEST_MARKER=kept'
    Set-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Services\PeckList' -Name Environment -Type MultiString -Value $custom
    # Links someone left in the data folder (a junction and a hard link to the test user's things):
    # the lock removes them and never changes what they point at.
    $scratch = 'C:\pl-scratch'
    Plant $scratch $user -Folder
    Plant (Join-Path $scratch 'target.txt') $user
    cmd /c "mklink /J `"$data\evil`" `"$scratch`"" | Out-Null
    cmd /c "mklink /H `"$data\hardlink.txt`" `"$scratch\target.txt`"" | Out-Null
    Check 'the junction and the hard link were made for the test' ((Test-Path "$data\evil") -and (Test-Path "$data\hardlink.txt"))
    # A folder and file the test user owns inside the data folder, and an entry of theirs on the data
    # folder itself: the lock takes all three, so nothing can be added to them while it runs.
    $mine = Join-Path $data 'mine'
    Plant $mine $user -Folder
    Plant (Join-Path $mine 'note.txt') $user
    icacls $data /grant "*${user}:(OI)(CI)F" /Q | Out-Null
    Check 'the user-owned folder and entry were made for the test' (((OwnerSid $mine) -eq $user) -and ((GrantedSids $data) -contains $user))
    # A firewall rule an older install left on another port follows the service's port.
    New-NetFirewallRule -DisplayName 'PeckList' -Direction Inbound -Protocol TCP -LocalPort 1234 -Action Allow -Profile Private | Out-Null
    $code = Install 'install-2.log' @()
    $ports = @(Get-NetFirewallRule -DisplayName 'PeckList' | Get-NetFirewallPortFilter | ForEach-Object LocalPort)
    Check "the firewall rule now opens $port (was 1234, now $($ports -join ', '))" ($ports -contains "$port" -and $ports -notcontains '1234')
    Check 'the junction is gone' (-not (Test-Path "$data\evil"))
    Check 'the hard link is gone' (-not (Test-Path "$data\hardlink.txt"))
    Check 'what they pointed at is still there' (Test-Path (Join-Path $scratch 'target.txt'))
    $took = "Took $(Join-Path $mine 'note.txt') from $user"
    Check 'the lock reports the file it took from the test user' ((Get-Content (Join-Path $data 'setup-service.log') -Raw).Contains($took))
    foreach ($item in $data, $mine, (Join-Path $mine 'note.txt')) {
        Check "$item is owned by Administrators ($(OwnerSid $item))" ((OwnerSid $item) -eq 'S-1-5-32-544')
        Check "$item gives the test user nothing" (-not ((GrantedSids $item) -contains $user))
    }
    foreach ($item in $scratch, (Join-Path $scratch 'target.txt')) {
        Check "$item is still the test user's ($(OwnerSid $item))" ((OwnerSid $item) -eq $user)
        Check "$item gives nothing to administrators or the service" (-not ((Get-Acl -LiteralPath $item).Access | Where-Object { -not $_.IsInherited -and $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -ne $user }))
    }
    Check "the second install exits 0 (was $code)" ($code -eq 0)
    Check "it still answers on port $port" (Healthy $port)
    $environment = ServiceEnvironment
    Check "the service's own lines stay ($($environment -join ' | '))" (($environment -contains 'PECKLIST_TEST_MARKER=kept') -and ($environment -contains "ASPNETCORE_URLS=http://localhost:$port"))
    Check 'the password file is the first one' ((Get-Content $passwordFile | Select-Object -First 1) -eq $password)
    $acl = (Get-Acl $passwordFile).Access | ForEach-Object { $_.IdentityReference.Value }
    Check "it is still for administrators and SYSTEM only ($($acl -join ', '))" (-not ($acl -match 'Users|PeckList'))
    Check 'the snapshot is still there' (@(Get-ChildItem (Join-Path $data 'snapshots') -File).Count -ge $snapshots.Count)
    Check 'PATH has the bin folder once' (@((MachinePath) -split ';' | Where-Object { $_ -eq $bin }).Count -eq 1)

    # --- 3. Uninstall -------------------------------------------------------------------------------
    Uninstall
    Check 'the service is gone' (-not (Get-Service PeckList -ErrorAction SilentlyContinue))
    Check 'the program is gone' (-not (Test-Path (Join-Path $program 'pecklist.exe')) -and -not (Test-Path (Join-Path $bin 'pecklist.exe')))
    Check 'the PATH entry is gone' (-not ((MachinePath) -split ';' -contains $bin))
    Check 'the database stays' (Test-Path (Join-Path $data 'pecklist.db'))
    Check 'the settings stay' (Test-Path (Join-Path $data 'pecklist.conf'))

    # --- 4. Installed again onto the kept data ------------------------------------------------------
    # No service, but a database: it is not a first install, so the admin password stays as it was.
    # A settings file the test user put there is set aside.
    Remove-Item (Join-Path $data 'pecklist.conf')
    Plant (Join-Path $data 'pecklist.conf') $user
    $code = Install 'install-3.log' @("/PORT=$port")
    Check 'the settings file the user put there was set aside' (@(Get-ChildItem $data -Filter 'pecklist.conf.untrusted-*').Count -eq 1)
    Check 'and is not used' ((Get-Content (Join-Path $data 'pecklist.conf') -Raw) -notmatch '^planted')
    Check "the install onto kept data exits 0 (was $code)" ($code -eq 0)
    Check "it answers on port $port" (Healthy $port)
    Check 'the password file was not rewritten' ((Get-Content $passwordFile | Select-Object -First 1) -eq $password)
    $status = SignIn $password
    Check "the same admin password still signs in (status $status)" ($status -eq 200)
    Uninstall

    # --- 5. The command line alone, into a folder of one's own ---------------------------------------
    # C:\ lets users change what they make below it; the installer's folder must not.
    $custom = 'C:\PeckListCustom'
    $code = Install 'install-4.log' @("/DIR=$custom", '/COMPONENTS=cli')
    Check "the command line alone installs into $custom (was $code)" ($code -eq 0)
    $sids = GrantedSids $custom
    $writers = (Get-Acl $custom).Access | Where-Object {
        $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin 'S-1-5-32-544', 'S-1-5-18' -and
        ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]'Write, Delete, ChangePermissions, TakeOwnership')
    }
    Check "only administrators and SYSTEM may change it ($($sids -join ', '))" (-not $writers -and (OwnerSid $custom) -eq 'S-1-5-32-544')
    Check 'its pecklist.exe inherits that' (-not ((Get-Acl (Join-Path $custom 'bin\pecklist.exe')).Access | Where-Object { -not $_.IsInherited }))
    Uninstall $custom

    # --- 6. A folder someone else made and filled: a first install there is refused ------------------
    $planted = 'C:\PeckListPlanted'
    Plant $planted $user -Folder
    Plant (Join-Path $planted 'version.dll') $user
    $code = Install 'install-5.log' @("/DIR=$planted", '/COMPONENTS=cli')
    Check "an install into $planted is refused (exit $code)" ($code -ne 0 -and -not (Test-Path (Join-Path $planted 'bin\pecklist.exe')))

    # --- 7. /PORT= that is not a port: refused before anything is installed ---------------------------
    $code = Install 'install-6.log' @('/PORT=abc')
    Check "/PORT=abc is refused (exit $code)" ($code -ne 0 -and -not (Test-Path (Join-Path $program 'pecklist.exe')))
} catch {
    Write-Host "FAIL $($_.Exception.Message)"
    $failures++
}

if ($failures -gt 0) {
    Show-Logs
    Write-Host "$failures check(s) failed"
    exit 1
}
Write-Host 'All checks passed'
