using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Punchlist.Core.Accounts;
using Punchlist.Core.Audit;
using Punchlist.Core.Configuration;
using Punchlist.Server.Audit;
using Punchlist.Server.Logging;
using Punchlist.Storage.Sqlite;
using Punchlist.Storage.Sql;

namespace Punchlist.Server.Tests;

/// <summary>The access and event log through the running server (spec: Access and event log).</summary>
public sealed class AuditTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private const string AdminPassword = "correct horse battery";
    private const string Password = "a long enough password";

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private WebApplicationFactory<Program> Server() => fixture.Factory(("ADMIN_PASSWORD", AdminPassword));

    private static async Task<HttpClient> LogIn(WebApplicationFactory<Program> server, string username, string password, string agent = "Mozilla/5.0 Firefox/131.0")
    {
        var client = server.CreateClient();
        client.DefaultRequestHeaders.UserAgent.ParseAdd(agent);
        (await client.PostAsJsonAsync("/auth/login", new { username, password }, Token)).EnsureSuccessStatusCode();
        return client;
    }

    private static async Task<string> NewUser(WebApplicationFactory<Program> server, string username) =>
        (await server.Services.GetRequiredService<AccountService>().CreateUserAsync(username, Password, mustChangePassword: false, cancellation: Token)).Id;

    private static async Task<IReadOnlyList<AuditEntry>> Entries(WebApplicationFactory<Program> server, AuditQuery? query = null)
    {
        // A request is recorded as its pipeline unwinds, just after the answer reaches the client.
        await Task.Delay(100, Token);
        await server.Services.GetRequiredService<AuditLog>().FlushAsync(Token);
        return (await server.Services.GetRequiredService<IAuditStore>().QueryAsync(query ?? new AuditQuery { Ascending = true }, Token)).Entries;
    }

    [Fact]
    public async Task Sign_ins_are_recorded_with_who_from_where_and_how_they_ended()
    {
        using var server = Server();
        var samId = await NewUser(server, "sam");
        var stranger = server.CreateClient();
        stranger.DefaultRequestHeaders.UserAgent.ParseAdd("curl/8.5");
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await stranger.PostAsJsonAsync("/auth/login", new { username = "sam", password = "not it at all" }, Token)).StatusCode);
        var sam = await LogIn(server, "sam", Password);
        await sam.PostAsync("/auth/logout", null, Token);
        // From a browser someone is signed in on: the attempt is nobody's until it works.
        var admin = await LogIn(server, "admin", AdminPassword);
        await admin.PostAsJsonAsync("/auth/login", new { username = "kim", password = "wrong" }, Token);

        var events = (await Entries(server)).Where(entry => entry.Type.StartsWith("auth.", StringComparison.Ordinal)).ToList();
        Assert.Equal(["auth.sign-in failed", "auth.sign-in ok", "auth.sign-out ok", "auth.sign-in ok", "auth.sign-in failed"],
            events.Select(entry => $"{entry.Type} {entry.Outcome}"));
        Assert.Equal((null, "kim"), (events[4].ActorName, events[4].TargetName));
        var failed = events[0];
        Assert.Equal((null, "sam", "curl/8.5"), (failed.ActorId, failed.TargetName, failed.Device));
        Assert.Equal(("sam", samId, "Mozilla/5.0 Firefox/131.0"), (events[1].ActorName, events[1].ActorId, events[1].Device));
        Assert.Equal(samId, events[2].ActorId);
    }

    [Fact]
    public async Task Every_api_request_is_in_the_access_log_by_route_template_never_its_query()
    {
        using var server = Server();
        var admin = await LogIn(server, "admin", AdminPassword);
        var samId = await NewUser(server, "sam");
        await admin.GetAsync($"/api/admin/users/{samId}/identities?secret=hunter2", Token);
        await admin.GetAsync("/healthz", Token);
        await admin.GetAsync("/index.html", Token);
        await admin.GetAsync("/api/nope?token=abc", Token);

        var access = await Entries(server, new AuditQuery { Kind = AuditKind.Access, Ascending = true });
        var routes = access.Select(entry => $"{entry.Method} {entry.Route} {entry.Status}").ToList();
        Assert.Contains("GET /api/admin/users/{id}/identities 200", routes);
        Assert.Contains("GET /api/nope 404", routes);
        Assert.DoesNotContain(routes, route => route.Contains("healthz", StringComparison.Ordinal) || route.Contains("index", StringComparison.Ordinal));
        Assert.DoesNotContain(access, entry => (entry.Route ?? "").Contains('?') || (entry.Route ?? "").Contains(samId, StringComparison.Ordinal));
        var identities = access.Single(entry => entry.Route == "/api/admin/users/{id}/identities");
        Assert.Equal(("admin", AuditOutcome.Ok), (identities.ActorName, identities.Outcome));
        Assert.True(identities.DurationMs >= 0);
        Assert.NotNull(identities.RequestId);

        // They reach the logs too.
        Assert.Contains(server.Services.GetRequiredService<LogPipeline>().Recent(),
            record => record.Category == "Punchlist.Access" && record.Message.Contains("/api/admin/users/{id}/identities 200", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Admin_actions_name_their_target_and_note_what_changed_even_when_refused()
    {
        using var server = Server();
        var admin = await LogIn(server, "admin", AdminPassword);
        var samId = await NewUser(server, "sam");
        var adminId = (await server.Services.GetRequiredService<IAccountStore>().FindByUsernameAsync("admin", Token))!.Id;
        (await admin.PutAsJsonAsync($"/api/admin/users/{samId}/role", new { role = "admin" }, Token)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PutAsJsonAsync($"/api/admin/users/{adminId}/role", new { role = "user" }, Token)).StatusCode);
        (await admin.PutAsJsonAsync($"/api/admin/users/{samId}/disabled", new { disabled = true }, Token)).EnsureSuccessStatusCode();
        (await admin.PutAsJsonAsync($"/api/admin/users/{samId}/disabled", new { disabled = false }, Token)).EnsureSuccessStatusCode();
        var group = await (await admin.PostAsJsonAsync("/api/admin/groups", new { name = "Family" }, Token)).Content.ReadFromJsonAsync<JsonObject>(Token);
        (await admin.PutAsync($"/api/admin/groups/{group!["id"]}/members/{samId}", null, Token)).EnsureSuccessStatusCode();
        (await admin.DeleteAsync($"/api/admin/groups/{group["id"]}", Token)).EnsureSuccessStatusCode();
        (await admin.PutAsJsonAsync("/api/admin/settings", new { values = new Dictionary<string, string> { ["REGISTRATION"] = "open" } }, Token)).EnsureSuccessStatusCode();

        var events = (await Entries(server)).Where(entry => !entry.Type.StartsWith("auth.", StringComparison.Ordinal))
            .Select(entry => $"{entry.Type} {entry.Outcome} {entry.ActorName} -> {entry.TargetName} ({entry.Detail})").ToList();
        Assert.Equal([
            "admin.role-changed ok admin -> sam (role admin)",
            "admin.role-changed refused admin -> admin (role user)",
            "admin.user-disabled ok admin -> sam ()",
            "admin.user-enabled ok admin -> sam ()",
            "admin.group-created ok admin -> Family ()",
            "admin.group-member-added ok admin -> sam (Family)",
            "admin.group-deleted ok admin -> Family ()",
            "settings.saved ok admin ->  (REGISTRATION)",
        ], events);
    }

    [Fact]
    public async Task What_an_admin_does_while_viewing_as_someone_names_both()
    {
        using var server = Server();
        var admin = await LogIn(server, "admin", AdminPassword);
        var samId = await NewUser(server, "sam");
        var started = await admin.PostAsJsonAsync($"/api/admin/users/{samId}/impersonate", new { reason = "checking a bug report" }, Token);
        var token = (string)(await started.Content.ReadFromJsonAsync<JsonObject>(Token))!["token"]!;
        var viewing = await LogIn(server, "admin", AdminPassword);
        viewing.DefaultRequestHeaders.Add("X-Punchlist-Impersonate", token);
        (await viewing.GetAsync("/auth/me", Token)).EnsureSuccessStatusCode();
        (await viewing.DeleteAsync("/auth/impersonation", Token)).EnsureSuccessStatusCode();

        var all = await Entries(server);
        var start = all.Single(entry => entry.Type == "impersonation.started");
        Assert.Equal(("admin", "sam", "checking a bug report"), (start.ActorName, start.TargetName, start.Detail));
        var end = all.Single(entry => entry.Type == "impersonation.ended");
        Assert.Equal(("sam", "admin"), (end.ActorName, end.ImpersonatorName));
        var me = (await Entries(server, new AuditQuery { Kind = AuditKind.Access, Ascending = true })).Last(entry => entry.Route == "/auth/me");
        Assert.Equal(("sam", "admin"), (me.ActorName, me.ImpersonatorName));
    }

    [Fact]
    public async Task The_dashboard_filters_pages_and_exports_csv_for_those_who_may_see_logs()
    {
        using var server = Server();
        var admin = await LogIn(server, "admin", AdminPassword);
        await NewUser(server, "sam");
        var sam = await LogIn(server, "sam", Password);
        await server.CreateClient().PostAsJsonAsync("/auth/login", new { username = "=cmd|' /C calc'!A0", password = "x" }, Token);
        Assert.Equal(HttpStatusCode.Forbidden, (await sam.GetAsync("/api/admin/audit", Token)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await sam.GetAsync("/api/admin/audit.csv", Token)).StatusCode);
        await Entries(server);

        var failed = await admin.GetFromJsonAsync<AuditPage>("/api/admin/audit?outcome=failed", Token);
        Assert.Equal("=cmd|' /C calc'!A0", Assert.Single(failed!.Entries).TargetName);
        var signIns = await admin.GetFromJsonAsync<AuditPage>("/api/admin/audit?type=auth.&user=sam&limit=1", Token);
        Assert.Equal("auth.sign-in", Assert.Single(signIns!.Entries).Type);
        var requests = await admin.GetFromJsonAsync<AuditPage>("/api/admin/audit?kind=access&text=%2Fapi%2Fadmin%2Faudit", Token);
        Assert.All(requests!.Entries, entry => Assert.StartsWith("/api/admin/audit", entry.Route));
        Assert.NotEmpty(requests.Entries);

        var csv = await admin.GetAsync("/api/admin/audit.csv?type=auth.sign-in", Token);
        Assert.Equal("text/csv", csv.Content.Headers.ContentType!.MediaType);
        var lines = (await csv.Content.ReadAsStringAsync(Token)).Split('\n', StringSplitOptions.RemoveEmptyEntries);
        Assert.StartsWith("time,kind,type,outcome,actor", lines[0]);
        Assert.Equal(4, lines.Length);
        // A name that looks like a formula is never run by a spreadsheet.
        Assert.Contains(",'=cmd|' /C calc'!A0,", lines[^1]);
    }

    [Fact]
    public async Task Old_entries_are_pruned_and_archived_first_when_asked()
    {
        var dir = Directory.CreateTempSubdirectory("punchlist-audit-").FullName;
        try
        {
            var database = new SqliteDatabase(Path.Combine(dir, "audit.db"));
            await database.MigrateAsync(Token);
            var store = new SqlAuditStore(database);
            var now = new DateTimeOffset(2026, 10, 22, 12, 0, 0, TimeSpan.Zero);
            AuditEntry Old(string kind, int daysAgo) => new()
            {
                Id = Guid.NewGuid().ToString("N"), Time = now.AddDays(-daysAgo), Kind = kind, Type = kind == AuditKind.Access ? "request" : "auth.sign-in",
                Outcome = AuditOutcome.Ok, ActorName = "sam",
            };
            await store.AppendAsync([Old(AuditKind.Event, 100), Old(AuditKind.Event, 30), Old(AuditKind.Access, 20), Old(AuditKind.Access, 1)], Token);
            var settings = new ServerSettings { AuditArchive = true, AuditArchiveDir = Path.Combine(dir, "archive") };
            var retention = new AuditRetention(store, settings, new ManualTime(now), Microsoft.Extensions.Logging.Abstractions.NullLogger<AuditRetention>.Instance);

            Assert.Equal(2, await retention.PruneAsync(Token));
            Assert.Single((await store.QueryAsync(new AuditQuery(), Token)).Entries);
            Assert.Single((await store.QueryAsync(new AuditQuery { Kind = AuditKind.Access }, Token)).Entries);
            var archives = Directory.GetFiles(settings.AuditArchiveDir).Select(Path.GetFileName).Order().ToList();
            Assert.Equal(2, archives.Count);
            Assert.StartsWith("audit-access-", archives[0]);
            await using var gzip = new System.IO.Compression.GZipStream(File.OpenRead(Path.Combine(settings.AuditArchiveDir, archives[1]!)),
                System.IO.Compression.CompressionMode.Decompress);
            var line = await new StreamReader(gzip).ReadLineAsync(Token);
            Assert.Equal("auth.sign-in", (string?)JsonNode.Parse(line!)!["type"]);
            Assert.Equal(0, await retention.PruneAsync(Token));
        }
        finally
        {
            Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
            Directory.Delete(dir, recursive: true);
        }
    }
}
