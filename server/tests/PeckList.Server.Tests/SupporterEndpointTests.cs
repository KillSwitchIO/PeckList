using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using NSec.Cryptography;
using PeckList.Core.Accounts;
using PeckList.Core.Audit;
using PeckList.Core.Supporters;
using PeckList.Server.Audit;
using PeckList.Server.Supporters;

namespace PeckList.Server.Tests;

/// <summary>Entering supporter keys over HTTP (PL-112), checked against a throwaway issuing key.</summary>
public sealed class SupporterEndpointTests(ServerFixture fixture) : IClassFixture<ServerFixture>, IDisposable
{
    private const string AdminPassword = "correct horse battery";
    private const string Password = "a long enough password";
    private static readonly SignatureAlgorithm Ed25519 = SignatureAlgorithm.Ed25519;

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private readonly Key issuer = Key.Create(Ed25519);
    private readonly Key stranger = Key.Create(Ed25519);

    public void Dispose()
    {
        issuer.Dispose();
        stranger.Dispose();
    }

    private string Issue(SupporterKind kind, Key? by = null, byte serial = 1)
    {
        var purchased = new DateOnly(2026, 11, 11);
        byte[] serialBytes = [serial, 0, 0, 0, 0, 0, 0, 7];
        return new SupporterKey(purchased, kind, serialBytes, Ed25519.Sign(by ?? issuer, SupporterKey.SignedBytes(purchased, kind, serialBytes))).Text;
    }

    private WebApplicationFactory<Program> Start(params (string, string)[] settings) =>
        fixture.Factory([("ADMIN_PASSWORD", AdminPassword), ("DB_PATH", fixture.NewDbPath()), .. settings])
            .WithWebHostBuilder(host => host.ConfigureTestServices(services =>
                services.AddSingleton<ISupporterKeyCheck>(new SupporterKeyCheck([issuer.PublicKey]))));

    private static async Task<HttpClient> LogIn(WebApplicationFactory<Program> server, string username, string password)
    {
        var client = server.CreateClient();
        (await client.PostAsJsonAsync("/auth/login", new { username, password }, Token)).EnsureSuccessStatusCode();
        return client;
    }

    private static async Task<(HttpClient Client, string Id)> NewUser(WebApplicationFactory<Program> server, string username)
    {
        var id = (await server.Services.GetRequiredService<AccountService>()
            .CreateUserAsync(username, Password, mustChangePassword: false, cancellation: Token)).Id;
        return (await LogIn(server, username, Password), id);
    }

