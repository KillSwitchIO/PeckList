using System.Globalization;
using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using PeckList.Core.Calendars;

namespace PeckList.Google;

/// <summary>
/// Google's OAuth endpoints (spec: PL-134, Tokens stay home): the sign-in address, swapping the code
/// for tokens, refreshing, and revoking. Each server does these itself with the client that signed
/// the person in; nothing passes through pecklist.com after the code.
/// </summary>
public sealed class GoogleOAuth(HttpClient http, TimeProvider time, GoogleAddresses? addresses = null)
{
    /// <summary>How long before an access token's end it is refreshed, so a call never starts with one about to lapse.</summary>
    public static readonly TimeSpan RefreshMargin = TimeSpan.FromMinutes(2);

    private readonly GoogleAddresses at = addresses ?? GoogleAddresses.Google;

    /// <summary>
    /// Where the browser goes to sign in: offline access with consent asked every time (so a refresh
    /// token always comes back, a reconnect included), the three scopes, PKCE S256 and the state.
    /// </summary>
    public Uri AuthorizeUrl(GoogleClient client, string redirectUri, string state, string codeChallenge) =>
        new(at.Authorize + "?" + Form(
            ("client_id", client.Id),
            ("redirect_uri", redirectUri),
            ("response_type", "code"),
            ("scope", GoogleScopes.All),
            ("access_type", "offline"),
            ("prompt", "consent"),
            ("code_challenge", codeChallenge),
            ("code_challenge_method", "S256"),
            ("state", state)));

    /// <summary>
    /// The code from the sign-in swapped for tokens, with the PKCE verifier only this server holds.
    /// Throws <see cref="CalendarProblem"/>: <see cref="CalendarProblemKind.Auth"/> when Google
    /// refuses the code (used, expired, or the verifier does not match).
    /// </summary>
    public async Task<GoogleToken> ExchangeAsync(GoogleClient client, string code, string redirectUri, string verifier, CancellationToken cancellation)
    {
        var answer = await TokenAsync(client, [("grant_type", "authorization_code"), ("code", code), ("redirect_uri", redirectUri), ("code_verifier", verifier)], cancellation);
        var refresh = Text(answer, "refresh_token")
            ?? throw new CalendarProblem(CalendarProblemKind.Auth, "calendar_auth_failed", "Google gave no refresh token");
        return Token(answer, client, refresh, Text(answer, "scope") ?? "");
    }

    /// <summary>
    /// A new access token for <paramref name="token"/>. Throws <see cref="CalendarProblemKind.Auth"/>
    /// with <c>calendar_auth_failed</c> when the refresh token no longer works (revoked, removed by
    /// the person, or a test sign-in past its 7 days), and with <c>calendar_google_client_changed</c>
    /// when the client that issued it is gone from this server or Google no longer knows it.
    /// </summary>
    public async Task<GoogleToken> RefreshAsync(GoogleToken token, GoogleClient? client, CancellationToken cancellation)
    {
        if (client is null) throw ClientChanged();
        var answer = await TokenAsync(client, [("grant_type", "refresh_token"), ("refresh_token", token.RefreshToken)], cancellation);
        // Google may hand out a new refresh token; keep the old one otherwise.
        return Token(answer, client, Text(answer, "refresh_token") ?? token.RefreshToken, Text(answer, "scope") ?? token.Scope);
    }

    /// <summary>
    /// Ends the grant at Google (a disconnect), so the token stops working everywhere. A token Google
    /// no longer knows counts as revoked. Throws only when Google could not be asked.
    /// </summary>
    public async Task RevokeAsync(GoogleToken token, CancellationToken cancellation)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, at.Revoke) { Content = FormContent([("token", token.RefreshToken)]) };
        using var response = await GoogleHttp.SendAsync(http, request, cancellation);
        // 400 invalid_token: already revoked or expired.
        if (response.IsSuccessStatusCode || response.StatusCode == HttpStatusCode.BadRequest) return;
        throw GoogleHttp.Problem(response, await GoogleHttp.ReadAsync(response, cancellation));
    }

    private async Task<JsonObject> TokenAsync(GoogleClient client, (string, string)[] fields, CancellationToken cancellation)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, at.Token)
        {
            Content = FormContent([("client_id", client.Id), ("client_secret", client.Secret), .. fields]),
        };
        using var response = await GoogleHttp.SendAsync(http, request, cancellation);
        var body = await GoogleHttp.ReadAsync(response, cancellation);
        if (response.IsSuccessStatusCode) return body ?? throw new CalendarProblem(CalendarProblemKind.Unavailable, "calendar_unavailable", "Google answered with no token");
        // RFC 6749 errors: invalid_grant is the token or code, invalid_client the client itself.
        var error = body?["error"] is JsonValue value && value.TryGetValue<string>(out var text) ? text : null;
        if (error == "invalid_grant") throw new CalendarProblem(CalendarProblemKind.Auth, "calendar_auth_failed", "Google refused the sign-in");
        if (error is "invalid_client" or "unauthorized_client") throw ClientChanged();
        throw GoogleHttp.Problem(response, body);
    }

    private GoogleToken Token(JsonObject answer, GoogleClient client, string refresh, string scope)
    {
        var access = Text(answer, "access_token") ?? throw new CalendarProblem(CalendarProblemKind.Unavailable, "calendar_unavailable", "Google answered with no access token");
        var seconds = answer["expires_in"] is JsonValue value && value.TryGetValue<int>(out var given) ? given : 3600;
        return new GoogleToken(refresh, access, time.GetUtcNow().AddSeconds(seconds), client.Id, scope);
    }

    private static CalendarProblem ClientChanged() =>
        new(CalendarProblemKind.Auth, "calendar_google_client_changed", "the Google client that signed this account in is no longer set up on this server");

    private static string? Text(JsonObject answer, string name) =>
        answer[name] is JsonValue value && value.TryGetValue<string>(out var text) && text.Length > 0 ? text : null;

    private static FormUrlEncodedContent FormContent((string Name, string Value)[] fields) =>
        new(fields.Select(field => new KeyValuePair<string, string>(field.Name, field.Value)));

    private static string Form(params (string Name, string Value)[] fields) =>
        string.Join('&', fields.Select(field => Uri.EscapeDataString(field.Name) + "=" + Uri.EscapeDataString(field.Value)));
}

