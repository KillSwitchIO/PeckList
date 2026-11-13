namespace PeckList.Client;

/// <summary>What a shell can offer for an option's value by asking the server (PL-138).</summary>
internal enum Lookup
{
    None,
    Lists,
    Sections,
    Tags,
}

/// <summary>
/// One option: its long name, the letter for it (the same letter means the same option in every
/// command), the value it takes (null for a flag), and what the shell may offer for that value.
/// </summary>
internal sealed record CliOption(string Long, char? Short, string? Value, string Help, string[]? Choices = null, Lookup Lookup = Lookup.None)
{
    public bool TakesValue => Value is not null;

    /// <summary><c>-l, --list L</c> or <c>    --plain</c>, as help lists it.</summary>
    public string Display => (Short is { } letter ? $"-{letter}, " : "    ") + Long + (Value is null ? "" : $" {Value}");
}

/// <summary>An option as one command uses it, with that command's own description when it needs one.</summary>
internal sealed record OptionUse(string Long, string? Help = null);

/// <summary>A word a command takes after its name: <c>ID</c>, <c>TEXT...</c>, <c>[FILE]</c>.</summary>
internal sealed record CliArgument(string Name, bool Required = true, bool Many = false, string[]? Choices = null)
{
    public string Display => (Required ? Name : $"[{Name}]") + (Many ? "..." : "");
}

/// <summary>
/// A command or a group of commands (<c>tasks</c>). Its path is the words that name it; aliases are
/// whole paths too (<c>tasks ls</c>, <c>add</c>).
/// </summary>
internal sealed record CliCommand(string Path, string Summary, string[] Examples)
{
    public CliArgument[] Arguments { get; init; } = [];
    public OptionUse[] Options { get; init; } = [];
    public string[] Aliases { get; init; } = [];

    /// <summary>More about it, for its help and the docs: a few plain sentences.</summary>
    public string? Details { get; init; }

    /// <summary>Kept out of help, the docs and completion (<c>__complete</c>, <c>version</c>).</summary>
    public bool Hidden { get; init; }

    public string[] Words => Path.Length == 0 ? [] : Path.Split(' ');

    /// <summary>
    /// The admin commands the server program also runs on its own database: the docs describe them
    /// once, with the server's commands, and the client reference links there.
    /// </summary>
    public bool Remote => Words.Length > 0 && Words[0] is "admin" or "oidc" or "snapshot" or "export" or "config";

    /// <summary>The docs anchor of its section on the Command line page (a test checks each exists).</summary>
    public string Anchor => Path switch
    {
        "" => "client-command-reference",
        "admin" or "oidc" or "config" => "remote-admin-commands",
        _ => Path.Replace(' ', '-'),
    };
}

/// <summary>
/// The one table of the client's commands and options (PL-138). The parser, the help, the shell
/// completion scripts and the docs' Command line reference are all made from it, so they cannot
/// drift apart; tests hold it to its rules (help and examples for every command, one meaning per letter).
/// </summary>
internal static class CommandTable
{
    public const string DocsUrl = "https://docs.pecklist.com/reference/cli";

    private static readonly string[] Statuses = ["open", "done", "wontdo", "all"];
    private static readonly string[] Priorities = ["none", "low", "medium", "high"];
    public static readonly string[] Shells = ["bash", "zsh", "fish", "powershell"];

