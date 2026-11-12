using System.Runtime.Versioning;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace PeckList.Client;

/// <summary>
/// The hidden <c>pecklist __complete lists|sections|tags [words...]</c> (PL-138): the names a shell
/// offers after <c>-l</c>, <c>-s</c> and <c>-t</c>, one per line. It signs in as any command does
/// (the saved sign-in, <c>--profile</c>, <c>--server</c>, <c>PECKLIST_TOKEN</c>), but never prompts,
/// never writes a key and never prints an error: signed out, offline, refused or slower than
/// <see cref="ClientIo.CompletionLimit"/>, it prints nothing and exits 0, and the shell's own
/// completion goes on. Names are kept for a minute in a cache file only this user can read.
/// Task ids are never offered.
/// </summary>
internal static class Completer
{
    public static readonly TimeSpan Fresh = TimeSpan.FromMinutes(1);

    public static async Task<int> RunAsync(IReadOnlyList<string> args, ClientIo io, CancellationToken cancellation)
    {
        using var stop = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        try
        {
            // The limit holds even for work that does not watch the token (a name lookup, a stuck file),
            // from its first line: on the pool, so a read that blocks before any await can't hold Tab.
            var work = Task.Run(() => NamesAsync(args, io, stop.Token), CancellationToken.None);
            var finished = await Task.WhenAny(work, Task.Delay(io.CompletionLimit, CancellationToken.None));
            if (finished != work || !work.IsCompletedSuccessfully) return ClientCli.Done;
            var text = new StringBuilder();
            foreach (var name in work.Result) text.Append(name).Append('\n');
            await io.Out.WriteAsync(text.ToString());
        }
        catch (Exception)
        {
            // Nothing: Tab must never print an error into someone's command line.
        }
        finally
        {
            await stop.CancelAsync();
        }
        return ClientCli.Done;
    }

    private static async Task<IReadOnlyList<string>> NamesAsync(IReadOnlyList<string> args, ClientIo io, CancellationToken cancellation)
    {
        if (args.Count == 0 || args[0] is not ("lists" or "sections" or "tags")) return [];
        var kind = args[0];
        var line = ClientArgs.Parse(Words(args.Skip(1)), lenient: true);
        var profile = line.Value("--profile") ?? io.Environment("PECKLIST_PROFILE") ?? "default";
        var store = io.Store ?? FileTokenStore.ForThisUser(io.Environment);
        var saved = await store.LoadAsync(profile, cancellation);
        var named = line.Value("--server") ?? io.Environment("PECKLIST_SERVER") ?? saved?.Server;
        if (named is null || ClientCli.ServerAddress(named, line.Flag("--insecure-http")) is not { } server) return [];
        // Tab is read-only, and a line may be pasted or mistyped before anyone means to run it: a key
        // from the environment goes only to PECKLIST_SERVER or the saved server, never to a --server
        // typed on the line (a key typed on that line may go there, as it would on Enter).
        var home = new[] { io.Environment("PECKLIST_SERVER"), saved?.Server }
            .Any(each => each is not null && ClientCli.ServerAddress(each, true) == server);
        var fromSaved = false;
        var token = line.Value("--api-key") is { Length: > 0 } fromFlag ? fromFlag
            : io.Environment("PECKLIST_TOKEN") is { Length: > 0 } fromEnvironment && home ? fromEnvironment
            : saved is not null && ClientCli.ServerAddress(saved.Server, true) == server && (fromSaved = true) ? saved.Token : null;
        if (token is null) return [];

        // Only a saved sign-in's names are kept, under its server and key id: a key from the flag or
        // the environment has no id to keep them under, and the key itself is never written here.
        var cache = fromSaved && saved!.KeyId is { Length: > 0 } ? CompletionCache.For(io, profile) : null;
        var who = cache is null ? "" : CompletionCache.Owner(server, saved!.KeyId!);
        var kept = cache?.Read(who, io.Now()) ?? new JsonObject();
        var changed = false;
        using var remote = new Remote(server, token, io.Handler);

        async Task<JsonArray> ListsAsync()
        {
            if (kept["lists"] is JsonArray lists) return lists;
            var page = await remote.GetAsync("api/v1/lists", cancellation);
            var fetched = new JsonArray([.. (page?["items"]?.AsArray() ?? []).Select(list => (JsonNode)new JsonObject
            {
                ["id"] = ClientCli.Text(list, "id"),
                ["name"] = ClientCli.Text(list, "name"),
            })]);
            kept["lists"] = fetched;
            changed = true;
            return fetched;
        }

        IEnumerable<string?> names;
        switch (kind)
        {
            case "lists":
                names = (await ListsAsync()).Select(list => ClientCli.Text(list, "name"));
                break;
            case "tags":
                if (kept["tags"] is not JsonArray tags)
                {
                    var page = await remote.GetAsync("api/v1/tags", cancellation);
                    tags = new JsonArray([.. (page?["items"]?.AsArray() ?? []).Select(tag => (JsonNode?)JsonValue.Create(ClientCli.Text(tag, "name")))]);
                    kept["tags"] = tags;
                    changed = true;
                }
                names = tags.Select(tag => tag?.GetValue<string>());
                break;
            default:
            {
                // The sections of the list named earlier on the line, or of every list.
                string? listId = null;
                if (line.Value("--list") is { } wanted)
                {
                    var lists = await ListsAsync();
                    var match = lists.FirstOrDefault(list => ClientCli.Text(list, "id") == wanted)
                        ?? lists.FirstOrDefault(list => string.Equals(ClientCli.Text(list, "name"), wanted, StringComparison.OrdinalIgnoreCase))
                        ?? lists.FirstOrDefault(list => ClientCli.Compact(ClientCli.Text(list, "name") ?? "") == ClientCli.Compact(wanted));
                    if (match is null) return [];
                    listId = ClientCli.Text(match, "id");
                }
                var key = listId ?? "*";
                if (kept["sections"] is not JsonObject bySection)
                {
                    bySection = [];
                    kept["sections"] = bySection;
                }
                if (bySection[key] is not JsonArray sections)
                {
                    var page = await remote.GetAsync(listId is null ? "api/v1/sections" : $"api/v1/sections?listId={Uri.EscapeDataString(listId)}", cancellation);
                    sections = new JsonArray([.. (page?["items"]?.AsArray() ?? []).Select(section => (JsonNode?)JsonValue.Create(ClientCli.Text(section, "name")))]);
                    bySection[key] = sections;
                    changed = true;
                }
                names = sections.Select(section => section?.GetValue<string>());
                break;
            }
        }
        if (changed && cache is not null)
        {
            try
            {
                await cache.WriteAsync(who, kept, io.Now(), cancellation);
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or CompletionCache.Refused)
            {
                // Not kept: the next Tab asks again.
            }
        }
        // One name per line, as text a terminal shows safely (no control characters, no line breaks).
        return [.. names.Where(name => !string.IsNullOrWhiteSpace(name)).Select(name => ClientCli.Printable(name)).Distinct(StringComparer.Ordinal)];
    }

