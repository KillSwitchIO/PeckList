using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Punchlist.Core.Accounts;
using Punchlist.Core.Backup;

namespace Punchlist.Server.Tests;

/// <summary>
/// An Admin cannot make themselves a super admin (audit S1), nor look into or act on an admin's
/// account (audit S15): sign-in settings and whole-server backups are for super admins only.
/// </summary>
public sealed class RoleEscalationTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private const string AdminPassword = "correct horse battery";
    private const string Password = "a long enough password";

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private WebApplicationFactory<Program> Server()
    {
        var db = fixture.NewDbPath();
        return fixture.Factory(("ADMIN_PASSWORD", AdminPassword), ("DB_PATH", db), ("SNAPSHOT_SCHEDULE", "off"),
            ("SNAPSHOT_DIR", Path.ChangeExtension(db, ".backups")));
    }

    private static async Task<HttpClient> LogIn(WebApplicationFactory<Program> server, string username, string password)
    {
        var client = server.CreateClient();
        (await client.PostAsJsonAsync("/auth/login", new { username, password }, Token)).EnsureSuccessStatusCode();
        return client;
    }

    private static async Task<(HttpClient Client, string Id)> NewAccount(WebApplicationFactory<Program> server, string username, Role role)
    {
        var account = await server.Services.GetRequiredService<AccountService>()
            .CreateUserAsync(username, Password, role, mustChangePassword: false, Token);
        return (await LogIn(server, username, Password), account.Id);
    }

    private static async Task<string> SuperAdminId(WebApplicationFactory<Program> server) =>
        (await server.Services.GetRequiredService<IAccountStore>().FindByUsernameAsync("admin", Token))!.Id;

    private static async Task<HttpResponseMessage> Restore(HttpClient client, string path, byte[] file)
    {
        using var form = new MultipartFormDataContent { { new ByteArrayContent(file), "file", "backup.json" } };
        return await client.PostAsync(path, form, Token);
    }

    private static async Task<string> ErrorOf(HttpResponseMessage response) =>
        (string)(await response.Content.ReadFromJsonAsync<JsonObject>(Token))!["error"]!;

    [Theory]
    [InlineData("OIDC_PROVIDERS", "evil")]
    [InlineData("LOCAL_LOGIN", "disabled")]
    [InlineData("REGISTRATION", "open")]
    [InlineData("TRUSTED_PROXIES", "0.0.0.0/0")]
    [InlineData("PUBLIC_URL", "https://elsewhere.example")]
    public async Task An_admin_cannot_save_settings_that_decide_who_signs_in(string key, string value)
    {
        using var server = Server();
        var (admin, _) = await NewAccount(server, "ada", Role.Admin);

        var refused = await admin.PutAsJsonAsync("/api/admin/settings", new { values = new Dictionary<string, string> { [key] = value } }, Token);

        Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
        Assert.Equal("super_admins_only", await ErrorOf(refused));
        var shown = (await admin.GetFromJsonAsync<SettingsView>("/api/admin/settings", Token))!.Settings.Single(each => each.Key == key);
        Assert.True(shown.Locked);
        Assert.True(shown.SuperAdminOnly);
        Assert.NotEqual(value, shown.Value);
    }

    [Fact]
    public async Task An_admin_still_saves_the_other_settings_and_a_super_admin_saves_sign_in_ones()
    {
        using var server = Server();
        var (admin, _) = await NewAccount(server, "ada", Role.Admin);
        var superAdmin = await LogIn(server, "admin", AdminPassword);

        var logging = await admin.PutAsJsonAsync("/api/admin/settings", new { values = new Dictionary<string, string> { ["LOG_LEVEL"] = "debug" } }, Token);
        Assert.Equal(HttpStatusCode.OK, logging.StatusCode);
        var registration = await superAdmin.PutAsJsonAsync("/api/admin/settings",
            new { values = new Dictionary<string, string> { ["REGISTRATION"] = "open" } }, Token);
        Assert.Equal(HttpStatusCode.OK, registration.StatusCode);

        var view = (await superAdmin.GetFromJsonAsync<SettingsView>("/api/admin/settings", Token))!;
        var shown = view.Settings.Single(each => each.Key == "REGISTRATION");
        Assert.False(shown.Locked);
        Assert.True(shown.SuperAdminOnly);
        Assert.Equal("open", shown.Value);
    }

    [Fact]
    public async Task An_admin_takes_and_lists_backups_but_cannot_download_export_or_restore_the_whole_server()
    {
        using var server = Server();
        var (admin, _) = await NewAccount(server, "ada", Role.Admin);
        var taken = await admin.PostAsync("/api/admin/backups", null, Token);
        Assert.Equal(HttpStatusCode.OK, taken.StatusCode);
        var name = (string)(await taken.Content.ReadFromJsonAsync<JsonObject>(Token))!["name"]!;
        Assert.Single((await admin.GetFromJsonAsync<BackupFile[]>("/api/admin/backups", Token))!);

        Assert.Equal(HttpStatusCode.Forbidden, (await admin.GetAsync($"/api/admin/backups/{name}", Token)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.GetAsync("/api/admin/export", Token)).StatusCode);
        using var form = new MultipartFormDataContent { { new StringContent(name), "backup" } };
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.PostAsync("/api/admin/restore", form, Token)).StatusCode);

        var superAdmin = await LogIn(server, "admin", AdminPassword);
        Assert.Equal(HttpStatusCode.OK, (await superAdmin.GetAsync($"/api/admin/backups/{name}", Token)).StatusCode);
    }

    [Fact]
    public async Task A_user_backup_an_admin_restores_comes_back_as_a_plain_user()
    {
        using var server = Server();
        var (admin, _) = await NewAccount(server, "ada", Role.Admin);
        var (_, samId) = await NewAccount(server, "sam", Role.User);
        var backup = JsonNode.Parse(await admin.GetByteArrayAsync($"/api/admin/users/{samId}/export", Token))!.AsObject();
        // A crafted file: a new account that says it is an admin, with a password the attacker knows.
        backup["account"]!["id"] = "01JBNEWACCOUNT0000000000AA";
        backup["account"]!["username"] = "mole";
        backup["account"]!["role"] = "admin";

        var restored = await Restore(admin, "/api/admin/users/restore", Encoding.UTF8.GetBytes(backup.ToJsonString()));

        Assert.Equal(HttpStatusCode.OK, restored.StatusCode);
        var mole = await server.Services.GetRequiredService<IAccountStore>().FindByUsernameAsync("mole", Token);
        Assert.Equal(Role.User, mole!.Role);
    }

    [Fact]
    public async Task An_admin_cannot_export_or_restore_an_admins_data()
    {
        using var server = Server();
        var (admin, _) = await NewAccount(server, "ada", Role.Admin);
        var superAdmin = await LogIn(server, "admin", AdminPassword);
        var superId = await SuperAdminId(server);

        var export = await admin.GetAsync($"/api/admin/users/{superId}/export", Token);
        Assert.Equal(HttpStatusCode.Forbidden, export.StatusCode);
        Assert.Equal("admins_only_by_super_admins", await ErrorOf(export));

        var theirs = await superAdmin.GetByteArrayAsync($"/api/admin/users/{superId}/export", Token);
        var restored = await Restore(admin, "/api/admin/users/restore", theirs);
        Assert.Equal(HttpStatusCode.Forbidden, restored.StatusCode);
        Assert.Equal("admins_only_by_super_admins", await ErrorOf(restored));
    }

    [Theory]
    [InlineData("identities")]
    [InlineData("friends")]
    [InlineData("shared")]
    public async Task An_admin_cannot_look_into_an_admins_account(string what)
    {
        using var server = Server();
        var (admin, _) = await NewAccount(server, "ada", Role.Admin);
        var (_, samId) = await NewAccount(server, "sam", Role.User);
        var superId = await SuperAdminId(server);

        var refused = await admin.GetAsync($"/api/admin/users/{superId}/{what}", Token);
        Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
        Assert.Equal("admins_only_by_super_admins", await ErrorOf(refused));
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync($"/api/admin/users/{samId}/{what}", Token)).StatusCode);
    }

    [Fact]
    public async Task An_admin_cannot_hand_over_an_admins_shares()
    {
        using var server = Server();
        var (admin, adaId) = await NewAccount(server, "ada", Role.Admin);
        var (_, samId) = await NewAccount(server, "sam", Role.User);
        var superId = await SuperAdminId(server);

        var refused = await admin.PostAsJsonAsync($"/api/admin/users/{superId}/hand-over", new { to = adaId }, Token);
        Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
        var allowed = await admin.PostAsJsonAsync($"/api/admin/users/{samId}/hand-over", new { to = adaId }, Token);
        Assert.Equal(HttpStatusCode.OK, allowed.StatusCode);
    }
}
