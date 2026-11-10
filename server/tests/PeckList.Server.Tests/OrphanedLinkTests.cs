using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using PeckList.Core.Accounts;
using PeckList.Server.Auth;

namespace PeckList.Server.Tests;

/// <summary>Links to a provider no longer set up sign nobody in and count as no way in (PL-046 P2, P3).</summary>
public sealed class OrphanedLinkTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private const string Password = "a long enough password";

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private static async Task<Account> Linked(WebApplicationFactory<Program> server, string username, params string[] providers)
    {
        var account = await server.Services.GetRequiredService<AccountService>()
            .CreateUserAsync(username, Password, mustChangePassword: false, cancellation: Token);
        foreach (var provider in providers)
        {
            await server.Services.GetRequiredService<IIdentityStore>().LinkAsync(new LinkedIdentity
            {
                Provider = provider, Subject = $"sub-{username}", AccountId = account.Id, LinkedAt = DateTimeOffset.UtcNow, LastUsedAt = DateTimeOffset.UtcNow,
            }, Token);
        }
        return account;
    }

    [Fact]
    public async Task A_password_cannot_be_removed_when_only_an_orphan_link_is_left()
    {
        using var server = fixture.Factory(("ADMIN_PASSWORD", "correct horse battery"), ("DB_PATH", fixture.NewDbPath()));
        await Linked(server, "kim-o", "authelia");
        var kim = server.CreateClient();
        (await kim.PostAsJsonAsync("/auth/login", new { username = "kim-o", password = Password }, Token)).EnsureSuccessStatusCode();

        var refused = await kim.PostAsJsonAsync("/api/account/password/remove", new { current = Password }, Token);
        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        Assert.Equal("last_way_in", (await refused.Content.ReadFromJsonAsync<AdminError>(Token))!.Error);
        // The password still works.
        Assert.Equal(HttpStatusCode.OK, (await server.CreateClient().PostAsJsonAsync("/auth/login", new { username = "kim-o", password = Password }, Token)).StatusCode);
    }

    [Fact]
    public async Task The_start_finds_each_provider_no_longer_set_up_that_still_has_links()
    {
        using var server = fixture.Factory(("ADMIN_PASSWORD", "correct horse battery"), ("DB_PATH", fixture.NewDbPath()));
        await Linked(server, "ann-o", "authelia");
        await Linked(server, "bo-o", "authelia", "keycloak");
        Assert.Equal([("authelia", 2), ("keycloak", 1)], await server.Services.GetRequiredService<OrphanedLinks>().FindAsync(Token));
    }
}
