using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using PeckList.Core.Configuration;
using PeckList.Storage.Sql;
using PeckList.Storage.Sqlite;

namespace PeckList.Server.Tests;

/// <summary>The admin settings page over HTTP, and what a restart does with what it saved.</summary>
public sealed class SettingsPageTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private const string AdminPassword = "correct horse battery";

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private WebApplicationFactory<Program> Server(string db, params (string Key, string Value)[] extra) =>
        fixture.Factory([("ADMIN_PASSWORD", AdminPassword), ("DB_PATH", db), .. extra]);

    private static async Task<HttpClient> Admin(WebApplicationFactory<Program> server)
    {
        var client = server.Browser();
        (await client.PostAsJsonAsync("/auth/login", new { username = "admin", password = AdminPassword }, Token)).EnsureSuccessStatusCode();
        return client;
    }

    private static SettingView Find(SettingsView view, string key) => view.Settings.Single(each => each.Key == key);

    private static Task<HttpResponseMessage> Save(HttpClient admin, params (string Key, string? Value)[] values) =>
        admin.PutAsJsonAsync("/api/admin/settings", new { values = values.ToDictionary(each => each.Key, each => each.Value) }, Token);

    private static readonly (string Key, string? Value)[] Pocket =
    [
        ("OIDC_PROVIDERS", "pocket"),
        ("OIDC_POCKET_AUTHORITY", "https://id.example.com"),
        ("OIDC_POCKET_CLIENT_ID", "pecklist"),
    ];

    private static async Task Link(WebApplicationFactory<Program> server, HttpClient admin, string provider, string subject)
    {
        var me = (await admin.GetFromJsonAsync<PeckList.Server.Auth.Me>("/auth/me", Token))!;
        await server.Services.GetRequiredService<PeckList.Core.Accounts.IIdentityStore>().LinkAsync(new PeckList.Core.Accounts.LinkedIdentity
        {
            Provider = provider,
            Subject = subject,
            AccountId = me.Id,
            LinkedAt = DateTimeOffset.UtcNow,
            LastUsedAt = DateTimeOffset.UtcNow,
        }, Token);
    }

    [Fact]
    public async Task A_provider_with_linked_accounts_cannot_be_removed_until_they_are_unbound()
    {
        using var server = Server(fixture.NewDbPath());
        var admin = await Admin(server);
        (await Save(admin, Pocket)).EnsureSuccessStatusCode();
        await Link(server, admin, "pocket", "kim-subject");
        await Link(server, admin, "pocket", "ben-subject");

        var refused = await Save(admin, ("OIDC_PROVIDERS", null));
        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        var why = (await refused.Content.ReadFromJsonAsync<AdminError>(Token))!;
        Assert.Equal("provider_in_use", why.Error);
        Assert.Contains("pocket (2 accounts)", why.Message);
        Assert.Contains("pecklist oidc unbind-all", why.Message);

        // Nothing was saved, and naming it differently is removing it too.
        var view = (await admin.GetFromJsonAsync<SettingsView>("/api/admin/settings", Token))!;
        Assert.Equal("pocket", Find(view, "OIDC_PROVIDERS").Value);
        var renamed = await Save(admin, ("OIDC_PROVIDERS", "id"), ("OIDC_ID_AUTHORITY", "https://id.example.com"), ("OIDC_ID_CLIENT_ID", "pecklist"));
        Assert.Equal(HttpStatusCode.Conflict, renamed.StatusCode);

        // Other changes to the page, and keeping the provider, are fine.
        (await Save(admin, ("REGISTRATION", "closed"))).EnsureSuccessStatusCode();

        (await admin.PostAsync("/api/admin/providers/pocket/unbind-all", null, Token)).EnsureSuccessStatusCode();
        (await Save(admin, ("OIDC_PROVIDERS", null))).EnsureSuccessStatusCode();
        view = (await admin.GetFromJsonAsync<SettingsView>("/api/admin/settings", Token))!;
        Assert.Null(Find(view, "OIDC_PROVIDERS").Value);
    }

    [Fact]
    public async Task A_provider_nobody_is_linked_to_can_be_removed()
    {
        using var server = Server(fixture.NewDbPath());
        var admin = await Admin(server);
        (await Save(admin, Pocket)).EnsureSuccessStatusCode();
        // A link to another provider says nothing about this one.
        await Link(server, admin, "other", "kim-subject");
        (await Save(admin, ("OIDC_PROVIDERS", null))).EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task Links_to_a_provider_already_gone_do_not_block_saving()
    {
        using var server = Server(fixture.NewDbPath());
        var admin = await Admin(server);
        await Link(server, admin, "gone", "kim-subject");
        (await Save(admin, ("REGISTRATION", "closed"))).EnsureSuccessStatusCode();
        (await Save(admin, Pocket)).EnsureSuccessStatusCode();
    }

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
    public async Task Lists_what_each_mail_provider_fills_in_for_the_page_to_show()
    {
        using var server = Server(fixture.NewDbPath());
        var view = (await (await Admin(server)).GetFromJsonAsync<SettingsView>("/api/admin/settings", Token))!;
        var gmail = view.MailProviders!.Single(each => each.Name == "gmail");
        Assert.Equal(("Gmail", "smtp.gmail.com", "587", "starttls"),
            (gmail.DisplayName, gmail.Sets["SMTP_HOST"], gmail.Sets["SMTP_PORT"], gmail.Sets["SMTP_TLS"]));
        Assert.False(gmail.Sets.ContainsKey("SMTP_USER"));
        Assert.Equal("apikey", view.MailProviders!.Single(each => each.Name == "sendgrid").Sets["SMTP_USER"]);
        // Amazon SES's host depends on the region: suggested, left to the admin.
        var ses = view.MailProviders!.Single(each => each.Name == "amazon-ses");
        Assert.False(ses.Sets.ContainsKey("SMTP_HOST"));
        Assert.Equal("email-smtp.us-east-1.amazonaws.com", ses.Suggests["SMTP_HOST"]);
    }

    [Fact]
    public async Task Saves_page_values_checked_like_the_environments_and_applies_them_after_a_restart()
    {
        var db = fixture.NewDbPath();
        using (var server = Server(db, ("SNAPSHOT_KEEP", "5")))
        {
            var admin = await Admin(server);
            var saved = await admin.PutAsJsonAsync("/api/admin/settings", new { values = new Dictionary<string, string?> { ["PUBLIC_URL"] = "https://tasks.example.com" } }, Token);
            var view = (await saved.Content.ReadFromJsonAsync<SettingsView>(Token))!;
            Assert.Equal(("https://tasks.example.com", "page", true), (Find(view, "PUBLIC_URL").Value, Find(view, "PUBLIC_URL").Source, Find(view, "PUBLIC_URL").Saved));
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
            Assert.Equal(new Uri("https://tasks.example.com"), restarted.Services.GetRequiredService<ServerSettings>().PublicUrl);
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
                    ["OIDC_POCKET_CLIENT_ID"] = "pecklist",
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
        Assert.Equal(7, server.Services.GetRequiredService<ServerSettings>().SnapshotKeep);
        var view = (await (await Admin(server)).GetFromJsonAsync<SettingsView>("/api/admin/settings", Token))!;
        Assert.Contains("SNAPSHOT_KEEP", view.Problem);
    }

    [Fact]
    public async Task One_saved_value_that_does_not_work_leaves_out_only_that_one()
    {
        var db = fixture.NewDbPath();
        using (var first = Server(db)) await Admin(first);
        var secrets = new SqlSecretStore(new SqliteDatabase(db));
        await secrets.PutAsync(SettingsLoader.PageKind, "SNAPSHOT_KEEP", "0", Token);
        await secrets.PutAsync(SettingsLoader.PageKind, "SIGNUP_RATE_LIMIT", "lots", Token);
        await secrets.PutAsync(SettingsLoader.PageKind, "ROLE_MAP_RENEW_DAYS", "3", Token);
        await secrets.PutAsync(SettingsLoader.PageKind, "ATTACHMENT_MAX_MB", "7", Token);

        using var server = Server(db);
        var settings = server.Services.GetRequiredService<ServerSettings>();
        // The two that work are used; the two that do not fall back to their defaults.
        Assert.Equal((3, 7), (settings.RoleMapRenewDays, settings.AttachmentMaxMb));
        Assert.Equal((7, 5), (settings.SnapshotKeep, settings.SignUpRateLimit));
        var loaded = server.Services.GetRequiredService<LoadedSettings>();
        Assert.Equal(["SIGNUP_RATE_LIMIT", "SNAPSHOT_KEEP"], loaded.PageLeftOut);
        var view = (await (await Admin(server)).GetFromJsonAsync<SettingsView>("/api/admin/settings", Token))!;
        Assert.Contains("SNAPSHOT_KEEP", view.Problem);
        Assert.Contains("SIGNUP_RATE_LIMIT", view.Problem);
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

    [Fact]
    public async Task Who_can_join_sign_in_and_retention_apply_as_soon_as_they_are_saved()
    {
        using var server = Server(fixture.NewDbPath());
        var admin = await Admin(server);
        var stranger = server.CreateClient();
        Assert.Equal("invite", (await stranger.GetFromJsonAsync<Auth.SignInOptions>("/auth/providers", Token))!.Registration);

        var saved = await admin.PutAsJsonAsync("/api/admin/settings", new
        {
            values = new Dictionary<string, string?> { ["REGISTRATION"] = "open", ["AUDIT_RETENTION_DAYS"] = "30", ["SNAPSHOT_KEEP"] = "3" },
        }, Token);
        Assert.False((await saved.Content.ReadFromJsonAsync<SettingsView>(Token))!.PendingRestart);
        Assert.Equal("open", (await stranger.GetFromJsonAsync<Auth.SignInOptions>("/auth/providers", Token))!.Registration);
        var joined = await stranger.PostAsJsonAsync("/auth/signup", new { username = "sam", password = "a long enough password" }, Token);
        Assert.Equal(HttpStatusCode.OK, joined.StatusCode);
        var live = server.Services.GetRequiredService<LiveSettings>().Current;
        Assert.Equal((30, 3), (live.AuditRetentionDays, live.SnapshotKeep));

        // Taken back from the page: the default (invite only) is back at once.
        await admin.PutAsJsonAsync("/api/admin/settings", new { values = new Dictionary<string, string?> { ["REGISTRATION"] = "" } }, Token);
        Assert.Equal("invite", (await stranger.GetFromJsonAsync<Auth.SignInOptions>("/auth/providers", Token))!.Registration);
    }

    [Fact]
    public async Task The_first_run_wizard_saves_a_provider_in_one_go_and_remembers_it_is_done()
    {
        using var server = Server(fixture.NewDbPath());
        var admin = await Admin(server);
        Assert.False((await admin.GetFromJsonAsync<SetupState>("/api/admin/setup", Token))!.Done);

        // What the wizard sends: the address, a new provider's block, who can join.
        var saved = await admin.PutAsJsonAsync("/api/admin/settings", new
        {
            values = new Dictionary<string, string?>
            {
                ["PUBLIC_URL"] = "https://tasks.example.com",
                ["OIDC_PROVIDERS"] = "pocket",
                ["OIDC_POCKET_AUTHORITY"] = "https://id.example.com",
                ["OIDC_POCKET_CLIENT_ID"] = "pecklist",
                ["OIDC_POCKET_CLIENT_SECRET"] = "wizard-secret-31f",
                ["OIDC_POCKET_DISPLAY_NAME"] = "Pocket ID",
                ["OIDC_POCKET_AUTO_CREATE"] = "true",
                ["REGISTRATION"] = "closed",
            },
        }, Token);
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        var view = (await saved.Content.ReadFromJsonAsync<SettingsView>(Token))!;
        Assert.True(view.PendingRestart);
        Assert.Equal((SettingsEndpoints.Hidden, "page"), (Find(view, "OIDC_POCKET_CLIENT_SECRET").Value, Find(view, "OIDC_POCKET_CLIENT_SECRET").Source));

        (await admin.PutAsJsonAsync("/api/admin/setup", new { done = true }, Token)).EnsureSuccessStatusCode();
        Assert.True((await admin.GetFromJsonAsync<SetupState>("/api/admin/setup", Token))!.Done);
    }
}
