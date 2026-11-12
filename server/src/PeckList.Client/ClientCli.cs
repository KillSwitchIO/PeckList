using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace PeckList.Client;

/// <summary>
/// The command line's client commands (PL-133): sign in, tasks, lists, sections and tags through
/// the task API, and the admin commands through the admin API, as the signed-in account may. The
/// same code runs in the client download and in the server program, which hands it what it does
/// not run itself.
/// </summary>
public static partial class ClientCli
{
    public const int Done = 0;
    public const int Failed = 1;
    public const int BadUsage = 2;
    public const int SignedOut = 3;
    public const int NotAllowed = 4;

    /// <summary>Commands that only ever talk to a server over HTTP (or print what the client knows).</summary>
    public static readonly string[] Commands = ["login", "logout", "whoami", "tasks", "add", "lists", "sections", "tags", "completion", "__complete"];

    /// <summary>Commands that only work on the server's own machine, with the server download.</summary>
    public static readonly string[] ServerOnly = ["import", "migrate-db", "upgrade-db", "debug-dump", "healthcheck"];

    /// <summary>The full help, as <c>pecklist help</c> prints it (made from <see cref="CommandTable"/>).</summary>
    public static string Usage => Help.Full();

    /// <summary>
    /// Text as it may reach a terminal: control characters (C0 but tab, DEL, C1) and the bidi
    /// controls become <c>?</c>, so a task title or a server's message can't move the cursor, clear
    /// the screen, retitle the window, write the clipboard or reorder what is shown. A line break
    /// becomes a space too (a title can't fake a line of its own), unless <paramref name="keepLineBreaks"/>.
    /// </summary>
    internal static string Printable(string? text, bool keepLineBreaks = false)
    {
        if (string.IsNullOrEmpty(text)) return text ?? "";
        StringBuilder? clean = null;
        for (var at = 0; at < text.Length; at++)
        {
            var c = text[at];
            var control = (c < ' ' && c != '\t' && !(keepLineBreaks && c == '\n')) || c is >= '\u007f' and <= '\u009f'
                || c is '\u061c' or '\u200e' or '\u200f' or (>= '\u202a' and <= '\u202e') or (>= '\u2066' and <= '\u2069');
            if (control)
            {
                clean ??= new StringBuilder(text, 0, at, text.Length);
                clean.Append(c is '\n' or '\r' ? ' ' : '?');
            }
            else clean?.Append(c);
        }
        return clean?.ToString() ?? text;
    }

    /// <summary>
    /// Whether the client takes this command line in the server program: its own commands, and any
    /// command aimed at a server elsewhere (<c>--server</c>, <c>--profile</c>).
    /// </summary>
    public static bool Handles(IReadOnlyList<string> args) =>
        args.Count > 0 && (Commands.Contains(args[0]) || ClientArgs.NamesARemote(args)
            || (args[0] == "help" && args.Count > 1 && Commands.Contains(args[1])));

    public static async Task<int> RunAsync(IReadOnlyList<string> args, ClientIo io, bool serverBuild, CancellationToken cancellation = default)
    {
        if (args.Count == 0)
        {
            await io.Out.WriteAsync(Help.Short());
            return Done;
        }
        try
        {
            // Completion never fails and never prints an error: it answers what it can, or nothing.
            if (args[0] == "__complete") return await Completer.RunAsync([.. args.Skip(1)], io, cancellation);
            // Help first, wherever -h or --help is: nothing signs in, calls the server or runs.
            if (ClientArgs.WantsHelp(args)) return await ShowHelpAsync(io, ClientArgs.Parse(args, lenient: true).Words);
            ClientArgs parsed;
            try
            {
                parsed = ClientArgs.Parse(args);
            }
            catch (UsageException wrong) when (wrong.Command is null)
            {
                // An unknown option or a missing value: with the usage line of the command it was for.
                var (about, _) = CommandTable.Resolve(ClientArgs.Parse(args, lenient: true).Words);
                throw new UsageException(wrong.Message) { Command = about.Path.Length > 0 ? about : null };
            }
            if (parsed.Word(0) == "help") return await ShowHelpAsync(io, [.. parsed.Words.Skip(1)]);
            ServerOnlyCheck(parsed.Words, serverBuild);
            var (command, used) = CommandTable.Resolve(parsed.Words);
            if (used < parsed.Words.Count && (command.Path.Length == 0 || CommandTable.IsGroup(command)))
            {
                // tasks help [add] is help too.
                if (parsed.Words[used] == "help") return await ShowHelpAsync(io, [.. command.Words, .. parsed.Words.Skip(used + 1)]);
                throw Unknown(command, parsed.Words[used]);
            }
            if (command.Path.Length == 0)
            {
                if (parsed.Flag("--version")) return await VersionAsync(io);
                await io.Out.WriteAsync(Help.Short());
                return Done;
            }
            if (CommandTable.IsGroup(command))
            {
                if (parsed.Given.Count == 0)
                {
                    await io.Out.WriteAsync(Help.For(command));
                    return Done;
                }
                throw new UsageException($"{command.Path} needs a command") { Command = command };
            }
            if (parsed.Given.FirstOrDefault(name => !CommandTable.Takes(command, name)) is { } stray)
            {
                throw new UsageException($"{command.Path} does not take {stray}") { Command = command };
            }
            parsed.Arguments = [.. parsed.Words.Skip(used)];
            if (command.Arguments.Where(argument => argument.Required).Skip(parsed.Arguments.Count).FirstOrDefault() is { } missing)
            {
                throw new UsageException($"{command.Path} needs {missing.Name}") { Command = command };
            }
            if (!command.Arguments.Any(argument => argument.Many) && parsed.Arguments.Count > command.Arguments.Length)
            {
                throw new UsageException($"{command.Path} takes {(command.Arguments.Length == 0 ? "no arguments" : $"at most {command.Arguments.Length}")}, not '{parsed.Arguments[command.Arguments.Length]}'") { Command = command };
            }
            var session = new Session(io, parsed, command, cancellation);
            var words = command.Words;
            var sub = words.Length > 1 ? words[1] : "";
            return words[0] switch
            {
                "version" => await VersionAsync(io),
                "completion" => await CompletionAsync(io, parsed.Argument(0), command),
                "login" => await session.LoginAsync(),
                "logout" => await session.LogoutAsync(),
                "whoami" => await session.WhoAmIAsync(),
                "tasks" => await session.TasksAsync(sub),
                "lists" => await session.ListsAsync(sub),
                "sections" => await session.SectionsAsync(sub),
                "tags" => await session.TagsAsync(),
                "admin" => await session.AdminAsync(sub),
                "oidc" => await session.OidcAsync(sub),
                "snapshot" => await session.SnapshotAsync(),
                "export" => await session.ExportAsync(),
                "config" => await session.ConfigShowAsync(),
                _ => throw Unknown(CommandTable.Root, words[0]),
            };
        }
        catch (UsageException usage)
        {
            var how = usage.Command is { } about
                ? $"usage: {Help.UsageLine(about)}\nRun `pecklist help {about.Path}` for details."
                : "Run `pecklist help` for the commands.";
            await io.Err.WriteLineAsync($"pecklist: {Printable(usage.Message)}\n{how}");
            return BadUsage;
        }
        catch (SignedOutException signedOut)
        {
            await io.Err.WriteLineAsync($"pecklist: {Printable(signedOut.Message)}");
            return SignedOut;
        }
        catch (ApiProblem problem)
        {
            switch (problem.Status)
            {
                case 401:
                    await io.Err.WriteLineAsync("pecklist: not signed in, or the key no longer works. Run `pecklist login`.");
                    return SignedOut;
                case 403:
                    await io.Err.WriteLineAsync($"pecklist: not allowed: {Printable(problem.Message)}" + ScopeHint(problem));
                    return NotAllowed;
                default:
                    await io.Err.WriteLineAsync($"pecklist: {Printable(problem.Message)}");
                    return Failed;
            }
        }
        catch (Exception error) when (error is CliFailure or TokenFileException or IOException or UnauthorizedAccessException)
        {
            await io.Err.WriteLineAsync($"pecklist: {Printable(error.Message)}");
            return Failed;
        }
    }

