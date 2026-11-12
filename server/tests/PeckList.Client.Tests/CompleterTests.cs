using System.Diagnostics;

namespace PeckList.Client.Tests;

/// <summary>
/// The hidden <c>__complete</c> (PL-138): names from the server within the limit, nothing at all
/// when it cannot, and a cache only this user can read.
/// </summary>
public sealed class CompleterTests : IDisposable
{
    private const string Server = "https://tasks.example.com";
    private readonly string cacheHome = Path.Combine(Path.GetTempPath(), $"pecklist-cache-{Guid.NewGuid():N}");

    public void Dispose()
    {
        if (Directory.Exists(cacheHome)) Directory.Delete(cacheHome, recursive: true);
    }

    private Dictionary<string, string> Environment() => new() { ["XDG_CACHE_HOME"] = cacheHome, ["LOCALAPPDATA"] = cacheHome, ["HOME"] = cacheHome };

    private static async Task<MemoryTokenStore> SignedInAsync(string token = "pl_test_key", string keyId = "K1")
    {
        var store = new MemoryTokenStore();
        await store.SaveAsync("default", new CliProfile(Server, token, keyId, "ben"), Cli.Token);
        return store;
    }

    private static FakeApi Api(TimeSpan delay = default, bool offline = false) => new()
    {
        Delay = delay,
        Offline = offline,
        Answers =
        {
            ["api/v1/lists"] = """{"items":[{"id":"L1","name":"Yard"},{"id":"L2","name":"Veg garden"},{"id":"L3","name":"Evil\u001b]0;x\u0007\nname"}]}""",
            ["api/v1/tags"] = """{"items":[{"name":"home"},{"name":"errands"}]}""",
            ["api/v1/sections"] = """{"items":[{"name":"Beds"},{"name":"Pots"}]}""",
            ["api/v1/sections?listId=L2"] = """{"items":[{"name":"Beds"}]}""",
        },
    };

    private string CacheFile => OperatingSystem.IsWindows()
        ? Path.Combine(cacheHome, "PeckList", "cache", "complete-default.json")
        : Path.Combine(cacheHome, "pecklist", "complete-default.json");

    [Fact]
    public async Task Names_come_from_the_server_one_per_line_and_safe_to_show()
    {
        var api = Api();
        var store = await SignedInAsync();
        var lists = await Cli.RunAsync(api, store, null, Environment(), "__complete", "lists", "tasks", "list");
        Assert.Equal(0, lists.Code);
        Assert.Equal("Yard\nVeg garden\nEvil?]0;x? name\n", lists.Out);
        Assert.Equal("home\nerrands\n", (await Cli.RunAsync(api, store, null, Environment(), "__complete", "tags")).Out);
        // The sections of the list named earlier on the line, as bash hands the words over.
        Assert.Equal("Beds\n", (await Cli.RunAsync(api, store, null, Environment(), "__complete", "sections", "tasks", "edit", "X", "-l", "\"Veg garden\"")).Out);
        Assert.Equal("Beds\n", (await Cli.RunAsync(api, store, null, Environment(), "__complete", "sections", "tasks", "list", "--list", "=", "veg\\ garden")).Out);
        Assert.Equal("Beds\nPots\n", (await Cli.RunAsync(api, store, null, Environment(), "__complete", "sections")).Out);
        Assert.Empty((await Cli.RunAsync(api, store, null, Environment(), "__complete", "tasks")).Out);
    }

    [Fact]
    public async Task Signed_out_offline_refused_or_slow_it_prints_nothing_and_exits_0()
    {
        var signedOut = await Cli.RunAsync(new FakeApi { Forbidden = true }, new MemoryTokenStore(), null, Environment(), "__complete", "lists");
        Assert.Equal(new Ran(0, "", ""), signedOut);
        var offline = await Cli.RunAsync(Api(offline: true), await SignedInAsync(), null, Environment(), "__complete", "lists");
        Assert.Equal(new Ran(0, "", ""), offline);
        var refused = await Cli.RunAsync(new FakeApi(), await SignedInAsync(), null, Environment(), "__complete", "tags");
        Assert.Equal(new Ran(0, "", ""), refused);
        var broken = await Cli.RunAsync(new FakeApi { Forbidden = true }, new UntouchableStore(), null, Environment(), "__complete", "lists");
        Assert.Equal(new Ran(0, "", ""), broken);

        var clock = Stopwatch.StartNew();
        var slow = await Cli.RunAsync(Api(delay: TimeSpan.FromSeconds(20)), await SignedInAsync(), null, Environment(), "__complete", "lists");
        Assert.Equal(new Ran(0, "", ""), slow);
        Assert.True(clock.Elapsed < TimeSpan.FromSeconds(5), $"took {clock.Elapsed}");
    }

