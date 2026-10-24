using System.Globalization;
using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Punchlist.Core.Accounts;
using Punchlist.Core.Audit;
using Punchlist.Core.Configuration;
using Punchlist.Server.Audit;

namespace Punchlist.Server.Auth;

/// <summary>
/// Signing in to the Android app with an identity provider (ADR-0017). The app cannot run the
/// provider in its WebView (passkeys do not work there, and some providers refuse embedded
/// browsers), so it opens <c>/auth/app/handoff</c> in a browser tab with a PKCE-style challenge.
/// The person signs in there if they are not already, then confirms on a page of ours; the browser
/// goes back to the app with a one-time code, and the app redeems it with the matching verifier in
/// its own WebView. The new session is a copy of the browser's, so a provider session still ends
/// when it should (<c>OIDC_&lt;NAME&gt;_SESSION_HOURS</c>).
/// <para>
/// The confirmation is the point: without it, any app on the phone could open the handoff in a
/// browser tab and quietly receive a session for whoever is signed in there.
/// </para>
/// </summary>
public static partial class AppSignIn
{
    public const string Kind = "app-handoff";
    public const string LinkKind = "app-link";
    public static readonly TimeSpan CodeLifetime = TimeSpan.FromMinutes(2);
    private const string Purpose = "punchlist.app-handoff.v1";

    /// <summary>PKCE S256: 32 bytes of SHA-256 as unpadded base64url.</summary>
    [GeneratedRegex("^[A-Za-z0-9_-]{43}$")]
    private static partial Regex ChallengePattern();

    /// <summary>A reverse-domain app scheme (<c>com.example.app</c>): never http, https or javascript.</summary>
    [GeneratedRegex("^[a-z][a-z0-9]*(\\.[a-z0-9_]+)+$")]
    private static partial Regex SchemePattern();

    private sealed record Handoff(string Challenge, DateTimeOffset Expires, string ReturnUrl, string Ticket);

    /// <summary>Linking a provider account from the app: who, with which provider, and where to report back.</summary>
    private sealed record LinkStart(string AccountId, string Provider, string Scheme, DateTimeOffset Expires);

    public sealed record LinkStartRequest(string? Provider, string? Scheme);

    /// <summary><paramref name="Url"/>: where the app's browser tab starts linking (a path on this server).</summary>
    public sealed record LinkStartResult(string Url);

    public static void MapAppSignIn(this RouteGroupBuilder auth, ServerSettings settings)
    {
        // Step 1, in the browser tab: sign in with the provider if needed, then ask to confirm.
        auth.MapGet("/app/handoff", async (string? provider, string? challenge, string? scheme, string? returnUrl, string? invite, HttpContext context) =>
        {
            if (!ValidRequest(challenge, scheme)) return Results.BadRequest(new AuthError("invalid_request"));
            var session = await context.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            if (session.Principal?.Identity?.IsAuthenticated != true)
            {
                if (provider is null || settings.OidcProviders.All(each => each.Name != provider)) return Results.NotFound();
                var here = context.Request.Path + context.Request.QueryString;
                var login = $"/auth/oidc/{Uri.EscapeDataString(provider)}/login?returnUrl={Uri.EscapeDataString(here)}";
                if (!string.IsNullOrWhiteSpace(invite)) login += $"&invite={Uri.EscapeDataString(invite)}";
                return Results.Redirect(login);
            }
            var user = session.Principal;
            Protect(context, scheme!);
            return Results.Content(ConfirmPage(user.FindFirstValue(ClaimTypes.Name) ?? "", challenge!, scheme!, SafeReturn(returnUrl)),
                "text/html; charset=utf-8");
        });

        // Step 2, the confirm button: a one-time code, and back to the app.
        auth.MapPost("/app/handoff", async (HttpContext context, ISecretStore secrets, IDataProtectionProvider protection, TimeProvider time) =>
        {
            var form = await context.Request.ReadFormAsync(context.RequestAborted);
            string challenge = form["challenge"].ToString(), scheme = form["scheme"].ToString();
            if (!ValidRequest(challenge, scheme) || !SameSite(context)) return Results.BadRequest(new AuthError("invalid_request"));
            var session = await context.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            if (session.Principal?.Identity?.IsAuthenticated != true || session.Ticket is null) return Results.Unauthorized();
            Note(context, session.Principal);

            var code = Base64Url(RandomNumberGenerator.GetBytes(32));
            var ticket = Convert.ToBase64String(TicketSerializer.Default.Serialize(session.Ticket));
            var handoff = new Handoff(challenge, time.GetUtcNow() + CodeLifetime, SafeReturn(form["returnUrl"].ToString()), ticket);
            var sealedValue = protection.CreateProtector(Purpose).Protect(JsonSerializer.Serialize(handoff));
            await secrets.PutAsync(Kind, Hash(code), sealedValue, context.RequestAborted);
            Protect(context, scheme);
            return Results.Redirect($"{scheme}://auth?code={code}");
        }).Audited("auth.app-handoff", targetRoute: null);

        // Step 3, in the app's WebView: the code and the verifier make a session there.
        auth.MapPost("/app/redeem", async (HttpContext context, ISecretStore secrets, IDataProtectionProvider protection, TimeProvider time) =>
        {
            var form = await context.Request.ReadFormAsync(context.RequestAborted);
            var handoff = await TakeAsync<Handoff>(secrets, protection, Kind, form["code"].ToString(), context.RequestAborted);
            var verifier = form["verifier"].ToString();
            if (handoff is null || handoff.Expires <= time.GetUtcNow() || verifier.Length < 43 || ChallengeOf(verifier) != handoff.Challenge)
            {
                context.Audit().Outcome = AuditOutcome.Failed;
                context.Audit().Anonymous = true;
                return Results.Redirect("/login?error=app_sign_in_failed");
            }
            var ticket = TicketSerializer.Default.Deserialize(Convert.FromBase64String(handoff.Ticket))!;
            Note(context, ticket.Principal);
            // A fresh issue time, the browser session's end: a provider session still ends on time.
            ticket.Properties.IssuedUtc = time.GetUtcNow();
            await context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, ticket.Principal, ticket.Properties);
            return Results.Redirect(handoff.ReturnUrl);
        }).Audited("auth.app-signed-in", targetRoute: null);