    /// <summary>
    /// The words a shell passes on, as the command would see them: quotes taken off (shells hand
    /// over words as typed), and what bash splits at <c>=</c>, <c>:</c> and <c>@</c> put back together
    /// (<c>--server = https : //tasks.example.com</c>).
    /// </summary>
    internal static List<string> Words(IEnumerable<string> raw)
    {
        var words = new List<string>();
        var glue = false;
        foreach (var each in raw)
        {
            var word = Unquote(each);
            if (word is "=" or ":" or "@" && words.Count > 0)
            {
                words[^1] += word;
                glue = true;
            }
            else if (glue)
            {
                words[^1] += word;
                glue = false;
            }
            else
            {
                words.Add(word);
            }
        }
        return words;
    }

    private static string Unquote(string word)
    {
        if (word.Length >= 2 && (word[0] == '"' || word[0] == '\'') && word[^1] == word[0]) return word[1..^1];
        if (!word.Contains('\\')) return word;
        var plain = new StringBuilder(word.Length);
        for (var at = 0; at < word.Length; at++)
        {
            if (word[at] == '\\' && at + 1 < word.Length) at++;
            plain.Append(word[at]);
        }
        return plain.ToString();
    }
}

/// <summary>
/// The completion cache: one file per profile, <c>$XDG_CACHE_HOME/pecklist/complete-PROFILE.json</c>
/// (or <c>~/.cache</c>; <c>%LOCALAPPDATA%\PeckList\cache</c> on Windows). List and tag names are
/// private, so as with the sign-in file the folder is <c>0700</c> and the file <c>0600</c>, written
/// new and renamed into place; a file others could read is not used. It holds no key: only the
/// server and the saved key's id it was filled for, so another sign-in never sees its names.
/// </summary>
internal sealed class CompletionCache(string path)
{
    public sealed class Refused(string message) : Exception(message);

    public string Path { get; } = path;

