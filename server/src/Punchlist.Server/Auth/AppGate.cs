using System.Globalization;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Punchlist.Server.Auth;

/// <summary>
/// Getting the Android app past a sign-in page in front of the server (Pangolin, Cloudflare
/// Access, Authelia, Authentik and the like). Such a gate signs the browser in with a cookie on
/// this server's address; the app's WebView never gets it, and the gate's own sign-in (a passkey,
/// often) does not work inside the WebView. So the app opens <c>/auth/app/gate</c> in a browser tab
/// with a public key it just made. The person passes the gate there; the request then reaches us
/// carrying the gate's cookies, and after a confirm, as for app sign-in, we send them back to the
/// app encrypted to that key (RSA-OAEP-SHA256 around AES-256-GCM), for its WebView to use.
/// <para>
/// Only cookies that are not Punchlist's own go: the gate's. They were sent to this server by this
/// browser anyway; the confirm keeps another app from collecting them unasked.
/// </para>
/// </summary>
public static partial class AppSignIn
{
    /// <summary>A 2048- to 4096-bit RSA public key as SubjectPublicKeyInfo, base64url: about 400 to 750 characters.</summary>
    private const int MaxKeyLength = 1000;

    public static void MapAppGate(this RouteGroupBuilder auth)
    {
        auth.MapGet("/app/gate", (string? key, string? scheme, HttpContext context) =>
        {
            if (PublicKeyOf(key) is null || scheme is null || !SchemePattern().IsMatch(scheme)) return Results.BadRequest(new AuthError("invalid_request"));
            Protect(context, scheme);
            return Results.Content(GatePage(key!, scheme), "text/html; charset=utf-8");
        });

        auth.MapPost("/app/gate", async (HttpContext context) =>
        {
            var form = await context.Request.ReadFormAsync(context.RequestAborted);
            var key = form["key"].ToString();
            var scheme = form["scheme"].ToString();
            using var rsa = PublicKeyOf(key);
            if (rsa is null || !SchemePattern().IsMatch(scheme) || !SameSite(context)) return Results.BadRequest(new AuthError("invalid_request"));
            var cookies = context.Request.Cookies
                .Where(each => !OwnCookie(each.Key))
                .Select(each => new GateCookie(each.Key, each.Value))
                .ToList();
            var sealedCookies = Seal(rsa, JsonSerializer.SerializeToUtf8Bytes(cookies));
            return Results.Redirect($"{scheme}://gate?data={sealedCookies}");
        });
    }

    private sealed record GateCookie(string Name, string Value);

    /// <summary>Ours: the session and the sign-in flow's own (correlation, nonce).</summary>
    private static bool OwnCookie(string name) =>
        name.StartsWith("punchlist", StringComparison.OrdinalIgnoreCase)
        || name.StartsWith(".AspNetCore.", StringComparison.OrdinalIgnoreCase);

    private static RSA? PublicKeyOf(string? key)
    {
        if (key is not { Length: > 0 and <= MaxKeyLength }) return null;
        try
        {
            var bytes = Convert.FromBase64String(key.Replace('-', '+').Replace('_', '/').PadRight(key.Length + (4 - key.Length % 4) % 4, '='));
            var rsa = RSA.Create();
            rsa.ImportSubjectPublicKeyInfo(bytes, out _);
            if (rsa.KeySize is >= 2048 and <= 4096) return rsa;
            rsa.Dispose();
            return null;
        }
        catch (Exception error) when (error is FormatException or CryptographicException)
        {
            return null;
        }
    }

    /// <summary>RSA-OAEP-SHA256(AES key) | 12-byte nonce | AES-256-GCM ciphertext | 16-byte tag, base64url.</summary>
    public static string Seal(RSA publicKey, byte[] plaintext)
    {
        var aesKey = RandomNumberGenerator.GetBytes(32);
        var nonce = RandomNumberGenerator.GetBytes(12);
        var ciphertext = new byte[plaintext.Length];
        var tag = new byte[16];
        using (var aes = new AesGcm(aesKey, tag.Length)) aes.Encrypt(nonce, plaintext, ciphertext, tag);
        var wrapped = publicKey.Encrypt(aesKey, RSAEncryptionPadding.OaepSHA256);
        return Base64Url([.. wrapped, .. nonce, .. ciphertext, .. tag]);
    }

    private static string GatePage(string key, string scheme)
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
              button { width: 100%; border: 0; border-radius: 8px; padding: 12px 16px; font: inherit; font-weight: 600; background: var(--accent); color: var(--on-accent); cursor: pointer; }
            </style>
            </head>
            <body>
            <main>
              <h1>Let the Punchlist app in?</h1>
              <p>You got past this server's sign-in page. Continue to let the Punchlist app on this device past it too. If you did not just ask for this in the app, close this tab.</p>
              <form method="post" action="/auth/app/gate">
                <input type="hidden" name="key" value="{{E(key)}}">
                <input type="hidden" name="scheme" value="{{E(scheme)}}">
                <button type="submit">Continue</button>
              </form>
            </main>
            </body>
            </html>
            """);
    }
}