    /// <summary>
    /// What to do about a key without the permission: a read-only key that tried to change
    /// something needs tasks:write (a new key or sign-in), an admin command needs --admin.
    /// </summary>
    internal static string ScopeHint(ApiProblem problem)
    {
        if (problem.Code != "scope") return "";
        if (problem.Message.Contains(ApiScopeNames.TasksWrite, StringComparison.Ordinal))
        {
            return $" (the key may only read: sign in again with `pecklist login`, or use a key with the {ApiScopeNames.TasksWrite} permission)";
        }
        if (problem.Message.Contains(ApiScopeNames.Admin, StringComparison.Ordinal))
        {
            return " (sign in again with `pecklist login --admin` for admin commands)";
        }
        return "";
    }

    private static class ApiScopeNames
    {
        public const string TasksWrite = "tasks:write";
        public const string Admin = "admin";
    }

    private static async Task<int> VersionAsync(ClientIo io)
    {
        await io.Out.WriteLineAsync($"pecklist {Remote.Version} (client)");
        return Done;
    }

    private static async Task<int> CompletionAsync(ClientIo io, string shell, CliCommand command)
    {
        var script = shell switch
        {
            "bash" => Completion.Bash(),
            "zsh" => Completion.Zsh(),
            "fish" => Completion.Fish(),
            "powershell" or "pwsh" => Completion.PowerShell(),
            _ => throw new UsageException($"no completion for '{shell}'; one of: {string.Join(", ", CommandTable.Shells)}") { Command = command },
        };
        await io.Out.WriteAsync(script);
        return Done;
    }

    /// <summary>Help for the command the words name; the words after a command (its arguments) do not matter.</summary>
    private static async Task<int> ShowHelpAsync(ClientIo io, IReadOnlyList<string> words)
    {
        if (words.Count == 0)
        {
            await io.Out.WriteAsync(Help.Full());
            return Done;
        }
        if (ServerOnly.Contains(words[0]))
        {
            await io.Out.WriteLineAsync($"`{words[0]}` runs on the server's machine with the server program: there, run pecklist help.");
            return Done;
        }
        var (command, used) = CommandTable.Resolve(words);
        if (used < words.Count && (command.Path.Length == 0 || CommandTable.IsGroup(command)) && words[used] != "help") throw Unknown(command, words[used]);
        await io.Out.WriteAsync(Help.For(command));
        return Done;
    }

    /// <summary>An unknown command, with the nearest one it may have meant. Never a guess that runs.</summary>
    private static UsageException Unknown(CliCommand group, string word)
    {
        var near = CommandTable.Nearest(group, word);
        if (group.Path.Length == 0)
        {
            return new UsageException($"unknown command '{word}'" + (near is null ? "" : $"; did you mean `{near}`?"));
        }
        var known = string.Join(", ", CommandTable.Children(group).Select(command => command.Words[^1]));
        return new UsageException($"unknown {group.Path} command '{word}'" + (near is null ? $"; one of: {known}" : $"; did you mean `{group.Path} {near}`?"))
        {
            Command = group,
        };
    }

    private static void ServerOnlyCheck(IReadOnlyList<string> words, bool serverBuild)
    {
        var command = words.Count > 0 ? words[0] : "";
        var sub = words.Count > 1 ? words[1] : "";
        if (ServerOnly.Contains(command) || (command == "config" && sub is "key" or "encrypt"))
        {
            var name = command == "config" ? $"config {sub}" : command;
            throw new UsageException(serverBuild
                ? $"`{name}` runs on this machine against its own database; leave out --server and --profile"
                : $"`{name}` runs on the server's machine, with the server download");
        }
    }

    [GeneratedRegex(@"^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$")]
    internal static partial Regex MomentPattern();

    internal static string? Text(JsonNode? node, string key) =>
        node is JsonObject json && json[key] is JsonValue value && value.TryGetValue<string>(out var text) ? text : null;

