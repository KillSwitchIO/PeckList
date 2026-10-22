using Punchlist.Server.Audit;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.Extensions.Caching.Memory;
using Punchlist.Core.Accounts;
using Punchlist.Core.Configuration;

namespace Punchlist.Server.Auth;

public sealed record Me(string Id, string Username, string Role, bool MustChangePassword, string AuthMode, ViewingAs? Impersonation = null);

/// <summary>Set while a super admin views the app as this user: who, why, until when.</summary>
public sealed record ViewingAs(string By, string Reason, DateTimeOffset Until);

public sealed record LoginRequest(string Username, string Password);

public sealed record PasswordRequest(string Current, string Next);

public sealed record AuthError(string Error, DateTimeOffset? Until = null);

/// <summary><c>/auth</c>: who am I, log in, log out, change password.</summary>
public static class AuthEndpoints
{
    public static void MapAuth(this WebApplication app)
    {
        var settings = app.Services.GetRequiredService<ServerSettings>();
        var mode = settings.AuthMode.ToString().ToLowerInvariant();
        var auth = app.MapGroup("/auth");

        auth.MapGet("/me", (ClaimsPrincipal user) => Results.Ok(MeOf(user, mode))).RequireAuthorization();
        auth.MapOidc(settings);
        auth.MapImpersonation();

        if (settings.AuthMode == AuthMode.None)
        {
            // Nothing to log in to.
            auth.MapPost("/login", () => Results.BadRequest(new AuthError("auth_disabled")));
            return;
        }

        auth.MapPost("/login", async (LoginRequest request, AccountService accounts, HttpContext context) =>
        {
            var tried = (request.Username ?? "").Trim();
            context.Audit().On(null, tried.Length > 100 ? tried[..100] : tried).Anonymous = true;
            switch (await accounts.LoginAsync(request.Username ?? "", request.Password ?? "", context.RequestAborted))
            {
                case LoginResult.Success success:
                    context.Audit().Actor(success.Account).On(null, null).Anonymous = false;
                    var principal = AuthSetup.Principal(success.Account, CookieAuthenticationDefaults.AuthenticationScheme);
                    await context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, principal,
                        new AuthenticationProperties { IsPersistent = true });
                    return Results.Ok(MeOf(principal, mode));
                case LoginResult.Locked locked:
                    return Results.Json(new AuthError("locked", locked.Until), statusCode: StatusCodes.Status423Locked);
                default:
                    return Results.Json(new AuthError("invalid"), statusCode: StatusCodes.Status401Unauthorized);
            }
        }).RequireRateLimiting(AuthSetup.LoginRateLimit).Audited("auth.sign-in", targetRoute: null);

        auth.MapPost("/logout", async (HttpContext context) =>
        {
            await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Results.NoContent();
        }).Audited("auth.sign-out", targetRoute: null);

        auth.MapPost("/password", async (PasswordRequest request, ClaimsPrincipal user, AccountService accounts, IMemoryCache cache, HttpContext context) =>
        {
            var (result, account) = await accounts.ChangePasswordAsync(user.UserId(), request.Current ?? "", request.Next ?? "", context.RequestAborted);
            if (result != PasswordChange.Changed)
            {
                var error = result switch
                {
                    PasswordChange.WrongPassword => "wrong_password",
                    PasswordChange.TooShort => "too_short",
                    _ => "unchanged",
                };
                return Results.BadRequest(new AuthError(error));
            }
            // Other sessions end (new stamp); this one gets a fresh cookie.
            AuthSetup.ForgetStamp(cache, account!.Id);
            var principal = AuthSetup.Principal(account, CookieAuthenticationDefaults.AuthenticationScheme);
            await context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, principal,
                new AuthenticationProperties { IsPersistent = true });
            return Results.Ok(MeOf(principal, mode));
        }).RequireAuthorization().RequireRateLimiting(AuthSetup.LoginRateLimit).Audited("auth.password-changed", targetRoute: null);
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

    private static Me MeOf(ClaimsPrincipal user, string mode) => new(
        user.UserId(),
        user.FindFirstValue(ClaimTypes.Name) ?? "",
        user.FindFirstValue(ClaimTypes.Role) ?? "user",
        user.MustChangePassword(),
        mode,
        user.Impersonator() is { } by
            ? new ViewingAs(by, user.FindFirstValue(ImpersonationSetup.ReasonClaim) ?? "",
                DateTimeOffset.Parse(user.FindFirstValue(ImpersonationSetup.UntilClaim)!, System.Globalization.CultureInfo.InvariantCulture))
            : null);
}
