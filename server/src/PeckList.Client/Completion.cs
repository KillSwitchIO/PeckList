using System.Text;

namespace PeckList.Client;

/// <summary>
/// The shell completion scripts (PL-138), made from <see cref="CommandTable"/>. Commands, options
/// and fixed values are in the script itself, so they work offline. List, section and tag names
/// come from the hidden <c>pecklist __complete</c>, which answers nothing when it cannot (signed
/// out, offline, slow). Names from the server are only ever compared and inserted as literal text:
/// never through <c>compgen -W</c>, <c>eval</c> or anything else that would expand them.
/// </summary>
internal static class Completion
{
    /// <summary>Every name a command can be called by (aliases too), with the command it stands for.</summary>
    private static IEnumerable<(string Name, string Canonical)> Names() =>
        Visible().SelectMany(command => command.Aliases.Prepend(command.Path).Select(name => (name, command.Path)));

    private static IEnumerable<CliCommand> Visible() => CommandTable.Commands.Where(command => !command.Hidden && command.Path.Length > 0);

    private static IEnumerable<CliCommand> Groups() => CommandTable.Commands.Where(command => !command.Hidden && (command.Path.Length == 0 || CommandTable.IsGroup(command)));

    /// <summary>The words one level under a group, aliases included, with what each does.</summary>
    private static IEnumerable<(string Word, string Summary)> ChildWords(CliCommand group) =>
        CommandTable.Children(group).SelectMany(child =>
                child.Aliases.Where(alias => CommandTable.Parent(alias) == group.Path)
                    .Select(alias => (alias.Split(' ')[^1], $"Same as {child.Path}."))
                    .Prepend((child.Words[^1], child.Summary)))
            .Concat(CommandTable.Commands.SelectMany(command => command.Aliases.Where(alias => CommandTable.Parent(alias) == group.Path && CommandTable.Parent(command.Path) != group.Path)
                .Select(alias => (alias.Split(' ')[^1], $"Same as {command.Path}."))));

    /// <summary>The options a command (or group) takes, as each shell may offer them.</summary>
    private static IEnumerable<(CliOption Option, string Help)> OptionsAt(CliCommand command) =>
        CommandTable.IsGroup(command) && command.Path.Length > 0
            ? CommandTable.Global.Select(name => (CommandTable.Option(name)!, CommandTable.Option(name)!.Help))
            : CommandTable.OptionsOf(command);

    private static IEnumerable<string> Spellings(CliOption option) =>
        option.Short is { } letter ? [$"-{letter}", option.Long] : [option.Long];

    private static IEnumerable<CliOption> Valued() => CommandTable.Options.Where(option => option.TakesValue);

    private static IEnumerable<(CliCommand Command, int Index, string[] Choices)> ArgumentChoices() =>
        Visible().SelectMany(command => command.Arguments.Select((argument, index) => (command, index, argument.Choices)))
            .Where(each => each.Choices is not null)
            .Select(each => (each.command, each.index, each.Choices!));

    private static string Lookup(Lookup kind) => kind.ToString().ToLowerInvariant();

    private static string Single(string text) => "'" + text.Replace("'", "'\\''") + "'";

    // bash ----------------------------------------------------------------------------------------

    public static string Bash()
    {
        var s = new StringBuilder();
        s.Append("""
            # bash completion for pecklist, made by `pecklist completion bash`.
            # Install: pecklist completion bash > ~/.local/share/bash-completion/completions/pecklist
            # Names of lists, sections and tags come from `pecklist __complete`: at most about a second,
            # nothing when signed out or offline.

            """);
        AppendShCases(s, "bash");
        s.Append("""

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

            """);
        return s.ToString().ReplaceLineEndings("\n");
    }

