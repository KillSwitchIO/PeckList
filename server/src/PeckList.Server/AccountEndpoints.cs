using PeckList.Server.Audit;
using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.Extensions.Caching.Memory;
using PeckList.Core.Accounts;
using PeckList.Core.Configuration;
using PeckList.Server.Auth;

namespace PeckList.Server;

public sealed record IdentityView(
    string Provider, string DisplayName, string Subject, string? Email, DateTimeOffset LinkedAt, DateTimeOffset LastUsedAt, string? Username = null);

public sealed record LinkOption(string Name, string DisplayName, string Url);

/// <summary>How an account signs in: a password, linked provider accounts, and providers it could link.</summary>
public sealed record SignInMethods(bool Password, IReadOnlyList<IdentityView> Identities, IReadOnlyList<LinkOption> CanLink);

/// <summary>
/// What deleting your own account means on this server: how many days an admin can still restore it
/// (0: it goes at once), the proof it asks for (<c>password</c>, or <c>sign-in</c>: a sign-in in the
/// last <see cref="AccountEndpoints.FreshSignIn"/>, for an account without a password to type),
/// whether this session's sign-in is that recent, and why it cannot be done now, if it cannot
/// (<c>last_super_admin</c>, <c>not_while_impersonating</c>, <c>no_sign_in</c>).
/// </summary>
public sealed record AccountDeletion(int GraceDays, string Proof, bool SignedInRecently, string? Blocked);

/// <summary>Delete my account: the password, when the proof asked for is <c>password</c>.</summary>
public sealed record AccountDeletionRequest(string? Password);

/// <summary><c>/api/account</c>: the signed-in user's own sign-in methods (spec: Accounts &amp; Admin, Linking).</summary>
public static class AccountEndpoints
{
    /// <summary>A sign-in this recent proves it is the person, for an account with no password to type.</summary>
    public static readonly TimeSpan FreshSignIn = TimeSpan.FromMinutes(10);

