# bash completion for pecklist, made by `pecklist completion bash`.
# Install: pecklist completion bash > ~/.local/share/bash-completion/completions/pecklist
# Names of lists, sections and tags come from `pecklist __complete`: at most about a second,
# nothing when signed out or offline.

_pecklist_canon() {
    case "$1" in
        'login') printf '%s\n' 'login' ;;
        'logout') printf '%s\n' 'logout' ;;
        'whoami') printf '%s\n' 'whoami' ;;
        'tasks') printf '%s\n' 'tasks' ;;
        'tasks list'|'tasks ls') printf '%s\n' 'tasks list' ;;
        'tasks add'|'add') printf '%s\n' 'tasks add' ;;
        'tasks show') printf '%s\n' 'tasks show' ;;
        'tasks edit') printf '%s\n' 'tasks edit' ;;
        'tasks done') printf '%s\n' 'tasks done' ;;
        'tasks reopen') printf '%s\n' 'tasks reopen' ;;
        'tasks delete'|'tasks rm') printf '%s\n' 'tasks delete' ;;
        'tasks restore') printf '%s\n' 'tasks restore' ;;
        'lists') printf '%s\n' 'lists' ;;
        'lists list') printf '%s\n' 'lists list' ;;
        'lists add') printf '%s\n' 'lists add' ;;
        'lists rename') printf '%s\n' 'lists rename' ;;
        'sections') printf '%s\n' 'sections' ;;
        'sections list') printf '%s\n' 'sections list' ;;
        'sections add') printf '%s\n' 'sections add' ;;
        'sections rename') printf '%s\n' 'sections rename' ;;
        'tags') printf '%s\n' 'tags' ;;
        'tags list') printf '%s\n' 'tags list' ;;
        'people') printf '%s\n' 'people' ;;
        'people list') printf '%s\n' 'people list' ;;
        'admin') printf '%s\n' 'admin' ;;
        'admin add-user') printf '%s\n' 'admin add-user' ;;
        'admin set-role') printf '%s\n' 'admin set-role' ;;
        'admin login-link') printf '%s\n' 'admin login-link' ;;
        'admin reset-password') printf '%s\n' 'admin reset-password' ;;
        'oidc') printf '%s\n' 'oidc' ;;
        'oidc unlink') printf '%s\n' 'oidc unlink' ;;
        'oidc unbind-all') printf '%s\n' 'oidc unbind-all' ;;
        'oidc migration-window') printf '%s\n' 'oidc migration-window' ;;
        'snapshot') printf '%s\n' 'snapshot' ;;
        'export') printf '%s\n' 'export' ;;
        'config') printf '%s\n' 'config' ;;
        'config show') printf '%s\n' 'config show' ;;
        'completion') printf '%s\n' 'completion' ;;
        'help') printf '%s\n' 'help' ;;
    esac
}

_pecklist_children() {
    case "$1" in
        '') printf '%s\n' login logout whoami tasks lists sections tags people admin oidc snapshot export config completion help add ;;
        'tasks') printf '%s\n' list ls add show edit done reopen delete rm restore ;;
        'lists') printf '%s\n' list add rename ;;
        'sections') printf '%s\n' list add rename ;;
        'tags') printf '%s\n' list ;;
        'people') printf '%s\n' list ;;
        'admin') printf '%s\n' add-user set-role login-link reset-password ;;
        'oidc') printf '%s\n' unlink unbind-all migration-window ;;
        'config') printf '%s\n' show ;;
    esac
}

_pecklist_options() {
    case "$1" in
        '') printf '%s\n' -v --version -h --help --server --profile --api-key --insecure-http ;;
        'tasks') printf '%s\n' -h --help --server --profile --api-key --insecure-http ;;
        'lists') printf '%s\n' -h --help --server --profile --api-key --insecure-http ;;
        'sections') printf '%s\n' -h --help --server --profile --api-key --insecure-http ;;
        'tags') printf '%s\n' -h --help --server --profile --api-key --insecure-http ;;
        'people') printf '%s\n' -h --help --server --profile --api-key --insecure-http ;;
        'admin') printf '%s\n' -h --help --server --profile --api-key --insecure-http ;;
        'oidc') printf '%s\n' -h --help --server --profile --api-key --insecure-http ;;
        'config') printf '%s\n' -h --help --server --profile --api-key --insecure-http ;;
        'login') printf '%s\n' --admin --token -h --help --server --profile --api-key --insecure-http ;;
        'logout') printf '%s\n' -h --help --server --profile --api-key --insecure-http ;;
        'whoami') printf '%s\n' -j --json -h --help --server --profile --api-key --insecure-http ;;
        'tasks list') printf '%s\n' -l --list -s --section -t --tag --status -a --all -d --due --due-before --due-after -p --priority -u --assigned -S --search -o --sort --limit -w --wide --deleted -j --json -h --help --server --profile --api-key --insecure-http ;;
        'tasks add') printf '%s\n' -l --list --plain -q --quiet -j --json -h --help --server --profile --api-key --insecure-http ;;
        'tasks show') printf '%s\n' -j --json -h --help --server --profile --api-key --insecure-http ;;
        'tasks edit') printf '%s\n' -T --title -n --notes -l --list -s --section -p --priority -d --due --start -t --tag --repeat --progress -j --json -h --help --server --profile --api-key --insecure-http ;;
        'tasks done') printf '%s\n' --wontdo -j --json -h --help --server --profile --api-key --insecure-http ;;
        'tasks reopen') printf '%s\n' -j --json -h --help --server --profile --api-key --insecure-http ;;
        'tasks delete') printf '%s\n' -h --help --server --profile --api-key --insecure-http ;;
        'tasks restore') printf '%s\n' -j --json -h --help --server --profile --api-key --insecure-http ;;
        'lists list') printf '%s\n' -a --all -j --json -h --help --server --profile --api-key --insecure-http ;;
        'lists add') printf '%s\n' --color -j --json -h --help --server --profile --api-key --insecure-http ;;
        'lists rename') printf '%s\n' --color -j --json -h --help --server --profile --api-key --insecure-http ;;
        'sections list') printf '%s\n' -j --json -h --help --server --profile --api-key --insecure-http ;;
        'sections add') printf '%s\n' -j --json -h --help --server --profile --api-key --insecure-http ;;
        'sections rename') printf '%s\n' -j --json -h --help --server --profile --api-key --insecure-http ;;
        'tags list') printf '%s\n' -j --json -h --help --server --profile --api-key --insecure-http ;;
        'people list') printf '%s\n' -j --json -h --help --server --profile --api-key --insecure-http ;;
        'admin add-user') printf '%s\n' --admin -h --help --server --profile --api-key --insecure-http ;;
        'admin set-role') printf '%s\n' -h --help --server --profile --api-key --insecure-http ;;
        'admin login-link') printf '%s\n' -h --help --server --profile --api-key --insecure-http ;;
        'admin reset-password') printf '%s\n' -h --help --server --profile --api-key --insecure-http ;;
        'oidc unlink') printf '%s\n' -h --help --server --profile --api-key --insecure-http ;;
        'oidc unbind-all') printf '%s\n' -h --help --server --profile --api-key --insecure-http ;;
        'oidc migration-window') printf '%s\n' -h --help --server --profile --api-key --insecure-http ;;
        'snapshot') printf '%s\n' -h --help --server --profile --api-key --insecure-http ;;
        'export') printf '%s\n' --user -h --help --server --profile --api-key --insecure-http ;;
        'config show') printf '%s\n' -j --json -h --help --server --profile --api-key --insecure-http ;;
        'completion') printf '%s\n' -h --help --server --profile --api-key --insecure-http ;;
        'help') printf '%s\n' -h --help --server --profile --api-key --insecure-http ;;
    esac
}

