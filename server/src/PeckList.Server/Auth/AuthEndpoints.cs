using PeckList.Server.Audit;
using PeckList.Core.Audit;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.Extensions.Caching.Memory;
using PeckList.Core.Accounts;
using PeckList.Core.Configuration;

namespace PeckList.Server.Auth;

/// <summary>
/// <paramref name="Provider"/>: the identity provider this session came through, if any.
/// <paramref name="LocalLogin"/>: whether passwords work on this server (<c>LOCAL_LOGIN</c>).
/// </summary>
public sealed record Me(
    string Id, string Username, string Role, bool MustChangePassword, string AuthMode, ViewingAs? Impersonation = null, string? Provider = null,
    bool HasProviderPicture = false, bool LocalLogin = true);

/// <summary>Set while a super admin views the app as this user: who, why, until when.</summary>
public sealed record ViewingAs(string By, string Reason, DateTimeOffset Until);

public sealed record LoginRequest(string Username, string Password);

public sealed record PasswordRequest(string Current, string Next);

public sealed record AuthError(string Error, DateTimeOffset? Until = null);

/// <summary>After signing out: the provider's end-session address, to end that session too.</summary>
public sealed record SignOutResult(string Redirect);

public sealed record SignUpRequest(string? Username, string? Password, string? Invite);

/// <summary>An invite link that still works: until when.</summary>
public sealed record InviteCheck(DateTimeOffset Expires);

/// <summary><c>/auth</c>: who am I, log in, log out, change password.</summary>
public static class AuthEndpoints
{
    public static void MapAuth(this WebApplication app)
    {
        var settings = app.Services.GetRequiredService<ServerSettings>();
        var mode = settings.AuthMode.ToString().ToLowerInvariant();
        var auth = app.MapGroup("/auth");

        auth.MapGet("/me", (ClaimsPrincipal user, LiveSettings live) =>
            Results.Ok(MeOf(user, mode) with { LocalLogin = !live.Current.LocalLoginDisabled })).RequireAuthorization();
        auth.MapOidc(settings);
        auth.MapImpersonation();
        // A gate in front of the server is there whatever PeckList's own sign-in is.
        auth.MapAppGate();

        if (settings.AuthMode == AuthMode.None)
        {
            // Nothing to log in to.
            auth.MapPost("/login", () => Results.BadRequest(new AuthError("auth_disabled")));
            return;
        }

        auth.MapAppSignIn(settings);

        auth.MapPost("/login", async (LoginRequest request, AccountService accounts, LiveSettings live, LoginAttempts attempts, TimeProvider time, HttpContext context) =>
        {
            context.Audit().On(null, Typed(request.Username)).Anonymous = true;
            // LOCAL_LOGIN=disabled: no password is checked at all, so nothing can be guessed here.
            if (live.Current.LocalLoginDisabled) return LocalLoginDisabled(context);
            // Ten tries a minute per account name too, whatever address they claim (audit S6).
            if (!attempts.TryTake(request.Username, out var wait))
            {
                AuthSetup.RetryAfter(context.Response, wait);
                return Results.StatusCode(StatusCodes.Status429TooManyRequests);
            }
            switch (await accounts.LoginAsync(request.Username ?? "", request.Password ?? "", context.RequestAborted))
            {
                case LoginResult.Success success:
                    context.Audit().Actor(success.Account).On(null, null).Anonymous = false;
                    return await SignedInAsync(context, success.Account, mode);
                case LoginResult.Locked locked:
                    AuthSetup.RetryAfter(context.Response, locked.Until - time.GetUtcNow());
                    return Results.Json(new AuthError("locked", locked.Until), statusCode: StatusCodes.Status423Locked);
                default:
                    return Results.Json(new AuthError("invalid"), statusCode: StatusCodes.Status401Unauthorized);
            }
        }).RequireRateLimiting(AuthSetup.LoginRateLimit).Audited("auth.sign-in", targetRoute: null);

        // Self sign-up (spec: Registration): open to anyone, or with an invite link.
        auth.MapGet("/invites/{token}", async (string token, SelfSignUp signUp, SignupInvites invites, CancellationToken cancellation) =>
            signUp.InvitesWork && await invites.FindAsync(token, cancellation) is { } invite
                ? Results.Ok(new InviteCheck(invite.Expires))
                : Results.NotFound(new AuthError("invite_invalid")))
            .RequireRateLimiting(AuthSetup.LoginRateLimit);

        auth.MapPost("/signup", async (SignUpRequest request, SelfSignUp signUp, SignUpThrottle throttle, HttpContext context) =>
        {
            context.Audit().On(null, Typed(request.Username)).Anonymous = true;
            var hasInvite = !string.IsNullOrWhiteSpace(request.Invite);
            context.Audit().Detail = hasInvite ? "with an invite" : "open sign-up";
            var address = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
            if (!throttle.Allows(address))
            {
                context.Audit().Detail = "too many accounts from one address";
                return Results.Json(new AuthError("signup_limited"), statusCode: StatusCodes.Status429TooManyRequests);
            }
            var result = await signUp.SignUpAsync(request.Username ?? "", request.Password ?? "", request.Invite, context.RequestAborted);
            if (result is not SignUpResult.Success success)
            {
                var refused = (SignUpResult.Refused)result;
                var status = refused.Error switch
                {
                    "registration_closed" or "invite_required" or "local_login_disabled" => StatusCodes.Status403Forbidden,
                    "username_taken" => StatusCodes.Status409Conflict,
                    _ => StatusCodes.Status400BadRequest,
                };
                return Results.Json(new AuthError(refused.Error), statusCode: status);
            }
            throttle.Record(address);
            context.Audit().Actor(success.Account).On(success.Account.Id, success.Account.Username).Anonymous = false;
            return await SignedInAsync(context, success.Account, mode);
        }).RequireRateLimiting(AuthSetup.LoginRateLimit).Audited("auth.signed-up", targetRoute: null);

        // A session from a provider that ends its own session too: the answer says where to go next.
        auth.MapPost("/logout", async (HttpContext context) =>
        {
            var session = await context.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            var next = await OidcSetup.ProviderSignOutUrlAsync(context, session.Properties);
            await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            if (next is null) return Results.NoContent();
            context.Audit().Detail = $"and from {session.Properties!.Items[OidcSetup.ProviderItem]}";
            return Results.Ok(new SignOutResult(next));
        }).Audited("auth.sign-out", targetRoute: null);

        auth.MapPost("/password", async (PasswordRequest request, ClaimsPrincipal user, AccountService accounts, IMemoryCache cache, LiveSettings live, HttpContext context) =>
        {
            // Passwords are not used while LOCAL_LOGIN=disabled; none is checked or set.
            if (live.Current.LocalLoginDisabled) return LocalLoginDisabled(context);
            var (result, account) = await accounts.ChangePasswordAsync(user.UserId(), request.Current ?? "", request.Next ?? "", context.RequestAborted);
            if (result != PasswordChange.Changed)
            {
                var error = result switch
                {
                    PasswordChange.WrongPassword => "wrong_password",
                    PasswordChange.TooShort => "too_short",
                    PasswordChange.TooLong => "too_long",
                    PasswordChange.DemoAccount => "demo_account",
                    _ => "unchanged",
                };
                return Results.BadRequest(new AuthError(error));
            }
            // Other sessions end (new stamp); this one gets a fresh cookie.
            AuthSetup.ForgetStamp(cache, account!.Id);
            return await SignedInAsync(context, account, mode);
        }).RequireAuthorization().RequireRateLimiting(AuthSetup.LoginRateLimit).Audited("auth.password-changed", targetRoute: null);

        // Forgot password, reset links and email confirmation (PL-122).
        auth.MapEmailAuth();
        // Passkeys (PL-123).
        auth.MapPasskeyAuth(mode);
    }