    /// <summary>Every option, once. Commands name the ones they take.</summary>
    public static readonly CliOption[] Options =
    [
        new("--help", 'h', null, "Show help for the command, and run nothing."),
        new("--version", 'v', null, "Print the version."),
        new("--json", 'j', null, "Print the API's JSON: one thing as an object, a list of things as `{\"items\": [...]}`."),
        new("--quiet", 'q', null, "Print only the new task's id."),
        new("--list", 'l', "L", "The list: an id or a name (exact, then a unique start, as ^list matches).", Lookup: Lookup.Lists),
        new("--section", 's', "S", "The section: an id or a name.", Lookup: Lookup.Sections),
        new("--tag", 't', "TAG", "Only tasks with this tag.", Lookup: Lookup.Tags),
        new("--all", 'a', null, "Every status, not only open tasks: the same as --status all."),
        new("--due", 'd', "DATE|none", "The due date (2026-11-30 or 2026-11-30T09:00), or none."),
        new("--priority", 'p', "LEVEL", "The priority: none, low, medium or high.", Priorities),
        new("--title", 'T', "TEXT", "The new title."),
        new("--notes", 'n', "TEXT", "The new notes."),
        new("--start", null, "DATE|none", "The start date, or none."),
        new("--repeat", null, "RRULE|none", "How it repeats (an RRULE such as FREQ=WEEKLY), or none."),
        new("--progress", null, "0-100", "Progress in percent."),
        new("--status", null, "STATUS", "Only tasks with this status: open (the default), done, wontdo or all. -a is --status all.", Statuses),
        new("--due-before", null, "DATE", "Only tasks due before this date."),
        new("--due-after", null, "DATE", "Only tasks due after this date."),
        new("--deleted", null, null, "The trash instead."),
        new("--wontdo", null, null, "Close it as won't do."),
        new("--plain", null, null, "Take the text as the title as it is, without reading dates or tags."),
        new("--color", null, "#RRGGBB", "The list's colour."),
        new("--user", null, "USER", "Only this account's data."),
        new("--admin", null, null, "Ask for the admin permission too (owners and admins)."),
        new("--token", null, null, "Save an API key, read from the keyboard, or from standard input when piped."),
        new("--server", null, "URL", "The server, such as https://tasks.example.com (or PECKLIST_SERVER)."),
        new("--profile", null, "NAME", "A saved sign-in by name, to keep several side by side (or PECKLIST_PROFILE)."),
        new("--api-key", null, "KEY", "A key for this command only. Prefer PECKLIST_TOKEN or login --token: a flag shows in ps and shell history."),
        new("--insecure-http", null, null, "Allow http:// to an address other than this machine."),
    ];

    /// <summary>Taken by every command.</summary>
    public static readonly string[] Global = ["--help", "--server", "--profile", "--api-key", "--insecure-http"];

    private static OptionUse[] Use(params string[] names) => [.. names.Select(name => new OptionUse(name))];

    private static readonly CliArgument Id = new("ID");