        // Linking a provider account from the app's Settings. The browser tab the provider runs in is
        // not signed in as the app is, so the app first asks, with its own session, for a one-time
        // code; the tab trades it for the provider's sign-in, marked (in the protected OIDC state) as
        // a link for that account, and OidcSetup sends the outcome back to <scheme>://link.
        auth.MapPost("/app/link-start", async (LinkStartRequest request, ClaimsPrincipal user, ISecretStore secrets,
            IDataProtectionProvider protection, TimeProvider time, HttpContext context) =>
        {
            if (request.Provider is not { } provider || settings.OidcProviders.All(each => each.Name != provider)) return Results.NotFound();
            if (request.Scheme is not { } scheme || !SchemePattern().IsMatch(scheme)) return Results.BadRequest(new AuthError("invalid_request"));
            var code = Base64Url(RandomNumberGenerator.GetBytes(32));
            var start = new LinkStart(user.UserId(), provider, scheme, time.GetUtcNow() + CodeLifetime);
            await secrets.PutAsync(LinkKind, Hash(code),
                protection.CreateProtector(Purpose).Protect(JsonSerializer.Serialize(start)), context.RequestAborted);
            return Results.Ok(new LinkStartResult($"/auth/app/link?code={code}"));
        }).RequireAuthorization();