    /// <summary>The case functions bash and zsh share: names, children, options, values, arguments.</summary>
    private static void AppendShCases(StringBuilder s, string shell)
    {
        // One word per line in both shells: names from the server may hold spaces.
        var print = shell == "zsh" ? "print -rl --" : "printf '%s\\n'";
        s.Append("\n_pecklist_canon() {\n    case \"$1\" in\n");
        foreach (var group in Names().GroupBy(name => name.Canonical))
        {
            s.Append("        ").Append(string.Join('|', group.Select(name => Single(name.Name)))).Append(") ").Append(print).Append(' ').Append(Single(group.Key)).Append(" ;;\n");
        }
        s.Append("    esac\n}\n\n_pecklist_children() {\n    case \"$1\" in\n");
        foreach (var group in Groups())
        {
            s.Append("        ").Append(Single(group.Path)).Append(") ").Append(print).Append(' ').Append(string.Join(' ', ChildWords(group).Select(child => child.Word))).Append(" ;;\n");
        }
        s.Append("    esac\n}\n\n_pecklist_options() {\n    case \"$1\" in\n");
        foreach (var command in Groups().Concat(Visible().Where(each => !CommandTable.IsGroup(each))).DistinctBy(each => each.Path))
        {
            s.Append("        ").Append(Single(command.Path)).Append(") ").Append(print).Append(' ')
                .Append(string.Join(' ', OptionsAt(command).SelectMany(each => Spellings(each.Option)))).Append(" ;;\n");
        }
        s.Append("    esac\n}\n\n_pecklist_valued() {\n    case \"$1\" in\n        ");
        s.Append(string.Join('|', Valued().SelectMany(Spellings))).Append(") return 0 ;;\n    esac\n    return 1\n}\n\n");
        s.Append("_pecklist_lookup() {\n");
        s.Append(shell == "zsh"
            ? "    command pecklist __complete \"$1\" \"${(@Q)words[2,CURRENT-1]}\" 2>/dev/null\n"
            : "    command pecklist __complete \"$1\" \"${line[@]}\" 2>/dev/null\n");
        s.Append("}\n\n_pecklist_values() {\n    case \"$1\" in\n");
        foreach (var option in Valued().Where(option => option.Choices is not null || option.Lookup != PeckList.Client.Lookup.None))
        {
            s.Append("        ").Append(string.Join('|', Spellings(option))).Append(") ");
            s.Append(option.Lookup != PeckList.Client.Lookup.None ? $"_pecklist_lookup {Lookup(option.Lookup)}" : $"{print} {string.Join(' ', option.Choices!)}");
            s.Append(" ;;\n");
        }
        s.Append("    esac\n}\n\n_pecklist_arguments() {\n    case \"$1 $2\" in\n");
        foreach (var (command, index, choices) in ArgumentChoices())
        {
            s.Append("        ").Append(Single($"{command.Path} {index}")).Append(") ").Append(print).Append(' ').Append(string.Join(' ', choices)).Append(" ;;\n");
        }
        s.Append("    esac\n}\n");
    }

    // zsh -----------------------------------------------------------------------------------------

    public static string Zsh()
    {
        var s = new StringBuilder();
        s.Append("""
            #compdef pecklist
            # zsh completion for pecklist, made by `pecklist completion zsh`.
            # Install: pecklist completion zsh > "${fpath[1]}/_pecklist" (any folder on $fpath), then
            # start a new shell. Names of lists, sections and tags come from `pecklist __complete`.

            """);
        AppendShCases(s, "zsh");
        s.Append("\n_pecklist_describe() {\n    case \"$1\" in\n");
        foreach (var group in Groups())
        {
            s.Append("        ").Append(Single(group.Path)).Append(")\n            reply=(");
            s.Append(string.Join(' ', ChildWords(group).Select(child => Single($"{child.Word}:{child.Summary}"))));
            s.Append(") ;;\n");
        }
        s.Append("""
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

            """);
        return s.ToString().ReplaceLineEndings("\n");
    }

    // fish ----------------------------------------------------------------------------------------

    private static string Fish(string text) => "'" + text.Replace("\\", "\\\\").Replace("'", "\\'") + "'";

    public static string Fish()
    {
        var s = new StringBuilder();
        s.Append("""
            # fish completion for pecklist, made by `pecklist completion fish`.
            # Install: pecklist completion fish > ~/.config/fish/completions/pecklist.fish
            # Names of lists, sections and tags come from `pecklist __complete`.

            function __pecklist_canon
                switch $argv[1]

            """);
        foreach (var group in Names().GroupBy(name => name.Canonical))
        {
            s.Append("        case ").Append(string.Join(' ', group.Select(name => Fish(name.Name)))).Append("\n            echo ").Append(Fish(group.Key)).Append('\n');
        }
        s.Append("    end\nend\n\nfunction __pecklist_valued\n    switch $argv[1]\n        case ");
        s.Append(string.Join(' ', Valued().SelectMany(Spellings).Select(Fish))).Append("\n            return 0\n    end\n    return 1\nend\n");
        s.Append("""

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

            """);
        foreach (var name in CommandTable.Global)
        {
            AppendFishOption(s, CommandTable.Option(name)!, CommandTable.Option(name)!.Help, null);
        }
        foreach (var group in Groups())
        {
            foreach (var (word, summary) in ChildWords(group))
            {
                s.Append("complete -c pecklist -n ").Append(Fish($"__pecklist_at {Fish(group.Path)}")).Append(" -a ").Append(Fish(word)).Append(" -d ").Append(Fish(summary)).Append('\n');
                s.Append("complete -c pecklist -n ").Append(Fish($"__pecklist_help_at {Fish(group.Path)}")).Append(" -a ").Append(Fish(word)).Append(" -d ").Append(Fish(summary)).Append('\n');
            }
        }
        foreach (var command in CommandTable.Commands.Where(each => !each.Hidden && (each.Path.Length == 0 || !CommandTable.IsGroup(each))))
        {
            foreach (var use in command.Options)
            {
                var option = CommandTable.Option(use.Long)!;
                AppendFishOption(s, option, use.Help ?? option.Help, command.Path);
            }
        }
        foreach (var (command, index, choices) in ArgumentChoices())
        {
            s.Append("complete -c pecklist -n ").Append(Fish($"__pecklist_argument {Fish(command.Path)} {index}")).Append(" -a ").Append(Fish(string.Join(' ', choices))).Append('\n');
        }
        foreach (var command in Visible().Where(each => each.Arguments.Any(argument => argument.Name == "FILE")))
        {
            s.Append("complete -c pecklist -n ").Append(Fish($"__pecklist_in {Fish(command.Path)}")).Append(" -F\n");
        }
        return s.ToString().ReplaceLineEndings("\n");
    }

