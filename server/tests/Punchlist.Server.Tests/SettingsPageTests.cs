using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Punchlist.Core.Configuration;
using Punchlist.Storage.Sql;
using Punchlist.Storage.Sqlite;

namespace Punchlist.Server.Tests;

/// <summary>The admin settings page over HTTP, and what a restart does with what it saved.</summary>
public sealed class SettingsPageTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private const string AdminPassword = "correct horse battery";

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private WebApplicationFactory<Program> Server(string db, params (string Key, string Value)[] extra) =>
        fixture.Factory([("ADMIN_PASSWORD", AdminPassword), ("DB_PATH", db), .. extra]);

    private static async Task<HttpClient> Admin(WebApplicationFactory<Program> server)
    {
        var client = server.CreateClient();
        (await client.PostAsJsonAsync("/auth/login", new { username = "admin", password = AdminPassword }, Token)).EnsureSuccessStatusCode();
        return client;
    }

    private static SettingView Find(SettingsView view, string key) => view.Settings.Single(each => each.Key == key);

    [Fact]
    public async Task Shows_every_setting_with_where_it_comes_from()
    {
        using var server = Server(fixture.NewDbPath(), ("SNAPSHOT_KEEP", "5"));
        var view = (await (await Admin(server)).GetFromJsonAsync<SettingsView>("/api/admin/settings", Token))!;
        Assert.Equal(("5", "environment", true), (Find(view, "SNAPSHOT_KEEP").Value, Find(view, "SNAPSHOT_KEEP").Source, Find(view, "SNAPSHOT_KEEP").Locked));
        Assert.Equal((null, "default", false), (Find(view, "REGISTRATION").Value, Find(view, "REGISTRATION").Source, Find(view, "REGISTRATION").Locked));
        // A secret never leaves the server.
        Assert.Equal((SettingsEndpoints.Hidden, true), (Find(view, "ADMIN_PASSWORD").Value, Find(view, "ADMIN_PASSWORD").Locked));
        Assert.False(view.PendingRestart);
    }

    [Fact]
    public async Task Saves_page_values_checked_like_the_environments_and_applies_them_after_a_restart()
    {
        var db = fixture.NewDbPath();
        using (var server = Server(db, ("SNAPSHOT_KEEP", "5")))
        {
            var admin = await Admin(server);
            var saved = await admin.PutAsJsonAsync("/api/admin/settings", new { values = new Dictionary<string, string?> { ["REGISTRATION"] = "open" } }, Token);
            var view = (await saved.Content.ReadFromJsonAsync<SettingsView>(Token))!;
            Assert.Equal(("open", "page", true), (Find(view, "REGISTRATION").Value, Find(view, "REGISTRATION").Source, Find(view, "REGISTRATION").Saved));
            Assert.True(view.PendingRestart);

            var bad = await admin.PutAsJsonAsync("/api/admin/settings", new { values = new Dictionary<string, string?> { ["REGISTRATION"] = "maybe" } }, Token);
            Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
            Assert.Contains("'maybe' is not one of", (await bad.Content.ReadFromJsonAsync<AdminError>(Token))!.Message);
            // The environment decides these.
            Assert.Equal(HttpStatusCode.Conflict, (await admin.PutAsJsonAsync("/api/admin/settings", new { values = new Dictionary<string, string?> { ["SNAPSHOT_KEEP"] = "9" } }, Token)).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict, (await admin.PutAsJsonAsync("/api/admin/settings", new { values = new Dictionary<string, string?> { ["DB_PATH"] = "/tmp/x" } }, Token)).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync("/api/admin/settings", new { values = new Dictionary<string, string?> { ["NOPE"] = "1" } }, Token)).StatusCode);
        }
        using (var restarted = Server(db, ("SNAPSHOT_KEEP", "5")))
        {
            Assert.Equal(Registration.Open, restarted.Services.GetRequiredService<ServerSettings>().Registration);
            var view = (await (await Admin(restarted)).GetFromJsonAsync<SettingsView>("/api/admin/settings", Token))!;
            Assert.False(view.PendingRestart);
        }
    }

    [Fact]
    public async Task Secrets_saved_on_the_page_are_encrypted_at_rest_and_never_shown()
    {
        var db = fixture.NewDbPath();
        using (var server = Server(db))
        {
            var admin = await Admin(server);
            var saved = await admin.PutAsJsonAsync("/api/admin/settings", new
            {
                values = new Dictionary<string, string?>
                {
                    ["OIDC_PROVIDERS"] = "pocket",
                    ["OIDC_POCKET_AUTHORITY"] = "https://id.example.com",
                    ["OIDC_POCKET_CLIENT_ID"] = "punchlist",
                    ["OIDC_POCKET_CLIENT_SECRET"] = "very secret",
                },
            }, Token);
            Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
            var view = (await saved.Content.ReadFromJsonAsync<SettingsView>(Token))!;
            Assert.Equal(SettingsEndpoints.Hidden, Find(view, "OIDC_POCKET_CLIENT_SECRET").Value);
            Assert.DoesNotContain("very secret", await (await admin.GetAsync("/api/admin/settings", Token)).Content.ReadAsStringAsync(Token));
            // Sending the hidden marker back leaves it as it is.
            Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync("/api/admin/settings", new { values = new Dictionary<string, string?> { ["OIDC_POCKET_CLIENT_SECRET"] = SettingsEndpoints.Hidden } }, Token)).StatusCode);
        }
        var rows = await new SqlSecretStore(new SqliteDatabase(db)).ListAsync(SettingsLoader.PageKind, Token);
        var stored = rows.Single(row => row.Name == "OIDC_POCKET_CLIENT_SECRET").Value;
        Assert.StartsWith("page:", stored);
        Assert.DoesNotContain("very secret", stored);
        using var restarted = Server(db);
        var provider = Assert.Single(restarted.Services.GetRequiredService<ServerSettings>().OidcProviders);
        Assert.Equal("very secret", provider.ClientSecret);
    }

    [Fact]
    public async Task A_saved_value_that_no_longer_works_never_stops_the_server()
    {
        var db = fixture.NewDbPath();
        using (var first = Server(db)) await Admin(first);
        await new SqlSecretStore(new SqliteDatabase(db)).PutAsync(SettingsLoader.PageKind, "SNAPSHOT_KEEP", "0", Token);
        using var server = Server(db);
        Assert.Equal(14, server.Services.GetRequiredService<ServerSettings>().SnapshotKeep);
        var view = (await (await Admin(server)).GetFromJsonAsync<SettingsView>("/api/admin/settings", Token))!;
        Assert.Contains("SNAPSHOT_KEEP", view.Problem);
    }

    [Fact]
    public async Task A_config_file_sits_between_the_environment_and_the_page()
    {
        var key = ConfigCipher.NewKeyText();
        var file = Path.Combine(Path.GetDirectoryName(fixture.NewDbPath())!, $"{Guid.NewGuid():N}.env");
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        await File.WriteAllTextAsync(file, $"REGISTRATION=closed\nLOG_LEVEL={ConfigCipher.FromText(key).Encrypt("warning")}\n", Token);
        using var server = Server(fixture.NewDbPath(), ("CONFIG_FILE", file), ("CONFIG_KEY", key));
        var settings = server.Services.GetRequiredService<ServerSettings>();
        Assert.Equal((Registration.Closed, LogLevelSetting.Warning), (settings.Registration, settings.Logging.Level));
        var view = (await (await Admin(server)).GetFromJsonAsync<SettingsView>("/api/admin/settings", Token))!;
        Assert.Equal(("file", true), (Find(view, "REGISTRATION").Source, Find(view, "REGISTRATION").Locked));
    }
}
