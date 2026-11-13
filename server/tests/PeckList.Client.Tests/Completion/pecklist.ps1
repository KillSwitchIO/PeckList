# PowerShell completion for pecklist, made by `pecklist completion powershell`.
# Install: pecklist completion powershell | Out-String | Invoke-Expression, in your $PROFILE.
# Names of lists, sections and tags come from `pecklist __complete`.
Register-ArgumentCompleter -Native -CommandName pecklist, pecklist.exe -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)
    $canon = @{
        'login' = 'login'
        'logout' = 'logout'
        'whoami' = 'whoami'
        'tasks' = 'tasks'
        'tasks list' = 'tasks list'
        'tasks ls' = 'tasks list'
        'tasks add' = 'tasks add'
        'add' = 'tasks add'
        'tasks show' = 'tasks show'
        'tasks edit' = 'tasks edit'
        'tasks done' = 'tasks done'
        'tasks reopen' = 'tasks reopen'
        'tasks delete' = 'tasks delete'
        'tasks rm' = 'tasks delete'
        'tasks restore' = 'tasks restore'
        'lists' = 'lists'
        'lists list' = 'lists list'
        'lists add' = 'lists add'
        'lists rename' = 'lists rename'
        'sections' = 'sections'
        'sections list' = 'sections list'
        'sections add' = 'sections add'
        'sections rename' = 'sections rename'
        'tags' = 'tags'
        'tags list' = 'tags list'
        'people' = 'people'
        'people list' = 'people list'
        'admin' = 'admin'
        'admin add-user' = 'admin add-user'
        'admin set-role' = 'admin set-role'
        'admin login-link' = 'admin login-link'
        'admin reset-password' = 'admin reset-password'
        'oidc' = 'oidc'
        'oidc unlink' = 'oidc unlink'
        'oidc unbind-all' = 'oidc unbind-all'
        'oidc migration-window' = 'oidc migration-window'
        'snapshot' = 'snapshot'
        'export' = 'export'
        'config' = 'config'
        'config show' = 'config show'
        'completion' = 'completion'
        'help' = 'help'
    }
    $children = @{
        '' = @('login', 'logout', 'whoami', 'tasks', 'lists', 'sections', 'tags', 'people', 'admin', 'oidc', 'snapshot', 'export', 'config', 'completion', 'help', 'add')
        'tasks' = @('list', 'ls', 'add', 'show', 'edit', 'done', 'reopen', 'delete', 'rm', 'restore')
        'lists' = @('list', 'add', 'rename')
        'sections' = @('list', 'add', 'rename')
        'tags' = @('list')
        'people' = @('list')
        'admin' = @('add-user', 'set-role', 'login-link', 'reset-password')
        'oidc' = @('unlink', 'unbind-all', 'migration-window')
        'config' = @('show')
    }
    $options = @{
        '' = @('-v', '--version', '-h', '--help', '--server', '--profile', '--api-key', '--insecure-http')
        'tasks' = @('-h', '--help', '--server', '--profile', '--api-key', '--insecure-http')
        'lists' = @('-h', '--help', '--server', '--profile', '--api-key', '--insecure-http')
        'sections' = @('-h', '--help', '--server', '--profile', '--api-key', '--insecure-http')
        'tags' = @('-h', '--help', '--server', '--profile', '--api-key', '--insecure-http')
        'people' = @('-h', '--help', '--server', '--profile', '--api-key', '--insecure-http')
        'admin' = @('-h', '--help', '--server', '--profile', '--api-key', '--insecure-http')
        'oidc' = @('-h', '--help', '--server', '--profile', '--api-key', '--insecure-http')
        'config' = @('-h', '--help', '--server', '--profile', '--api-key', '--insecure-http')
        'login' = @('--admin', '--token', '-h', '--help', '--server', '--profile', '--api-key', '--insecure-http')
        'logout' = @('-h', '--help', '--server', '--profile', '--api-key', '--insecure-http')
        'whoami' = @('-j', '--json', '-h', '--help', '--server', '--profile', '--api-key', '--insecure-http')
        'tasks list' = @('-l', '--list', '-s', '--section', '-t', '--tag', '--status', '-a', '--all', '-d', '--due', '--due-before', '--due-after', '-p', '--priority', '-u', '--assigned', '-S', '--search', '-o', '--sort', '--limit', '-w', '--wide', '--deleted', '-j', '--json', '-h', '--help', '--server', '--profile', '--api-key', '--insecure-http')
        'tasks add' = @('-l', '--list', '--plain', '-q', '--quiet', '-j', '--json', '-h', '--help', '--server', '--profile', '--api-key', '--insecure-http')
        'tasks show' = @('-j', '--json', '-h', '--help', '--server', '--profile', '--api-key', '--insecure-http')
        'tasks edit' = @('-T', '--title', '-n', '--notes', '-l', '--list', '-s', '--section', '-p', '--priority', '-d', '--due', '--start', '-t', '--tag', '--repeat', '--progress', '-j', '--json', '-h', '--help', '--server', '--profile', '--api-key', '--insecure-http')
        'tasks done' = @('--wontdo', '-j', '--json', '-h', '--help', '--server', '--profile', '--api-key', '--insecure-http')
        'tasks reopen' = @('-j', '--json', '-h', '--help', '--server', '--profile', '--api-key', '--insecure-http')
        'tasks delete' = @('-h', '--help', '--server', '--profile', '--api-key', '--insecure-http')
        'tasks restore' = @('-j', '--json', '-h', '--help', '--server', '--profile', '--api-key', '--insecure-http')
        'lists list' = @('-a', '--all', '-j', '--json', '-h', '--help', '--server', '--profile', '--api-key', '--insecure-http')
        'lists add' = @('--color', '-j', '--json', '-h', '--help', '--server', '--profile', '--api-key', '--insecure-http')
        'lists rename' = @('--color', '-j', '--json', '-h', '--help', '--server', '--profile', '--api-key', '--insecure-http')
        'sections list' = @('-j', '--json', '-h', '--help', '--server', '--profile', '--api-key', '--insecure-http')
        'sections add' = @('-j', '--json', '-h', '--help', '--server', '--profile', '--api-key', '--insecure-http')
        'sections rename' = @('-j', '--json', '-h', '--help', '--server', '--profile', '--api-key', '--insecure-http')
        'tags list' = @('-j', '--json', '-h', '--help', '--server', '--profile', '--api-key', '--insecure-http')
        'people list' = @('-j', '--json', '-h', '--help', '--server', '--profile', '--api-key', '--insecure-http')
        'admin add-user' = @('--admin', '-h', '--help', '--server', '--profile', '--api-key', '--insecure-http')
        'admin set-role' = @('-h', '--help', '--server', '--profile', '--api-key', '--insecure-http')
        'admin login-link' = @('-h', '--help', '--server', '--profile', '--api-key', '--insecure-http')
        'admin reset-password' = @('-h', '--help', '--server', '--profile', '--api-key', '--insecure-http')
        'oidc unlink' = @('-h', '--help', '--server', '--profile', '--api-key', '--insecure-http')
        'oidc unbind-all' = @('-h', '--help', '--server', '--profile', '--api-key', '--insecure-http')
        'oidc migration-window' = @('-h', '--help', '--server', '--profile', '--api-key', '--insecure-http')
        'snapshot' = @('-h', '--help', '--server', '--profile', '--api-key', '--insecure-http')
        'export' = @('--user', '-h', '--help', '--server', '--profile', '--api-key', '--insecure-http')
        'config show' = @('-j', '--json', '-h', '--help', '--server', '--profile', '--api-key', '--insecure-http')
        'completion' = @('-h', '--help', '--server', '--profile', '--api-key', '--insecure-http')
        'help' = @('-h', '--help', '--server', '--profile', '--api-key', '--insecure-http')
    }
    $valued = @('-l', '--list', '-s', '--section', '-t', '--tag', '-d', '--due', '-p', '--priority', '-T', '--title', '-n', '--notes', '--start', '--repeat', '--progress', '--status', '--due-before', '--due-after', '-u', '--assigned', '-S', '--search', '-o', '--sort', '--limit', '--color', '--user', '--server', '--profile', '--api-key')
    $values = @{
        '-p' = @('none', 'low', 'medium', 'high')
        '--priority' = @('none', 'low', 'medium', 'high')
        '--status' = @('open', 'done', 'wontdo', 'deleted', 'all')
        '-o' = @('due', 'priority', 'title', 'list', 'status', 'created', 'updated')
        '--sort' = @('due', 'priority', 'title', 'list', 'status', 'created', 'updated')
    }
    $lookups = @{
        '-l' = 'lists'
        '--list' = 'lists'
        '-s' = 'sections'
        '--section' = 'sections'
        '-t' = 'tags'
        '--tag' = 'tags'
    }
    $arguments = @{
        'admin set-role 1' = @('user', 'admin', 'superadmin')
        'completion 0' = @('bash', 'zsh', 'fish', 'powershell')
    }
    $words = @($commandAst.CommandElements | Select-Object -Skip 1 | Where-Object { $_.Extent.EndOffset -lt $cursorPosition } | ForEach-Object {
        if ($_ -is [System.Management.Automation.Language.StringConstantExpressionAst]) { $_.Value } else { $_.Extent.Text }
    })
    $cmdpath = ''
    $help = $false
    $count = 0
    for ($i = 0; $i -lt $words.Count; $i++) {
        $w = [string]$words[$i]
        if ($w -eq '--') { $count++; break }
        if ($w.StartsWith('--')) {
            if (-not $w.Contains('=') -and $valued -contains $w) { $i++ }
            continue
        }
        if ($w.Length -gt 1 -and $w.StartsWith('-')) {
            for ($j = 1; $j -lt $w.Length; $j++) {
                if ($valued -ccontains ('-' + $w[$j])) {
                    if ($j + 1 -eq $w.Length) { $i++ }
                    break
                }
            }
            continue
        }
        if ($cmdpath -eq '' -and -not $help -and $count -eq 0 -and $w -eq 'help') { $help = $true; continue }
        if ($count -eq 0) {
            $next = if ($cmdpath) { "$cmdpath $w" } else { $w }
            if ($canon.ContainsKey($next)) { $cmdpath = $canon[$next]; continue }
        }
        $count++
    }
    $word = $wordToComplete.Trim("'", '"')
    $prev = if ($words.Count -gt 0) { [string]$words[-1] } else { '' }
    $opt = ''
    if ($word.StartsWith('--') -and $word.Contains('=')) {
        $opt = $word.Substring(0, $word.IndexOf('='))
        $word = $word.Substring($word.IndexOf('=') + 1)
    } elseif ($prev.StartsWith('--') -and $valued -contains $prev) {
        $opt = $prev
    } elseif ($prev.Length -gt 1 -and $prev.StartsWith('-') -and -not $prev.StartsWith('--') -and $valued -ccontains ('-' + $prev[-1])) {
        $opt = '-' + $prev[-1]
    }
    $candidates = @()
    if ($opt) {
        # Keys by case: -t is a tag, -T a title.
        if ($lookups.Keys -ccontains $opt) {
            $candidates = @(& pecklist __complete $lookups[$opt] @words 2>$null)
        } elseif ($values.Keys -ccontains $opt) {
            $candidates = $values[$opt]
        }
    } elseif ($help) {
        $candidates = $children[$cmdpath]
    } elseif ($word.StartsWith('-')) {
        $candidates = $options[$cmdpath]
    } elseif ($count -eq 0 -and $children.ContainsKey($cmdpath)) {
        $candidates = $children[$cmdpath]
    } elseif ($arguments.ContainsKey("$cmdpath $count")) {
        $candidates = $arguments["$cmdpath $count"]
    }
    $prefix = if ($wordToComplete -match '^--[^=]+=') { $Matches[0] } else { '' }
    foreach ($candidate in $candidates) {
        $text = [string]$candidate
        if ($text -and $text.StartsWith($word, [System.StringComparison]::OrdinalIgnoreCase)) {
            # Plain text as it is (never starting with #, a comment); anything else single-quoted with
            # every kind of single quote escaped (PowerShell also ends '...' at U+2018 to U+201B).
            $insert = if ($text -cmatch '^[A-Za-z0-9_.:+/-][A-Za-z0-9_.#:+/-]*$') { $text } else {
                "'" + [System.Management.Automation.Language.CodeGeneration]::EscapeSingleQuotedStringContent($text) + "'"
            }
            [System.Management.Automation.CompletionResult]::new($prefix + $insert, $text, 'ParameterValue', $text)
        }
    }
}
