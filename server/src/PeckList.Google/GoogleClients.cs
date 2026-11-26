using System.Text.Json;
using System.Text.Json.Serialization;

namespace PeckList.Google;

/// <summary>
/// A Google OAuth client the server signs people in with (spec: PL-134, Google Sign-In for Everyone):
/// the PeckList app built in, or an admin's own.
/// </summary>
/// <param name="Relay">
/// Sign-ins come back through the relay page on pecklist.com (the built-in client, whose only
/// redirect is that page) rather than straight to this server's callback (an admin's own client).
/// </param>
public sealed record GoogleClient(string Id, string Secret, bool Relay)
{
    /// <summary>The secret stays out of logs and test output.</summary>
    public override string ToString() => $"GoogleClient {{ Id = {Id}, Relay = {Relay} }}";
}

/// <summary>Which Google clients this server has, read live so a settings change applies at once.</summary>
public interface IGoogleClients
{
    /// <summary>The client new sign-ins use: an admin's own when set, else the built-in one; null when neither is.</summary>
    GoogleClient? Current { get; }

    /// <summary>
    /// The client with this id, built-in or the admin's current one; null when the server no longer
    /// has it. A refresh token only works with the client that issued it.
    /// </summary>
    GoogleClient? ById(string id);
}

/// <summary>
/// The PeckList project's own Google client (spec: PL-134, One PeckList app). Its id and secret ship
/// with PeckList, as Thunderbird and rclone ship theirs; Google treats a secret in open source as
/// public, and the relay page's confirm step is what stands between a crafted sign-in link and
/// someone else's server. Both stay empty until the Google Cloud project exists, so no server points
/// at a client that is not there.
/// </summary>
public static class GoogleDefaults
{
    /// <summary>The built-in client's id; empty until the PeckList Google Cloud project is made.</summary>
    public const string ClientId = "";

    /// <summary>The built-in client's secret; empty until the PeckList Google Cloud project is made.</summary>
    public const string ClientSecret = "";

    /// <summary>The built-in client's only redirect: the relay page that hands the code to the server that asked.</summary>
    public static readonly Uri RelayUrl = new("https://pecklist.com/calendar/google/");

    /// <summary>The built-in client, or null while it is not filled in.</summary>
    public static GoogleClient? BuiltIn(string clientId = ClientId, string clientSecret = ClientSecret) =>
        clientId.Length > 0 && clientSecret.Length > 0 ? new GoogleClient(clientId, clientSecret, Relay: true) : null;
}

/// <summary>Where the adapter calls; tests point it at a fake.</summary>
public sealed record GoogleAddresses(Uri Api, Uri Token, Uri Revoke, Uri Authorize)
{
    /// <summary>Google's own.</summary>
    public static GoogleAddresses Google { get; } = new(
        new Uri("https://www.googleapis.com/calendar/v3/"),
        new Uri("https://oauth2.googleapis.com/token"),
        new Uri("https://oauth2.googleapis.com/revoke"),
        new Uri("https://accounts.google.com/o/oauth2/v2/auth"));
}

/// <summary>
/// The narrowest scopes that cover every call the adapter makes (spec: PL-134, For Security to
/// review): listing calendars and their access roles, reading, writing and watching events, and
/// making the PeckList calendar.
/// </summary>
public static class GoogleScopes
{
    public const string CalendarList = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";
    public const string Events = "https://www.googleapis.com/auth/calendar.events";
    public const string AppCreated = "https://www.googleapis.com/auth/calendar.app.created";

    /// <summary>All three, as one space-separated value.</summary>
    public static readonly string All = string.Join(' ', CalendarList, Events, AppCreated);

    /// <summary>Whether a granted scope list (space-separated, as Google returns it) holds every scope asked for.</summary>
    public static bool Granted(string? scope)
    {
        var granted = (scope ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries).ToHashSet(StringComparer.Ordinal);
        return granted.Contains(CalendarList) && granted.Contains(Events) && granted.Contains(AppCreated);
    }
}

/// <summary>
/// What the account's secret holds for Google: the refresh token, the last access token, and the
/// client that issued them (a refresh only works with it). Stored encrypted like every calendar secret.
/// </summary>
public sealed record GoogleToken(
    [property: JsonPropertyName("refresh_token")] string RefreshToken,
    [property: JsonPropertyName("access_token")] string? AccessToken,
    [property: JsonPropertyName("expires_at")] DateTimeOffset AccessExpires,
    [property: JsonPropertyName("client_id")] string ClientId,
    [property: JsonPropertyName("scope")] string Scope)
{
    /// <summary>The token as the account's secret.</summary>
    public string Write() => JsonSerializer.Serialize(this);

    /// <summary>The token from an account's secret; null when it is not one.</summary>
    public static GoogleToken? Read(string secret)
    {
        try
        {
            return JsonSerializer.Deserialize<GoogleToken>(secret) is { RefreshToken.Length: > 0, ClientId.Length: > 0 } token ? token : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>The tokens stay out of logs and test output.</summary>
    public override string ToString() => $"GoogleToken {{ ClientId = {ClientId}, AccessExpires = {AccessExpires:O} }}";
}