    private static async Task<string?> Refusal(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<AdminError>(Token))?.Error;
    }

    [Fact]
    public async Task A_person_enters_their_own_key_sees_its_date_and_can_remove_it()
    {
        using var server = Start();
        var (sam, _) = await NewUser(server, "sam");
        Assert.Equal(new SupporterView(null, null), await sam.GetFromJsonAsync<SupporterView>("/api/account/supporter", Token));

        Assert.Equal("not_a_key", await Refusal(await sam.PutAsJsonAsync("/api/account/supporter", new { key = "PECKLIST-20261111-S-NOPE" }, Token)));
        Assert.Equal("not_genuine", await Refusal(await sam.PutAsJsonAsync("/api/account/supporter", new { key = Issue(SupporterKind.Person, stranger) }, Token)));
        Assert.Equal("server_key", await Refusal(await sam.PutAsJsonAsync("/api/account/supporter", new { key = Issue(SupporterKind.Server) }, Token)));

        // Pasted from an email: lower case and wrapped.
        var key = Issue(SupporterKind.Person);
        var entered = await sam.PutAsJsonAsync("/api/account/supporter", new { key = key[..25].ToLowerInvariant() + "\n" + key[25..] }, Token);
        entered.EnsureSuccessStatusCode();
        var expected = new SupporterView(new SupporterKeyView(new DateOnly(2026, 11, 11), "person"), null);
        Assert.Equal(expected, await entered.Content.ReadFromJsonAsync<SupporterView>(Token));
        var shown = await sam.GetStringAsync("/api/account/supporter", Token);
        Assert.DoesNotContain(key[^20..], shown);
        Assert.Equal(expected, await sam.GetFromJsonAsync<SupporterView>("/api/account/supporter", Token));

        Assert.Equal(HttpStatusCode.NoContent, (await sam.DeleteAsync("/api/account/supporter", Token)).StatusCode);
        Assert.Equal(new SupporterView(null, null), await sam.GetFromJsonAsync<SupporterView>("/api/account/supporter", Token));

        await server.Services.GetRequiredService<AuditLog>().FlushAsync(Token);
        var events = (await server.Services.GetRequiredService<IAuditStore>().QueryAsync(new AuditQuery { Ascending = true }, Token)).Entries;
        var saved = Assert.Single(events, entry => entry.Type == "account.supporter-key-entered" && entry.Outcome == AuditOutcome.Ok);
        Assert.Equal("2026-11-11 0100000000000007", saved.Detail);
        Assert.Equal(3, events.Count(entry => entry.Type == "account.supporter-key-entered" && entry.Outcome == AuditOutcome.Failed));
        Assert.Contains(events, entry => entry.Type == "account.supporter-key-removed");
        Assert.DoesNotContain(events, entry => (entry.Detail ?? "").Contains(key[^20..], StringComparison.Ordinal));
    }

    [Fact]
    public async Task An_admin_enters_the_server_key_and_everyone_sees_it()
    {
        using var server = Start();
        var admin = await LogIn(server, "admin", AdminPassword);
        var (sam, _) = await NewUser(server, "sam");

        Assert.Equal(HttpStatusCode.Forbidden, (await sam.PutAsJsonAsync("/api/admin/supporter", new { key = Issue(SupporterKind.Server) }, Token)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await sam.GetAsync("/api/admin/supporter", Token)).StatusCode);
        Assert.Equal("person_key", await Refusal(await admin.PutAsJsonAsync("/api/admin/supporter", new { key = Issue(SupporterKind.Person) }, Token)));
        Assert.Equal(new ServerSupporterView(null), await admin.GetFromJsonAsync<ServerSupporterView>("/api/admin/supporter", Token));

        (await admin.PutAsJsonAsync("/api/admin/supporter", new { key = Issue(SupporterKind.Server) }, Token)).EnsureSuccessStatusCode();
        var serverKey = new SupporterKeyView(new DateOnly(2026, 11, 11), "server");
        Assert.Equal(new ServerSupporterView(serverKey), await admin.GetFromJsonAsync<ServerSupporterView>("/api/admin/supporter", Token));
        Assert.Equal(new SupporterView(null, serverKey), await sam.GetFromJsonAsync<SupporterView>("/api/account/supporter", Token));

        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync("/api/admin/supporter", Token)).StatusCode);
        Assert.Equal(new SupporterView(null, null), await sam.GetFromJsonAsync<SupporterView>("/api/account/supporter", Token));
    }

    [Fact]
    public async Task A_person_removed_for_good_takes_their_key_with_them()
    {
        using var server = Start(("ACCOUNT_DELETE_GRACE_DAYS", "0"));
        var admin = await LogIn(server, "admin", AdminPassword);
        var (sam, samId) = await NewUser(server, "sam");
        (await sam.PutAsJsonAsync("/api/account/supporter", new { key = Issue(SupporterKind.Person) }, Token)).EnsureSuccessStatusCode();

        (await admin.DeleteAsync($"/api/admin/users/{samId}", Token)).EnsureSuccessStatusCode();
        await server.Services.GetRequiredService<AccountRemoval>().RemoveDueAsync(Token);

        Assert.Empty(await server.Services.GetRequiredService<ISecretStore>().ListAsync(SupporterKeys.Kind, Token));
    }
}