    public static readonly CliCommand[] Commands =
    [
        new("", "Your PeckList tasks from the command line, through your server's API.",
        [
            "pecklist login --server https://tasks.example.com",
            "pecklist add \"Water the plants tomorrow #home\"",
            "pecklist tasks list -l Home",
        ])
        {
            Options = Use("--version"),
        },

        new("login", "Sign in: approve a code in the browser, or save an API key. Never a password.",
        [
            "pecklist login --server https://tasks.example.com",
            "pecklist login --server https://tasks.example.com --admin",
            "pecklist login --server https://tasks.example.com --token < key.txt",
        ])
        {
            Options = [new("--admin"), new("--token")],
            Details = "Without --token it prints a code and the address of your server's sign-in page, and opens it where it can. "
                + "Approve the code there and the CLI saves a key named for this machine. Only enter a code you just asked for here.",
        },
        new("logout", "Revoke this CLI's key on the server and forget it here.",
        [
            "pecklist logout",
            "pecklist logout --profile work",
        ])
        {
            Details = "The key in use is revoked, so a key from --api-key or PECKLIST_TOKEN is revoked too. If PECKLIST_TOKEN is set, unset it as well.",
        },
        new("whoami", "The server, the account, its role and the key's permissions.",
        [
            "pecklist whoami",
            "pecklist whoami -j",
        ])
        {
            Options = Use("--json"),
        },

        new("tasks", "List, add, change and close tasks.",
        [
            "pecklist tasks list -l Home",
            "pecklist tasks add \"Pay rent on the 1st every month ^Home !high\"",
            "pecklist tasks done 01HX...",
        ]),
        new("tasks list", "List the open tasks you can see, filtered by list, section, tag, status and due dates.",
        [
            "pecklist tasks list -l Home -t errands",
            "pecklist tasks ls -a --due-before 2026-11-30",
            "pecklist tasks list --deleted -j",
        ])
        {
            Aliases = ["tasks ls"],
            Options = [new("--list"), new("--section"), new("--tag"), new("--status"), new("--due-before"), new("--due-after"), new("--all"), new("--deleted"), new("--json")],
        },
        new("tasks add", "Add a task, reading dates, #tags, ^list, !priority, @person and \"every ...\" as the app's quick add does.",
        [
            "pecklist tasks add \"Water the plants tomorrow #home\" -l Yard",
            "id=$(pecklist add -q \"Call the plumber friday !high\")",
            "echo \"Buy milk #home\" | pecklist tasks add -",
        ])
        {
            Aliases = ["add"],
            Arguments = [new("TEXT", Many: true)],
            Options = [new("--list", "The list to add it to (without one, your inbox)."), new("--plain"), new("--quiet"), new("--json")],
            Details = "A single - as TEXT reads the task from standard input (one line). Put -- before a task that starts with a dash.",
        },
        new("tasks show", "Show one task.",
        [
            "pecklist tasks show 01HX...",
            "pecklist tasks show 01HX... -j",
        ])
        {
            Arguments = [Id],
            Options = Use("--json"),
        },
        new("tasks edit", "Change a task: only what you name changes.",
        [
            "pecklist tasks edit 01HX... -T \"Water the roses\" -d 2026-12-01",
            "pecklist tasks edit 01HX... --due none -t +errands,-later",
            "pecklist tasks edit 01HX... -p high -l Home -s Garden",
        ])
        {
            Arguments = [Id],
            Options =
            [
                new("--title"), new("--notes"), new("--list", "Move it to this list."), new("--section", "Move it to this section, or none."),
                new("--priority"), new("--due"), new("--start"), new("--tag", "Add (+name) and remove (-name) tags, comma separated."),
                new("--repeat"), new("--progress"), new("--json"),
            ],
        },
        new("tasks done", "Close a task. A repeating one moves on to its next date, as in the app.",
        [
            "pecklist tasks done 01HX...",
            "pecklist tasks done 01HX... --wontdo",
        ])
        {
            Arguments = [Id],
            Options = Use("--wontdo", "--json"),
        },
        new("tasks reopen", "Open a closed task again.",
        [
            "pecklist tasks reopen 01HX...",
        ])
        {
            Arguments = [Id],
            Options = Use("--json"),
        },
        new("tasks delete", "Move a task to the trash. tasks restore brings it back.",
        [
            "pecklist tasks delete 01HX...",
            "pecklist tasks rm 01HX...",
        ])
        {
            Aliases = ["tasks rm"],
            Arguments = [Id],
        },
        new("tasks restore", "Bring a task back from the trash.",
        [
            "pecklist tasks restore 01HX...",
        ])
        {
            Arguments = [Id],
            Options = Use("--json"),
        },

        new("lists", "Your lists.",
        [
            "pecklist lists list",
            "pecklist lists add Garden --color \"#3a7d44\"",
        ]),
        new("lists list", "Show your lists.",
        [
            "pecklist lists list",
            "pecklist lists list -a -j",
        ])
        {
            Options = [new("--all", "Archived lists too."), new("--json")],
        },
        new("lists add", "Make a list.",
        [
            "pecklist lists add Garden",
            "pecklist lists add Garden --color \"#3a7d44\"",
        ])
        {
            Arguments = [new("NAME")],
            Options = Use("--color", "--json"),
        },
        new("lists rename", "Rename a list.",
        [
            "pecklist lists rename Garden \"Veg garden\"",
        ])
        {
            Arguments = [new("L"), new("NAME")],
            Options = Use("--color", "--json"),
        },

        new("sections", "The sections in a list.",
        [
            "pecklist sections list Garden",
            "pecklist sections add Garden Beds",
        ]),
        new("sections list", "Show the sections, in one list or in all of them.",
        [
            "pecklist sections list",
            "pecklist sections list Garden -j",
        ])
        {
            Arguments = [new("L", Required: false)],
            Options = Use("--json"),
        },
        new("sections add", "Make a section in a list.",
        [
            "pecklist sections add Garden Beds",
        ])
        {
            Arguments = [new("L"), new("NAME")],
            Options = Use("--json"),
        },
        new("sections rename", "Rename a section.",
        [
            "pecklist sections rename 01HX... \"Raised beds\"",
        ])
        {
            Arguments = [new("ID"), new("NAME")],
            Options = Use("--json"),
        },

        new("tags", "Your tags.",
        [
            "pecklist tags list",
        ]),
        new("tags list", "Show your tags. Tags named in tasks add or tasks edit are made when needed.",
        [
            "pecklist tags list",
            "pecklist tags list -j",
        ])
        {
            Options = Use("--json"),
        },

        new("admin", "Accounts, through the admin API (sign in with --admin).",
        [
            "pecklist admin add-user sam",
            "pecklist admin login-link sam",
        ])
        {
            Details = "In the server program these run on its own database unless --server or --profile names a server.",
        },
        new("admin add-user", "Add an account. Its generated password must be changed at the first login.",
        [
            "pecklist admin add-user sam",
            "pecklist admin add-user sam --admin",
        ])
        {
            Arguments = [new("USER")],
            Options = [new("--admin", "Make it an admin.")],
        },
        new("admin set-role", "Make an account a user, admin or superadmin, from its next request.",
        [
            "pecklist admin set-role sam admin",
        ])
        {
            Arguments = [new("USER"), new("ROLE", Choices: ["user", "admin", "superadmin"])],
        },
        new("admin login-link", "Print a link that signs the account in once.",
        [
            "pecklist admin login-link sam",
        ])
        {
            Arguments = [new("USER")],
        },
        new("admin reset-password", "Give an account (default: admin) a new password to change at login.",
        [
            "pecklist admin reset-password sam",
        ])
        {
            Arguments = [new("USER", Required: false)],
        },

        new("oidc", "Single sign-on accounts, through the admin API.",
        [
            "pecklist oidc unlink sam",
            "pecklist oidc migration-window authentik 24",
        ]),
        new("oidc unlink", "Detach an account's provider accounts (all, or one provider's).",
        [
            "pecklist oidc unlink sam",
            "pecklist oidc unlink sam authentik",
        ])
        {
            Arguments = [new("USER"), new("PROVIDER", Required: false)],
        },
        new("oidc unbind-all", "Detach every account from a provider, when moving to another.",
        [
            "pecklist oidc unbind-all authentik",
        ])
        {
            Arguments = [new("PROVIDER")],
        },
        new("oidc migration-window", "Until it closes, a first sign-in through the provider joins the account with the same username.",
        [
            "pecklist oidc migration-window authentik 24",
            "pecklist oidc migration-window authentik close",
        ])
        {
            Arguments = [new("PROVIDER"), new("HOURS|close")],
        },
        new("snapshot", "Take a snapshot on the server now.",
        [
            "pecklist snapshot",
        ]),
        new("export", "Download a full backup, or one account's data, to a file or standard output.",
        [
            "pecklist export backup.json",
            "pecklist export --user sam sam.json",
        ])
        {
            Arguments = [new("FILE", Required: false)],
            Options = Use("--user"),
        },
        new("config", "The server's settings, through the admin API.",
        [
            "pecklist config show",
        ]),
        new("config show", "Every setting with where it comes from (secrets hidden).",
        [
            "pecklist config show",
            "pecklist config show -j",
        ])
        {
            Options = Use("--json"),
        },

        new("completion", "Print the shell completion script for bash, zsh, fish or powershell.",
        [
            "pecklist completion bash > ~/.local/share/bash-completion/completions/pecklist",
            "pecklist completion zsh > ~/.zfunc/_pecklist",
            "pecklist completion fish > ~/.config/fish/completions/pecklist.fish",
        ])
        {
            Arguments = [new("SHELL", Choices: Shells)],
            Details = "Tab then completes commands and options, and the names of your lists, sections and tags after -l, -s and -t "
                + "(asked of the server, for at most a second, and kept for a minute in a file only you can read).",
        },
        new("help", "Show help for a command.",
        [
            "pecklist help",
            "pecklist help tasks add",
        ])
        {
            Arguments = [new("COMMAND", Required: false, Many: true)],
        },

        new("version", "Print the version.", ["pecklist version"]) { Hidden = true },
        new("__complete", "Names for shell completion.", ["pecklist __complete lists"])
        {
            Hidden = true,
            Arguments = [new("KIND"), new("WORDS", Required: false, Many: true)],
        },
    ];