    public static CompletionCache? For(ClientIo io, string profile)
    {
        string? folder;
        if (OperatingSystem.IsWindows())
        {
            folder = io.Environment("LOCALAPPDATA") is { Length: > 0 } local ? System.IO.Path.Combine(local, "PeckList", "cache") : null;
        }
        else
        {
            var cache = io.Environment("XDG_CACHE_HOME") is { Length: > 0 } xdg ? xdg
                : io.Environment("HOME") is { Length: > 0 } home ? System.IO.Path.Combine(home, ".cache") : null;
            folder = cache is null ? null : System.IO.Path.Combine(cache, "pecklist");
        }
        return folder is null || FileName(profile) is not { } name ? null : new CompletionCache(System.IO.Path.Combine(folder, $"complete-{name}.json"));
    }

    /// <summary>
    /// A profile name as a file name: as it is when plain, else hex (never a path of its own); none
    /// for a very long name, which is then not kept. No hashing: on Linux that would load OpenSSL,
    /// and a machine without it would abort on Tab.
    /// </summary>
    internal static string? FileName(string profile)
    {
        if (profile.Length is > 0 and <= 64 && profile.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_')) return profile;
        var hex = Convert.ToHexStringLower(Encoding.UTF8.GetBytes(profile));
        return hex.Length is > 0 and <= 128 ? "x" + hex : null;
    }

    /// <summary>Which sign-in the names belong to: its server and key id. The key itself is never written here.</summary>
    public static string Owner(Uri server, string keyId) => $"{server.AbsoluteUri}\n{keyId}";

    /// <summary>What was kept for this owner within the last minute; empty otherwise, or when the file can't be trusted.</summary>
    public JsonObject Read(string owner, DateTimeOffset now)
    {
        try
        {
            if (!File.Exists(Path)) return [];
            if (!OperatingSystem.IsWindows() && !OnlyMine(Path)) return [];
            if (JsonNode.Parse(File.ReadAllText(Path)) is not JsonObject kept) return [];
            if ((string?)kept["owner"] != owner) return [];
            if (kept["at"] is not JsonValue at || !at.TryGetValue<long>(out var seconds)) return [];
            var age = now - DateTimeOffset.FromUnixTimeSeconds(seconds);
            if (age < TimeSpan.Zero || age > Completer.Fresh || kept["names"] is not JsonObject names) return [];
            return (JsonObject)names.DeepClone();
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or InvalidOperationException or FormatException)
        {
            return [];
        }
    }

    public async Task WriteAsync(string owner, JsonObject names, DateTimeOffset now, CancellationToken cancellation)
    {
        var folder = System.IO.Path.GetDirectoryName(Path)!;
        var document = new JsonObject
        {
            ["owner"] = owner,
            ["at"] = now.ToUnixTimeSeconds(),
            ["names"] = names.DeepClone(),
        };
        var options = new FileStreamOptions { Mode = FileMode.CreateNew, Access = FileAccess.Write };
        if (OperatingSystem.IsWindows())
        {
            Directory.CreateDirectory(folder);
        }
        else
        {
            Directory.CreateDirectory(folder, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
            CloseFolder(folder);
            options.UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite;
        }
        // A name nobody can guess, made new: never a file someone left there.
        var temp = System.IO.Path.Combine(folder, $".complete.{Guid.NewGuid():N}.tmp");
        try
        {
            await using (var stream = new FileStream(temp, options)) await stream.WriteAsync(Encoding.UTF8.GetBytes(document.ToJsonString()), cancellation);
            File.Move(temp, Path, overwrite: true);
        }
        finally
        {
            File.Delete(temp);
        }
    }

    [UnsupportedOSPlatform("windows")]
    private static bool OnlyMine(string file)
    {
        const UnixFileMode others = UnixFileMode.GroupRead | UnixFileMode.GroupWrite | UnixFileMode.GroupExecute
            | UnixFileMode.OtherRead | UnixFileMode.OtherWrite | UnixFileMode.OtherExecute;
        if ((File.GetUnixFileMode(file) & others) != 0) return false;
        try
        {
            // Only the owner (or root) may change a file's mode: setting it to what it is tells.
            File.SetUnixFileMode(file, File.GetUnixFileMode(file));
            return true;
        }
        catch (UnauthorizedAccessException)
        {
            return false;
        }
    }

    /// <summary>The folder is the user's alone (0700); one that belongs to someone else is refused.</summary>
    [UnsupportedOSPlatform("windows")]
    private static void CloseFolder(string folder)
    {
        try
        {
            File.SetUnixFileMode(folder, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        }
        catch (UnauthorizedAccessException)
        {
            throw new Refused($"{folder} belongs to another user");
        }
    }
}
