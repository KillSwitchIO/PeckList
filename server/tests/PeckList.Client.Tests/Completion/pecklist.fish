# fish completion for pecklist, made by `pecklist completion fish`.
# Install: pecklist completion fish > ~/.config/fish/completions/pecklist.fish
# Names of lists, sections and tags come from `pecklist __complete`.

function __pecklist_canon
    switch $argv[1]
        case 'login'
            echo 'login'
        case 'logout'
            echo 'logout'
        case 'whoami'
            echo 'whoami'
        case 'tasks'
            echo 'tasks'
        case 'tasks list' 'tasks ls'
            echo 'tasks list'
        case 'tasks add' 'add'
            echo 'tasks add'
        case 'tasks show'
            echo 'tasks show'
        case 'tasks edit'
            echo 'tasks edit'
        case 'tasks done'
            echo 'tasks done'
        case 'tasks reopen'
            echo 'tasks reopen'
        case 'tasks delete' 'tasks rm'
            echo 'tasks delete'
        case 'tasks restore'
            echo 'tasks restore'
        case 'lists'
            echo 'lists'
        case 'lists list'
            echo 'lists list'
        case 'lists add'
            echo 'lists add'
        case 'lists rename'
            echo 'lists rename'
        case 'sections'
            echo 'sections'
        case 'sections list'
            echo 'sections list'
        case 'sections add'
            echo 'sections add'
        case 'sections rename'
            echo 'sections rename'
        case 'tags'
            echo 'tags'
        case 'tags list'
            echo 'tags list'
        case 'admin'
            echo 'admin'
        case 'admin add-user'
            echo 'admin add-user'
        case 'admin set-role'
            echo 'admin set-role'
        case 'admin login-link'
            echo 'admin login-link'
        case 'admin reset-password'
            echo 'admin reset-password'
        case 'oidc'
            echo 'oidc'
        case 'oidc unlink'
            echo 'oidc unlink'
        case 'oidc unbind-all'
            echo 'oidc unbind-all'
        case 'oidc migration-window'
            echo 'oidc migration-window'
        case 'snapshot'
            echo 'snapshot'
        case 'export'
            echo 'export'
        case 'config'
            echo 'config'
        case 'config show'
            echo 'config show'
        case 'completion'
            echo 'completion'
        case 'help'
            echo 'help'
    end
end

function __pecklist_valued
    switch $argv[1]
        case '-l' '--list' '-s' '--section' '-t' '--tag' '-d' '--due' '-p' '--priority' '-T' '--title' '-n' '--notes' '--start' '--repeat' '--progress' '--status' '--due-before' '--due-after' '--color' '--user' '--server' '--profile' '--api-key'
            return 0
    end
    return 1
end

# Prints: help-mode, positional count, command path.
function __pecklist_state
    set -l words (commandline -opc)
    set -e words[1]
    set -l cmdpath ''
    set -l help 0
    set -l args 0
    set -l skip 0
    for w in $words
        if test $skip = 1
            set skip 0
            continue
        end
        switch $w
            case '--'
                set args (math $args + 1)
                break
            case '--*=*'
                continue
            case '--*'
                __pecklist_valued $w; and set skip 1
                continue
            case '-?*'
                set -l letters (string split '' -- (string sub -s 2 -- $w))
                for at in (seq (count $letters))
                    if __pecklist_valued -$letters[$at]
                        test $at = (count $letters); and set skip 1
                        break
                    end
                end
                continue
        end
        if test -z "$cmdpath" -a $help = 0 -a $args = 0 -a "$w" = help
            set help 1
            continue
        end
        if test $args = 0
            set -l canon (__pecklist_canon (string trim -- "$cmdpath $w"))
            if test -n "$canon"
                set cmdpath $canon
                continue
            end
        end
        set args (math $args + 1)
    end
    echo "$help $args $cmdpath"
end

# At this command, before its arguments: where its sub-commands go.
function __pecklist_at
    set -l state (string split -m 2 ' ' -- (__pecklist_state))
    test $state[1] = 0 -a $state[2] = 0 -a "$state[3]" = "$argv[1]"
