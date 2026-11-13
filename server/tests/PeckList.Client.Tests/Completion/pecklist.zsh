#compdef pecklist
# zsh completion for pecklist, made by `pecklist completion zsh`.
# Install: pecklist completion zsh > "${fpath[1]}/_pecklist" (any folder on $fpath), then
# start a new shell. Names of lists, sections and tags come from `pecklist __complete`.

_pecklist_canon() {
    case "$1" in
        'login') print -rl -- 'login' ;;
        'logout') print -rl -- 'logout' ;;
        'whoami') print -rl -- 'whoami' ;;
        'tasks') print -rl -- 'tasks' ;;
        'tasks list'|'tasks ls') print -rl -- 'tasks list' ;;
        'tasks add'|'add') print -rl -- 'tasks add' ;;
        'tasks show') print -rl -- 'tasks show' ;;
        'tasks edit') print -rl -- 'tasks edit' ;;
        'tasks done') print -rl -- 'tasks done' ;;
        'tasks reopen') print -rl -- 'tasks reopen' ;;
        'tasks delete'|'tasks rm') print -rl -- 'tasks delete' ;;
        'tasks restore') print -rl -- 'tasks restore' ;;
        'lists') print -rl -- 'lists' ;;
        'lists list') print -rl -- 'lists list' ;;
        'lists add') print -rl -- 'lists add' ;;
        'lists rename') print -rl -- 'lists rename' ;;
        'sections') print -rl -- 'sections' ;;
        'sections list') print -rl -- 'sections list' ;;
        'sections add') print -rl -- 'sections add' ;;
        'sections rename') print -rl -- 'sections rename' ;;
        'tags') print -rl -- 'tags' ;;
        'tags list') print -rl -- 'tags list' ;;
        'people') print -rl -- 'people' ;;
        'people list') print -rl -- 'people list' ;;
        'admin') print -rl -- 'admin' ;;
        'admin add-user') print -rl -- 'admin add-user' ;;
        'admin set-role') print -rl -- 'admin set-role' ;;
        'admin login-link') print -rl -- 'admin login-link' ;;
        'admin reset-password') print -rl -- 'admin reset-password' ;;
        'oidc') print -rl -- 'oidc' ;;
        'oidc unlink') print -rl -- 'oidc unlink' ;;
        'oidc unbind-all') print -rl -- 'oidc unbind-all' ;;
        'oidc migration-window') print -rl -- 'oidc migration-window' ;;
        'snapshot') print -rl -- 'snapshot' ;;
        'export') print -rl -- 'export' ;;
        'config') print -rl -- 'config' ;;
        'config show') print -rl -- 'config show' ;;
        'completion') print -rl -- 'completion' ;;
        'help') print -rl -- 'help' ;;
    esac
}

_pecklist_children() {
    case "$1" in
        '') print -rl -- login logout whoami tasks lists sections tags people admin oidc snapshot export config completion help add ;;
        'tasks') print -rl -- list ls add show edit done reopen delete rm restore ;;
        'lists') print -rl -- list add rename ;;
        'sections') print -rl -- list add rename ;;
        'tags') print -rl -- list ;;
        'people') print -rl -- list ;;
        'admin') print -rl -- add-user set-role login-link reset-password ;;
        'oidc') print -rl -- unlink unbind-all migration-window ;;
        'config') print -rl -- show ;;
    esac
}

