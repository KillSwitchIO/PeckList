using System.Net;
using System.Text;

namespace PeckList.Client.Tests;

/// <summary>A server that answers from a table of paths, records every request, and can be made to fail, hang or refuse all.</summary>
internal sealed class FakeApi : HttpMessageHandler
{
    public List<string> Requests { get; } = [];
    public Dictionary<string, string> Answers { get; } = new(StringComparer.Ordinal);

    /// <summary>Any request at all fails the test (help must run nothing).</summary>
    public bool Forbidden { get; init; }
    public bool Offline { get; init; }
    public TimeSpan Delay { get; init; }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var line = $"{request.Method} {request.RequestUri!.PathAndQuery}";
        Requests.Add(line);
        if (Forbidden) throw new InvalidOperationException($"no request may be made, but got {line}");
        if (Offline) throw new HttpRequestException("connection refused");
        if (Delay > TimeSpan.Zero) await Task.Delay(Delay, cancellationToken);
        var key = request.RequestUri.PathAndQuery.TrimStart('/');
        var found = Answers.TryGetValue($"{request.Method} {key}", out var body) || Answers.TryGetValue(key, out body);
        return new HttpResponseMessage(found ? HttpStatusCode.OK : HttpStatusCode.NotFound)
        {
            Content = new StringContent(body ?? """{"code":"not_found","detail":"not found"}""", Encoding.UTF8, "application/json"),
        };
    }
}

/// <summary>A token store that fails the test when touched: help must not sign in.</summary>
internal sealed class UntouchableStore : ITokenStore
{
    public int Touched { get; private set; }

    public string Where => "nowhere";

    public Task<CliProfile?> LoadAsync(string profile, CancellationToken cancellation = default)
    {
        Touched++;
        throw new InvalidOperationException("help must not read the sign-in");
    }

    public Task SaveAsync(string profile, CliProfile value, CancellationToken cancellation = default)
    {
        Touched++;
        throw new InvalidOperationException("help must not save a sign-in");
    }

    public Task<bool> RemoveAsync(string profile, CancellationToken cancellation = default)
    {
        Touched++;
        throw new InvalidOperationException("help must not remove a sign-in");
    }
}

internal sealed record Ran(int Code, string Out, string Err);

internal static class Cli
{
    public static CancellationToken Token => TestContext.Current.CancellationToken;

    public static async Task<Ran> RunAsync(HttpMessageHandler handler, ITokenStore store, params string[] args) =>
        await RunAsync(handler, store, null, new Dictionary<string, string>(), args);

    public static Task<Ran> RunAsync(HttpMessageHandler handler, ITokenStore store, string? input, Dictionary<string, string> environment, params string[] args) =>
        RunAsync(handler, store, input, environment, () => DateTimeOffset.UtcNow, TimeZoneInfo.Local, null, args);

    /// <summary>At a set moment, in UTC, and (with <paramref name="width"/>) at a terminal that wide.</summary>
    public static Task<Ran> RunAtAsync(HttpMessageHandler handler, ITokenStore store, DateTimeOffset now, int? width, params string[] args) =>
        RunAsync(handler, store, null, [], () => now, TimeZoneInfo.Utc, width, args);

    private static async Task<Ran> RunAsync(HttpMessageHandler handler, ITokenStore store, string? input, Dictionary<string, string> environment,
        Func<DateTimeOffset> now, TimeZoneInfo zone, int? width, string[] args)
    {
        var output = new StringWriter();
        var errors = new StringWriter();
        var io = new ClientIo
        {
            Out = output,
            Err = errors,
            In = new StringReader(input ?? ""),
            InputRedirected = input is not null,
            Store = store,
            Handler = handler,
            Environment = name => environment.GetValueOrDefault(name),
            OpenBrowser = _ => throw new InvalidOperationException("no browser"),
            ReadSecret = () => throw new InvalidOperationException("no prompt"),
            Delay = (_, _) => Task.CompletedTask,
            HostName = "test-box",
            Now = now,
            Zone = zone,
            Width = () => width,
        };
        var code = await ClientCli.RunAsync(args, io, serverBuild: false, Token);
        return new Ran(code, output.ToString().ReplaceLineEndings("\n"), errors.ToString().ReplaceLineEndings("\n"));
    }

    /// <summary>The repository root, found from the test's folder (for the docs page and the snapshots).</summary>
    public static string RepositoryRoot()
    {
        for (var folder = new DirectoryInfo(AppContext.BaseDirectory); folder is not null; folder = folder.Parent)
        {
            if (File.Exists(Path.Combine(folder.FullName, "docs", "reference", "cli.md"))) return folder.FullName;
        }
        throw new InvalidOperationException("the repository root (with docs/reference/cli.md) was not found above " + AppContext.BaseDirectory);
    }
}
