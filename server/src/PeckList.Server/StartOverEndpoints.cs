using System.Globalization;
using System.Security.Claims;
using PeckList.Core.Accounts;
using PeckList.Core.Configuration;
using PeckList.Server.Audit;
using PeckList.Server.Auth;

namespace PeckList.Server;

/// <summary>
/// What starting over asks for here: the proof (<c>password</c>, or <c>sign-in</c>: a sign-in in
/// the last <see cref="AccountEndpoints.FreshSignIn"/>, for an account without a password to type),
/// whether this session's sign-in is that recent, and why it cannot be done now, if it cannot
/// (<c>not_while_impersonating</c>, <c>no_sign_in</c>).
/// </summary>
public sealed record StartOverInfo(string Proof, bool SignedInRecently, string? Blocked);

/// <summary>Start over: the password, when the proof asked for is <c>password</c>.</summary>
public sealed record StartOverRequest(string? Password);

/// <summary><c>/api/account/start-over</c> (spec: PL-147): erase your own data and keep your account.</summary>
public static class StartOverEndpoints
{
    public static RouteGroupBuilder MapStartOver(this RouteGroupBuilder api)
    {
        api.MapGet("/account/start-over", async (ClaimsPrincipal user, IAccountStore store, LiveSettings live, ServerSettings settings,
            TimeProvider time, CancellationToken cancellation) =>
        {
            if (await store.FindByIdAsync(user.UserId(), cancellation) is not { DeletedAt: null } account) return Results.NotFound();
            var blocked = settings.AuthMode == AuthMode.None ? "no_sign_in"
                : user.Impersonator() is not null ? "not_while_impersonating"
                : null;
            return Results.Ok(new StartOverInfo(AccountEndpoints.ProofFor(account, live), AccountEndpoints.SignedInRecently(user, time), blocked));
        }).Doc<StartOverInfo>("What starting over asks for here: the proof, and whether this sign-in is recent enough").Missing();

        // The same proof as Delete my account: the password, or a sign-in in the last 10 minutes.
        api.MapPost("/account/start-over", async (StartOverRequest request, ClaimsPrincipal user, IAccountStore store, AccountService accounts,
            StartOver startOver, LiveSettings live, ServerSettings settings, TimeProvider time, LoginAttempts attempts, HttpContext context,
            CancellationToken cancellation) =>
        {
            // With AUTH_MODE=none there is no sign-in to prove it is them (Settings > Your data still starts the device over).
            if (settings.AuthMode == AuthMode.None) return AccountEndpoints.Refuse(StatusCodes.Status403Forbidden, "no_sign_in", "this server has no sign-in");
            // An admin viewing as someone acts for them, but never erases their data this way.
            if (user.Impersonator() is not null)
            {
                return AccountEndpoints.Refuse(StatusCodes.Status403Forbidden, "not_while_impersonating", "stop viewing as them first");
            }
            if (await store.FindByIdAsync(user.UserId(), cancellation) is not { DeletedAt: null } account) return Results.NotFound();
            context.Audit().On(account.Id, account.Username);
            if (AccountEndpoints.ProofFor(account, live) == AccountEndpoints.ProofPassword)
            {
                // Wrong ones count toward the sign-in lockout, as for Delete my account.
                if (PasswordProof.TooMany(attempts, account.Username, context) is { } tooMany) return tooMany;
                switch (await accounts.ConfirmPasswordAsync(account, request.Password ?? "", cancellation))
                {
                    case PasswordCheck.Locked locked:
                        return PasswordProof.Locked(context, locked.Until, time);
                    case PasswordCheck.Wrong:
                        return Results.BadRequest(new AuthError("wrong_password"));
                }
            }
            else if (!AccountEndpoints.SignedInRecently(user, time))
            {
                return AccountEndpoints.Refuse(StatusCodes.Status403Forbidden, "sign_in_again", "sign in again, then start over within 10 minutes");
            }
            var done = await startOver.RunAsync(account, cancellation);
            context.Audit().Detail = string.Create(CultureInfo.InvariantCulture, $"{done.Erased} things erased, {done.HandedOn} shared lists handed on");
            return Results.Ok(done);
        }).Doc<StartedOver>("Start over: erase your own tasks, lists, tags and comments and keep your account, with your password or a sign-in in the last 10 minutes")
            .Refuses(StatusCodes.Status400BadRequest, StatusCodes.Status403Forbidden, StatusCodes.Status423Locked).Missing()
            .RequireRateLimiting(AuthSetup.LoginRateLimit).Audited("account.started-over", targetRoute: null);

        return api;
    }
}
