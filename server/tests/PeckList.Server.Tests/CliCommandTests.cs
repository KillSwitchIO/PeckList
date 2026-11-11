using System.Net.Http.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using PeckList.Client;
using Microsoft.Extensions.DependencyInjection;
using PeckList.Core.Audit;
using PeckList.Server.Audit;
using PeckList.Server.Auth;
using static PeckList.Server.Tests.TaskApiWorld;

namespace PeckList.Server.Tests;

/// <summary>The client commands (PL-133) against a real server: sign-in, tasks, lists, admin, exit codes.</summary>
public sealed partial class CliCommandTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private sealed record Ran(int Code, string Out, string Err);

    private static async Task<Ran> Run(TaskApiWorld world, ITokenStore store, string? input, params string[] args) =>
        await Run(world, store, input, null, args);

    private static async Task<Ran> Run(TaskApiWorld world, ITokenStore store, string? input, Func<StringWriter, Task>? onWait, params string[] args) =>
        await Run(world, store, input, onWait, new Dictionary<string, string>(), args);

    private static async Task<Ran> Run(TaskApiWorld world, ITokenStore store, string? input, Func<StringWriter, Task>? onWait, Dictionary<string, string> environment, params string[] args)
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
            Handler = world.Server.Server.CreateHandler(),
            Environment = name => environment.GetValueOrDefault(name),
            OpenBrowser = _ => false,
            Delay = (_, _) => onWait?.Invoke(output) ?? System.Threading.Tasks.Task.CompletedTask,
            HostName = "test-box",
        };
        var code = await ClientCli.RunAsync(args, io, serverBuild: false, Token);
        return new Ran(code, output.ToString(), errors.ToString());
    }

    private static async Task<string> KeyTokenAsync(HttpClient session, params string[] scopes)
    {
        var made = await session.PostAsJsonAsync("/api/account/api-keys", new { name = "Test key", scopes }, Token);
        made.EnsureSuccessStatusCode();
        return (await made.Content.ReadFromJsonAsync<ApiKeyAuth.CreatedKey>(Token))!.Token;
    }

    private const string Server = "http://localhost";

    [Theory]
    [MemberData(nameof(Databases), MemberType = typeof(TaskApiWorld))]
    public async Task A_pasted_key_signs_in_and_tasks_lists_and_sections_work_from_the_command_line(string kind)
    {
        using var world = await StartAsync(fixture, kind);
        var ben = await world.PersonAsync("ben");
        await PushAsync(ben, List("IN", "Inbox", inbox: true), List("L1", "Home"));
        var store = new MemoryTokenStore();

        var signedIn = await Run(world, store, await KeyTokenAsync(ben.Session, "tasks:write"), "login", "--server", Server, "--token");
        Assert.True(signedIn.Code == 0, signedIn.Err);
        Assert.Contains("Signed in to http://localhost as ben", signedIn.Out);
        Assert.Contains("ben (user)", (await Run(world, store, null, "whoami")).Out);

        var added = await Run(world, store, null, "tasks", "add", "Water plants tomorrow #garden ^home !high");
        Assert.True(added.Code == 0, added.Err);
        Assert.Contains("Added: Water plants", added.Out);
        var id = AddedId().Match(added.Out).Groups[1].Value;
        Assert.Contains("tag \"#garden\"", added.Out);

        var listed = await Run(world, store, null, "tasks", "list", "--list", "home");
        Assert.Contains("Water plants #garden", listed.Out);
        Assert.Contains("!!!", listed.Out);
        var json = JsonNode.Parse((await Run(world, store, null, "tasks", "list", "--json")).Out)!.AsArray();
        Assert.Equal(id, (string?)json.Single()!["id"]);

        Assert.Equal(0, (await Run(world, store, null, "tasks", "edit", id, "--title", "Water the plants", "--due", "2026-12-01", "--tag", "+outside,-garden")).Code);
        var shown = await Run(world, store, null, "tasks", "show", id);
        Assert.Contains("Water the plants", shown.Out);
        Assert.Contains("Due:       2026-12-01", shown.Out);
        Assert.Contains("#outside", shown.Out);
        Assert.DoesNotContain("#garden", shown.Out);
        Assert.Contains("List:      Home", shown.Out);

        Assert.Contains("Done: Water the plants", (await Run(world, store, null, "tasks", "done", id)).Out);
        Assert.Contains("No tasks.", (await Run(world, store, null, "tasks", "list")).Out);
        Assert.Contains("[x]", (await Run(world, store, null, "tasks", "list", "--all")).Out);
        Assert.Contains("Reopened", (await Run(world, store, null, "tasks", "reopen", id)).Out);
        Assert.Contains("tasks restore", (await Run(world, store, null, "tasks", "delete", id)).Out);
        Assert.Contains("Restored", (await Run(world, store, null, "tasks", "restore", id)).Out);
        Assert.Contains("Added: -n is not an option", (await Run(world, store, null, "tasks", "add", "--plain", "--", "-n is not an option")).Out);

        Assert.Contains("Added list Garden", (await Run(world, store, null, "lists", "add", "Garden", "--color", "#3a7d44")).Out);
        Assert.Contains("Renamed to Veg garden", (await Run(world, store, null, "lists", "rename", "gard", "Veg garden")).Out);
        Assert.Contains("Added section Beds", (await Run(world, store, null, "sections", "add", "Veg garden", "Beds")).Out);
        Assert.Contains("Beds", (await Run(world, store, null, "sections", "list", "veg")).Out);
        Assert.Contains("outside", (await Run(world, store, null, "tags", "list")).Out);
        var lists = await Run(world, store, null, "lists", "list");
        Assert.Contains("Inbox (inbox)", lists.Out);
        Assert.Contains("owner", lists.Out);

        // Signing out revokes the key on the server and forgets it here.
        Assert.Contains("Signed out of http://localhost", (await Run(world, store, null, "logout")).Out);
        Assert.Null(await store.LoadAsync("default", Token));
        Assert.Equal(ClientCli.SignedOut, (await Run(world, store, null, "whoami")).Code);
        Assert.DoesNotContain((await ben.Session.GetFromJsonAsync<JsonArray>("/api/account/api-keys", Token))!, key => key!["revokedAt"] is null && (string?)key["name"] == "Test key");
    }

    [Fact]
    public async Task Login_shows_a_code_and_collects_the_key_once_it_is_approved_in_the_browser()
    {
        using var world = await StartAsync(fixture, Sqlite);
        var ben = await world.PersonAsync("ben");
        var store = new MemoryTokenStore();
        var approved = false;

        var signedIn = await Run(world, store, null, async output =>
        {
            if (approved) return;
            var code = UserCode().Match(output.ToString()).Groups[1].Value;
            (await ben.Session.PostAsJsonAsync("/api/v1/cli/approve", new { userCode = code }, Token)).EnsureSuccessStatusCode();
            approved = true;
        }, "login", "--server", Server);

        Assert.True(signedIn.Code == 0, signedIn.Err);
        Assert.Contains("open http://localhost/cli", signedIn.Out);
        Assert.Contains("Signed in to http://localhost as ben", signedIn.Out);
        var saved = (await store.LoadAsync("default", Token))!;
        Assert.Equal(("http://localhost", "ben"), (saved.Server, saved.Account));
        var keys = (await ben.Session.GetFromJsonAsync<JsonArray>("/api/account/api-keys", Token))!;
        Assert.Equal("CLI: CLI on test-box", (string?)keys.Single(key => (string?)key!["id"] == saved.KeyId)!["name"]);
    }

    [Fact]
    public async Task Exit_codes_say_what_went_wrong_and_a_saved_key_goes_only_to_its_own_server()
    {
        using var world = await StartAsync(fixture, Sqlite);
        var ben = await world.PersonAsync("ben");
        var store = new MemoryTokenStore();

        Assert.Equal(ClientCli.SignedOut, (await Run(world, store, null, "tasks", "list")).Code);
        var plain = await Run(world, store, "pl_x_y", "login", "--server", "http://tasks.example.com", "--token");
        Assert.Equal(ClientCli.BadUsage, plain.Code);
        Assert.Contains("unencrypted", plain.Err);
        Assert.Equal(ClientCli.BadUsage, (await Run(world, store, null, "tasks", "fly")).Code);
        Assert.Equal(ClientCli.BadUsage, (await Run(world, store, null, "tasks", "list", "--colour", "red")).Code);
        var import = await Run(world, store, null, "import", "backup.json");
        Assert.Equal(ClientCli.BadUsage, import.Code);
        Assert.Contains("runs on the server's machine", import.Err);
        Assert.Equal(ClientCli.SignedOut, (await Run(world, store, "pl_nope_nope", "login", "--server", Server, "--token")).Code);

        // A key that may only read.
        Assert.Equal(0, (await Run(world, store, await KeyTokenAsync(ben.Session, "tasks:read"), "login", "--server", Server, "--token")).Code);
        Assert.Equal(ClientCli.NotAllowed, (await Run(world, store, null, "tasks", "add", "Nope")).Code);
        Assert.Equal(ClientCli.NotAllowed, (await Run(world, store, null, "admin", "add-user", "sam")).Code);
        Assert.Equal(ClientCli.Failed, (await Run(world, store, null, "tasks", "show", "NOPE")).Code);
        Assert.Equal(ClientCli.Failed, (await Run(world, store, null, "tasks", "list", "--list", "nowhere")).Code);

        // Named another server, the saved key stays home.
        var elsewhere = await Run(world, store, null, "whoami", "--server", "http://127.0.0.1:5999");
        Assert.Equal(ClientCli.SignedOut, elsewhere.Code);
        Assert.Contains("not signed in to http://127.0.0.1:5999", elsewhere.Err);
    }

    [Fact]
    public async Task The_key_comes_from_the_flag_then_the_environment_then_the_saved_sign_in()
    {
        using var world = await StartAsync(fixture, Sqlite);
        var ben = await world.PersonAsync("ben");
        var store = new MemoryTokenStore();
        // Saved: a key that may only read, put there with --api-key.
        Assert.Equal(0, (await Run(world, store, null, "login", "--server", Server, "--api-key", await KeyTokenAsync(ben.Session, "tasks:read"))).Code);
        Assert.Equal(ClientCli.NotAllowed, (await Run(world, store, null, "tasks", "add", "Saved", "--plain")).Code);

        var writer = new Dictionary<string, string> { ["PECKLIST_TOKEN"] = await KeyTokenAsync(ben.Session, "tasks:write") };
        Assert.Equal(0, (await Run(world, store, null, null, writer, "lists", "add", "Home")).Code);
        var fromEnvironment = await Run(world, store, null, null, writer, "tasks", "add", "From the environment", "--plain", "--list", "Home");
        Assert.True(fromEnvironment.Code == 0, fromEnvironment.Err);
        // The flag wins over both.
        Assert.Equal(ClientCli.SignedOut, (await Run(world, store, null, null, writer, "tasks", "add", "Flag", "--list", "Home", "--api-key", "pl_nope_nope")).Code);
        Assert.Equal(0, (await Run(world, store, null, "tasks", "add", "From the flag", "--plain", "--list", "Home", "--api-key", writer["PECKLIST_TOKEN"])).Code);
        // The saved one is untouched.
        Assert.Equal(ClientCli.NotAllowed, (await Run(world, store, null, "tasks", "add", "Saved again", "--list", "Home")).Code);
    }

    [Fact]
    public async Task Text_from_the_server_reaches_the_terminal_without_escape_sequences()
    {
        using var world = await StartAsync(fixture, Sqlite);
        var ben = await world.PersonAsync("ben");
        var store = new MemoryTokenStore();
        Assert.Equal(0, (await Run(world, store, null, "login", "--server", Server, "--api-key", await KeyTokenAsync(ben.Session, "tasks:write"))).Code);
        Assert.Equal(0, (await Run(world, store, null, "lists", "add", "Home")).Code);
        var added = await Run(world, store, null, "tasks", "add", "Water\u001b]0;pwned\u0007 the\u001b[2J plants\nId: fake", "--plain", "--list", "Home", "--json");
        Assert.True(added.Code == 0, added.Err);
        var made = JsonNode.Parse(added.Out)!;
        var id = (string)(made["task"] ?? made)["id"]!;

        var listed = await Run(world, store, null, "tasks", "list", "--list", "Home");
        var shown = await Run(world, store, null, "tasks", "show", id);
        foreach (var output in new[] { listed.Out, shown.Out })
        {
            Assert.DoesNotContain('\u001b', output);
            Assert.DoesNotContain('\u0007', output);
            Assert.Contains("Water?]0;pwned? the?[2J plants Id: fake", output);
        }
        // --json is the API's own JSON, where such characters are escaped.
        Assert.DoesNotContain('\u001b', (await Run(world, store, null, "tasks", "show", id, "--json")).Out);
    }

    [Fact]
    public async Task Admin_commands_run_remotely_as_the_role_allows_and_settings_come_masked()
    {
        using var world = await StartAsync(fixture, Sqlite);
        await world.PersonAsync("ben");
        var admin = world.Server.CreateClient();
        (await admin.PostAsJsonAsync("/auth/login", new { username = "admin", password = AdminPassword }, Token)).EnsureSuccessStatusCode();
        var store = new MemoryTokenStore();
        Assert.Equal(0, (await Run(world, store, await KeyTokenAsync(admin, "admin"), "login", "--server", Server, "--token")).Code);

        var added = await Run(world, store, null, "admin", "add-user", "newbie");
        Assert.True(added.Code == 0, added.Err);
        Assert.Matches("Added newbie \\(user\\)\\. Password: \\S+", added.Out);
        Assert.Contains("is now admin", (await Run(world, store, null, "admin", "set-role", "newbie", "admin")).Out);
        Assert.Contains("New password for newbie", (await Run(world, store, null, "admin", "reset-password", "newbie")).Out);

        var file = Path.Combine(Path.GetTempPath(), $"pecklist-export-{Guid.NewGuid():N}.json");
        try
        {
            var exported = await Run(world, store, null, "export", "--user", "ben", file);
            Assert.True(exported.Code == 0, exported.Err);
            Assert.NotNull(JsonNode.Parse(await File.ReadAllTextAsync(file, Token)));
            // The event log says which key took it.
            var keyId = (await store.LoadAsync("default", Token))!.KeyId!;
            await world.Server.Services.GetRequiredService<AuditLog>().FlushAsync(Token);
            var events = (await world.Server.Services.GetRequiredService<IAuditStore>().QueryAsync(new AuditQuery { Ascending = true }, Token)).Entries;
            Assert.Contains(events, entry => entry.Type == "backup.user-exported" && entry.Device?.StartsWith($"API key {keyId}; pecklist-cli/", StringComparison.Ordinal) == true);

            // A refused export leaves the earlier file as it was, and nothing beside it.
            var before = await File.ReadAllTextAsync(file, Token);
            var stale = new MemoryTokenStore();
            await stale.SaveAsync("default", new CliProfile(Server, "pl_gone_notakey", "gone", "admin"), Token);
            var refused = await Run(world, stale, null, "export", file);
            Assert.NotEqual(0, refused.Code);
            Assert.Equal(before, await File.ReadAllTextAsync(file, Token));
            Assert.Empty(Directory.GetFiles(Path.GetDirectoryName(file)!, $".{Path.GetFileName(file)}.*"));
            if (!OperatingSystem.IsWindows()) Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, File.GetUnixFileMode(file));
        }
        finally
        {
            File.Delete(file);
        }

        var settings = await Run(world, store, null, "config", "show");
        Assert.True(settings.Code == 0, settings.Err);
        Assert.Contains("DB_PROVIDER", settings.Out);
        Assert.DoesNotContain(AdminPassword, settings.Out);
        // A key's own account gets no sign-in link this way.
        Assert.Equal(ClientCli.NotAllowed, (await Run(world, store, null, "admin", "login-link", "admin")).Code);
        Assert.Equal(ClientCli.Failed, (await Run(world, store, null, "admin", "set-role", "nobody", "admin")).Code);
    }

    [GeneratedRegex(@"Added: .*  (\S+)")]
    private static partial Regex AddedId();

    [GeneratedRegex(@"code ([A-Z]{4}-[A-Z]{4})")]
    private static partial Regex UserCode();
}
