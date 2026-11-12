namespace PeckList.Client;

/// <summary>Wrong use of a command: exit code 2, with how to use it.</summary>
public sealed class UsageException(string message) : Exception(message)
{
    /// <summary>The command it was about, whose usage line goes with the message.</summary>
    internal CliCommand? Command { get; init; }
}

/// <summary>Not signed in (or nowhere to sign in to): exit code 3.</summary>
public sealed class SignedOutException(string message) : Exception(message);

/// <summary>A command that could not be done, for a reason the CLI found itself: exit code 1.</summary>
public sealed class CliFailure(string message) : Exception(message);

/// <summary>
/// A command line (PL-138): its words, its options with values, and its flags, read POSIX style
/// with the letters from <see cref="CommandTable"/>: <c>-aq</c>, <c>-l Yard</c>, <c>-lYard</c>,
/// <c>--list Yard</c>, <c>--list=Yard</c>; <c>--</c> ends the options and <c>-</c> alone is a word
/// (standard input). Options are kept by their long name, however they were written.
/// </summary>
internal sealed class ClientArgs
{
    public List<string> Words { get; } = [];
    public Dictionary<string, string> Values { get; } = new(StringComparer.Ordinal);
    public HashSet<string> Flags { get; } = new(StringComparer.Ordinal);

    /// <summary>The options given, by long name, in the order given.</summary>
    public List<string> Given { get; } = [];

    /// <summary>The words after the command's own (its arguments), once the command is known.</summary>
    public List<string> Arguments { get; set; } = [];

    public string? Value(string name) => Values.GetValueOrDefault(name);

    public bool Flag(string name) => Flags.Contains(name);

    public string Word(int index) => index < Words.Count ? Words[index] : "";

    public string Argument(int index) => index < Arguments.Count ? Arguments[index] : "";

    /// <summary>
    /// The command line read. <paramref name="lenient"/> skips what it does not know rather than
    /// refusing it (for help, and for completion, which must never fail).
    /// </summary>
    public static ClientArgs Parse(IReadOnlyList<string> args, bool lenient = false)
    {
        var parsed = new ClientArgs();
        var rest = false;
        for (var at = 0; at < args.Count; at++)
        {
            var arg = args[at];
            if (rest || !arg.StartsWith('-') || arg == "-")
            {
                parsed.Words.Add(arg);
                continue;
            }
            if (arg == "--")
            {
                rest = true;
                continue;
            }
            if (arg.StartsWith("--", StringComparison.Ordinal))
            {
                var cut = arg.IndexOf('=');
                var name = cut > 0 ? arg[..cut] : arg;
                var option = CommandTable.Option(name);
                if (option is null)
                {
                    if (lenient) continue;
                    throw new UsageException($"unknown option {name}");
                }
                if (option.TakesValue)
                {
                    string value;
                    if (cut > 0) value = arg[(cut + 1)..];
                    else if (at + 1 < args.Count) value = args[++at];
                    else if (lenient) continue;
                    else throw new UsageException($"{name} needs a value ({option.Value})");
                    parsed.Set(option, value);
                }
                else if (cut < 0)
                {
                    parsed.Set(option, null);
                }
                else if (!lenient)
                {
                    throw new UsageException($"{name} takes no value");
                }
                continue;
            }
            // Letters: grouped flags (-aq); a letter that takes a value takes the rest (-lYard) or the next word (-l Yard).
            for (var letter = 1; letter < arg.Length; letter++)
            {
                var option = CommandTable.Option(arg[letter]);
                if (option is null)
                {
                    if (lenient) break;
                    throw new UsageException($"unknown option -{arg[letter]}");
                }
                if (!option.TakesValue)
                {
                    parsed.Set(option, null);
                    continue;
                }
                if (letter + 1 < arg.Length) parsed.Set(option, arg[(letter + 1)..]);
                else if (at + 1 < args.Count) parsed.Set(option, args[++at]);
                else if (!lenient) throw new UsageException($"-{arg[letter]} needs a value ({option.Value})");
                break;
            }
        }
        return parsed;
    }

    private void Set(CliOption option, string? value)
    {
        Given.Add(option.Long);
        if (value is null) Flags.Add(option.Long);
        else Values[option.Long] = value;
    }

    /// <summary>
    /// Whether help is asked for anywhere before <c>--</c>: <c>-h</c>, <c>--help</c>, or a group of
    /// letters with h in it. Checked before anything runs, so <c>tasks delete ID --help</c> deletes nothing.
    /// </summary>
    public static bool WantsHelp(IReadOnlyList<string> args)
    {
        foreach (var arg in args)
        {
            if (arg == "--") return false;
            if (arg is "-h" or "--help") return true;
        }
        return Parse(args, lenient: true).Flag("--help");
    }

    /// <summary>Whether the command line names a server or a profile, so it is meant for a server elsewhere.</summary>
    public static bool NamesARemote(IReadOnlyList<string> args) =>
        args.Any(arg => arg is "--server" or "--profile" || arg.StartsWith("--server=", StringComparison.Ordinal) || arg.StartsWith("--profile=", StringComparison.Ordinal));
}
