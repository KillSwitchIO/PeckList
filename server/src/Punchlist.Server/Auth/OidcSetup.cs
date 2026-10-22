using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Punchlist.Core.Accounts;
using Punchlist.Core.Configuration;
using Punchlist.Core.Sharing;

namespace Punchlist.Server.Auth;

public sealed record SignInProvider(string Name, string DisplayName);

public sealed record SignInOptions(IReadOnlyList<SignInProvider> Providers, bool LocalLogin);

/// <summary>
/// OIDC sign-in (spec: Accounts &amp; Admin, OIDC). The server runs the code flow with PKCE and keeps
/// the tokens (BFF); the browser only ever gets the usual session cookie. Each provider is its own
/// scheme, <c>oidc-&lt;name&gt;</c>, calling back to <c>/auth/oidc/&lt;name&gt;/callback</c>. The rules
/// (access check, accounts, mappings) are <see cref="ExternalSignIn"/>.
/// </summary>
public static class OidcSetup
{
    public static string Scheme(string provider) => $"oidc-{provider}";

    public static string CallbackPath(string provider) => $"/auth/oidc/{provider}/callback";

    public static IServiceCollection AddOidc(this IServiceCollection services, ServerSettings settings, AuthenticationBuilder authentication)
    {
        foreach (var provider in settings.OidcProviders)
        {
            authentication.AddOpenIdConnect(Scheme(provider.Name), provider.DisplayName, options =>
            {
                options.Authority = provider.Authority.ToString();
                options.ClientId = provider.ClientId;
                options.ClientSecret = provider.ClientSecret;
                options.ResponseType = OpenIdConnectResponseType.Code;
                options.UsePkce = true;
                // Query, not form_post: the state and nonce cookies can then stay SameSite=Lax, which
                // works over plain http on a home network.
                options.ResponseMode = OpenIdConnectResponseMode.Query;
                options.CallbackPath = CallbackPath(provider.Name);
                options.SignInScheme = CookieAuthenticationDefaults.AuthenticationScheme;
                options.RequireHttpsMetadata = provider.Authority.Scheme == Uri.UriSchemeHttps;
                options.SaveTokens = false;
                options.MapInboundClaims = false;
                options.GetClaimsFromUserInfoEndpoint = true;
                options.Scope.Clear();
                foreach (var scope in provider.Scopes) options.Scope.Add(scope);
                options.ClaimActions.MapJsonKey(provider.GroupsClaim, provider.GroupsClaim);
                options.ClaimActions.MapJsonKey(provider.UsernameClaim, provider.UsernameClaim);
                foreach (var cookie in new[] { options.CorrelationCookie, options.NonceCookie })
                {
                    cookie.SameSite = SameSiteMode.Lax;
                    cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
                }
                options.Events.OnRedirectToIdentityProvider = context =>
                {
                    // A fixed callback address when PUBLIC_URL is set, matching what the provider has on file.
                    if (settings.PublicUrl is { } publicUrl)
                    {
                        // The handler keeps this for the code exchange, which must send the same address.
                        context.ProtocolMessage.RedirectUri = publicUrl.ToString().TrimEnd('/') + CallbackPath(provider.Name);
                    }
                    return Task.CompletedTask;
                };
                options.Events.OnTicketReceived = context => SignInAsync(context, provider);
                options.Events.OnRemoteFailure = context =>
                {
                    context.HttpContext.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("Punchlist.Oidc")
                        .LogWarning("Sign-in with {Provider} failed: {Error}", provider.Name, context.Failure?.Message);
                    context.HandleResponse();
                    context.Response.Redirect("/login?error=oidc_failed");
                    return Task.CompletedTask;
                };
            });
        }
        return services;
    }

    /// <summary>
    /// <c>/auth/providers</c> (who can sign you in) and <c>/auth/oidc/&lt;name&gt;/login</c> (start).
    /// </summary>
    public static void MapOidc(this RouteGroupBuilder auth, ServerSettings settings)
    {
        auth.MapGet("/providers", () => new SignInOptions(
            settings.OidcProviders.Select(provider => new SignInProvider(provider.Name, provider.DisplayName)).ToList(),
            !settings.LocalLoginHidden));

        auth.MapGet("/oidc/{name}/login", (string name, string? returnUrl) =>
        {
            if (settings.OidcProviders.All(provider => provider.Name != name)) return Results.NotFound();
            // Only back into this app: a path, never another site.
            var back = returnUrl is { Length: > 0 } && returnUrl.StartsWith('/') && !returnUrl.StartsWith("//", StringComparison.Ordinal)
                && !returnUrl.StartsWith("/\\", StringComparison.Ordinal)
                ? returnUrl
                : "/";
            return Results.Challenge(new AuthenticationProperties { RedirectUri = back, IsPersistent = true }, [Scheme(name)]);
        });
    }

    private static async Task SignInAsync(TicketReceivedContext context, OidcProviderSettings provider)
    {
        var services = context.HttpContext.RequestServices;
        var logger = services.GetRequiredService<ILoggerFactory>().CreateLogger("Punchlist.Oidc");
        var claims = context.Principal!;
        string? Claim(string type) => claims.FindFirst(type)?.Value is { Length: > 0 } value ? value : null;
        var subject = Claim("sub");
        if (subject is null)
        {
            Redirect(context, "oidc_failed");
            logger.LogWarning("Sign-in with {Provider} sent no subject", provider.Name);
            return;
        }
        var identity = new ExternalIdentity
        {
            Subject = subject,
            Username = Claim(provider.UsernameClaim),
            DisplayName = Claim("name"),
            Email = Claim("email"),
            Groups = claims.FindAll(provider.GroupsClaim).Select(claim => claim.Value).Distinct().ToList(),
        };
        var result = await services.GetRequiredService<ExternalSignIn>().SignInAsync(provider, identity, context.HttpContext.RequestAborted);
        switch (result)
        {
            case ExternalSignInResult.Success success:
                if (success.Created)
                {
                    await services.GetRequiredService<Friends>().EnsureProfileAsync(
                        success.Account, identity.DisplayName, context.HttpContext.RequestAborted);
                }
                logger.LogInformation("{Username} signed in with {Provider}{Created}",
                    success.Account.Username, provider.Name, success.Created ? " (new account)" : "");
                context.Principal = AuthSetup.Principal(success.Account, CookieAuthenticationDefaults.AuthenticationScheme);
                context.Properties!.IsPersistent = true;
                break;
            case ExternalSignInResult.NotAllowed:
                logger.LogWarning("Sign-in with {Provider} refused for {Subject}: in none of the required groups", provider.Name, subject);
                Redirect(context, "oidc_not_allowed");
                break;
            case ExternalSignInResult.Pending:
                logger.LogInformation("Sign-in with {Provider} for {Subject} waits for an admin (auto-create is off)", provider.Name, subject);
                Redirect(context, "oidc_pending");
                break;
            default:
                Redirect(context, "oidc_disabled");
                break;
        }
    }

    private static void Redirect(TicketReceivedContext context, string error)
    {
        context.HandleResponse();
        context.Response.Redirect($"/login?error={error}");
    }
}
