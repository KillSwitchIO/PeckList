using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using PeckList.Core.Accounts;
using PeckList.Server.Auth;

namespace PeckList.Server.Tests;

/// <summary>Used one-time tokens leave no row, and a daily prune clears expired ones (audit S14 / B6).</summary>
public sealed class OneTimeSecretTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private WebApplicationFactory<Program> Server() =>
        fixture.Factory(("ADMIN_PASSWORD", "correct horse battery"), ("DB_PATH", fixture.NewDbPath()));

    [Fact]
    public async Task A_used_login_link_leaves_no_row_and_works_only_once()
    {
        using var server = Server();
        var secrets = server.Services.GetRequiredService<ISecretStore>();
        var links = server.Services.GetRequiredService<LoginLinks>();
        var kim = await server.Services.GetRequiredService<AccountService>()
            .CreateUserAsync("kim-t", "a long enough password", mustChangePassword: false, cancellation: Token);
        var (token, _) = await links.CreateAsync(kim.Id, cancellation: Token);
        Assert.Single(await secrets.ListAsync(LoginLinks.Kind, Token));

        var client = server.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var used = await client.PostAsync($"/auth/link/{token}", null, Token);
        Assert.Equal(HttpStatusCode.Redirect, used.StatusCode);
        Assert.DoesNotContain("error", used.Headers.Location!.OriginalString);
        Assert.Empty(await secrets.ListAsync(LoginLinks.Kind, Token));
        var again = await server.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false })
            .PostAsync($"/auth/link/{token}", null, Token);
        Assert.Contains("link_expired", again.Headers.Location!.OriginalString);
    }

    [Fact]
    public async Task An_ended_impersonation_and_a_revoked_invite_leave_no_row()
    {
        using var server = Server();
        var secrets = server.Services.GetRequiredService<ISecretStore>();
        var accounts = server.Services.GetRequiredService<AccountService>();
        var admin = await accounts.CreateUserAsync("ann-t", "a long enough password", mustChangePassword: false, cancellation: Token);
        var kim = await accounts.CreateUserAsync("kim-t", "a long enough password", mustChangePassword: false, cancellation: Token);
        var impersonations = server.Services.GetRequiredService<Impersonations>();
        var (token, _) = (await impersonations.StartAsync(admin.Id, kim.Id, "checking a report", Token))!.Value;
        Assert.NotNull(await impersonations.FindAsync(token, Token));
        await impersonations.EndAsync(token, Token);
        Assert.Null(await impersonations.FindAsync(token, Token));
        Assert.Empty(await secrets.ListAsync(Impersonations.Kind, Token));

        var invites = server.Services.GetRequiredService<SignupInvites>();
        var (code, invite) = await invites.CreateAsync(admin.Id, TimeSpan.FromDays(1), maxUses: null, note: null, Token);
        Assert.NotNull(await invites.FindAsync(code, Token));
        Assert.NotNull(await invites.RevokeAsync(invite.Id, Token));
        Assert.Null(await invites.FindAsync(code, Token));
        Assert.Empty(await secrets.ListAsync(SignupInvites.Kind, Token));
    }

    [Fact]
    public async Task The_prune_removes_empty_and_expired_rows_and_keeps_live_and_unreadable_ones()
    {
        using var server = Server();
        var secrets = server.Services.GetRequiredService<ISecretStore>();
        var protection = server.Services.GetRequiredService<IDataProtectionProvider>();
        var now = DateTimeOffset.UtcNow;
        string At(TimeSpan from) => (now + from).ToString("O", System.Globalization.CultureInfo.InvariantCulture);

        // As older versions left them: used tokens marked empty.
        await secrets.PutAsync(LoginLinks.Kind, "used", "", Token);
        await secrets.PutAsync(AppSignIn.Kind, "used", "", Token);
        await secrets.PutAsync(CrashReporting.QueueKind, "sent", "", Token);
        // Never used, and run out.
        await secrets.PutAsync(LoginLinks.Kind, "expired", $"U1 {At(TimeSpan.FromHours(-1))}", Token);
        await secrets.PutAsync(AccountEmails.ResetKind, "expired", $"U1 stamp {At(TimeSpan.FromHours(-1))}", Token);
        await secrets.PutAsync(Impersonations.Kind, "expired", $"A1 U1 {At(TimeSpan.FromMinutes(-1))} a long reason", Token);
        var protector = protection.CreateProtector("pecklist.app-handoff.v1");
        await secrets.PutAsync(AppSignIn.LinkKind, "expired",
            protector.Protect(System.Text.Json.JsonSerializer.Serialize(new { Expires = now.AddMinutes(-1) })), Token);
        // Still good, waiting, or not ours to read: kept.
        await secrets.PutAsync(LoginLinks.Kind, "live", $"U1 {At(TimeSpan.FromHours(1))}", Token);
        await secrets.PutAsync(AppSignIn.LinkKind, "live",
            protector.Protect(System.Text.Json.JsonSerializer.Serialize(new { Expires = now.AddMinutes(5) })), Token);
        await secrets.PutAsync(CrashReporting.QueueKind, "waiting", "{}", Token);
        await secrets.PutAsync(LoginLinks.Kind, "odd", "not a link", Token);
        await secrets.PutAsync("settings-page", "kept", "", Token);

        Assert.Equal(7, await server.Services.GetRequiredService<OneTimeSecretPrune>().PruneAsync(Token));

        Assert.Equal(["live", "odd"], (await secrets.ListAsync(LoginLinks.Kind, Token)).Select(each => each.Name));
        Assert.Equal(["live"], (await secrets.ListAsync(AppSignIn.LinkKind, Token)).Select(each => each.Name));
        Assert.Equal(["waiting"], (await secrets.ListAsync(CrashReporting.QueueKind, Token)).Select(each => each.Name));
        Assert.Empty(await secrets.ListAsync(AppSignIn.Kind, Token));
        Assert.Empty(await secrets.ListAsync(AccountEmails.ResetKind, Token));
        Assert.Empty(await secrets.ListAsync(Impersonations.Kind, Token));
        Assert.Equal("", await secrets.GetAsync("settings-page", "kept", Token));
    }
}