        auth.MapGet("/app/link", async (string? code, ISecretStore secrets, IDataProtectionProvider protection, TimeProvider time, HttpContext context) =>
        {
            var start = await TakeAsync<LinkStart>(secrets, protection, LinkKind, code ?? "", context.RequestAborted);
            if (start is null || start.Expires <= time.GetUtcNow() || settings.OidcProviders.All(each => each.Name != start.Provider))
            {
                return Results.Content(
                    "<!doctype html><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\">" +
                    "<title>Link expired</title><p style=\"font:16px system-ui;padding:24px\">This link has expired. " +
                    "Close this tab and press Link again in the Punchlist app.</p>",
                    "text/html; charset=utf-8", statusCode: StatusCodes.Status400BadRequest);
            }
            return Results.Challenge(OidcSetup.LinkProperties(start.AccountId, start.Scheme), [OidcSetup.Scheme(start.Provider)]);
        });
    }

    /// <summary>What a code stands for, used up whatever happens next; null when unknown or used.</summary>
    private static async Task<T?> TakeAsync<T>(ISecretStore secrets, IDataProtectionProvider protection, string kind, string code, CancellationToken cancellation)
        where T : class
    {
        if (code.Length is 0 or > 100) return null;
        var key = Hash(code);
        var stored = (await secrets.ListAsync(kind, cancellation)).FirstOrDefault(each => each.Name == key).Value;
        if (string.IsNullOrEmpty(stored)) return null;
        await secrets.PutAsync(kind, key, "", cancellation);
        try
        {
            return JsonSerializer.Deserialize<T>(protection.CreateProtector(Purpose).Unprotect(stored));
        }
        catch (CryptographicException)
        {
            return null;
        }
    }

    private static void Note(HttpContext context, ClaimsPrincipal user)
    {
        var note = context.Audit();
        note.ActorId = user.UserId();
        note.ActorName = user.FindFirstValue(ClaimTypes.Name);
    }

    public static string ChallengeOf(string verifier) => Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));

    private static bool ValidRequest(string? challenge, string? scheme) =>
        challenge is not null && ChallengePattern().IsMatch(challenge) && scheme is not null && SchemePattern().IsMatch(scheme);

    /// <summary>The confirm button only works from our own page: no other site may press it.</summary>
    private static bool SameSite(HttpContext context)
    {
        var fetchSite = context.Request.Headers["Sec-Fetch-Site"].ToString();
        if (fetchSite.Length > 0 && fetchSite != "same-origin") return false;
        var origin = context.Request.Headers.Origin.ToString();
        return origin.Length == 0
            || string.Equals(origin, ServerApp.Origin(context), StringComparison.OrdinalIgnoreCase)
            || string.Equals(origin, $"{context.Request.Scheme}://{context.Request.Host}", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Only back into this app: a path, never another site.</summary>
    private static string SafeReturn(string? returnUrl) =>
        returnUrl is { Length: > 0 } && returnUrl.StartsWith('/') && !returnUrl.StartsWith("//", StringComparison.Ordinal)
            && !returnUrl.StartsWith("/\\", StringComparison.Ordinal)
            ? returnUrl
            : "/";

    /// <summary>Not framed (the button must not be clicked through another page), no script, and the form may only lead back to the app.</summary>
    private static void Protect(HttpContext context, string scheme)
    {
        var headers = context.Response.Headers;
        headers.ContentSecurityPolicy = $"default-src 'none'; style-src 'unsafe-inline'; form-action 'self' {scheme}:; frame-ancestors 'none'; base-uri 'none'";
        headers.XFrameOptions = "DENY";
        headers.CacheControl = "no-store";
        // Not no-referrer: under it Chrome sends "Origin: null" with the form, which SameSite refuses.
        headers["Referrer-Policy"] = "same-origin";
    }

    private static string ConfirmPage(string username, string challenge, string scheme, string returnUrl)
    {
        static string E(string text) => WebUtility.HtmlEncode(text);
        return string.Create(CultureInfo.InvariantCulture, $$"""
            <!doctype html>
            <html lang="en">
            <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>Open Punchlist</title>
            <style>
              :root { color-scheme: light dark; --bg: #FAFAF7; --card: #FFFFFF; --text: #1F2421; --muted: #5E6662; --line: #DADDD8; --accent: #4F8F87; --on-accent: #FFFFFF; }
              @media (prefers-color-scheme: dark) { :root { --bg: #151816; --card: #1D211F; --text: #E6E9E6; --muted: #A3ABA7; --line: #333A36; --accent: #7FBFB6; --on-accent: #0E1A18; } }
              body { margin: 0; min-height: 100dvh; display: grid; place-items: center; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; padding: 16px; box-sizing: border-box; }
              main { width: 100%; max-width: 380px; background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 28px 24px; box-sizing: border-box; }
              h1 { font-size: 1.375rem; margin: 0 0 4px; }
              p { color: var(--muted); margin: 0 0 24px; font-size: 0.875rem; }
              strong { color: var(--text); }
              button { width: 100%; border: 0; border-radius: 8px; padding: 12px 16px; font: inherit; font-weight: 600; background: var(--accent); color: var(--on-accent); cursor: pointer; }
            </style>
            </head>
            <body>
            <main>
              <h1>Open Punchlist on this device?</h1>
              <p>You are signed in as <strong>{{E(username)}}</strong>. Continue to sign in to the Punchlist app with this account. If you did not just ask for this, close this tab.</p>
              <form method="post" action="/auth/app/handoff">
                <input type="hidden" name="challenge" value="{{E(challenge)}}">
                <input type="hidden" name="scheme" value="{{E(scheme)}}">
                <input type="hidden" name="returnUrl" value="{{E(returnUrl)}}">
                <button type="submit">Continue</button>
              </form>
            </main>
            </body>
            </html>
            """);
    }

    private static string Hash(string code) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(code)));

    private static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
