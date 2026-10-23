using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Punchlist.Server.Tests;

/// <summary>
/// Just enough of an OIDC provider for the server's real sign-in flow: discovery, keys, and a token
/// endpoint handing out signed ID tokens. Plugged in as the OIDC handler's backchannel; the test
/// plays the browser at the authorize step with <see cref="Authorize"/>.
/// </summary>
public sealed class FakeOidcProvider : HttpMessageHandler
{
    public const string Authority = "https://id.test";
    public const string ClientId = "punchlist";

    private readonly RsaSecurityKey key = new(RSA.Create(2048)) { KeyId = "test-key" };
    private readonly Dictionary<string, (Dictionary<string, object> Claims, string Nonce)> codes = [];

    /// <summary>The <c>redirect_uri</c> the last code exchange sent (it must match the authorize request's).</summary>
    public string? LastTokenRedirectUri { get; private set; }

    /// <summary>The URL the server sends the browser back to, as if the person signed in as <paramref name="claims"/>.</summary>
    public string Authorize(Uri challenge, Dictionary<string, object> claims)
    {
        Assert.StartsWith($"{Authority}/authorize", challenge.ToString());
        var query = QueryHelpers.ParseQuery(challenge.Query);
        Assert.Equal("S256", query["code_challenge_method"].ToString());
        var code = Guid.NewGuid().ToString("N");
        codes[code] = (claims, query["nonce"].ToString());
        return $"{query["redirect_uri"]}?code={code}&state={Uri.EscapeDataString(query["state"].ToString())}";
    }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        switch (request.RequestUri!.AbsolutePath)
        {
            case "/.well-known/openid-configuration":
                return Json(new Dictionary<string, object>
                {
                    ["issuer"] = Authority,
                    ["authorization_endpoint"] = $"{Authority}/authorize",
                    ["token_endpoint"] = $"{Authority}/token",
                    ["end_session_endpoint"] = $"{Authority}/logout",
                    ["jwks_uri"] = $"{Authority}/jwks",
                    ["response_types_supported"] = new[] { "code" },
                    ["subject_types_supported"] = new[] { "public" },
                    ["id_token_signing_alg_values_supported"] = new[] { "RS256" },
                });
            case "/jwks":
                var parameters = key.Rsa.ExportParameters(false);
                return Json(new
                {
                    keys = new[]
                    {
                        new
                        {
                            kty = "RSA",
                            use = "sig",
                            alg = "RS256",
                            kid = key.KeyId,
                            n = Base64UrlEncoder.Encode(parameters.Modulus),
                            e = Base64UrlEncoder.Encode(parameters.Exponent),
                        },
                    },
                });
            case "/token":
                var form = QueryHelpers.ParseQuery(await request.Content!.ReadAsStringAsync(cancellationToken));
                LastTokenRedirectUri = form["redirect_uri"].ToString();
                if (!codes.Remove(form["code"].ToString(), out var grant)) return new HttpResponseMessage(HttpStatusCode.BadRequest);
                Assert.False(string.IsNullOrEmpty(form["code_verifier"]));
                var claims = new Dictionary<string, object>(grant.Claims) { ["nonce"] = grant.Nonce };
                var idToken = new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
                {
                    Issuer = Authority,
                    Audience = ClientId,
                    Claims = claims,
                    IssuedAt = DateTime.UtcNow,
                    Expires = DateTime.UtcNow.AddMinutes(5),
                    SigningCredentials = new SigningCredentials(key, SecurityAlgorithms.RsaSha256),
                });
                return Json(new { access_token = "access", token_type = "Bearer", expires_in = 300, id_token = idToken });
            default:
                return new HttpResponseMessage(HttpStatusCode.NotFound);
        }
    }

    private static HttpResponseMessage Json<T>(T body) => new(HttpStatusCode.OK) { Content = JsonContent.Create(body) };
}