    private static readonly Dictionary<string, CliOption> ByLong = Options.ToDictionary(option => option.Long, StringComparer.Ordinal);
    private static readonly Dictionary<char, CliOption> ByShort = Options.Where(option => option.Short is not null).ToDictionary(option => option.Short!.Value);
    private static readonly Dictionary<string, CliCommand> ByPath = Commands.ToDictionary(command => command.Path, StringComparer.Ordinal);
    private static readonly Dictionary<string, CliCommand> ByAlias =
        Commands.SelectMany(command => command.Aliases.Select(alias => (alias, command))).ToDictionary(pair => pair.alias, pair => pair.command, StringComparer.Ordinal);

    public static CliOption? Option(string longName) => ByLong.GetValueOrDefault(longName);

    public static CliOption? Option(char letter) => ByShort.GetValueOrDefault(letter);

    public static CliCommand Root => ByPath[""];

    /// <summary>A command by its path or an alias.</summary>
    public static CliCommand? Find(string path) => ByPath.GetValueOrDefault(path) ?? ByAlias.GetValueOrDefault(path);

    /// <summary>The commands one level under a group (or the top), in table order.</summary>
    public static IEnumerable<CliCommand> Children(CliCommand group) =>
        Commands.Where(command => !command.Hidden && command.Path.Length > 0 && Parent(command.Path) == group.Path);

