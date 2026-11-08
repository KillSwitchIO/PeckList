using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using PeckList.Core.Accounts;
using PeckList.Core.Audit;
using PeckList.Server.Audit;
using PeckList.Server.Auth;
using PeckList.Server.Logging;

namespace PeckList.Server.Tests;

/// <summary>
/// What a start does when no account is called <c>admin</c>: it stays that way while a super admin is
/// active, and otherwise the server rescues itself, once, with an audit event. On SQLite, and on
/// PostgreSQL where <c>PECKLIST_TEST_POSTGRES</c> names a server (CI does).
/// </summary>
public sealed class AdminAccountStartTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private const string Password = "correct horse battery";
    private const string Sqlite = "sqlite";
    private const string Postgres = "postgres";

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    public static TheoryData<string> Databases => [Sqlite, Postgres];

    /// <summary>Settings naming one new database, kept across the restarts of a test.</summary>
    private async Task<(string Key, string Value)[]> NewDatabase(string kind)
    {
        if (kind == Sqlite) return [("DB_PATH", fixture.NewDbPath())];
        var given = Environment.GetEnvironmentVariable("PECKLIST_TEST_POSTGRES");
        Assert.SkipWhen(string.IsNullOrEmpty(given), "needs PECKLIST_TEST_POSTGRES");
        var name = $"test_{Guid.NewGuid():N}";
        await using (var admin = new Npgsql.NpgsqlConnection(given))
        {
            await admin.OpenAsync(Token);
            await using var create = new Npgsql.NpgsqlCommand($"CREATE DATABASE {name}", admin);
            await create.ExecuteNonQueryAsync(Token);
        }
        return
        [
            ("DB_PROVIDER", "postgres"),
            ("DB_CONNECTION_STRING", new Npgsql.NpgsqlConnectionStringBuilder(given) { Database = name }.ToString()),
        ];
    }

    private WebApplicationFactory<Program> Start((string Key, string Value)[] database, params (string Key, string Value)[] extra) =>
        fixture.Factory([.. database, .. extra]);

    private WebApplicationFactory<Program> StartWithValue((string Key, string Value)[] database) =>
        Start(database, ("ADMIN_PASSWORD", Password));

    private static Task<Account?> Admin(WebApplicationFactory<Program> server) =>
        server.Services.GetRequiredService<IAccountStore>().FindByUsernameAsync(AccountService.AdminUsername, Token);

    private static async Task<IReadOnlyList<AuditEntry>> Created(WebApplicationFactory<Program> server)
    {
        await server.Services.GetRequiredService<AuditLog>().FlushAsync(Token);
        var entries = (await server.Services.GetRequiredService<IAuditStore>().QueryAsync(new AuditQuery { Ascending = true }, Token)).Entries;
        return entries.Where(entry => entry.Type == "auth.admin-created").ToList();
    }

    /// <summary>Start, arrange the accounts with <paramref name="arrange"/>, and take the row called admin away.</summary>
    private async Task<(string Key, string Value)[]> ServerWithoutAdmin(
        string kind, Func<AccountService, IAccountStore, Task> arrange)
    {
        var database = await NewDatabase(kind);
        using var first = StartWithValue(database);
        var accounts = first.Services.GetRequiredService<AccountService>();
        var store = first.Services.GetRequiredService<IAccountStore>();
        await arrange(accounts, store);
        await store.DeleteAsync((await Admin(first))!.Id, Token);
        return database;
    }

    [Theory]
    [MemberData(nameof(Databases))]
    public async Task A_first_start_makes_the_admin_and_says_so_once(string kind)
    {
        var database = await NewDatabase(kind);
        using (var first = StartWithValue(database))
        {
            Assert.Equal(Role.SuperAdmin, (await Admin(first))!.Role);
            Assert.Equal("source=setting", Assert.Single(await Created(first)).Detail);
        }
        using var again = StartWithValue(database);
        Assert.Single(await Created(again));
    }

    [Theory]
    [MemberData(nameof(Databases))]
    public async Task An_admin_deleted_by_another_super_admin_stays_gone(string kind)
    {
        var database = await NewDatabase(kind);
        using (var first = StartWithValue(database))
        {
            var client = first.CreateClient();
            await first.Services.GetRequiredService<AccountService>()
                .CreateUserAsync("keeper", Password, Role.SuperAdmin, mustChangePassword: false, cancellation: Token);
            (await client.PostAsJsonAsync("/auth/login", new { username = "keeper", password = Password }, Token)).EnsureSuccessStatusCode();
            var id = (await Admin(first))!.Id;
            (await client.DeleteAsync($"/api/admin/users/{id}", Token)).EnsureSuccessStatusCode();
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/admin/users/{id}/remove-now", null, Token)).StatusCode);
        }

        var console = new StringWriter();
        using var restarted = Start(database, ("ADMIN_PASSWORD", Password))
            .WithWebHostBuilder(host => host.ConfigureTestServices(services => services.AddSingleton(new StartupConsole(console))));

        Assert.Null(await Admin(restarted));
        Assert.Equal(string.Empty, console.ToString());
        Assert.Single(await Created(restarted));
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await restarted.CreateClient().PostAsJsonAsync("/auth/login", new { username = "admin", password = Password }, Token)).StatusCode);
    }

    [Theory]
    [MemberData(nameof(Databases))]
    public async Task A_restart_during_the_grace_period_leaves_a_deleted_admin_as_it_is(string kind)
    {
        var database = await NewDatabase(kind);
        string id;
        using (var first = StartWithValue(database))
        {
            var accounts = first.Services.GetRequiredService<AccountService>();
            await accounts.CreateUserAsync("keeper", Password, Role.SuperAdmin, mustChangePassword: false, cancellation: Token);
            id = (await Admin(first))!.Id;
            await accounts.DeleteAsync(id, Token);
        }

        using var restarted = StartWithValue(database);

        var admin = (await Admin(restarted))!;
        Assert.Equal(id, admin.Id);
        Assert.True(admin.Disabled);
        Assert.Single(await Created(restarted));
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await restarted.CreateClient().PostAsJsonAsync("/auth/login", new { username = "admin", password = Password }, Token)).StatusCode);
    }

    [Fact]
    public async Task Making_the_admin_from_the_setting_is_logged_without_the_value()
    {
        using var server = StartWithValue(await NewDatabase(Sqlite));

        var logged = server.Services.GetRequiredService<LogPipeline>().Recent();

        Assert.Contains(logged, record => record.Message.StartsWith("Admin account admin created", StringComparison.Ordinal));
        Assert.DoesNotContain(logged, record => record.Message.Contains(Password, StringComparison.Ordinal));
    }

    [Theory]
    [MemberData(nameof(Databases))]
    public async Task An_admin_removed_when_its_grace_period_ends_stays_gone(string kind)
    {
        var database = await NewDatabase(kind);
        using (var first = Start(database, ("ADMIN_PASSWORD", Password), ("ACCOUNT_DELETE_GRACE_DAYS", "0")))
        {
            var accounts = first.Services.GetRequiredService<AccountService>();
            await accounts.CreateUserAsync("keeper", Password, Role.SuperAdmin, mustChangePassword: false, cancellation: Token);
            await accounts.DeleteAsync((await Admin(first))!.Id, Token);
            Assert.Equal(1, await first.Services.GetRequiredService<AccountRemoval>().RemoveDueAsync(Token));
            Assert.Null(await Admin(first));
        }

        using var restarted = StartWithValue(database);
        Assert.Null(await Admin(restarted));
        Assert.Single(await Created(restarted));
    }

    [Theory]
    [MemberData(nameof(Databases))]
    public async Task A_start_with_a_value_too_long_to_use_goes_on_while_a_super_admin_is_active(string kind)
    {
        var database = await ServerWithoutAdmin(kind, (accounts, _) =>
            accounts.CreateUserAsync("keeper", Password, Role.SuperAdmin, cancellation: Token));

        using var restarted = Start(database, ("ADMIN_PASSWORD", new string('x', AccountService.MaxTriedPasswordLength + 1)));

        Assert.Null(await Admin(restarted));
    }

    public static TheoryData<string, string> NoWorkingSuperAdmin()
    {
        var data = new TheoryData<string, string>();
        foreach (var kind in new[] { Sqlite, Postgres })
        {
            foreach (var situation in new[] { "disabled", "grace period", "plain admin", "plain users" }) data.Add(kind, situation);
        }
        return data;
    }

    [Theory]
    [MemberData(nameof(NoWorkingSuperAdmin))]
    public async Task With_no_working_super_admin_a_start_makes_the_admin_once(string kind, string situation)
    {
        var database = await ServerWithoutAdmin(kind, async (accounts, store) =>
        {
            await accounts.CreateUserAsync("sam", Password, cancellation: Token);
            if (situation == "plain users") return;
            var role = situation == "plain admin" ? Role.Admin : Role.SuperAdmin;
            var other = await accounts.CreateUserAsync("other", Password, role, cancellation: Token);
            if (situation == "disabled") await accounts.SetDisabledAsync(other.Id, true, Token);
            if (situation == "grace period") await accounts.DeleteAsync(other.Id, Token);
        });

        using (var restarted = StartWithValue(database))
        {
            Assert.Equal(Role.SuperAdmin, (await Admin(restarted))!.Role);
            Assert.Equal(2, (await Created(restarted)).Count); // The first start's, and this one.
            Assert.Equal("source=setting", (await Created(restarted))[^1].Detail);
        }
        using var again = StartWithValue(database);
        Assert.Equal(2, (await Created(again)).Count);
    }

    [Fact]
    public async Task With_no_value_the_rescue_generates_a_password_to_change()
    {
        var database = await ServerWithoutAdmin(Sqlite, (accounts, _) => accounts.CreateUserAsync("sam", Password, cancellation: Token));

        var console = new StringWriter();
        using var restarted = Start(database)
            .WithWebHostBuilder(host => host.ConfigureTestServices(services => services.AddSingleton(new StartupConsole(console))));

        Assert.True((await Admin(restarted))!.MustChangePassword);
        Assert.Contains("username: admin", console.ToString());
        Assert.Equal("source=generated", (await Created(restarted))[^1].Detail);
    }

    [Theory]
    [InlineData("admin")]
    [InlineData("ADMIN")]
    [InlineData(" Admin ")]
    public async Task Sign_up_refuses_the_servers_own_name_even_when_it_is_free(string username)
    {
        var database = await ServerWithoutAdmin(Sqlite, (accounts, _) =>
            accounts.CreateUserAsync("keeper", Password, Role.SuperAdmin, cancellation: Token));
        using var server = Start(database, ("REGISTRATION", "open"));

        var answer = await server.CreateClient().PostAsJsonAsync("/auth/signup", new { username, password = Password }, Token);

        Assert.Equal(HttpStatusCode.Conflict, answer.StatusCode);
        Assert.Equal("username_taken", (await answer.Content.ReadFromJsonAsync<AuthError>(Token))!.Error);
        Assert.Null(await Admin(server));
    }
}