    [Fact]
    public async Task Names_are_kept_a_minute_for_that_sign_in_only_in_a_file_only_this_user_can_read()
    {
        var api = Api();
        Assert.Equal("home\nerrands\n", (await Cli.RunAsync(api, await SignedInAsync(), null, Environment(), "__complete", "tags")).Out);
        Assert.True(File.Exists(CacheFile));
        if (!OperatingSystem.IsWindows())
        {
            Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, File.GetUnixFileMode(CacheFile));
            Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute, File.GetUnixFileMode(Path.GetDirectoryName(CacheFile)!));
        }
        var text = await File.ReadAllTextAsync(CacheFile, Cli.Token);
        Assert.DoesNotContain("pl_test_key", text);

        // Again: from the file, no request.
        var offline = Api(offline: true);
        Assert.Equal("home\nerrands\n", (await Cli.RunAsync(offline, await SignedInAsync(), null, Environment(), "__complete", "tags")).Out);
        // Another key (another account) never sees those names.
        Assert.Empty((await Cli.RunAsync(offline, await SignedInAsync("pl_other_key", "K2"), null, Environment(), "__complete", "tags")).Out);
        // Nor does a key from the environment, whose names are never kept.
        var fromEnvironment = Environment();
        fromEnvironment["PECKLIST_TOKEN"] = "pl_env_key";
        Assert.Empty((await Cli.RunAsync(offline, await SignedInAsync(), null, fromEnvironment, "__complete", "tags")).Out);

        if (!OperatingSystem.IsWindows())
        {
            // A file others could read is not used (and is replaced, 600 again, on the next fetch).
            File.SetUnixFileMode(CacheFile, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.OtherRead);
            Assert.Empty((await Cli.RunAsync(offline, await SignedInAsync(), null, Environment(), "__complete", "tags")).Out);
            Assert.Equal("home\nerrands\n", (await Cli.RunAsync(Api(), await SignedInAsync(), null, Environment(), "__complete", "tags")).Out);
            Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, File.GetUnixFileMode(CacheFile));
        }
    }

    [Fact]
    public async Task A_key_from_the_environment_completes_but_leaves_no_file()
    {
        var environment = Environment();
        environment["PECKLIST_TOKEN"] = "pl_env_key";
        environment["PECKLIST_SERVER"] = Server;
        Assert.Equal("home\nerrands\n", (await Cli.RunAsync(Api(), new MemoryTokenStore(), null, environment, "__complete", "tags")).Out);
        Assert.False(Directory.Exists(cacheHome) && Directory.EnumerateFiles(cacheHome, "*", SearchOption.AllDirectories).Any());
    }

    [Fact]
    public async Task Tab_never_sends_the_environment_key_to_a_server_typed_on_the_line()
    {
        var environment = Environment();
        environment["PECKLIST_TOKEN"] = "pl_env_key";
        var elsewhere = new FakeApi { Forbidden = true };
        // A pasted or mistyped --server gets nothing; with no saved sign-in for it, nothing is asked at all.
        Assert.Equal(new Ran(0, "", ""), await Cli.RunAsync(elsewhere, new MemoryTokenStore(), null, environment, "__complete", "lists", "tasks", "list", "--server", "https://taskss.example.com"));
        Assert.Equal(new Ran(0, "", ""), await Cli.RunAsync(elsewhere, await SignedInAsync(), null, environment, "__complete", "lists", "--server", "https", ":", "//a", "@", "evil.example.com"));
        Assert.Empty(elsewhere.Requests);
        // The same server as the saved sign-in or PECKLIST_SERVER is fine.
        environment["PECKLIST_SERVER"] = Server;
        Assert.Contains("Yard", (await Cli.RunAsync(Api(), new MemoryTokenStore(), null, environment, "__complete", "lists", "--server", Server)).Out);
        // A key typed on the line goes to the server on the line, as it would on Enter.
        Assert.Contains("Yard", (await Cli.RunAsync(Api(), new MemoryTokenStore(), null, Environment(), "__complete", "lists", "--server", "https://other.example.com", "--api-key", "pl_line_key")).Out);
    }

    [Fact]
    public void Words_split_by_bash_come_back_together()
    {
        Assert.Equal(["--server=https://a@tasks.example.com", "-l", "Veg garden"],
            Completer.Words(["--server", "=", "https", ":", "//a", "@", "tasks.example.com", "-l", "'Veg garden'"]));
    }

    [Fact]
    public void Profile_names_never_become_paths()
    {
        Assert.Equal("work", CompletionCache.FileName("work"));
        Assert.DoesNotContain("/", CompletionCache.FileName("../../etc/passwd"));
        Assert.DoesNotContain(".", CompletionCache.FileName("../x"));
        Assert.NotEqual(CompletionCache.FileName("a b"), CompletionCache.FileName("a_b"));
        Assert.Null(CompletionCache.FileName(new string('é', 80)));
    }
}