_pecklist_options() {
    case "$1" in
        '') print -rl -- -v --version -h --help --server --profile --api-key --insecure-http ;;
        'tasks') print -rl -- -h --help --server --profile --api-key --insecure-http ;;
        'lists') print -rl -- -h --help --server --profile --api-key --insecure-http ;;
        'sections') print -rl -- -h --help --server --profile --api-key --insecure-http ;;
        'tags') print -rl -- -h --help --server --profile --api-key --insecure-http ;;
        'people') print -rl -- -h --help --server --profile --api-key --insecure-http ;;
        'admin') print -rl -- -h --help --server --profile --api-key --insecure-http ;;
        'oidc') print -rl -- -h --help --server --profile --api-key --insecure-http ;;
        'config') print -rl -- -h --help --server --profile --api-key --insecure-http ;;
        'login') print -rl -- --admin --token -h --help --server --profile --api-key --insecure-http ;;
        'logout') print -rl -- -h --help --server --profile --api-key --insecure-http ;;
        'whoami') print -rl -- -j --json -h --help --server --profile --api-key --insecure-http ;;
        'tasks list') print -rl -- -l --list -s --section -t --tag --status -a --all -d --due --due-before --due-after -p --priority -u --assigned -S --search -o --sort --limit -w --wide --deleted -j --json -h --help --server --profile --api-key --insecure-http ;;
        'tasks add') print -rl -- -l --list --plain -q --quiet -j --json -h --help --server --profile --api-key --insecure-http ;;
        'tasks show') print -rl -- -j --json -h --help --server --profile --api-key --insecure-http ;;
        'tasks edit') print -rl -- -T --title -n --notes -l --list -s --section -p --priority -d --due --start -t --tag --repeat --progress -j --json -h --help --server --profile --api-key --insecure-http ;;
        'tasks done') print -rl -- --wontdo -j --json -h --help --server --profile --api-key --insecure-http ;;
        'tasks reopen') print -rl -- -j --json -h --help --server --profile --api-key --insecure-http ;;
        'tasks delete') print -rl -- -h --help --server --profile --api-key --insecure-http ;;
        'tasks restore') print -rl -- -j --json -h --help --server --profile --api-key --insecure-http ;;
        'lists list') print -rl -- -a --all -j --json -h --help --server --profile --api-key --insecure-http ;;
        'lists add') print -rl -- --color -j --json -h --help --server --profile --api-key --insecure-http ;;
        'lists rename') print -rl -- --color -j --json -h --help --server --profile --api-key --insecure-http ;;
        'sections list') print -rl -- -j --json -h --help --server --profile --api-key --insecure-http ;;
        'sections add') print -rl -- -j --json -h --help --server --profile --api-key --insecure-http ;;
        'sections rename') print -rl -- -j --json -h --help --server --profile --api-key --insecure-http ;;
        'tags list') print -rl -- -j --json -h --help --server --profile --api-key --insecure-http ;;
        'people list') print -rl -- -j --json -h --help --server --profile --api-key --insecure-http ;;
        'admin add-user') print -rl -- --admin -h --help --server --profile --api-key --insecure-http ;;
        'admin set-role') print -rl -- -h --help --server --profile --api-key --insecure-http ;;
        'admin login-link') print -rl -- -h --help --server --profile --api-key --insecure-http ;;
        'admin reset-password') print -rl -- -h --help --server --profile --api-key --insecure-http ;;
        'oidc unlink') print -rl -- -h --help --server --profile --api-key --insecure-http ;;
        'oidc unbind-all') print -rl -- -h --help --server --profile --api-key --insecure-http ;;
        'oidc migration-window') print -rl -- -h --help --server --profile --api-key --insecure-http ;;
        'snapshot') print -rl -- -h --help --server --profile --api-key --insecure-http ;;
        'export') print -rl -- --user -h --help --server --profile --api-key --insecure-http ;;
        'config show') print -rl -- -j --json -h --help --server --profile --api-key --insecure-http ;;
        'completion') print -rl -- -h --help --server --profile --api-key --insecure-http ;;
        'help') print -rl -- -h --help --server --profile --api-key --insecure-http ;;
    esac
}

_pecklist_valued() {
    case "$1" in
        -l|--list|-s|--section|-t|--tag|-d|--due|-p|--priority|-T|--title|-n|--notes|--start|--repeat|--progress|--status|--due-before|--due-after|-u|--assigned|-S|--search|-o|--sort|--limit|--color|--user|--server|--profile|--api-key) return 0 ;;
    esac
    return 1
}

_pecklist_lookup() {
    command pecklist __complete "$1" "${(@Q)words[2,CURRENT-1]}" 2>/dev/null
}

_pecklist_values() {
    case "$1" in
        -l|--list) _pecklist_lookup lists ;;
        -s|--section) _pecklist_lookup sections ;;
        -t|--tag) _pecklist_lookup tags ;;
        -p|--priority) print -rl -- none low medium high ;;
        --status) print -rl -- open done wontdo deleted all ;;
        -o|--sort) print -rl -- due priority title list status created updated ;;
    esac
}

_pecklist_arguments() {
    case "$1 $2" in
        'admin set-role 1') print -rl -- user admin superadmin ;;
        'completion 0') print -rl -- bash zsh fish powershell ;;
    esac
}