    public const string ProofPassword = "password";
    public const string ProofSignIn = "sign-in";

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
        }).Doc<SignInMethods>("How you sign in: a password, linked provider accounts, and the providers you could link").Missing();

        // The person's own numbers, the same as on the admin's stats page (spec: Server stats).
        api.MapGet("/account/stats", async (ClaimsPrincipal user, Core.Stats.StatsService stats, CancellationToken cancellation) =>
            await stats.ForAsync(user.UserId(), cancellation) is { } mine ? Results.Ok(mine) : Results.NotFound())
            .Doc<Core.Stats.UserStats>("Your own numbers: tasks, lists, files and the space they take").Missing();

        api.MapDelete("/account/identities/{provider}/{subject}", async (
            string provider, string subject, ClaimsPrincipal user, ExternalSignIn signIn, HttpContext context, CancellationToken cancellation) =>
        {
            context.Audit().Detail = provider;
            return await signIn.UnlinkAsync(user.UserId(), provider, subject, selfService: true, cancellation) switch
            {
                UnlinkResult.Unlinked => Results.NoContent(),
                UnlinkResult.LastWayIn => Results.Conflict(new AdminError("last_way_in", "this is your only way to sign in")),
                _ => Results.NotFound(),
            };
        }).Doc("Unlink a provider account from yours").Refuses(StatusCodes.Status409Conflict).Missing()
            .Audited("account.identity-unlinked", targetRoute: null);

        // Delete my account (the Play account deletion policy): the same delete as an admin's, with its
        // grace period and restore, asked for by the person with fresh proof that it is them.
        api.MapGet("/account/delete", async (ClaimsPrincipal user, IAccountStore store, AccountService accounts, LiveSettings live,
            ServerSettings settings, TimeProvider time, CancellationToken cancellation) =>
        {
            if (await store.FindByIdAsync(user.UserId(), cancellation) is not { } account) return Results.NotFound();
            var blocked = settings.AuthMode == AuthMode.None ? "no_sign_in"
                : user.Impersonator() is not null ? "not_while_impersonating"
                : await accounts.IsLastSuperAdminAsync(account, cancellation) ? "last_super_admin"
                : null;
            return Results.Ok(new AccountDeletion(live.Current.AccountDeleteGraceDays, ProofFor(account, live), SignedInRecently(user, time), blocked));
        }).Doc<AccountDeletion>("What deleting your account means here: the days an admin can still restore it, and the proof it asks for").Missing();

        api.MapPost("/account/delete", async (AccountDeletionRequest request, ClaimsPrincipal user, IAccountStore store, AccountService accounts,
            AccountRemoval removal, LiveSettings live, ServerSettings settings, IMemoryCache cache, TimeProvider time, LoginAttempts attempts,
            HttpContext context, CancellationToken cancellation) =>
        {
            // With AUTH_MODE=none there is one account and no sign-in to leave by.
            if (settings.AuthMode == AuthMode.None) return Refuse(StatusCodes.Status403Forbidden, "no_sign_in", "this server has no sign-in");
            // An admin viewing as someone acts for them, but never deletes them this way.
            if (user.Impersonator() is not null) return Refuse(StatusCodes.Status403Forbidden, "not_while_impersonating", "stop viewing as them first");
            if (await store.FindByIdAsync(user.UserId(), cancellation) is not { DeletedAt: null } account) return Results.NotFound();
            context.Audit().On(account.Id, account.Username);
            if (ProofFor(account, live) == ProofPassword)
            {
                if (PasswordProof.TooMany(attempts, account.Username, context) is { } tooMany) return tooMany;
                switch (await accounts.ConfirmPasswordAsync(account, request.Password ?? "", cancellation))
                {
                    case PasswordCheck.Locked locked:
                        return PasswordProof.Locked(context, locked.Until, time);
                    case PasswordCheck.Wrong:
                        return Results.BadRequest(new AuthError("wrong_password"));
                }
            }
            else if (!SignedInRecently(user, time))
            {
                return Refuse(StatusCodes.Status403Forbidden, "sign_in_again", "sign in again, then delete within 10 minutes");
            }
            Account deleted;
            try
            {
                deleted = await accounts.DeleteAsync(account.Id, cancellation);
            }
            catch (LastSuperAdminException)
            {
                return Refuse(StatusCodes.Status409Conflict, "last_super_admin", "make someone else a super admin first");
            }
            // Every session and device signed in as them ends now (new stamp), this one too.
            AuthSetup.ForgetStamp(cache, account.Id);
            await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            var removedAt = removal.RemovedAt(deleted);
            if (live.Current.AccountDeleteGraceDays == 0)
            {
                // No grace period (a demo server, or ACCOUNT_DELETE_GRACE_DAYS=0): gone at once.
                await removal.RemoveNowAsync(account.Id, cancellation);
                context.Audit().Detail = "removed at once";
            }
            else
            {
                context.Audit().Detail = string.Create(CultureInfo.InvariantCulture, $"restorable until {removedAt:yyyy-MM-dd HH:mm} UTC");
            }
            return Results.Ok(new UserDeleted(removedAt));
        }).Doc<UserDeleted>("Delete your own account, with your password or a sign-in in the last 10 minutes: an admin can restore it until removedAt")
            .Refuses(StatusCodes.Status400BadRequest, StatusCodes.Status403Forbidden, StatusCodes.Status409Conflict, StatusCodes.Status423Locked).Missing()
            .RequireRateLimiting(AuthSetup.LoginRateLimit).Audited("account.deleted", targetRoute: null);

        return api;
    }

    /// <summary>
    /// The proof deleting an account asks for: its password while it has one that signs in, or else
    /// (provider and passkey accounts, LOCAL_LOGIN=disabled) a recent sign-in.
    /// </summary>
    private static string ProofFor(Account account, LiveSettings live) =>
        account.PasswordHash is not null && !live.Current.LocalLoginDisabled ? ProofPassword : ProofSignIn;

    /// <summary>
    /// Whether the person proved who they are within <see cref="FreshSignIn"/>: for a provider
    /// session, when the provider last checked (<see cref="AuthSetup.AuthTimeClaim"/>), if it says;
    /// otherwise when this session was signed in to (sliding renewals keep it). Never for a session
    /// whose sign-in time was only assumed.
    /// </summary>
    internal static bool SignedInRecently(ClaimsPrincipal user, TimeProvider time) =>
        user.FindFirst(AuthSetup.SinceAssumedClaim) is null
        && long.TryParse(user.FindFirstValue(AuthSetup.AuthTimeClaim) ?? user.FindFirstValue(AuthSetup.SinceClaim), NumberStyles.None, CultureInfo.InvariantCulture, out var seconds)
        && time.GetUtcNow() - DateTimeOffset.FromUnixTimeSeconds(seconds) <= FreshSignIn;

    private static IResult Refuse(int status, string error, string message) => Results.Json(new AdminError(error, message), statusCode: status);

    public static IdentityView View(LinkedIdentity identity, ServerSettings settings) => new(
        identity.Provider,
        settings.Provider(identity.Provider)?.DisplayName ?? identity.Provider,
        identity.Subject,
        identity.Email,
        identity.LinkedAt,
        identity.LastUsedAt,
        identity.Username);
}