    /// <summary>
    /// A server address as commands use it (http(s), nothing but a path, plain http only to this
    /// machine unless allowed), or null when it is not one.
    /// </summary>
    internal static Uri? ServerAddress(string text, bool insecureHttp)
    {
        if (!Uri.TryCreate(text.Trim(), UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https")
            || uri.UserInfo.Length > 0 || uri.Query.Length > 0 || uri.Fragment.Length > 0)
        {
            return null;
        }
        if (uri.Scheme == "http" && !uri.IsLoopback && !insecureHttp) return null;
        return new Uri(uri.GetLeftPart(UriPartial.Path).TrimEnd('/'));
    }

    /// <summary>A list name compared as ^list does: lower case, no spaces, dashes or underscores.</summary>
    internal static string Compact(string text) => new([.. text.ToLowerInvariant().Where(c => !char.IsWhiteSpace(c) && c is not ('-' or '_'))]);

    /// <summary>One command line's work: which server, which sign-in, and the commands.</summary>
    private sealed class Session(ClientIo io, ClientArgs args, CliCommand command, CancellationToken cancellation)
    {
        private readonly ITokenStore store = io.Store ?? FileTokenStore.ForThisUser(io.Environment);
        private string Profile => args.Value("--profile") ?? io.Environment("PECKLIST_PROFILE") ?? "default";
        private bool Json => args.Flag("--json");

        // Servers and sign-ins ------------------------------------------------------------------

        /// <summary>An http(s) address with nothing but a path; plain http only to this machine unless allowed.</summary>
        private Uri ServerUri(string text)
        {
            if (ServerAddress(text, args.Flag("--insecure-http")) is { } server) return server;
            if (ServerAddress(text, insecureHttp: true) is { } plain)
            {
                throw new UsageException($"{plain.Host} over plain http would send your key unencrypted; use https, or --insecure-http on a network you trust");
            }
            throw new UsageException($"'{text}' is not a server address such as https://tasks.example.com");
        }

        private static string Show(Uri server) => server.AbsoluteUri.TrimEnd('/');

        /// <summary>The server and the key to use: the saved key only ever goes to the server it was saved for.</summary>
        private async Task<(Uri Server, string? Token, CliProfile? Saved)> ResolveAsync()
        {
            var saved = await store.LoadAsync(Profile, cancellation);
            var named = args.Value("--server") ?? io.Environment("PECKLIST_SERVER");
            if (named is null && saved is null)
            {
                throw new SignedOutException("not signed in. Run `pecklist login --server https://...` first");
            }
            var server = ServerUri(named ?? saved!.Server);
            // The key: --api-key, then PECKLIST_TOKEN, then the saved sign-in (for its own server only).
            var token = args.Value("--api-key") is { Length: > 0 } fromFlag ? fromFlag
                : io.Environment("PECKLIST_TOKEN") is { Length: > 0 } fromEnvironment ? fromEnvironment
                : saved is not null && ServerUri(saved.Server) == server ? saved.Token : null;
            return (server, token, saved);
        }

        private async Task<Remote> ConnectAsync()
        {
            var (server, token, _) = await ResolveAsync();
            if (token is null) throw new SignedOutException($"not signed in to {Show(server)}. Run `pecklist login --server {Show(server)}`");
            return new Remote(server, token, io.Handler);
        }

        // Everything said to the terminal, server text included, goes through Printable.
        private Task Say(string line) => io.Out.WriteLineAsync(Printable(line));

        /// <summary>Several lines (a task's notes), each made printable.</summary>
        private Task SayLines(string text) => io.Out.WriteLineAsync(Printable(text, keepLineBreaks: true));

        private Task PrintJson(JsonNode? node) =>
            io.Out.WriteLineAsync(node?.ToJsonString(new JsonSerializerOptions { WriteIndented = true }) ?? "null");

        public async Task<int> LoginAsync()
        {
            var saved = await store.LoadAsync(Profile, cancellation);
            var named = args.Value("--server") ?? io.Environment("PECKLIST_SERVER") ?? saved?.Server
                ?? throw new UsageException("login needs the server: pecklist login --server https://tasks.example.com");
            var server = ServerUri(named);
            string token;
            if (args.Value("--api-key") is { } given)
            {
                token = given.Trim();
                if (token.Length == 0) throw new UsageException("no key given");
            }
            else if (args.Flag("--token"))
            {
                if (!io.InputRedirected) await io.Err.WriteAsync("API key: ");
                token = ((io.InputRedirected ? await io.In.ReadLineAsync(cancellation) : io.ReadSecret()) ?? "").Trim();
                if (token.Length == 0) throw new UsageException("no key given");
            }
            else
            {
                token = await ApproveInBrowserAsync(server);
            }
            using var remote = new Remote(server, token, io.Handler);
            var me = await remote.GetAsync("api/v1/me", cancellation);
            var account = Text(me, "username");
            await store.SaveAsync(Profile, new CliProfile(Show(server), token, Text(me?["key"], "id"), account), cancellation);
            await Say($"Signed in to {Show(server)} as {account}.");
            return Done;
        }

        private async Task<string> ApproveInBrowserAsync(Uri server)
        {
            using var anonymous = new Remote(server, null, io.Handler);
            var started = await anonymous.SendAsync(HttpMethod.Post, "api/v1/cli/sign-in",
                new JsonObject { ["name"] = $"CLI on {io.HostName}", ["admin"] = args.Flag("--admin") }, cancellation);
            var code = Text(started, "userCode") ?? throw new CliFailure("the server did not start a sign-in");
            var pollToken = Text(started, "pollToken")!;
            var interval = TimeSpan.FromSeconds(Math.Max(1, started?["interval"]?.GetValue<int>() ?? 5));
            var lifetime = TimeSpan.FromSeconds(started?["expiresIn"]?.GetValue<int>() ?? 600);
            // The page on the server we were told to sign in to, never another address.
            var page = Text(started, "approveUrl") is { } offered && Uri.TryCreate(offered, UriKind.Absolute, out var offeredUri)
                && offeredUri.Scheme == server.Scheme && offeredUri.Authority == server.Authority
                ? offeredUri.AbsoluteUri
                : $"{Show(server)}/cli";
            await Say($"To sign in, open {page}");
            await Say($"and enter the code {code}");
            await Say("Only enter it on your own PeckList server's page, and only for a code you just asked for here.");
            if (io.OpenBrowser(page)) await Say("(The page is opening in your browser.)");
            await Say("Waiting for approval...");

            var deadline = DateTimeOffset.UtcNow + lifetime;
            while (DateTimeOffset.UtcNow < deadline)
            {
                await io.Delay(interval, cancellation);
                try
                {
                    var collected = await anonymous.SendAsync(HttpMethod.Post, "api/v1/cli/sign-in/poll", new JsonObject { ["pollToken"] = pollToken }, cancellation);
                    return Text(collected, "token") ?? throw new CliFailure("the server approved the sign-in but sent no key");
                }
                catch (ApiProblem problem) when (problem.Code is "pending")
                {
                }
                catch (ApiProblem problem) when (problem.Code is "slow_down" or "rate_limited")
                {
                    interval += TimeSpan.FromSeconds(5);
                }
                catch (ApiProblem problem) when (problem.Code is "denied")
                {
                    throw new CliFailure("the sign-in was denied");
                }
                catch (ApiProblem problem) when (problem.Code is "expired")
                {
                    break;
                }
            }
            throw new CliFailure("the code ran out before it was approved; run pecklist login again");
        }

        public async Task<int> LogoutAsync()
        {
            var saved = await store.LoadAsync(Profile, cancellation);
            var fromEnvironment = io.Environment("PECKLIST_TOKEN") is { Length: > 0 };
            if (saved is null && !fromEnvironment)
            {
                await Say("Not signed in.");
                return Done;
            }
            var (server, token, _) = await ResolveAsync();
            if (token is not null)
            {
                try
                {
                    using var remote = new Remote(server, token, io.Handler);
                    await remote.SendAsync(HttpMethod.Delete, "api/v1/cli/sign-in", null, cancellation);
                }
                catch (ApiProblem problem) when (problem.Status != 401)
                {
                    await io.Err.WriteLineAsync($"pecklist: the key could not be revoked on the server ({Printable(problem.Message)}). " +
                        "Revoke it under Settings > Account > API keys.");
                }
                catch (ApiProblem)
                {
                    // Revoked already, or expired: nothing left to revoke.
                }
            }
            if (saved is not null) await store.RemoveAsync(Profile, cancellation);
            if (fromEnvironment) await io.Err.WriteLineAsync("pecklist: PECKLIST_TOKEN is set; unset it as well.");
            await Say($"Signed out of {Show(server)}.");
            return Done;
        }

        public async Task<int> WhoAmIAsync()
        {
            using var remote = await ConnectAsync();
            var me = await remote.GetAsync("api/v1/me", cancellation);
            if (Json)
            {
                await PrintJson(me);
                return Done;
            }
            await Say($"Server:  {Show(remote.Server)}");
            await Say($"Account: {Text(me, "username")} ({Text(me, "role")})");
            if (me?["key"] is JsonObject key)
            {
                await Say($"Key:     {Text(key, "name")} ({string.Join(", ", key["scopes"]?.AsArray().Select(each => (string?)each) ?? [])})");
            }
            return Done;
        }

        // Tasks -----------------------------------------------------------------------------------

        public async Task<int> TasksAsync(string sub)
        {
            // Standard input is read before signing in, so a wrong call fails without the network.
            var text = sub == "add" ? await TaskTextAsync() : "";
            using var remote = await ConnectAsync();
            switch (sub)
            {
                case "list":
                    return await TaskListAsync(remote);
                case "add":
                {
                    var listId = args.Value("--list") is { } list ? await ListIdAsync(remote, list) : null;
                    JsonNode? made;
                    try
                    {
                        if (args.Flag("--plain"))
                        {
                            var body = new JsonObject { ["title"] = text };
                            if (listId is not null) body["listId"] = listId;
                            made = await remote.SendAsync(HttpMethod.Post, "api/v1/tasks", body, cancellation);
                        }
                        else
                        {
                            var body = new JsonObject { ["text"] = text };
                            if (listId is not null) body["listId"] = listId;
                            made = await remote.SendAsync(HttpMethod.Post, "api/v1/tasks/quick", body, cancellation);
                        }
                    }
                    catch (ApiProblem problem) when (listId is null && problem.Status is 400 or 422 && problem.Message.Contains("listId", StringComparison.Ordinal))
                    {
                        // No inbox yet (a new account): the API wants a list, so say how to name one.
                        throw new CliFailure($"{problem.Message}. Name a list with -l/--list (see `pecklist lists list`, or make one with `pecklist lists add NAME`)");
                    }
                    if (Json)
                    {
                        await PrintJson(made);
                        return Done;
                    }
                    var task = made?["task"] ?? made;
                    if (args.Flag("--quiet"))
                    {
                        await Say(Text(task, "id") ?? "");
                        return Done;
                    }
                    await Say($"Added: {Text(task, "title")}  {Text(task, "id")}");
                    if (made?["tokens"] is JsonArray { Count: > 0 } tokens)
                    {
                        await Say("  read " + string.Join(", ", tokens.Select(token => $"{Text(token, "kind")} \"{Text(token, "text")}\"")));
                    }
                    return Done;
                }
                case "show":
                {
                    var task = await remote.GetAsync($"api/v1/tasks/{Id()}", cancellation);
                    if (Json) await PrintJson(task);
                    else await ShowTaskAsync(remote, task!);
                    return Done;
                }
                case "edit":
                {
                    var id = Id();
                    var body = await EditBodyAsync(remote);
                    var task = await remote.SendAsync(HttpMethod.Patch, $"api/v1/tasks/{id}", body, cancellation);
                    if (Json) await PrintJson(task);
                    else await Say($"Updated: {Text(task, "title")}");
                    return Done;
                }
                case "done":
                {
                    var closed = await remote.SendAsync(HttpMethod.Post, $"api/v1/tasks/{Id()}/complete",
                        new JsonObject { ["status"] = args.Flag("--wontdo") ? "wontdo" : "done" }, cancellation);
                    if (Json)
                    {
                        await PrintJson(closed);
                        return Done;
                    }
                    await Say($"{(args.Flag("--wontdo") ? "Won't do" : "Done")}: {Text(closed?["completed"], "title")}");
                    if (closed?["next"] is JsonObject next) await Say($"Next: {When(next) ?? "repeats"}");
                    return Done;
                }
                case "reopen":
                {
                    var task = await remote.SendAsync(HttpMethod.Post, $"api/v1/tasks/{Id()}/reopen", null, cancellation);
                    if (Json) await PrintJson(task);
                    else await Say($"Reopened: {Text(task, "title")}");
                    return Done;
                }
                case "delete":
                {
                    var id = Id();
                    await remote.SendAsync(HttpMethod.Delete, $"api/v1/tasks/{id}", null, cancellation);
                    await Say($"Deleted. Bring it back with: pecklist tasks restore {id}");
                    return Done;
                }
                case "restore":
                {
                    var task = await remote.SendAsync(HttpMethod.Post, $"api/v1/tasks/{Id()}/restore", null, cancellation);
                    if (Json) await PrintJson(task);
                    else await Say($"Restored: {Text(task, "title")}");
                    return Done;
                }
                default:
                    throw new UsageException($"unknown tasks command '{sub}'");
            }
        }

        private string Id(int at = 0) =>
            args.Argument(at) is { Length: > 0 } id ? Uri.EscapeDataString(id) : throw new UsageException($"{command.Path} needs a task id") { Command = command };

        /// <summary>The task's text: the words given, or standard input for <c>-</c> (one line).</summary>
        private async Task<string> TaskTextAsync()
        {
            if (args.Arguments is not ["-"]) return string.Join(' ', args.Arguments).Trim() is { Length: > 0 } given
                ? given
                : throw new UsageException($"{command.Path} needs TEXT") { Command = command };
            if (!io.InputRedirected) throw new UsageException("- reads the task from standard input, but nothing is piped in") { Command = command };
            var lines = (await io.In.ReadToEndAsync(cancellation)).Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            return lines.Length switch
            {
                0 => throw new UsageException("standard input is empty: no task to add") { Command = command },
                1 => lines[0],
                _ => throw new UsageException($"standard input has {lines.Length} lines; add one task at a time") { Command = command },
            };
        }

        private static string? When(JsonNode task) => Text(task["schedule"], "start") ?? Text(task["due"], "at");

        private async Task<int> TaskListAsync(Remote remote)
        {
            var query = new List<string>();
            void Add(string name, string? value)
            {
                if (value is not null) query.Add($"{name}={Uri.EscapeDataString(value)}");
            }
            string? listId = null;
            if (args.Value("--list") is { } list) Add("listId", listId = await ListIdAsync(remote, list));
            if (args.Value("--section") is { } section) Add("sectionId", await SectionIdAsync(remote, section, listId));
            Add("tag", args.Value("--tag"));
            Add("status", args.Flag("--all") ? "all" : args.Value("--status"));
            Add("dueBefore", args.Value("--due-before"));
            Add("dueAfter", args.Value("--due-after"));
            if (args.Flag("--deleted")) Add("deleted", "true");
            Add("limit", "500");
            var items = new JsonArray();
            string? cursor = null;
            do
            {
                var page = await remote.GetAsync("api/v1/tasks?" + string.Join('&', query.Append(cursor is null ? "" : $"cursor={Uri.EscapeDataString(cursor)}").Where(each => each.Length > 0)), cancellation);
                foreach (var item in page?["items"]?.AsArray() ?? []) items.Add(item?.DeepClone());
                cursor = Text(page, "next");
            }
            while (cursor is not null);
            if (Json)
            {
                // The API's shape, with every page in it (PL-138; 0.10.0 printed a bare array).
                await PrintJson(new JsonObject { ["items"] = items });
                return Done;
            }
            if (items.Count == 0)
            {
                await Say("No tasks.");
                return Done;
            }
            var rows = items.Select(task => new[]
            {
                Text(task, "id") ?? "",
                Text(task, "status") switch { "done" => "[x]", "wontdo" => "[-]", _ => "[ ]" },
                (When(task!) ?? "").Replace('T', ' '),
                (task?["priority"]?.GetValue<int>() ?? 0) switch { 3 => "!!!", 2 => "!!", 1 => "!", _ => "" },
                Text(task, "title") + string.Concat((task?["tags"]?.AsArray() ?? []).Select(tag => $" #{(string?)tag}")),
            }).ToList();
            await Table(rows);
            return Done;
        }

        private async Task Table(IReadOnlyList<string[]> rows)
        {
            var widths = Enumerable.Range(0, rows[0].Length - 1).Select(column => rows.Max(row => row[column].Length)).ToArray();
            foreach (var row in rows)
            {
                var line = new StringBuilder();
                for (var column = 0; column < row.Length; column++)
                {
                    if (column < widths.Length) line.Append(row[column].PadRight(widths[column])).Append("  ");
                    else line.Append(row[column]);
                }
                await Say(line.ToString().TrimEnd());
            }
        }

        private async Task ShowTaskAsync(Remote remote, JsonNode task)
        {
            var lists = await remote.GetAsync("api/v1/lists?archived=true", cancellation);
            var listName = lists?["items"]?.AsArray().FirstOrDefault(list => Text(list, "id") == Text(task, "listId")) is { } found ? Text(found, "name") : Text(task, "listId");
            await Say(Text(task, "title") ?? "");
            await Say($"  Id:        {Text(task, "id")}");
            await Say($"  Status:    {Text(task, "status")}{(Text(task, "deletedAt") is { } deleted ? $" (deleted {deleted})" : "")}");
            await Say($"  List:      {listName}");
            if (Text(task, "parentId") is { } parent) await Say($"  Subtask of {parent}");
            if (task["priority"]?.GetValue<int>() is > 0 and var priority) await Say($"  Priority:  {priority switch { 3 => "high", 2 => "medium", _ => "low" }}");
            if (task["schedule"] is JsonObject schedule) await Say($"  Start:     {Text(schedule, "start")}{(Text(schedule, "end") is { } end ? $" to {end}" : "")} ({Text(schedule, "timeZone")})");
            if (task["due"] is JsonObject due) await Say($"  Due:       {Text(due, "at")} ({Text(due, "timeZone")})");
            if (Text(task, "recurrence") is { } rule) await Say($"  Repeats:   {rule}");
            if (task["tags"] is JsonArray { Count: > 0 } tags) await Say($"  Tags:      {string.Join(' ', tags.Select(tag => $"#{(string?)tag}"))}");
            if (task["assignees"] is JsonArray { Count: > 0 } people) await Say($"  Assigned:  {string.Join(", ", people.Select(each => (string?)each))}");
            if (task["progress"]?.GetValue<int>() is > 0 and var progress) await Say($"  Progress:  {progress}%");
            if (Text(task, "notes") is { Length: > 0 } notes) await SayLines($"  Notes:     {notes.ReplaceLineEndings("\n             ")}");
        }

        private async Task<JsonObject> EditBodyAsync(Remote remote)
        {
            var body = new JsonObject();
            if (args.Value("--title") is { } title) body["title"] = title;
            if (args.Value("--notes") is { } notes) body["notes"] = notes;
            string? listId = null;
            if (args.Value("--list") is { } list) body["listId"] = listId = await ListIdAsync(remote, list);
            if (args.Value("--section") is { } section) body["sectionId"] = section == "none" ? null : await SectionIdAsync(remote, section, listId);
            if (args.Value("--priority") is { } priority)
            {
                body["priority"] = priority.ToLowerInvariant() switch
                {
                    "none" or "0" => 0,
                    "low" or "1" => 1,
                    "medium" or "med" or "2" => 2,
                    "high" or "3" => 3,
                    _ => throw new UsageException("--priority is none, low, medium or high"),
                };
            }
            if (args.Value("--due") is { } due) body["due"] = Moment(due, "at", "--due");
            if (args.Value("--start") is { } start) body["schedule"] = Moment(start, "start", "--start");
            if (args.Value("--tag") is { } tags)
            {
                var add = new JsonArray();
                var remove = new JsonArray();
                foreach (var each in tags.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                {
                    if (each.StartsWith('-')) remove.Add((JsonNode?)JsonValue.Create(each[1..]));
                    else add.Add((JsonNode?)JsonValue.Create(each.TrimStart('+')));
                }
                if (add.Count > 0) body["addTags"] = add;
                if (remove.Count > 0) body["removeTags"] = remove;
            }
            if (args.Value("--repeat") is { } repeat) body["recurrence"] = repeat == "none" ? null : repeat;
            if (args.Value("--progress") is { } progressText)
            {
                body["progress"] = int.TryParse(progressText, NumberStyles.None, CultureInfo.InvariantCulture, out var progress) && progress <= 100
                    ? progress
                    : throw new UsageException("--progress is 0 to 100");
            }
            if (body.Count == 0) throw new UsageException("tasks edit needs something to change, such as --title or --due");
            return body;
        }

        private static JsonNode? Moment(string text, string key, string option)
        {
            if (text == "none") return null;
            if (!MomentPattern().IsMatch(text)) throw new UsageException($"{option} is a date (2026-11-30), a date and time (2026-11-30T09:00), or none");
            return new JsonObject { [key] = text };
        }

        // Lists, sections and tags ----------------------------------------------------------------

        /// <summary>A list by id, by name, or by a unique start of its name (as ^list matches).</summary>
        private async Task<string> ListIdAsync(Remote remote, string wanted)
        {
            var lists = (await remote.GetAsync("api/v1/lists?archived=true", cancellation))?["items"]?.AsArray() ?? [];
            if (lists.FirstOrDefault(list => Text(list, "id") == wanted) is { } byId) return Text(byId, "id")!;
            var named = lists.Where(list => string.Equals(Text(list, "name"), wanted, StringComparison.OrdinalIgnoreCase)).ToList();
            if (named.Count == 0) named = [.. lists.Where(list => Compact(Text(list, "name") ?? "") == Compact(wanted))];
            if (named.Count == 0) named = [.. lists.Where(list => Compact(Text(list, "name") ?? "").StartsWith(Compact(wanted), StringComparison.Ordinal))];
            return named.Count switch
            {
                1 => Text(named[0], "id")!,
                0 => throw new CliFailure($"no list matches '{wanted}'; see pecklist lists list"),
                _ => throw new CliFailure($"'{wanted}' matches several lists: {string.Join(", ", named.Select(list => Text(list, "name")))}"),
            };
        }

        private async Task<string> SectionIdAsync(Remote remote, string wanted, string? listId)
        {
            var path = listId is null ? "api/v1/sections" : $"api/v1/sections?listId={Uri.EscapeDataString(listId)}";
            var sections = (await remote.GetAsync(path, cancellation))?["items"]?.AsArray() ?? [];
            if (sections.FirstOrDefault(section => Text(section, "id") == wanted) is { } byId) return Text(byId, "id")!;
            var named = sections.Where(section => string.Equals(Text(section, "name"), wanted, StringComparison.OrdinalIgnoreCase)).ToList();
            return named.Count switch
            {
                1 => Text(named[0], "id")!,
                0 => throw new CliFailure($"no section matches '{wanted}'"),
                _ => throw new CliFailure($"'{wanted}' matches several sections: name the list with --list, or use the id"),
            };
        }

        public async Task<int> ListsAsync(string sub)
        {
            using var remote = await ConnectAsync();
            switch (sub)
            {
                case "list" or "":
                {
                    var lists = await remote.GetAsync($"api/v1/lists{(args.Flag("--all") ? "?archived=true" : "")}", cancellation);
                    if (Json)
                    {
                        await PrintJson(lists);
                        return Done;
                    }
                    var items = lists?["items"]?.AsArray() ?? [];
                    if (items.Count == 0)
                    {
                        await Say("No lists.");
                        return Done;
                    }
                    await Table([.. items.Select(list => new[]
                    {
                        Text(list, "id") ?? "",
                        Text(list, "role") ?? "",
                        Text(list, "name") + (list?["isInbox"]?.GetValue<bool>() == true ? " (inbox)" : "")
                            + (list?["archived"]?.GetValue<bool>() == true ? " (archived)" : "")
                            + (list?["shared"]?.GetValue<bool>() == true ? " (shared)" : ""),
                    })]);
                    return Done;
                }
                case "add":
                {
                    var name = args.Argument(0);
                    if (name.Length == 0) throw new UsageException("lists add needs a name: pecklist lists add \"Garden\"");
                    var body = new JsonObject { ["name"] = name };
                    if (args.Value("--color") is { } color) body["color"] = color;
                    var made = await remote.SendAsync(HttpMethod.Post, "api/v1/lists", body, cancellation);
                    if (Json) await PrintJson(made);
                    else await Say($"Added list {Text(made, "name")}  {Text(made, "id")}");
                    return Done;
                }
                case "rename":
                {
                    if (args.Argument(0).Length == 0 || args.Argument(1).Length == 0) throw new UsageException("lists rename needs the list and a name: pecklist lists rename Garden \"Veg garden\"");
                    var id = await ListIdAsync(remote, args.Argument(0));
                    var body = new JsonObject { ["name"] = args.Argument(1) };
                    if (args.Value("--color") is { } color) body["color"] = color;
                    var changed = await remote.SendAsync(HttpMethod.Patch, $"api/v1/lists/{Uri.EscapeDataString(id)}", body, cancellation);
                    if (Json) await PrintJson(changed);
                    else await Say($"Renamed to {Text(changed, "name")}");
                    return Done;
                }
                default:
                    throw new UsageException($"unknown lists command '{sub}'");
            }
        }

        public async Task<int> SectionsAsync(string sub)
        {
            using var remote = await ConnectAsync();
            switch (sub)
            {
                case "list" or "":
                {
                    var path = "api/v1/sections";
                    if (args.Argument(0).Length > 0) path += $"?listId={Uri.EscapeDataString(await ListIdAsync(remote, args.Argument(0)))}";
                    var sections = await remote.GetAsync(path, cancellation);
                    if (Json)
                    {
                        await PrintJson(sections);
                        return Done;
                    }
                    var items = sections?["items"]?.AsArray() ?? [];
                    if (items.Count == 0) await Say("No sections.");
                    else await Table([.. items.Select(section => new[] { Text(section, "id") ?? "", Text(section, "name") ?? "" })]);
                    return Done;
                }
                case "add":
                {
                    if (args.Argument(0).Length == 0 || args.Argument(1).Length == 0) throw new UsageException("sections add needs the list and a name: pecklist sections add Garden \"Beds\"");
                    var listId = await ListIdAsync(remote, args.Argument(0));
                    var made = await remote.SendAsync(HttpMethod.Post, "api/v1/sections", new JsonObject { ["listId"] = listId, ["name"] = args.Argument(1) }, cancellation);
                    if (Json) await PrintJson(made);
                    else await Say($"Added section {Text(made, "name")}  {Text(made, "id")}");
                    return Done;
                }
                case "rename":
                {
                    if (args.Argument(0).Length == 0 || args.Argument(1).Length == 0) throw new UsageException("sections rename needs the section id and a name");
                    var changed = await remote.SendAsync(HttpMethod.Patch, $"api/v1/sections/{Uri.EscapeDataString(args.Argument(0))}",
                        new JsonObject { ["name"] = args.Argument(1) }, cancellation);
                    if (Json) await PrintJson(changed);
                    else await Say($"Renamed to {Text(changed, "name")}");
                    return Done;
                }
                default:
                    throw new UsageException($"unknown sections command '{sub}'");
            }
        }

        public async Task<int> TagsAsync()
        {
            using var remote = await ConnectAsync();
            var tags = await remote.GetAsync("api/v1/tags", cancellation);
            if (Json)
            {
                await PrintJson(tags);
                return Done;
            }
            var items = tags?["items"]?.AsArray() ?? [];
            if (items.Count == 0) await Say("No tags.");
            foreach (var tag in items) await Say(Text(tag, "name") ?? "");
            return Done;
        }

        // Admin, remote ---------------------------------------------------------------------------

        private async Task<(string Id, string Username)> AccountAsync(Remote remote, string wanted)
        {
            var users = (await remote.GetAsync("api/admin/users", cancellation))?.AsArray() ?? [];
            var found = users.FirstOrDefault(user => Text(user, "id") == wanted)
                ?? users.FirstOrDefault(user => string.Equals(Text(user, "username"), wanted.Trim(), StringComparison.OrdinalIgnoreCase))
                ?? throw new CliFailure($"no account '{wanted}'");
            return (Text(found, "id")!, Text(found, "username")!);
        }

        public async Task<int> AdminAsync(string sub)
        {
            using var remote = await ConnectAsync();
            switch (sub)
            {
                case "add-user":
                {
                    if (args.Argument(0).Length == 0) throw new UsageException("admin add-user needs a username: pecklist admin add-user <user> [--admin]");
                    var made = await remote.SendAsync(HttpMethod.Post, "api/admin/users",
                        new JsonObject { ["username"] = args.Argument(0), ["role"] = args.Flag("--admin") ? "admin" : "user" }, cancellation);
                    await Say($"Added {Text(made, "username")} ({Text(made, "role")}). Password: {Text(made, "password")}");
                    await Say("It must be changed at the first login.");
                    return Done;
                }
                case "set-role":
                {
                    if (args.Argument(0).Length == 0 || args.Argument(1).Length == 0) throw new UsageException("admin set-role needs a user and a role: pecklist admin set-role <user> <user|admin|superadmin>");
                    var (id, username) = await AccountAsync(remote, args.Argument(0));
                    var changed = await remote.SendAsync(HttpMethod.Put, $"api/admin/users/{id}/role", new JsonObject { ["role"] = args.Argument(1) }, cancellation);
                    await Say($"{username} is now {Text(changed, "role")}. It applies from their next request.");
                    return Done;
                }
                case "login-link":
                {
                    if (args.Argument(0).Length == 0) throw new UsageException("admin login-link needs a user: pecklist admin login-link <user>");
                    var (id, username) = await AccountAsync(remote, args.Argument(0));
                    var link = await remote.SendAsync(HttpMethod.Post, $"api/admin/users/{id}/login-link", null, cancellation);
                    await Say(Text(link, "url") ?? "");
                    await Say($"Signs {username} in once, until {Text(link, "expires")}.");
                    return Done;
                }
                case "reset-password":
                {
                    var (id, username) = await AccountAsync(remote, args.Argument(0) is { Length: > 0 } user ? user : "admin");
                    var reset = await remote.SendAsync(HttpMethod.Post, $"api/admin/users/{id}/password", new JsonObject(), cancellation);
                    await Say($"New password for {username}: {Text(reset, "password")}");
                    await Say("It must be changed at the next login. Other sessions of this account have ended.");
                    return Done;
                }
                default:
                    throw new UsageException($"unknown admin command '{sub}'");
            }
        }

        public async Task<int> OidcAsync(string sub)
        {
            using var remote = await ConnectAsync();
            switch (sub)
            {
                case "unlink" when args.Argument(0).Length > 0:
                {
                    var (id, username) = await AccountAsync(remote, args.Argument(0));
                    var provider = args.Argument(1);
                    var identities = (await remote.GetAsync($"api/admin/users/{id}/identities", cancellation))?.AsArray() ?? [];
                    var unlinked = 0;
                    var stranded = false;
                    foreach (var identity in identities.Where(each => provider.Length == 0 || Text(each, "provider") == provider))
                    {
                        var result = await remote.SendAsync(HttpMethod.Delete,
                            $"api/admin/users/{id}/identities/{Uri.EscapeDataString(Text(identity, "provider")!)}/{Uri.EscapeDataString(Text(identity, "subject")!)}",
                            null, cancellation);
                        unlinked++;
                        stranded |= result?["stranded"]?.AsArray().Count > 0;
                    }
                    await Say($"Detached {unlinked} provider account(s) from {username}.");
                    if (stranded) await Say($"{username} has no way left to sign in: give them a password or a sign-in link.");
                    return Done;
                }
                case "unbind-all" when args.Argument(0).Length > 0:
                {
                    var result = await remote.SendAsync(HttpMethod.Post, $"api/admin/providers/{Uri.EscapeDataString(args.Argument(0))}/unbind-all", null, cancellation);
                    await Say($"Detached {result?["unbound"]} account(s) from {args.Argument(0)}.");
                    if (result?["stranded"] is JsonArray { Count: > 0 } stranded)
                    {
                        await Say($"No way left to sign in: {string.Join(", ", stranded.Select(each => (string?)each))}");
                    }
                    return Done;
                }
                case "migration-window" when args.Argument(0).Length > 0 && args.Argument(1).Length > 0:
                {
                    var path = $"api/admin/providers/{Uri.EscapeDataString(args.Argument(0))}/migration-window";
                    if (args.Argument(1) == "close")
                    {
                        await remote.SendAsync(HttpMethod.Delete, path, null, cancellation);
                        await Say($"The migration window for {args.Argument(0)} is closed.");
                        return Done;
                    }
                    if (!double.TryParse(args.Argument(1), NumberStyles.Float, CultureInfo.InvariantCulture, out var hours)) throw new UsageException("migration-window takes hours or close");
                    var opened = await remote.SendAsync(HttpMethod.Put, path, new JsonObject { ["hours"] = hours }, cancellation);
                    await Say($"Open until {Text(opened, "until")}.");
                    return Done;
                }
                default:
                    throw new UsageException("oidc unlink <user> [provider], oidc unbind-all <provider>, oidc migration-window <provider> <hours|close>");
            }
        }

        public async Task<int> SnapshotAsync()
        {
            using var remote = await ConnectAsync();
            var taken = await remote.SendAsync(HttpMethod.Post, "api/admin/backups", null, cancellation);
            await Say($"Snapshot {Text(taken, "name")} taken (kept on the server).");
            return Done;
        }

        public async Task<int> ExportAsync()
        {
            using var remote = await ConnectAsync();
            var path = "api/admin/export";
            if (args.Value("--user") is { } user) path = $"api/admin/users/{(await AccountAsync(remote, user)).Id}/export";
            var file = args.Argument(0);
            if (file.Length > 0)
            {
                await DownloadToFileAsync(remote, path, file);
                await io.Err.WriteLineAsync($"Exported to {file}.");
            }
            else
            {
                await using var target = io.StandardOutput?.Invoke() ?? throw new CliFailure("export needs a file here");
                await remote.DownloadAsync(path, target, cancellation);
            }
            return Done;
        }

        /// <summary>
        /// A backup into <paramref name="file"/> only once it has all arrived: a refused or broken
        /// download leaves an earlier file there as it was. Readable by this user only, off Windows.
        /// </summary>
        private async Task DownloadToFileAsync(Remote remote, string path, string file)
        {
            var full = Path.GetFullPath(file);
            var partial = Path.Combine(Path.GetDirectoryName(full)!, $".{Path.GetFileName(full)}.{Guid.NewGuid():N}.partial");
            var options = new FileStreamOptions { Mode = FileMode.CreateNew, Access = FileAccess.Write };
            if (!OperatingSystem.IsWindows()) options.UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite;
            try
            {
                await using (var target = new FileStream(partial, options)) await remote.DownloadAsync(path, target, cancellation);
                File.Move(partial, full, overwrite: true);
            }
            finally
            {
                File.Delete(partial);
            }
        }

        public async Task<int> ConfigShowAsync()
        {
            using var remote = await ConnectAsync();
            var view = await remote.GetAsync("api/admin/settings", cancellation);
            if (Json)
            {
                await PrintJson(view);
                return Done;
            }
            // Secrets come masked from the server, as on the Settings page.
            foreach (var setting in view?["settings"]?.AsArray() ?? [])
            {
                var value = Text(setting, "value") ?? $"(default: {Text(setting, "default") ?? "none"})";
                await Say($"{Text(setting, "key"),-28} {value}  [{Text(setting, "source")?.ToLowerInvariant()}]");
            }
            if (Text(view, "problem") is { } problem) await Say($"Page values not used: {problem}");
            return Done;
        }
    }
}
