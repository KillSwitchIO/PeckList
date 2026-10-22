using System.Security.Claims;
using Punchlist.Core.Accounts;
using Punchlist.Core.Configuration;
using Punchlist.Server.Auth;

namespace Punchlist.Server;

public sealed record IdentityView(string Provider, string DisplayName, string Subject, string? Email, DateTimeOffset LinkedAt, DateTimeOffset LastUsedAt);

public sealed record LinkOption(string Name, string DisplayName, string Url);

/// <summary>How an account signs in: a password, linked provider accounts, and providers it could link.</summary>
public sealed record SignInMethods(bool Password, IReadOnlyList<IdentityView> Identities, IReadOnlyList<LinkOption> CanLink);

/// <summary><c>/api/account</c>: the signed-in user's own sign-in methods (spec: Accounts &amp; Admin, Linking).</summary>
public static class AccountEndpoints
{
    public static RouteGroupBuilder MapAccount(this RouteGroupBuilder api)
    {
        api.MapGet("/account/sign-in", async (ClaimsPrincipal user, IAccountStore accounts, ExternalSignIn signIn, ServerSettings settings, CancellationToken cancellation) =>
        {
            var account = await accounts.FindByIdAsync(user.UserId(), cancellation);
            if (account is null) return Results.NotFound();
            var linked = await signIn.IdentitiesOfAsync(account.Id, cancellation);
            return Results.Ok(new SignInMethods(
                account.PasswordHash is not null,
                linked.Select(identity => View(identity, settings)).ToList(),
                settings.OidcProviders
                    .Where(provider => linked.All(identity => identity.Provider != provider.Name))
                    .Select(provider => new LinkOption(provider.Name, provider.DisplayName, $"/auth/oidc/{provider.Name}/link"))
                    .ToList()));
        });

        api.MapDelete("/account/identities/{provider}/{subject}", async (
            string provider, string subject, ClaimsPrincipal user, ExternalSignIn signIn, CancellationToken cancellation) =>
            await signIn.UnlinkAsync(user.UserId(), provider, subject, selfService: true, cancellation) switch
            {
                UnlinkResult.Unlinked => Results.NoContent(),
                UnlinkResult.LastWayIn => Results.Conflict(new AdminError("last_way_in", "this is your only way to sign in")),
                _ => Results.NotFound(),
            });

        return api;
    }

    public static IdentityView View(LinkedIdentity identity, ServerSettings settings) => new(
        identity.Provider,
        settings.OidcProviders.FirstOrDefault(provider => provider.Name == identity.Provider)?.DisplayName ?? identity.Provider,
        identity.Subject,
        identity.Email,
        identity.LinkedAt,
        identity.LastUsedAt);
}
