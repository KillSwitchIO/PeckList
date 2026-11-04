using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using PeckList.Core.Configuration;
using PeckList.Storage.Sql;
using PeckList.Storage.Sqlite;

namespace PeckList.Server.Tests;

/// <summary>
/// Session cookie and key hardening (audit S8): Secure on an https address, an absolute session
/// limit, and the keys the server keeps in its own database wrapped with <c>CONFIG_KEY</c>.
/// </summary>
public sealed class SessionHardeningTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private const string AdminPassword = "correct horse battery";

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private WebApplicationFactory<Program> Server(string db, params (string Key, string Value)[] extra) =>
        fixture.Factory([("ADMIN_PASSWORD", AdminPassword), ("DB_PATH", db), .. extra]);

    private static async Task<HttpResponseMessage> LogIn(HttpClient client) =>
        await client.PostAsJsonAsync("/auth/login", new { username = "admin", password = AdminPassword }, Token);

    [Fact]
    public async Task On_an_https_address_the_session_cookie_is_always_secure()
    {
        using (var server = Server(fixture.NewDbPath(), ("PUBLIC_URL", "https://tasks.example.com")))
        {
            // The test client speaks plain http, as a proxy that forgot X-Forwarded-Proto would.
            var cookie = Assert.Single((await LogIn(server.CreateClient())).Headers.GetValues("Set-Cookie"), each => each.StartsWith("pecklist_session=", StringComparison.Ordinal));
            Assert.Contains("secure", cookie, StringComparison.OrdinalIgnoreCase);
        }
        using (var server = Server(fixture.NewDbPath()))
        {
            var cookie = Assert.Single((await LogIn(server.CreateClient())).Headers.GetValues("Set-Cookie"), each => each.StartsWith("pecklist_session=", StringComparison.Ordinal));
            Assert.DoesNotContain("secure", cookie, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Fact]
    public async Task A_session_ends_ninety_days_after_its_sign_in_however_often_it_is_used()
    {
        var time = new ManualTime(DateTimeOffset.UtcNow);
        using var server = Server(fixture.NewDbPath())
            .WithWebHostBuilder(host => host.ConfigureTestServices(services => services.AddSingleton<TimeProvider>(time)));
        var client = server.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await LogIn(client)).StatusCode);
        // Used every 20 days: the cookie slides, but not past 90 days from the sign-in.
        for (var day = 20; day <= 80; day += 20)
        {
            time.Now = time.Now.AddDays(20);
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/auth/me", Token)).StatusCode);
        }
        time.Now = time.Now.AddDays(20);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/auth/me", Token)).StatusCode);
    }

    [Fact]
    public async Task With_CONFIG_KEY_the_keys_kept_in_the_database_open_only_with_it()
    {
        var db = fixture.NewDbPath();
        var key = ConfigCipher.NewKeyText();
        // Before CONFIG_KEY: a page secret, and session keys, stored as they always were.
        using (var server = Server(db))
        {
            var admin = server.CreateClient();
            await LogIn(admin);
            Assert.Equal(HttpStatusCode.OK, (await SaveSecret(admin)).StatusCode);
        }
        var secrets = new SqlSecretStore(new SqliteDatabase(db));
        Assert.False(ConfigCipher.IsEncrypted(await SettingsKey(secrets)));

        // CONFIG_KEY set: what was plain is wrapped with it, and everything still opens.
        using (var server = Server(db, ("CONFIG_KEY", key)))
        {
            Assert.Equal("very secret", Assert.Single(server.Services.GetRequiredService<ServerSettings>().OidcProviders).ClientSecret);
            var admin = server.CreateClient();
            Assert.Equal(HttpStatusCode.OK, (await LogIn(admin)).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync("/auth/me", Token)).StatusCode);
        }
        Assert.True(ConfigCipher.IsEncrypted(await SettingsKey(secrets)));
        var sessionKeys = await secrets.ListAsync("dataprotection", Token);
        Assert.NotEmpty(sessionKeys);
        Assert.All(sessionKeys, each => Assert.True(ConfigCipher.IsEncrypted(each.Value)));

        // Without it the page secrets stay shut: the server starts without the page values, and says why.
        using (var server = Server(db))
        {
            var loaded = server.Services.GetRequiredService<LoadedSettings>();
            Assert.Contains("CONFIG_KEY", loaded.PageProblem);
            Assert.Empty(loaded.Settings.OidcProviders);
            // Sessions still work: a key that does not open is left out and a new one made.
            var admin = server.CreateClient();
            Assert.Equal(HttpStatusCode.OK, (await LogIn(admin)).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync("/auth/me", Token)).StatusCode);
        }
    }

    private static Task<HttpResponseMessage> SaveSecret(HttpClient admin) =>
        admin.PutAsJsonAsync("/api/admin/settings", new
        {
            values = new Dictionary<string, string?>
            {
                ["OIDC_PROVIDERS"] = "pocket",
                ["OIDC_POCKET_AUTHORITY"] = "https://id.example.com",
                ["OIDC_POCKET_CLIENT_ID"] = "pecklist",
                ["OIDC_POCKET_CLIENT_SECRET"] = "very secret",
            },
        }, Token);

    private static async Task<string> SettingsKey(SqlSecretStore secrets) =>
        Assert.Single(await secrets.ListAsync("settings-key", Token)).Value;
}
