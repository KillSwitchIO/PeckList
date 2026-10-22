using System.IO.Compression;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Punchlist.Core;
using Punchlist.Core.Accounts;
using Punchlist.Server.Auth;
using Punchlist.Server.Logging;

namespace Punchlist.Server.Tests;

/// <summary>Logging in the running server (spec: Logging): fields, redaction, live levels, the debug dump.</summary>
public sealed class LoggingTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private const string AdminPassword = "admin-pass-9f3c1e7b";
    private const string ClientSecret = "oidc-client-secret-2d8a";
    private const string TaskTitle = "Buy a ring for Sam 51c7";
    private const string UserPassword = "kims-password-4b6e";

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private static async Task<HttpClient> LogIn(WebApplicationFactory<Program> server, string username, string password, bool redirects = true)
    {
        var client = server.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = redirects });
        (await client.PostAsJsonAsync("/auth/login", new { username, password }, Token)).EnsureSuccessStatusCode();
        return client;
    }

    [Fact]
    public async Task A_whole_run_at_trace_level_never_logs_passwords_cookies_tokens_secrets_or_task_content()
    {
        var dir = Path.Combine(fixture.WebRoot, "leak-" + Guid.NewGuid().ToString("N"));
        var provider = new FakeOidcProvider();
        var cookies = new List<string>();
        var code = "";
        using (var server = fixture.Factory(
            ("ADMIN_PASSWORD", AdminPassword), ("LOG_LEVEL", "trace"), ("LOG_LEVEL_OVERRIDES", "Microsoft.AspNetCore=Trace,System.Net.Http=Trace"),
            ("LOG_FILES", "on"), ("LOG_DIR", dir),
            ("OIDC_PROVIDERS", "fake"), ("OIDC_FAKE_AUTHORITY", FakeOidcProvider.Authority), ("OIDC_FAKE_CLIENT_ID", FakeOidcProvider.ClientId),
            ("OIDC_FAKE_CLIENT_SECRET", ClientSecret), ("OIDC_FAKE_AUTO_CREATE", "true"))
            .WithWebHostBuilder(host => host.ConfigureTestServices(services =>
                services.Configure<OpenIdConnectOptions>(OidcSetup.Scheme("fake"), options => options.BackchannelHttpHandler = provider))))
        {
            // Password sign-in, a failed one, a password change, an OIDC sign-in and a sync with a task.
            var admin = server.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
            var login = await admin.PostAsJsonAsync("/auth/login", new { username = "admin", password = AdminPassword }, Token);
            cookies.AddRange(login.Headers.GetValues("Set-Cookie").Select(cookie => cookie.Split(';')[0].Split('=', 2)[1]));
            await admin.PostAsJsonAsync("/auth/login", new { username = "admin", password = AdminPassword + "-wrong" }, Token);
            await server.Services.GetRequiredService<AccountService>().CreateUserAsync("kim", UserPassword, mustChangePassword: false, cancellation: Token);
            var kim = await LogIn(server, "kim", UserPassword);

            var browser = server.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
            var start = await browser.GetAsync("/auth/oidc/fake/login?returnUrl=%2F", Token);
            var callback = provider.Authorize(start.Headers.Location!, new Dictionary<string, object>
            {
                ["sub"] = "lee-subject",
                ["preferred_username"] = "lee",
            });
            code = System.Web.HttpUtility.ParseQueryString(new Uri(callback).Query)["code"]!;
            var back = await browser.GetAsync(callback, Token);
            Assert.Equal(HttpStatusCode.Redirect, back.StatusCode);
            cookies.AddRange(back.Headers.GetValues("Set-Cookie").Select(cookie => cookie.Split(';')[0].Split('=', 2)[1]));

            const string Clock = "2026-10-22T10:00:00.000Z-0000-dev1";
            var list = new JsonObject
            {
                ["id"] = "L1", ["name"] = "Chores", ["visibility"] = "private", ["deletedAt"] = null,
                ["_hlc"] = new JsonObject { ["name"] = Clock, ["visibility"] = Clock, ["deletedAt"] = Clock },
            };
            var task = new JsonObject
            {
                ["id"] = "T1", ["title"] = TaskTitle, ["listId"] = "L1", ["parentId"] = null, ["deletedAt"] = null,
                ["_hlc"] = new JsonObject { ["title"] = Clock, ["listId"] = Clock, ["parentId"] = Clock, ["deletedAt"] = Clock },
            };
            var sync = await kim.PostAsJsonAsync("/api/sync", new
            {
                schemaVersion = WorkspaceSchema.CurrentVersion,
                cursor = (long?)null,
                changes = new[] { new { collection = "lists", entity = list }, new { collection = "tasks", entity = task } },
            }, Token);
            sync.EnsureSuccessStatusCode();
            Assert.Contains(TaskTitle, await (await kim.PostAsJsonAsync("/api/sync", new { schemaVersion = WorkspaceSchema.CurrentVersion, cursor = (long?)null }, Token))
                .Content.ReadAsStringAsync(Token));
            (await kim.PostAsJsonAsync("/auth/password", new { current = UserPassword, next = UserPassword + "-new" }, Token)).EnsureSuccessStatusCode();
        }

        var written = string.Join("\n", Directory.GetFiles(dir).Select(File.ReadAllText));
        Assert.True(written.Split('\n').Length > 50, "a trace-level run writes plenty");
        Assert.Contains("\"requestId\"", written);
        Assert.Contains("\"traceId\"", written);
        foreach (var secret in new[] { AdminPassword, ClientSecret, UserPassword, TaskTitle }.Concat(cookies.Where(cookie => cookie.Length > 8)))
        {
            Assert.DoesNotContain(secret, written);
        }
        Assert.DoesNotContain(code, written);
        Directory.Delete(dir, recursive: true);
    }

    [Fact]
    public async Task Entries_written_in_a_request_carry_the_request_trace_and_user()
    {
        using var server = fixture.Factory(("ADMIN_PASSWORD", AdminPassword), ("LOG_LEVEL_OVERRIDES", "Punchlist=Debug"));
        var admin = await LogIn(server, "admin", AdminPassword);
        await admin.PostAsync("/api/admin/backups", null, Token);
        var pipeline = server.Services.GetRequiredService<LogPipeline>();
        // The event log's entry for it, as it goes to the logs.
        var entry = pipeline.Recent().Last(record => record.Category == "Punchlist.Audit");
        Assert.StartsWith("backup.taken ok by admin on punchlist-", entry.Message);
        Assert.NotNull(entry.RequestId);
        Assert.Matches("^[0-9a-f]{32}$", entry.TraceId);
        var adminId = (await server.Services.GetRequiredService<IAccountStore>().FindByUsernameAsync("admin", Token))!.Id;
        Assert.Equal(adminId, entry.UserId);
    }

    [Fact]
    public async Task Levels_and_outputs_saved_on_the_settings_page_apply_without_a_restart()
    {
        using var server = fixture.Factory(("ADMIN_PASSWORD", AdminPassword));
        var admin = await LogIn(server, "admin", AdminPassword);
        var pipeline = server.Services.GetRequiredService<LogPipeline>();
        var logger = server.Services.GetRequiredService<ILoggerFactory>().CreateLogger("Punchlist.Probe");
        logger.LogDebug("before");
        Assert.DoesNotContain(pipeline.Recent(), record => record.Message == "before");

        var saved = await admin.PutAsJsonAsync("/api/admin/settings", new
        {
            values = new Dictionary<string, string> { ["LOG_LEVEL"] = "debug", ["LOG_SYSLOG_ADDRESS"] = "udp://127.0.0.1:5514" },
        }, Token);
        saved.EnsureSuccessStatusCode();
        Assert.False((bool)(await saved.Content.ReadFromJsonAsync<JsonObject>(Token))!["pendingRestart"]!);
        logger.LogDebug("after");
        Assert.Contains(pipeline.Recent(), record => record.Message == "after");

        var view = await admin.GetFromJsonAsync<JsonObject>("/api/admin/logging", Token);
        Assert.Equal("debug", (string?)view!["level"]);
        Assert.Equal(["console", "syslog"], view["outputs"]!.AsArray().Select(output => (string)output!["name"]!));

        // A bad value is refused and changes nothing.
        var bad = await admin.PutAsJsonAsync("/api/admin/settings", new { values = new Dictionary<string, string> { ["LOG_GELF_ADDRESS"] = "graylog" } }, Token);
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        Assert.Equal(2, pipeline.Status.Count);
    }

    [Fact]
    public async Task The_debug_dump_holds_logs_settings_versions_counts_and_health_but_no_secrets()
    {
        var dir = Path.Combine(fixture.WebRoot, "dump-" + Guid.NewGuid().ToString("N"));
        using var server = fixture.Factory(("ADMIN_PASSWORD", AdminPassword), ("LOG_FILES", "on"), ("LOG_DIR", dir),
            ("LOG_LOKI_URL", "http://127.0.0.1:9"), ("LOG_LOKI_PASSWORD", "loki-pass-77aa"));
        var admin = await LogIn(server, "admin", AdminPassword);
        await server.Services.GetRequiredService<AccountService>().CreateUserAsync("sam", UserPassword, mustChangePassword: false, cancellation: Token);
        var sam = await LogIn(server, "sam", UserPassword);
        Assert.Equal(HttpStatusCode.Forbidden, (await sam.GetAsync("/api/admin/debug-dump", Token)).StatusCode);

        var response = await admin.GetAsync("/api/admin/debug-dump", Token);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/zip", response.Content.Headers.ContentType!.MediaType);
        using var zip = new ZipArchive(await response.Content.ReadAsStreamAsync(Token));
        var names = zip.Entries.Select(entry => entry.FullName).ToList();
        Assert.Contains("about.json", names);
        Assert.Contains("settings.json", names);
        Assert.Contains("database.json", names);
        Assert.Contains("health.json", names);
        Assert.Contains("logs/recent.jsonl", names);
        Assert.Contains(names, name => name.StartsWith("logs/punchlist-", StringComparison.Ordinal));
        Assert.Equal(names.Count, names.Distinct().Count());

        string Read(string name)
        {
            using var reader = new StreamReader(zip.GetEntry(name)!.Open());
            return reader.ReadToEnd();
        }
        var everything = string.Join("\n", zip.Entries.Where(entry => !entry.FullName.EndsWith(".gz", StringComparison.Ordinal)).Select(entry => Read(entry.FullName)));
        Assert.DoesNotContain(AdminPassword, everything);
        Assert.DoesNotContain(UserPassword, everything);
        Assert.DoesNotContain("loki-pass-77aa", everything);
        Assert.DoesNotContain("passwordHash", everything);

        var about = JsonNode.Parse(Read("about.json"))!;
        Assert.Equal(WorkspaceSchema.CurrentVersion, (int)about["schemaVersion"]!);
        var settings = JsonNode.Parse(Read("settings.json"))!.AsArray();
        var loki = settings.Single(setting => (string?)setting!["key"] == "LOG_LOKI_PASSWORD")!;
        Assert.Equal(("********", "environment"), ((string?)loki["value"], (string?)loki["source"]));
        var database = JsonNode.Parse(Read("database.json"))!;
        Assert.Equal(2, (long)database["rows"]!["accounts"]!);
        var health = JsonNode.Parse(Read("health.json"))!;
        Assert.Equal("Healthy", (string?)health["status"]);
        Assert.Contains(health["logOutputs"]!.AsArray(), output => (string?)output!["name"] == "loki");
        Directory.Delete(dir, recursive: true);
    }
}