_pecklist_valued() {
    case "$1" in
        -l|--list|-s|--section|-t|--tag|-d|--due|-p|--priority|-T|--title|-n|--notes|--start|--repeat|--progress|--status|--due-before|--due-after|-u|--assigned|-S|--search|-o|--sort|--limit|--color|--user|--server|--profile|--api-key) return 0 ;;
    esac
    return 1
}

_pecklist_lookup() {
    command pecklist __complete "$1" "${line[@]}" 2>/dev/null
}

_pecklist_values() {
    case "$1" in
        -l|--list) _pecklist_lookup lists ;;
        -s|--section) _pecklist_lookup sections ;;
        -t|--tag) _pecklist_lookup tags ;;
        -p|--priority) printf '%s\n' none low medium high ;;
        --status) printf '%s\n' open done wontdo deleted all ;;
        -o|--sort) printf '%s\n' due priority title list status created updated ;;
    esac
}

_pecklist_arguments() {
    case "$1 $2" in
        'admin set-role 1') printf '%s\n' user admin superadmin ;;
        'completion 0') printf '%s\n' bash zsh fish powershell ;;
    esac
}

_pecklist_reply() {
    local line match="${cur#[\"\']}"
    match="${match//\\/}"
    while IFS= read -r line; do
        [[ -n $line && $line == "$match"* ]] && COMPREPLY+=("$(printf '%q' "$line")")
    done <<< "$1"
}

_pecklist() {
    local cur="${COMP_WORDS[COMP_CWORD]}" opt="" cmdpath="" w canon c
    local -i i j args=0 help=0
    local -a line=("${COMP_WORDS[@]:1:COMP_CWORD-1}")
    COMPREPLY=()
    # bash splits --list=Yard at the =.
    if [[ $cur == = ]]; then
        opt="${COMP_WORDS[COMP_CWORD-1]}"
        cur=""
    elif ((COMP_CWORD >= 2)) && [[ ${COMP_WORDS[COMP_CWORD-1]} == = ]]; then
        opt="${COMP_WORDS[COMP_CWORD-2]}"
    fi
    for ((i = 1; i < COMP_CWORD; i++)); do
        w="${COMP_WORDS[i]}"
        case "$w" in
            --) args+=1; break ;;
            =) i+=1; continue ;;
            --*) _pecklist_valued "$w" && [[ ${COMP_WORDS[i+1]} != = ]] && i+=1; continue ;;
            -?*)
                for ((j = 1; j < ${#w}; j++)); do
                    if _pecklist_valued "-${w:j:1}"; then
                        ((j + 1 == ${#w})) && i+=1
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
    if [[ -z $opt ]] && ((COMP_CWORD >= 2)); then
        w="${COMP_WORDS[COMP_CWORD-1]}"
        case "$w" in
            --*) _pecklist_valued "$w" && opt="$w" ;;
            -?*) c="-${w: -1}"; _pecklist_valued "$c" && opt="$c" ;;
        esac
    fi
    if [[ -n $opt ]]; then
        _pecklist_reply "$(_pecklist_values "$opt")"
    elif ((help)); then
        _pecklist_reply "$(_pecklist_children "$cmdpath")"
    elif [[ $cur == -* ]]; then
        _pecklist_reply "$(_pecklist_options "$cmdpath")"
    elif ((args == 0)) && [[ -n $(_pecklist_children "$cmdpath") ]]; then
        _pecklist_reply "$(_pecklist_children "$cmdpath")"
    else
        _pecklist_reply "$(_pecklist_arguments "$cmdpath" "$args")"
    fi
}

complete -F _pecklist pecklist
