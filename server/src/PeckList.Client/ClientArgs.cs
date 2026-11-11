namespace PeckList.Client;

/// <summary>Wrong use of a command: exit code 2, with how to use it.</summary>
public sealed class UsageException(string message) : Exception(message);

/// <summary>Not signed in (or nowhere to sign in to): exit code 3.</summary>
public sealed class SignedOutException(string message) : Exception(message);

/// <summary>A command that could not be done, for a reason the CLI found itself: exit code 1.</summary>
public sealed class CliFailure(string message) : Exception(message);

/// <summary>A command line: its words, its options with values, and its flags.</summary>
internal sealed class ClientArgs
{
    private static readonly HashSet<string> Valued = new(StringComparer.Ordinal)
    {
        "--server", "--profile", "--api-key", "--list", "--section", "--tag", "--status", "--due-before", "--due-after", "--title", "--notes",
        "--priority", "--due", "--start", "--repeat", "--progress", "--color", "--user",
    };

    private static readonly HashSet<string> FlagNames = new(StringComparer.Ordinal)
    {
        "--json", "--admin", "--token", "--insecure-http", "--all", "--plain", "--wontdo", "--deleted", "--help", "-h",
    };

    public List<string> Words { get; } = [];
    public Dictionary<string, string> Values { get; } = new(StringComparer.Ordinal);
    public HashSet<string> Flags { get; } = new(StringComparer.Ordinal);

    public string? Value(string name) => Values.GetValueOrDefault(name);

    public bool Flag(string name) => Flags.Contains(name);

    public string Word(int index) => index < Words.Count ? Words[index] : "";

    public static ClientArgs Parse(IReadOnlyList<string> args)
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
            var cut = arg.IndexOf('=');
            var name = cut > 0 ? arg[..cut] : arg;
            if (Valued.Contains(name))
            {
                string value;
                if (cut > 0) value = arg[(cut + 1)..];
                else if (at + 1 < args.Count) value = args[++at];
                else throw new UsageException($"{name} needs a value");
                parsed.Values[name] = value;
            }
            else if (FlagNames.Contains(name) && cut < 0)
            {
                parsed.Flags.Add(name);
            }
            else
            {
                throw new UsageException($"unknown option {name}");
            }
        }
        return parsed;
    }

    /// <summary>Whether the command line names a server or a profile, so it is meant for a server elsewhere.</summary>
    public static bool NamesARemote(IReadOnlyList<string> args) =>
        args.Any(arg => arg is "--server" or "--profile" || arg.StartsWith("--server=", StringComparison.Ordinal) || arg.StartsWith("--profile=", StringComparison.Ordinal));
}