    /// <summary>A lasting password session for the account, and who they are now.</summary>
    private static async Task<IResult> SignedInAsync(HttpContext context, Account account, string mode)
    {
        var principal = AuthSetup.Principal(account, CookieAuthenticationDefaults.AuthenticationScheme, AuthSetup.ByPassword);
        await context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, principal, new AuthenticationProperties { IsPersistent = true });
        return Results.Ok(MeOf(principal, mode));
    }

    /// <summary>The username someone typed, for the log: trimmed, at most 100 characters.</summary>
    private static string Typed(string? username)
    {
        return Core.SafeText.Cut((username ?? "").Trim(), 100);
    }

    /// <summary>403 <c>local_login_disabled</c>: passwords are turned off (<c>LOCAL_LOGIN=disabled</c>).</summary>
    private static IResult LocalLoginDisabled(HttpContext context)
    {
        context.Audit().Outcome = AuditOutcome.Refused;
        context.Audit().Detail = "password sign-in is disabled";
        return Results.Json(new AuthError("local_login_disabled"), statusCode: StatusCodes.Status403Forbidden);
    }

    /// <summary>
    /// For the API: signed in, and not holding a password that must be changed first (the generated
    /// admin password, a reset one).
    /// </summary>
    public static RouteGroupBuilder RequirePasswordChanged(this RouteGroupBuilder group) =>
        group.AddEndpointFilter(async (context, next) =>
            context.HttpContext.User.MustChangePassword()
                ? Results.Json(new AuthError("password_change_required"), statusCode: StatusCodes.Status403Forbidden)
                : await next(context));

    internal static Me MeOf(ClaimsPrincipal user, string mode) => new(
        user.UserId(),
        user.FindFirstValue(ClaimTypes.Name) ?? "",
        user.FindFirstValue(ClaimTypes.Role) ?? "user",
        user.MustChangePassword(),
        mode,
        user.Impersonator() is { } by
            ? new ViewingAs(by, user.FindFirstValue(ImpersonationSetup.ReasonClaim) ?? "",
                DateTimeOffset.Parse(user.FindFirstValue(ImpersonationSetup.UntilClaim)!, System.Globalization.CultureInfo.InvariantCulture))
            : null,
        user.FindFirstValue(OidcSetup.ProviderClaim),
        user.FindFirstValue(OidcSetup.PictureClaim) is not null);
}
