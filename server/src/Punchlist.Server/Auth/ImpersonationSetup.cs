using System.Security.Claims;
using Microsoft.AspNetCore.Authentication.Cookies;
using Punchlist.Core.Accounts;

namespace Punchlist.Server.Auth;

public sealed record ImpersonationStart(string Token, DateTimeOffset Expires);

public sealed record ImpersonationRequest(string? Reason);

/// <summary>
/// Impersonation on the wire (spec: Account management). A request with the
/// <c>X-Punchlist-Impersonate</c> header from the super admin who started it runs as the user. It
/// may only sync and look people up; everything else is refused, and the admin's session cookie is
/// never touched, so their other tabs stay theirs.
/// </summary>
public static class ImpersonationSetup
{
    public const string Header = "X-Punchlist-Impersonate";
    public const string ByClaim = "impersonator";
    public const string ByNameClaim = "impersonator_name";
    public const string ReasonClaim = "impersonation_reason";
    public const string UntilClaim = "impersonation_until";

    /// <summary>Paths an impersonated request may reach: the app's data and who's who, nothing about accounts.</summary>
    private static readonly string[] Allowed = ["/api/sync", "/api/friends", "/api/users/lookup", "/api/info", "/auth/me", "/auth/impersonation"];

    public static IApplicationBuilder UseImpersonation(this IApplicationBuilder app) =>
        app.Use(async (context, next) =>
        {
            if (context.Request.Headers[Header].FirstOrDefault() is not { Length: > 0 } token)
            {
                await next(context);
                return;
            }
            var services = context.RequestServices;
            var view = await services.GetRequiredService<Impersonations>().FindAsync(token, context.RequestAborted);
            var admin = context.User;
            var target = view is null ? null : await services.GetRequiredService<IAccountStore>().FindByIdAsync(view.TargetId, context.RequestAborted);
            if (view is null || admin.Identity?.IsAuthenticated != true || admin.UserId() != view.AdminId
                || !admin.AccountRole().Can(Permission.Impersonate) || target is null || target.Disabled || target.Role == Role.SuperAdmin)
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                await context.Response.WriteAsJsonAsync(new AuthError("impersonation_ended"));
                return;
            }
            if (!Allowed.Any(path => context.Request.Path.StartsWithSegments(path)))
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                await context.Response.WriteAsJsonAsync(new AuthError("not_while_impersonating"));
                return;
            }
            var principal = AuthSetup.Principal(target with { MustChangePassword = false }, CookieAuthenticationDefaults.AuthenticationScheme);
            ((ClaimsIdentity)principal.Identity!).AddClaims(
            [
                new Claim(ByClaim, view.AdminId),
                new Claim(ByNameClaim, admin.FindFirstValue(ClaimTypes.Name) ?? ""),
                new Claim(ReasonClaim, view.Reason),
                new Claim(UntilClaim, view.Expires.ToString("O", System.Globalization.CultureInfo.InvariantCulture)),
            ]);
            context.User = principal;
            await next(context);
        });

    /// <summary>Who is really behind a request, when it is an impersonation.</summary>
    public static string? Impersonator(this ClaimsPrincipal user) => user.FindFirstValue(ByNameClaim);

    /// <summary><c>DELETE /auth/impersonation</c>: end the one this tab holds.</summary>
    public static void MapImpersonation(this RouteGroupBuilder auth) =>
        auth.MapDelete("/impersonation", async (HttpContext context, Impersonations impersonations, ILoggerFactory logs) =>
        {
            if (context.Request.Headers[Header].FirstOrDefault() is { Length: > 0 } token)
            {
                await impersonations.EndAsync(token, context.RequestAborted);
                logs.CreateLogger("Punchlist.Impersonation").LogWarning(
                    "{Admin} stopped viewing as {User}", context.User.Impersonator(), context.User.FindFirstValue(ClaimTypes.Name));
            }
            return Results.NoContent();
        });
}