/// <summary>Sending to Google and reading its answers and errors, shared by the OAuth calls and the Calendar API.</summary>
internal static class GoogleHttp
{
    /// <summary>Sends, turning a network failure into <see cref="CalendarProblemKind.Unavailable"/>. A timeout stays a cancellation, which the engine records as timed out.</summary>
    public static async Task<HttpResponseMessage> SendAsync(HttpClient http, HttpRequestMessage request, CancellationToken cancellation)
    {
        try
        {
            return await http.SendAsync(request, cancellation);
        }
        catch (HttpRequestException error)
        {
            // The message names the host at most; Google's addresses are fixed, so nothing of the person's.
            throw new CalendarProblem(CalendarProblemKind.Unavailable, "calendar_unreachable", "Google could not be reached", inner: error);
        }
        catch (OperationCanceledException error) when (!cancellation.IsCancellationRequested)
        {
            // HttpClient's own timeout, not the caller giving up: the same as no answer at all.
            throw new CalendarProblem(CalendarProblemKind.Unavailable, "calendar_unreachable", "Google did not answer in time", inner: error);
        }
    }

    /// <summary>The answer's JSON object, or null when it has none.</summary>
    public static async Task<JsonObject?> ReadAsync(HttpResponseMessage response, CancellationToken cancellation)
    {
        var text = await response.Content.ReadAsStringAsync(cancellation);
        if (string.IsNullOrWhiteSpace(text)) return null;
        try
        {
            return JsonNode.Parse(text) as JsonObject;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>
    /// A failed answer as the problem the engine switches on. The message gives the status and
    /// Google's reason code only: Google's own message can quote the request, and with it event text.
    /// </summary>
    public static CalendarProblem Problem(HttpResponseMessage response, JsonObject? body)
    {
        var status = (int)response.StatusCode;
        var reason = Reason(body);
        var retry = response.Headers.RetryAfter is { } after
            ? after.Delta ?? (after.Date is { } date ? date - DateTimeOffset.UtcNow : null)
            : null;
        var said = string.Create(CultureInfo.InvariantCulture, $"Google answered {status}{(reason is null ? "" : " (" + reason + ")")}");
        return status switch
        {
            401 => new(CalendarProblemKind.Auth, "calendar_auth_failed", said),
            403 when reason is "rateLimitExceeded" or "userRateLimitExceeded" or "quotaExceeded" =>
                new(CalendarProblemKind.RateLimited, "calendar_rate_limited", said, retry),
            403 => new(CalendarProblemKind.Refused, "calendar_forbidden", said),
            404 or 410 => new(CalendarProblemKind.NotFound, "calendar_not_found", said),
            409 or 412 => new(CalendarProblemKind.Conflict, "calendar_conflict", said),
            429 => new(CalendarProblemKind.RateLimited, "calendar_rate_limited", said, retry),
            >= 500 => new(CalendarProblemKind.Unavailable, "calendar_unavailable", said, retry),
            _ => new(CalendarProblemKind.Refused, "calendar_refused", said),
        };
    }

    /// <summary>Google's machine reason (<c>error.errors[0].reason</c>), when it gave one of plain word characters.</summary>
    private static string? Reason(JsonObject? body)
    {
        var reason = body?["error"] is JsonObject error && error["errors"] is JsonArray errors && errors.Count > 0 && errors[0] is JsonObject first
            && first["reason"] is JsonValue value && value.TryGetValue<string>(out var text) ? text : null;
        return reason is not null && reason.Length <= 64 && reason.All(char.IsAsciiLetterOrDigit) ? reason : null;
    }
}