    public static bool IsGroup(CliCommand command) => Children(command).Any();

    public static string Parent(string path) => path.LastIndexOf(' ') is var cut and >= 0 ? path[..cut] : "";

    /// <summary>The options a command takes, its own then the global ones, each with its help for that command.</summary>
    public static IEnumerable<(CliOption Option, string Help)> OptionsOf(CliCommand command) =>
        command.Options.Select(use => (ByLong[use.Long], use.Help ?? ByLong[use.Long].Help))
            .Concat(Global.Where(name => command.Options.All(use => use.Long != name)).Select(name => (ByLong[name], ByLong[name].Help)));

    public static bool Takes(CliCommand command, string longName) =>
        Global.Contains(longName) || command.Options.Any(use => use.Long == longName);

    /// <summary>
    /// The command the words name, as deep as they go (aliases too), and how many words that took.
    /// </summary>
    public static (CliCommand Command, int Used) Resolve(IReadOnlyList<string> words)
    {
        var found = Root;
        var used = 0;
        var path = "";
        for (var at = 0; at < words.Count; at++)
        {
            path = path.Length == 0 ? words[at] : $"{path} {words[at]}";
            if (Find(path) is not { } next || (next.Hidden && at > 0)) break;
            // An alias stands for its command from here on (add -> tasks add).
            found = next;
            path = next.Path;
            used = at + 1;
            if (!IsGroup(found)) break;
        }
        return (found, used);
    }

    /// <summary>The names a word could have meant at this level, closest first, for "did you mean".</summary>
    public static string? Nearest(CliCommand group, string word)
    {
        var names = Children(group).Select(command => command.Words[^1])
            .Concat(Commands.SelectMany(command => command.Aliases).Where(alias => Parent(alias) == group.Path).Select(alias => alias.Split(' ')[^1]));
        return names.Select(name => (name, distance: Distance(name, word)))
            .Where(pair => pair.distance <= Math.Max(1, Math.Min(2, word.Length / 3)))
            .OrderBy(pair => pair.distance).Select(pair => pair.name).FirstOrDefault();
    }

    private static int Distance(string a, string b)
    {
        var d = new int[a.Length + 1, b.Length + 1];
        for (var i = 0; i <= a.Length; i++) d[i, 0] = i;
        for (var j = 0; j <= b.Length; j++) d[0, j] = j;
        for (var i = 1; i <= a.Length; i++)
        {
            for (var j = 1; j <= b.Length; j++)
            {
                d[i, j] = Math.Min(Math.Min(d[i, j - 1] + 1, d[i - 1, j] + 1), d[i - 1, j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1));
                // Two letters swapped (lsit for list) count as one change.
                if (i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1]) d[i, j] = Math.Min(d[i, j], d[i - 2, j - 2] + 1);
            }
        }
        return d[a.Length, b.Length];
    }
}