    private static void AppendFishOption(StringBuilder s, CliOption option, string help, string? path)
    {
        s.Append("complete -c pecklist");
        if (path is not null) s.Append(" -n ").Append(Fish($"__pecklist_in {Fish(path)}"));
        if (option.Short is { } letter) s.Append(" -s ").Append(letter);
        s.Append(" -l ").Append(option.Long[2..]);
        if (option.TakesValue)
        {
            // A value, never a file name.
            s.Append(" -x");
            if (option.Lookup != PeckList.Client.Lookup.None) s.Append(" -a ").Append(Fish($"(__pecklist_lookup {Lookup(option.Lookup)})"));
            else if (option.Choices is { } choices) s.Append(" -a ").Append(Fish(string.Join(' ', choices)));
        }
        s.Append(" -d ").Append(Fish(help)).Append('\n');
    }

    // PowerShell ----------------------------------------------------------------------------------

    private static string Ps(string text) => "'" + text.Replace("'", "''") + "'";

    private static string PsList(IEnumerable<string> items) => "@(" + string.Join(", ", items.Select(Ps)) + ")";

    public static string PowerShell()
    {
        var s = new StringBuilder();
        s.Append("""
            # PowerShell completion for pecklist, made by `pecklist completion powershell`.
            # Install: pecklist completion powershell | Out-String | Invoke-Expression, in your $PROFILE.
            # Names of lists, sections and tags come from `pecklist __complete`.
            Register-ArgumentCompleter -Native -CommandName pecklist, pecklist.exe -ScriptBlock {
                param($wordToComplete, $commandAst, $cursorPosition)
                $canon = @{

            """);
        foreach (var (name, canonical) in Names()) s.Append("        ").Append(Ps(name)).Append(" = ").Append(Ps(canonical)).Append('\n');
        s.Append("    }\n    $children = @{\n");
        foreach (var group in Groups()) s.Append("        ").Append(Ps(group.Path)).Append(" = ").Append(PsList(ChildWords(group).Select(child => child.Word))).Append('\n');
        s.Append("    }\n    $options = @{\n");
        foreach (var command in Groups().Concat(Visible().Where(each => !CommandTable.IsGroup(each))).DistinctBy(each => each.Path))
        {
            s.Append("        ").Append(Ps(command.Path)).Append(" = ").Append(PsList(OptionsAt(command).SelectMany(each => Spellings(each.Option)))).Append('\n');
        }
        s.Append("    }\n    $valued = ").Append(PsList(Valued().SelectMany(Spellings))).Append("\n    $values = @{\n");
        foreach (var option in Valued().Where(option => option.Choices is not null))
        {
            foreach (var spelling in Spellings(option)) s.Append("        ").Append(Ps(spelling)).Append(" = ").Append(PsList(option.Choices!)).Append('\n');
        }
        s.Append("    }\n    $lookups = @{\n");
        foreach (var option in Valued().Where(option => option.Lookup != PeckList.Client.Lookup.None))
        {
            foreach (var spelling in Spellings(option)) s.Append("        ").Append(Ps(spelling)).Append(" = ").Append(Ps(Lookup(option.Lookup))).Append('\n');
        }
        s.Append("    }\n    $arguments = @{\n");
        foreach (var (command, index, choices) in ArgumentChoices()) s.Append("        ").Append(Ps($"{command.Path} {index}")).Append(" = ").Append(PsList(choices)).Append('\n');
        s.Append("""
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

            """);
        return s.ToString().ReplaceLineEndings("\n");
    }
}
