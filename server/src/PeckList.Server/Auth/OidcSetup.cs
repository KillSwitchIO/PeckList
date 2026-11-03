using PeckList.Server.Audit;
using PeckList.Core.Audit;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using PeckList.Core.Accounts;
using PeckList.Core.Configuration;
using PeckList.Core.Sharing;

namespace PeckList.Server.Auth;

/// <summary><paramref name="Icon"/>: where the server serves the provider's icon (404 when it has none).</summary>
/// <summary>A sign-in button: <paramref name="Preset"/> names a provider with a button of its own (<c>google</c>).</summary>
public sealed record SignInProvider(string Name, string DisplayName, string Icon, string? Preset = null);

/// <summary><paramref name="Registration"/>: who may make an account here (<c>open</c>, <c>invite</c>, <c>closed</c>).</summary>
public sealed record SignInOptions(IReadOnlyList<SignInProvider> Providers, bool LocalLogin, string Registration = "closed");

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
    private const string LinkAccountItem = "pecklist.link_account";

    /// <summary>
    /// Set (with the app's URL scheme) on a link started from the Android app (AppSignIn): the
    /// browser tab has no session, the one-time code stood in for it, and the outcome goes back to
    /// the app. Only the server sets it; the state it travels in is encrypted.
    /// </summary>
    private const string AppLinkItem = "pecklist.app_link_scheme";

    /// <summary>On a session from a provider that ends its own session too: which provider (with the ID token kept).</summary>
    public const string ProviderItem = "pecklist.provider";

    /// <summary>On sessions a provider signed in: its name, for the provider badge on the avatar.</summary>
    public const string ProviderClaim = "pecklist:provider";

    /// <summary>The provider's picture of the person (its URL), for the app to bring in when they have no photo.</summary>
    public const string PictureClaim = "pecklist:picture";

    /// <summary>Set on a sign-in started from an invite link: a new provider account may come in on it.</summary>
    private const string InviteItem = "pecklist.invite";

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
                // The person's picture, for their profile until they set one (spec: R-FB-62).
                options.ClaimActions.MapUniqueJsonKey("picture", "picture");
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
                options.Events.OnTokenValidated = context =>
                {
                    // Kept only when signing out ends the provider session: the end-session request names it.
                    if (provider.SignOut
                        && (context.TokenEndpointResponse?.IdToken ?? context.ProtocolMessage?.IdToken) is { Length: > 0 } idToken)
                    {
                        context.Properties!.StoreTokens([new AuthenticationToken { Name = "id_token", Value = idToken }]);
                        context.Properties!.Items[ProviderItem] = provider.Name;
                    }
                    return Task.CompletedTask;
                };
                options.Events.OnTicketReceived = context => SignInAsync(context, provider);
                options.Events.OnRemoteFailure = context =>
                {
                    var note = context.HttpContext.Audit();
                    note.Type = "auth.oidc-sign-in";
                    note.Outcome = AuditOutcome.Failed;
                    note.Detail = $"{provider.Name}: {context.Failure?.Message}";
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
    public static string IconPath(string provider) => $"/auth/providers/{Uri.EscapeDataString(provider)}/icon";

    public static void MapOidc(this RouteGroupBuilder auth, ServerSettings settings)
    {
        auth.MapGet("/providers", (SelfSignUp signUp, LiveSettings live) => new SignInOptions(
            settings.OidcProviders.Select(provider => new SignInProvider(provider.Name, provider.DisplayName, IconPath(provider.Name), provider.Preset)).ToList(),
            !live.Current.LocalLoginDisabled,
            signUp.InvitesWork ? signUp.Policy.ToString().ToLowerInvariant() : "closed"));

        auth.MapGet("/providers/{name}/icon", async (string name, ProviderIcons icons, HttpContext context, CancellationToken cancellation) =>
        {
            if (await icons.GetAsync(name, cancellation) is not { } icon) return Results.NotFound();
            context.Response.Headers.CacheControl = "public, max-age=86400";
            context.Response.Headers.XContentTypeOptions = "nosniff";
            // An SVG icon may carry script: never let it run, even opened on its own.
            context.Response.Headers.ContentSecurityPolicy = "sandbox; default-src 'none'; style-src 'unsafe-inline'";
            return Results.File(icon.Bytes, icon.ContentType);
        });

        auth.MapGet("/oidc/{name}/login", (string name, string? returnUrl, string? invite) =>
        {
            if (settings.Provider(name) is null) return Results.NotFound();
            var properties = new AuthenticationProperties { RedirectUri = ReturnUrls.Safe(returnUrl), IsPersistent = true };
            if (!string.IsNullOrWhiteSpace(invite)) properties.Items[InviteItem] = invite.Trim();
            return Results.Challenge(properties, [Scheme(name)]);
        });

        // Link a provider account to the signed-in user (their settings page).
        auth.MapGet("/oidc/{name}/link", (string name, ClaimsPrincipal user) =>
        {
            if (settings.Provider(name) is null) return Results.NotFound();
            return Results.Challenge(LinkProperties(user.UserId(), appScheme: null), [Scheme(name)]);
        }).RequireAuthorization();

        // A one-time sign-in link from an admin.
        // It stays the way back in while LOCAL_LOGIN=disabled (pecklist admin login-link); then no
        // password is asked for, so a temporary one cannot stand in the way.
        auth.MapGet("/link/{token}", async (string token, LoginLinks links, LiveSettings live, HttpContext context) =>
        {
            if (await links.RedeemAsync(token, context.RequestAborted) is not { } account)
            {
                context.Audit().Outcome = AuditOutcome.Failed;
                return Results.Redirect("/login?error=link_expired");
            }
            context.Audit().Actor(account);
            var signedIn = live.Current.LocalLoginDisabled ? account with { MustChangePassword = false } : account;
            await context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme,
                AuthSetup.Principal(signedIn, CookieAuthenticationDefaults.AuthenticationScheme, AuthSetup.ByLink),
                new AuthenticationProperties { IsPersistent = true });
            return Results.Redirect(LinkReturn);
        }).Audited("auth.login-link-used", targetRoute: null);
    }

    /// <summary>A challenge that links the provider account to <paramref name="accountId"/>; from the app when <paramref name="appScheme"/> is set.</summary>
    public static AuthenticationProperties LinkProperties(string accountId, string? appScheme)
    {
        var properties = new AuthenticationProperties { RedirectUri = LinkReturn };
        properties.Items[LinkAccountItem] = accountId;
        if (appScheme is not null) properties.Items[AppLinkItem] = appScheme;
        return properties;
    }

    /// <summary>
    /// Where to send the browser to end the provider session as well (RP-initiated logout), for a
    /// session from a provider with <c>SIGN_OUT</c> on whose discovery names an end-session endpoint;
    /// else null. The provider sends the browser back to <c>/login</c>.
    /// </summary>
    public static async Task<string?> ProviderSignOutUrlAsync(HttpContext context, AuthenticationProperties? session)
    {
        if (session?.Items.TryGetValue(ProviderItem, out var name) != true || name is null) return null;
        var settings = context.RequestServices.GetRequiredService<ServerSettings>();
        if (settings.Provider(name) is not { SignOut: true } provider) return null;
        if (session.GetTokenValue("id_token") is not { Length: > 0 } idToken) return null;
        var options = context.RequestServices.GetRequiredService<Microsoft.Extensions.Options.IOptionsMonitor<OpenIdConnectOptions>>().Get(Scheme(name));
        try
        {
            var configuration = await options.ConfigurationManager!.GetConfigurationAsync(context.RequestAborted);
            if (string.IsNullOrEmpty(configuration.EndSessionEndpoint)) return null;
            return Microsoft.AspNetCore.WebUtilities.QueryHelpers.AddQueryString(configuration.EndSessionEndpoint, new Dictionary<string, string?>
            {
                ["id_token_hint"] = idToken,
                ["client_id"] = provider.ClientId,
                ["post_logout_redirect_uri"] = $"{ServerApp.Origin(context)}/login",
            });
        }
        catch (Exception error) when (error is HttpRequestException or InvalidOperationException or IOException)
        {
            // The provider cannot be reached: signing out of PeckList still works.
            context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("PeckList.Auth")
                .LogWarning("Could not end the {Provider} session: {Message}", name, error.Message);
            return null;
        }
    }

    private static async Task SignInAsync(TicketReceivedContext context, OidcProviderSettings provider)
    {
        var services = context.HttpContext.RequestServices;
        var note = context.HttpContext.Audit();
        note.Type = "auth.oidc-sign-in";
        note.Detail = provider.Name;
        note.Anonymous = true;
        var claims = context.Principal!;
        string? Claim(string type) => claims.FindFirst(type)?.Value is { Length: > 0 } value ? value : null;
        var subject = Claim("sub");
        if (subject is null)
        {
            Redirect(context, "oidc_failed");
            note.Outcome = AuditOutcome.Failed;
            note.Detail = $"{provider.Name}: no subject";
            return;
        }
        var identity = new ExternalIdentity
        {
            Subject = subject,
            Username = Claim(provider.UsernameClaim),
            DisplayName = Claim("name"),
            Email = Claim("email"),
            EmailVerified = string.Equals(Claim("email_verified"), "true", StringComparison.OrdinalIgnoreCase),
            Groups = claims.FindAll(provider.GroupsClaim).Select(claim => claim.Value).Distinct().ToList(),
        };
        note.On(null, identity.Username ?? subject);
        if (context.Properties?.Items.TryGetValue(LinkAccountItem, out var linkTo) == true && linkTo is not null)
        {
            note.Type = "auth.oidc-linked";
            note.Anonymous = false;
            await LinkAsync(context, provider, identity, linkTo);
            return;
        }
        var signIn = services.GetRequiredService<ExternalSignIn>();
        var result = await signIn.SignInAsync(provider, identity, context.HttpContext.RequestAborted);
        if (result is ExternalSignInResult.Pending
            && context.Properties?.Items.TryGetValue(InviteItem, out var invite) == true && invite is not null
            && services.GetRequiredService<SelfSignUp>().InvitesWork)
        {
            // Came from an invite link: the invite stands in for an admin's approval.
            var made = await services.GetRequiredService<SignupInvites>().UseAsync(invite,
                async () => await signIn.ApproveAsync(provider, subject, context.HttpContext.RequestAborted)
                    ?? throw new InvalidOperationException("the sign-in stopped waiting"),
                account => account.Id, context.HttpContext.RequestAborted);
            if (made is not null) result = new ExternalSignInResult.Success(made, Created: true, JoinedBy: "invite");
        }
        switch (result)
        {
            case ExternalSignInResult.Success success:
                if (success.Created)
                {
                    await services.GetRequiredService<Friends>().EnsureProfileAsync(
                        success.Account, identity.DisplayName, context.HttpContext.RequestAborted);
                }
                await services.GetRequiredService<ProviderPhoto>().ImportAsync(
                    success.Account.Id, Claim("picture"), context.HttpContext.RequestAborted);
                note.Actor(success.Account).On(null, null).Anonymous = false;
                // The provider's groups may have changed this person's server groups.
                await services.GetRequiredService<ServerGroupProjection>().ProjectAsync(context.HttpContext.RequestAborted);
                note.Outcome = AuditOutcome.Ok;
                if (success.Created) note.Detail = success.JoinedBy == "invite" ? $"{provider.Name}, new account from an invite" : $"{provider.Name}, new account";
                else if (success.JoinedBy == "remap") note.Detail = $"{provider.Name}, moved here from another account by a mapping";
                else if (success.JoinedBy is { } joined) note.Detail = $"{provider.Name}, joined the account by {joined}";
                // No password was used, so a temporary one an admin set does not stand in the way: the
                // account keeps the flag, and signing in with that password still asks for a new one.
                var principal = AuthSetup.Principal(
                    success.Account with { MustChangePassword = false }, CookieAuthenticationDefaults.AuthenticationScheme, AuthSetup.ByProvider);
                ((ClaimsIdentity)principal.Identity!).AddClaim(new Claim(ProviderClaim, provider.Name));
                if (Claim("picture") is { } pictureUrl) ((ClaimsIdentity)principal.Identity!).AddClaim(new Claim(PictureClaim, pictureUrl));
                context.Principal = principal;
                context.Properties!.IsPersistent = true;
                if (provider.SessionLength is { } length)
                {
                    // A fixed end, not sliding: then the person goes through the provider again, which
                    // re-checks the required groups and mappings (instant while their provider session lives).
                    var now = services.GetRequiredService<TimeProvider>().GetUtcNow();
                    context.Properties.IssuedUtc = now;
                    context.Properties.ExpiresUtc = now + length;
                    context.Properties.AllowRefresh = false;
                }
                break;
            case ExternalSignInResult.NotAllowed:
                note.Outcome = AuditOutcome.Denied;
                note.Detail = $"{provider.Name}: in none of the required groups";
                Redirect(context, "oidc_not_allowed");
                break;
            case ExternalSignInResult.Pending:
                note.Outcome = AuditOutcome.Pending;
                note.Detail = $"{provider.Name}: waits for an admin";
                Redirect(context, "oidc_pending");
                break;
            default:
                note.Outcome = AuditOutcome.Denied;
                note.Detail = $"{provider.Name}: account turned off";
                Redirect(context, "oidc_disabled");
                break;
        }
    }

    /// <summary>
    /// The link flow's return: only for the same person who started it (the session cookie still
    /// names them), so a forged callback cannot attach someone else's provider account. A link
    /// started from the app has no session in its browser tab; the one-time code that started it
    /// was issued to that account's own session instead (AppSignIn), and the outcome goes back to
    /// the app.
    /// </summary>
    private static async Task LinkAsync(TicketReceivedContext context, OidcProviderSettings provider, ExternalIdentity identity, string accountId)
    {
        context.HandleResponse();
        var appScheme = context.Properties?.Items.TryGetValue(AppLinkItem, out var scheme) == true ? scheme : null;
        string Back(string outcome) => appScheme is null ? $"{LinkReturn}?link={outcome}" : $"{appScheme}://link?result={outcome}";
        var note = context.HttpContext.Audit();
        if (appScheme is null)
        {
            // The callback runs before the session cookie is read for this request: read it here.
            var session = await context.HttpContext.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            var current = session.Principal;
            if (current?.Identity?.IsAuthenticated != true || current.UserId() != accountId)
            {
                note.Outcome = AuditOutcome.Denied;
                context.Response.Redirect(Back("failed"));
                return;
            }
            note.ActorId = current.UserId();
            note.ActorName = current.FindFirstValue(ClaimTypes.Name);
        }
        else
        {
            var account = await context.HttpContext.RequestServices.GetRequiredService<IAccountStore>()
                .FindByIdAsync(accountId, context.HttpContext.RequestAborted);
            if (account is null || account.Disabled)
            {
                note.Outcome = AuditOutcome.Denied;
                context.Response.Redirect(Back("failed"));
                return;
            }
            note.Actor(account);
        }
        var result = await context.HttpContext.RequestServices.GetRequiredService<ExternalSignIn>()
            .LinkAsync(provider, identity, accountId, context.HttpContext.RequestAborted);
        var outcome = result switch
        {
            LinkResult.Linked => "linked",
            LinkResult.Taken => "taken",
            _ => "not_allowed",
        };
        note.Outcome = result == LinkResult.Linked ? AuditOutcome.Ok : AuditOutcome.Refused;
        note.Detail = $"{provider.Name}: {outcome}";
        context.Response.Redirect(Back(outcome));
    }

    private static void Redirect(TicketReceivedContext context, string error)
    {
        context.HandleResponse();
        context.Response.Redirect($"/login?error={error}");
    }
}