_pecklist_describe() {
    case "$1" in
        '')
            reply=('login:Sign in: approve a code in the browser, or save an API key. Never a password.' 'logout:Revoke this CLI'\''s key on the server and forget it here.' 'whoami:The server, the account, its role and the key'\''s permissions.' 'tasks:List, add, change and close tasks.' 'lists:Your lists.' 'sections:The sections in a list.' 'tags:Your tags.' 'people:Who tasks can be assigned to.' 'admin:Accounts, through the admin API (sign in with --admin).' 'oidc:Single sign-on accounts, through the admin API.' 'snapshot:Take a snapshot on the server now.' 'export:Download a full backup, or one account'\''s data, to a file or standard output.' 'config:The server'\''s settings, through the admin API.' 'completion:Print the shell completion script for bash, zsh, fish or powershell.' 'help:Show help for a command.' 'add:Same as tasks add.') ;;
        'tasks')
            reply=('list:List tasks with their status, date, priority, list and tags; filter by list, tag, status, due date, priority, person and words.' 'ls:Same as tasks list.' 'add:Add a task, reading dates, #tags, ^list, !priority, @person and "every ..." as the app'\''s quick add does.' 'show:Show everything about one task: its list, dates, reminders, repeat, people, checklist, subtasks and notes.' 'edit:Change a task: only what you name changes.' 'done:Close a task. A repeating one moves on to its next date, as in the app.' 'reopen:Open a closed task again.' 'delete:Move a task to the trash. tasks restore brings it back.' 'rm:Same as tasks delete.' 'restore:Bring a task back from the trash.') ;;
        'lists')
            reply=('list:Show your lists.' 'add:Make a list.' 'rename:Rename a list.') ;;
        'sections')
            reply=('list:Show the sections, in one list or in all of them.' 'add:Make a section in a list.' 'rename:Rename a section.') ;;
        'tags')
            reply=('list:Show your tags. Tags named in tasks add or tasks edit are made when needed.') ;;
        'people')
            reply=('list:Show the people and groups a task can be assigned to, with the id to use.') ;;
        'admin')
            reply=('add-user:Add an account. Its generated password must be changed at the first login.' 'set-role:Make an account a user, admin or superadmin, from its next request.' 'login-link:Print a link that signs the account in once.' 'reset-password:Give an account (default: admin) a new password to change at login.') ;;
        'oidc')
            reply=('unlink:Detach an account'\''s provider accounts (all, or one provider'\''s).' 'unbind-all:Detach every account from a provider, when moving to another.' 'migration-window:Until it closes, a first sign-in through the provider joins the account with the same username.') ;;
        'config')
            reply=('show:Every setting with where it comes from (secrets hidden).') ;;
    esac
}

_pecklist() {
    local cur="${words[CURRENT]}" opt="" cmdpath="" w canon c
    integer i j args=0 help=0
    local -a reply values
    for ((i = 2; i < CURRENT; i++)); do
        w="${(Q)words[i]}"
        case "$w" in
            --) args+=1; break ;;
            --*=*) continue ;;
            --*) _pecklist_valued "$w" && i+=1; continue ;;
            -?*)
                for ((j = 2; j <= ${#w}; j++)); do
                    if _pecklist_valued "-${w[j]}"; then
                        ((j == ${#w})) && i+=1
                        break
                    fi
                done
                continue ;;
        esac
        if [[ -z $cmdpath && $help == 0 && $args == 0 && $w == help ]]; then
            help=1
            continue
        fi
        if ((args == 0)); then
            canon="$(_pecklist_canon "${cmdpath:+$cmdpath }$w")"
            if [[ -n $canon ]]; then
                cmdpath="$canon"
                continue
            fi
        fi
        args+=1
    done
    if [[ $cur == --*=* ]]; then
        opt="${cur%%=*}"
        compset -P '*='
    elif ((CURRENT > 2)); then
        w="${(Q)words[CURRENT-1]}"
        case "$w" in
            --*) _pecklist_valued "$w" && opt="$w" ;;
            -?*) c="-${w[-1]}"; _pecklist_valued "$c" && opt="$c" ;;
        esac
    fi
    if [[ -n $opt ]]; then
        values=("${(@f)$(_pecklist_values "$opt")}")
        compadd -a values
    elif ((help)) || { ((args == 0)) && [[ $cur != -* && -n $(_pecklist_children "$cmdpath") ]]; }; then
        _pecklist_describe "$cmdpath"
        _describe -t commands 'pecklist command' reply
    elif [[ $cur == -* ]]; then
        values=("${(@f)$(_pecklist_options "$cmdpath")}")
        values=(${=values})
        compadd -a values
    else
        values=("${(@f)$(_pecklist_arguments "$cmdpath" "$args")}")
        values=(${=values})
        compadd -a values
    fi
}

_pecklist "$@"
