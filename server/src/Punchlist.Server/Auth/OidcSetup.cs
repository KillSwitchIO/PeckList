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

    /// <summary>Set on a challenge that links a provider account to the signed-in user instead of signing in.</summary>
    private const string LinkAccountItem = "punchlist.link_account";

    /// <summary>Where linking reports back: the settings page, with <c>?link=</c> saying how it went.</summary>
    private const string LinkReturn = "/settings";

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

        // Link a provider account to the signed-in user (their settings page).
        auth.MapGet("/oidc/{name}/link", (string name, ClaimsPrincipal user) =>
        {
            if (settings.OidcProviders.All(provider => provider.Name != name)) return Results.NotFound();
            var properties = new AuthenticationProperties { RedirectUri = LinkReturn };
            properties.Items[LinkAccountItem] = user.UserId();
            return Results.Challenge(properties, [Scheme(name)]);
        }).RequireAuthorization();

        // A one-time sign-in link from an admin.
        auth.MapGet("/link/{token}", async (string token, LoginLinks links, HttpContext context) =>
        {
            if (await links.RedeemAsync(token, context.RequestAborted) is not { } account) return Results.Redirect("/login?error=link_expired");
            await context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme,
                AuthSetup.Principal(account, CookieAuthenticationDefaults.AuthenticationScheme),
                new AuthenticationProperties { IsPersistent = true });
            return Results.Redirect(LinkReturn);
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
        if (context.Properties?.Items.TryGetValue(LinkAccountItem, out var linkTo) == true && linkTo is not null)
        {
            await LinkAsync(context, provider, identity, linkTo);
            return;
        }
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

    /// <summary>
    /// The link flow's return: only for the same person who started it (the session cookie still
    /// names them), so a forged callback cannot attach someone else's provider account.
    /// </summary>
    private static async Task LinkAsync(TicketReceivedContext context, OidcProviderSettings provider, ExternalIdentity identity, string accountId)
    {
        context.HandleResponse();
        // The callback runs before the session cookie is read for this request: read it here.
        var session = await context.HttpContext.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        var current = session.Principal;
        if (current?.Identity?.IsAuthenticated != true || current.UserId() != accountId)
        {
            context.Response.Redirect($"{LinkReturn}?link=failed");
            return;
        }
        var result = await context.HttpContext.RequestServices.GetRequiredService<ExternalSignIn>()
            .LinkAsync(provider, identity, accountId, context.HttpContext.RequestAborted);
        var outcome = result switch
        {
            LinkResult.Linked => "linked",
            LinkResult.Taken => "taken",
            _ => "not_allowed",
        };
        context.HttpContext.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("Punchlist.Oidc")
            .LogInformation("Linking {Provider} to {Account}: {Outcome}", provider.Name, accountId, outcome);
        context.Response.Redirect($"{LinkReturn}?link={outcome}");
    }

    private static void Redirect(TicketReceivedContext context, string error)
    {
        context.HandleResponse();
        context.Response.Redirect($"/login?error={error}");
    }
}