end

# Inside this command: where its options go.
function __pecklist_in
    set -l state (string split -m 2 ' ' -- (__pecklist_state))
    test $state[1] = 0 -a "$state[3]" = "$argv[1]"
end

# After help (and a group): commands to show help for.
function __pecklist_help_at
    set -l state (string split -m 2 ' ' -- (__pecklist_state))
    test $state[1] = 1 -a "$state[3]" = "$argv[1]"
end

# This command's argument number N (from 0).
function __pecklist_argument
    set -l state (string split -m 2 ' ' -- (__pecklist_state))
    test $state[1] = 0 -a $state[2] = $argv[2] -a "$state[3]" = "$argv[1]"
end

function __pecklist_lookup
    set -l words (commandline -opc)
    command pecklist __complete $argv[1] $words[2..-1] 2>/dev/null
end

complete -c pecklist -f
complete -c pecklist -s h -l help -d 'Show help for the command, and run nothing.'
complete -c pecklist -l server -x -d 'The server, such as https://tasks.example.com (or PECKLIST_SERVER).'
complete -c pecklist -l profile -x -d 'A saved sign-in by name, to keep several side by side (or PECKLIST_PROFILE).'
complete -c pecklist -l api-key -x -d 'A key for this command only. Prefer PECKLIST_TOKEN or login --token: a flag shows in ps and shell history.'
complete -c pecklist -l insecure-http -d 'Allow http:// to an address other than this machine.'
complete -c pecklist -n '__pecklist_at \'\'' -a 'login' -d 'Sign in: approve a code in the browser, or save an API key. Never a password.'
complete -c pecklist -n '__pecklist_help_at \'\'' -a 'login' -d 'Sign in: approve a code in the browser, or save an API key. Never a password.'
complete -c pecklist -n '__pecklist_at \'\'' -a 'logout' -d 'Revoke this CLI\'s key on the server and forget it here.'
complete -c pecklist -n '__pecklist_help_at \'\'' -a 'logout' -d 'Revoke this CLI\'s key on the server and forget it here.'
complete -c pecklist -n '__pecklist_at \'\'' -a 'whoami' -d 'The server, the account, its role and the key\'s permissions.'
complete -c pecklist -n '__pecklist_help_at \'\'' -a 'whoami' -d 'The server, the account, its role and the key\'s permissions.'
complete -c pecklist -n '__pecklist_at \'\'' -a 'tasks' -d 'List, add, change and close tasks.'
complete -c pecklist -n '__pecklist_help_at \'\'' -a 'tasks' -d 'List, add, change and close tasks.'
complete -c pecklist -n '__pecklist_at \'\'' -a 'lists' -d 'Your lists.'
complete -c pecklist -n '__pecklist_help_at \'\'' -a 'lists' -d 'Your lists.'
complete -c pecklist -n '__pecklist_at \'\'' -a 'sections' -d 'The sections in a list.'
complete -c pecklist -n '__pecklist_help_at \'\'' -a 'sections' -d 'The sections in a list.'
complete -c pecklist -n '__pecklist_at \'\'' -a 'tags' -d 'Your tags.'
complete -c pecklist -n '__pecklist_help_at \'\'' -a 'tags' -d 'Your tags.'
complete -c pecklist -n '__pecklist_at \'\'' -a 'admin' -d 'Accounts, through the admin API (sign in with --admin).'
complete -c pecklist -n '__pecklist_help_at \'\'' -a 'admin' -d 'Accounts, through the admin API (sign in with --admin).'
complete -c pecklist -n '__pecklist_at \'\'' -a 'oidc' -d 'Single sign-on accounts, through the admin API.'
complete -c pecklist -n '__pecklist_help_at \'\'' -a 'oidc' -d 'Single sign-on accounts, through the admin API.'
complete -c pecklist -n '__pecklist_at \'\'' -a 'snapshot' -d 'Take a snapshot on the server now.'
complete -c pecklist -n '__pecklist_help_at \'\'' -a 'snapshot' -d 'Take a snapshot on the server now.'
complete -c pecklist -n '__pecklist_at \'\'' -a 'export' -d 'Download a full backup, or one account\'s data, to a file or standard output.'
complete -c pecklist -n '__pecklist_help_at \'\'' -a 'export' -d 'Download a full backup, or one account\'s data, to a file or standard output.'
complete -c pecklist -n '__pecklist_at \'\'' -a 'config' -d 'The server\'s settings, through the admin API.'
complete -c pecklist -n '__pecklist_help_at \'\'' -a 'config' -d 'The server\'s settings, through the admin API.'
complete -c pecklist -n '__pecklist_at \'\'' -a 'completion' -d 'Print the shell completion script for bash, zsh, fish or powershell.'
complete -c pecklist -n '__pecklist_help_at \'\'' -a 'completion' -d 'Print the shell completion script for bash, zsh, fish or powershell.'
complete -c pecklist -n '__pecklist_at \'\'' -a 'help' -d 'Show help for a command.'
complete -c pecklist -n '__pecklist_help_at \'\'' -a 'help' -d 'Show help for a command.'
complete -c pecklist -n '__pecklist_at \'\'' -a 'add' -d 'Same as tasks add.'
complete -c pecklist -n '__pecklist_help_at \'\'' -a 'add' -d 'Same as tasks add.'
complete -c pecklist -n '__pecklist_at \'tasks\'' -a 'list' -d 'List the open tasks you can see, filtered by list, section, tag, status and due dates.'
complete -c pecklist -n '__pecklist_help_at \'tasks\'' -a 'list' -d 'List the open tasks you can see, filtered by list, section, tag, status and due dates.'
complete -c pecklist -n '__pecklist_at \'tasks\'' -a 'ls' -d 'Same as tasks list.'
complete -c pecklist -n '__pecklist_help_at \'tasks\'' -a 'ls' -d 'Same as tasks list.'
complete -c pecklist -n '__pecklist_at \'tasks\'' -a 'add' -d 'Add a task, reading dates, #tags, ^list, !priority, @person and "every ..." as the app\'s quick add does.'
complete -c pecklist -n '__pecklist_help_at \'tasks\'' -a 'add' -d 'Add a task, reading dates, #tags, ^list, !priority, @person and "every ..." as the app\'s quick add does.'
complete -c pecklist -n '__pecklist_at \'tasks\'' -a 'show' -d 'Show one task.'
complete -c pecklist -n '__pecklist_help_at \'tasks\'' -a 'show' -d 'Show one task.'
complete -c pecklist -n '__pecklist_at \'tasks\'' -a 'edit' -d 'Change a task: only what you name changes.'
complete -c pecklist -n '__pecklist_help_at \'tasks\'' -a 'edit' -d 'Change a task: only what you name changes.'
complete -c pecklist -n '__pecklist_at \'tasks\'' -a 'done' -d 'Close a task. A repeating one moves on to its next date, as in the app.'
complete -c pecklist -n '__pecklist_help_at \'tasks\'' -a 'done' -d 'Close a task. A repeating one moves on to its next date, as in the app.'
complete -c pecklist -n '__pecklist_at \'tasks\'' -a 'reopen' -d 'Open a closed task again.'
complete -c pecklist -n '__pecklist_help_at \'tasks\'' -a 'reopen' -d 'Open a closed task again.'
complete -c pecklist -n '__pecklist_at \'tasks\'' -a 'delete' -d 'Move a task to the trash. tasks restore brings it back.'
complete -c pecklist -n '__pecklist_help_at \'tasks\'' -a 'delete' -d 'Move a task to the trash. tasks restore brings it back.'
complete -c pecklist -n '__pecklist_at \'tasks\'' -a 'rm' -d 'Same as tasks delete.'
complete -c pecklist -n '__pecklist_help_at \'tasks\'' -a 'rm' -d 'Same as tasks delete.'
complete -c pecklist -n '__pecklist_at \'tasks\'' -a 'restore' -d 'Bring a task back from the trash.'
complete -c pecklist -n '__pecklist_help_at \'tasks\'' -a 'restore' -d 'Bring a task back from the trash.'
complete -c pecklist -n '__pecklist_at \'lists\'' -a 'list' -d 'Show your lists.'
complete -c pecklist -n '__pecklist_help_at \'lists\'' -a 'list' -d 'Show your lists.'
complete -c pecklist -n '__pecklist_at \'lists\'' -a 'add' -d 'Make a list.'
complete -c pecklist -n '__pecklist_help_at \'lists\'' -a 'add' -d 'Make a list.'
complete -c pecklist -n '__pecklist_at \'lists\'' -a 'rename' -d 'Rename a list.'
complete -c pecklist -n '__pecklist_help_at \'lists\'' -a 'rename' -d 'Rename a list.'
complete -c pecklist -n '__pecklist_at \'sections\'' -a 'list' -d 'Show the sections, in one list or in all of them.'
complete -c pecklist -n '__pecklist_help_at \'sections\'' -a 'list' -d 'Show the sections, in one list or in all of them.'
complete -c pecklist -n '__pecklist_at \'sections\'' -a 'add' -d 'Make a section in a list.'
complete -c pecklist -n '__pecklist_help_at \'sections\'' -a 'add' -d 'Make a section in a list.'
complete -c pecklist -n '__pecklist_at \'sections\'' -a 'rename' -d 'Rename a section.'
complete -c pecklist -n '__pecklist_help_at \'sections\'' -a 'rename' -d 'Rename a section.'
complete -c pecklist -n '__pecklist_at \'tags\'' -a 'list' -d 'Show your tags. Tags named in tasks add or tasks edit are made when needed.'
complete -c pecklist -n '__pecklist_help_at \'tags\'' -a 'list' -d 'Show your tags. Tags named in tasks add or tasks edit are made when needed.'
complete -c pecklist -n '__pecklist_at \'admin\'' -a 'add-user' -d 'Add an account. Its generated password must be changed at the first login.'
complete -c pecklist -n '__pecklist_help_at \'admin\'' -a 'add-user' -d 'Add an account. Its generated password must be changed at the first login.'
complete -c pecklist -n '__pecklist_at \'admin\'' -a 'set-role' -d 'Make an account a user, admin or superadmin, from its next request.'
complete -c pecklist -n '__pecklist_help_at \'admin\'' -a 'set-role' -d 'Make an account a user, admin or superadmin, from its next request.'
complete -c pecklist -n '__pecklist_at \'admin\'' -a 'login-link' -d 'Print a link that signs the account in once.'
complete -c pecklist -n '__pecklist_help_at \'admin\'' -a 'login-link' -d 'Print a link that signs the account in once.'
complete -c pecklist -n '__pecklist_at \'admin\'' -a 'reset-password' -d 'Give an account (default: admin) a new password to change at login.'
complete -c pecklist -n '__pecklist_help_at \'admin\'' -a 'reset-password' -d 'Give an account (default: admin) a new password to change at login.'
complete -c pecklist -n '__pecklist_at \'oidc\'' -a 'unlink' -d 'Detach an account\'s provider accounts (all, or one provider\'s).'
complete -c pecklist -n '__pecklist_help_at \'oidc\'' -a 'unlink' -d 'Detach an account\'s provider accounts (all, or one provider\'s).'
complete -c pecklist -n '__pecklist_at \'oidc\'' -a 'unbind-all' -d 'Detach every account from a provider, when moving to another.'
complete -c pecklist -n '__pecklist_help_at \'oidc\'' -a 'unbind-all' -d 'Detach every account from a provider, when moving to another.'
complete -c pecklist -n '__pecklist_at \'oidc\'' -a 'migration-window' -d 'Until it closes, a first sign-in through the provider joins the account with the same username.'
complete -c pecklist -n '__pecklist_help_at \'oidc\'' -a 'migration-window' -d 'Until it closes, a first sign-in through the provider joins the account with the same username.'
complete -c pecklist -n '__pecklist_at \'config\'' -a 'show' -d 'Every setting with where it comes from (secrets hidden).'
complete -c pecklist -n '__pecklist_help_at \'config\'' -a 'show' -d 'Every setting with where it comes from (secrets hidden).'
complete -c pecklist -n '__pecklist_in \'\'' -s v -l version -d 'Print the version.'
complete -c pecklist -n '__pecklist_in \'login\'' -l admin -d 'Ask for the admin permission too (owners and admins).'
complete -c pecklist -n '__pecklist_in \'login\'' -l token -d 'Save an API key, read from the keyboard, or from standard input when piped.'
complete -c pecklist -n '__pecklist_in \'whoami\'' -s j -l json -d 'Print the API\'s JSON: one thing as an object, a list of things as `{"items": [...]}`.'
complete -c pecklist -n '__pecklist_in \'tasks list\'' -s l -l list -x -a '(__pecklist_lookup lists)' -d 'The list: an id or a name (exact, then a unique start, as ^list matches).'
complete -c pecklist -n '__pecklist_in \'tasks list\'' -s s -l section -x -a '(__pecklist_lookup sections)' -d 'The section: an id or a name.'
complete -c pecklist -n '__pecklist_in \'tasks list\'' -s t -l tag -x -a '(__pecklist_lookup tags)' -d 'Only tasks with this tag.'
complete -c pecklist -n '__pecklist_in \'tasks list\'' -l status -x -a 'open done wontdo all' -d 'Only tasks with this status: open, done, wontdo or all.'
complete -c pecklist -n '__pecklist_in \'tasks list\'' -l due-before -x -d 'Only tasks due before this date.'
complete -c pecklist -n '__pecklist_in \'tasks list\'' -l due-after -x -d 'Only tasks due after this date.'
complete -c pecklist -n '__pecklist_in \'tasks list\'' -s a -l all -d 'Every status, not only open tasks.'
complete -c pecklist -n '__pecklist_in \'tasks list\'' -l deleted -d 'The trash instead.'
complete -c pecklist -n '__pecklist_in \'tasks list\'' -s j -l json -d 'Print the API\'s JSON: one thing as an object, a list of things as `{"items": [...]}`.'
complete -c pecklist -n '__pecklist_in \'tasks add\'' -s l -l list -x -a '(__pecklist_lookup lists)' -d 'The list to add it to (without one, your inbox).'
complete -c pecklist -n '__pecklist_in \'tasks add\'' -l plain -d 'Take the text as the title as it is, without reading dates or tags.'
complete -c pecklist -n '__pecklist_in \'tasks add\'' -s q -l quiet -d 'Print only the new task\'s id.'
complete -c pecklist -n '__pecklist_in \'tasks add\'' -s j -l json -d 'Print the API\'s JSON: one thing as an object, a list of things as `{"items": [...]}`.'
complete -c pecklist -n '__pecklist_in \'tasks show\'' -s j -l json -d 'Print the API\'s JSON: one thing as an object, a list of things as `{"items": [...]}`.'
complete -c pecklist -n '__pecklist_in \'tasks edit\'' -s T -l title -x -d 'The new title.'
complete -c pecklist -n '__pecklist_in \'tasks edit\'' -s n -l notes -x -d 'The new notes.'
complete -c pecklist -n '__pecklist_in \'tasks edit\'' -s l -l list -x -a '(__pecklist_lookup lists)' -d 'Move it to this list.'
complete -c pecklist -n '__pecklist_in \'tasks edit\'' -s s -l section -x -a '(__pecklist_lookup sections)' -d 'Move it to this section, or none.'
complete -c pecklist -n '__pecklist_in \'tasks edit\'' -s p -l priority -x -a 'none low medium high' -d 'The priority: none, low, medium or high.'
complete -c pecklist -n '__pecklist_in \'tasks edit\'' -s d -l due -x -d 'The due date (2026-11-30 or 2026-11-30T09:00), or none.'
complete -c pecklist -n '__pecklist_in \'tasks edit\'' -l start -x -d 'The start date, or none.'
complete -c pecklist -n '__pecklist_in \'tasks edit\'' -s t -l tag -x -a '(__pecklist_lookup tags)' -d 'Add (+name) and remove (-name) tags, comma separated.'
complete -c pecklist -n '__pecklist_in \'tasks edit\'' -l repeat -x -d 'How it repeats (an RRULE such as FREQ=WEEKLY), or none.'
complete -c pecklist -n '__pecklist_in \'tasks edit\'' -l progress -x -d 'Progress in percent.'
complete -c pecklist -n '__pecklist_in \'tasks edit\'' -s j -l json -d 'Print the API\'s JSON: one thing as an object, a list of things as `{"items": [...]}`.'
complete -c pecklist -n '__pecklist_in \'tasks done\'' -l wontdo -d 'Close it as won\'t do.'
complete -c pecklist -n '__pecklist_in \'tasks done\'' -s j -l json -d 'Print the API\'s JSON: one thing as an object, a list of things as `{"items": [...]}`.'
complete -c pecklist -n '__pecklist_in \'tasks reopen\'' -s j -l json -d 'Print the API\'s JSON: one thing as an object, a list of things as `{"items": [...]}`.'
complete -c pecklist -n '__pecklist_in \'tasks restore\'' -s j -l json -d 'Print the API\'s JSON: one thing as an object, a list of things as `{"items": [...]}`.'
complete -c pecklist -n '__pecklist_in \'lists list\'' -s a -l all -d 'Archived lists too.'
complete -c pecklist -n '__pecklist_in \'lists list\'' -s j -l json -d 'Print the API\'s JSON: one thing as an object, a list of things as `{"items": [...]}`.'
complete -c pecklist -n '__pecklist_in \'lists add\'' -l color -x -d 'The list\'s colour.'
complete -c pecklist -n '__pecklist_in \'lists add\'' -s j -l json -d 'Print the API\'s JSON: one thing as an object, a list of things as `{"items": [...]}`.'
complete -c pecklist -n '__pecklist_in \'lists rename\'' -l color -x -d 'The list\'s colour.'
complete -c pecklist -n '__pecklist_in \'lists rename\'' -s j -l json -d 'Print the API\'s JSON: one thing as an object, a list of things as `{"items": [...]}`.'
complete -c pecklist -n '__pecklist_in \'sections list\'' -s j -l json -d 'Print the API\'s JSON: one thing as an object, a list of things as `{"items": [...]}`.'
complete -c pecklist -n '__pecklist_in \'sections add\'' -s j -l json -d 'Print the API\'s JSON: one thing as an object, a list of things as `{"items": [...]}`.'
complete -c pecklist -n '__pecklist_in \'sections rename\'' -s j -l json -d 'Print the API\'s JSON: one thing as an object, a list of things as `{"items": [...]}`.'
complete -c pecklist -n '__pecklist_in \'tags list\'' -s j -l json -d 'Print the API\'s JSON: one thing as an object, a list of things as `{"items": [...]}`.'
complete -c pecklist -n '__pecklist_in \'admin add-user\'' -l admin -d 'Make it an admin.'
complete -c pecklist -n '__pecklist_in \'export\'' -l user -x -d 'Only this account\'s data.'
complete -c pecklist -n '__pecklist_in \'config show\'' -s j -l json -d 'Print the API\'s JSON: one thing as an object, a list of things as `{"items": [...]}`.'
complete -c pecklist -n '__pecklist_argument \'admin set-role\' 1' -a 'user admin superadmin'
complete -c pecklist -n '__pecklist_argument \'completion\' 0' -a 'bash zsh fish powershell'
complete -c pecklist -n '__pecklist_in \'export\'' -F
