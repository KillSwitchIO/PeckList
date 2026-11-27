using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using PeckList.Core.Calendars;

namespace PeckList.Google;

/// <summary>
/// The Google Calendar adapter (spec: PL-134), behind the calendar port: the Calendar API v3 with
/// sync tokens, etags sent as If-Match, push channels through <c>events.watch</c>, and PeckList's
/// marker in <c>extendedProperties.private</c>.
/// </summary>
/// <remarks>
/// <para>
/// The connection's secret is a <see cref="GoogleToken"/>. An access token is refreshed shortly
/// before it ends, or once after a 401, with the client that issued it, and the new token goes back
/// through <see cref="CalendarConnection.SecretChanged"/> to be stored encrypted.
/// </para>
/// <para>
/// Overrides of single occurrences are events of their own in Google (<c>recurringEventId</c>), so
/// a changed series does not list them again: <see cref="CalendarCapabilities.SeriesListsOverrides"/> is off.
/// </para>
/// </remarks>
public sealed partial class GoogleCalendarProvider(HttpClient http, IGoogleClients clients, TimeProvider time, GoogleAddresses? addresses = null)
    : ICalendarProvider
{
    /// <summary>How long a push channel asks to live: Google's longest for calendar events, a week.</summary>
    public static readonly TimeSpan ChannelLife = TimeSpan.FromDays(7);

    /// <summary>The <see cref="CalendarConnection.ServerUrl"/> of every Google account.</summary>
    public const string ServerUrl = "https://www.googleapis.com/calendar/v3";

    /// <summary>An HTTP client for this adapter, with a time limit per request. Google's addresses are fixed, so no network policy applies.</summary>
    public static HttpClient CreateHttpClient() => new() { Timeout = TimeSpan.FromSeconds(30) };

    private readonly GoogleAddresses at = addresses ?? GoogleAddresses.Google;
    private readonly GoogleOAuth oauth = new(http, time, addresses);

    // The freshest token per connection, so the calls of one run refresh once, not each.
    private readonly ConditionalWeakTable<CalendarConnection, GoogleToken> fresh = [];

    /// <inheritdoc />
    public string Kind => "google";

    /// <inheritdoc />
    public CalendarCapabilities Capabilities { get; } = new(Push: true, CreateCalendar: true, SeriesListsOverrides: false);

    /// <summary>The OAuth endpoints with the same HTTP client and addresses, for the sign-in.</summary>
    public GoogleOAuth OAuth => oauth;

    /// <inheritdoc />
    public async Task<IReadOnlyList<RemoteCalendar>> CalendarsAsync(CalendarConnection connection, CancellationToken cancellation)
    {
        var calendars = new List<RemoteCalendar>();
        string? page = null;
        do
        {
            var query = "users/me/calendarList?maxResults=250" + (page is null ? "" : "&pageToken=" + Uri.EscapeDataString(page));
            var body = await OkAsync(connection, () => new HttpRequestMessage(HttpMethod.Get, Api(query)), cancellation);
            foreach (var entry in (body["items"] as JsonArray ?? []).OfType<JsonObject>())
            {
                if (Calendar(entry) is { } calendar) calendars.Add(calendar);
            }
            page = GoogleEvents.Text(body, "nextPageToken");
        }
        while (page is not null);
        return calendars;
    }

    /// <summary>
    /// The Google address of the account: its primary calendar's id. The connect flow names the
    /// account with it and pairs a reconnect with the account already there.
    /// </summary>
    public async Task<string> AddressAsync(CalendarConnection connection, CancellationToken cancellation)
    {
        var primary = await OkAsync(connection, () => new HttpRequestMessage(HttpMethod.Get, Api("users/me/calendarList/primary")), cancellation);
        return GoogleEvents.Text(primary, "id") ?? throw new CalendarProblem(CalendarProblemKind.Refused, "calendar_refused", "Google gave no primary calendar");
    }

    /// <inheritdoc />
    public async Task<RemoteCalendar> CreateCalendarAsync(CalendarConnection connection, string name, CancellationToken cancellation)
    {
        // The new calendar keeps the person's own zone, so its all-day and timed events read as theirs.
        var primary = await OkAsync(connection, () => new HttpRequestMessage(HttpMethod.Get, Api("users/me/calendarList/primary")), cancellation);
        var body = new JsonObject { ["summary"] = name };
        if (GoogleEvents.Text(primary, "timeZone") is { } zone) body["timeZone"] = zone;
        var made = await OkAsync(connection, () => Json(HttpMethod.Post, Api("calendars"), body), cancellation);
        var id = GoogleEvents.Text(made, "id") ?? throw new CalendarProblem(CalendarProblemKind.Refused, "calendar_refused", "Google gave the new calendar no id");
        // Its colour and role come from the calendar list, where Google adds it.
        var (response, entry) = await SendAsync(connection, () => new HttpRequestMessage(HttpMethod.Get, Api("users/me/calendarList/" + Escape(id))), cancellation);
        if (response.IsSuccessStatusCode && entry is not null && Calendar(entry) is { } listed) return listed;
        return new RemoteCalendar(id, name, null, ReadOnly: false, GoogleEvents.Text(made, "timeZone"));
    }

    /// <inheritdoc />
    public async Task<RemoteChanges> ChangesAsync(CalendarConnection connection, string calendarId, string? syncToken, CancellationToken cancellation)
    {
        var changed = new List<RemoteEvent>();
        var deleted = new List<string>();
        string? page = null;
        string? next = null;
        do
        {
            // A full listing leaves deleted events out; cancelled occurrences of a series still come, as
            // they are its exceptions. A token brings deletions as cancelled events.
            var query = new StringBuilder("calendars/").Append(Escape(calendarId)).Append("/events?maxResults=2500");
            query.Append(syncToken is null ? "&showDeleted=false" : "&syncToken=" + Uri.EscapeDataString(syncToken));
            if (page is not null) query.Append("&pageToken=").Append(Uri.EscapeDataString(page));
            var (response, body) = await SendAsync(connection, () => new HttpRequestMessage(HttpMethod.Get, Api(query.ToString())), cancellation);
            if (response.StatusCode == HttpStatusCode.Gone && syncToken is not null)
            {
                throw new CalendarProblem(CalendarProblemKind.SyncTokenExpired, "calendar_sync_token_expired", "Google no longer accepts the sync token");
            }
            if (!response.IsSuccessStatusCode || body is null) throw GoogleHttp.Problem(response, body);
            var zone = GoogleEvents.Text(body, "timeZone");
            foreach (var item in (body["items"] as JsonArray ?? []).OfType<JsonObject>())
            {
                var remote = GoogleEvents.Read(item, zone);
                if (remote.Cancelled && remote.SeriesId is null)
                {
                    if (syncToken is not null) deleted.Add(remote.Id);
                    continue;
                }
                changed.Add(remote);
            }
            page = GoogleEvents.Text(body, "nextPageToken");
            next = GoogleEvents.Text(body, "nextSyncToken") ?? next;
        }
        while (page is not null);
        return new RemoteChanges(changed, deleted, next, Reset: syncToken is null);
    }

    /// <inheritdoc />
    public async Task<RemoteEvent> CreateEventAsync(CalendarConnection connection, string calendarId, EventData data, CancellationToken cancellation)
    {
        var body = GoogleEvents.Create(data);
        var created = await OkAsync(connection, () => Json(HttpMethod.Post, Api($"calendars/{Escape(calendarId)}/events"), body), cancellation);
        return GoogleEvents.Read(created, data.Start.TimeZone);
    }

    /// <inheritdoc />
    public async Task<RemoteEvent> UpdateEventAsync(CalendarConnection connection, string calendarId, RemoteEvent basis, EventData data, CancellationToken cancellation)
    {
        if (basis.SeriesId is not null)
        {
            throw new CalendarProblem(CalendarProblemKind.Refused, "calendar_occurrence_read_only", "a changed occurrence of a repeating event can't be edited here");
        }
        var body = GoogleEvents.Patch(data, basis.Raw);
        var updated = await OkAsync(connection, () =>
        {
            var request = Json(HttpMethod.Patch, Api($"calendars/{Escape(calendarId)}/events/{Escape(basis.Id)}"), body);
            IfMatch(request, basis.Etag);
            return request;
        }, cancellation);
        return GoogleEvents.Read(updated, data.Start.TimeZone);
    }

    /// <inheritdoc />
    public async Task DeleteEventAsync(CalendarConnection connection, string calendarId, string eventId, string etag, CancellationToken cancellation)
    {
        var (response, body) = await SendAsync(connection, () =>
        {
            var request = new HttpRequestMessage(HttpMethod.Delete, Api($"calendars/{Escape(calendarId)}/events/{Escape(eventId)}"));
            IfMatch(request, etag);
            return request;
        }, cancellation);
        // Gone already counts as deleted.
        if (response.IsSuccessStatusCode || response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Gone) return;
        throw GoogleHttp.Problem(response, body);
    }

    /// <inheritdoc />
    public async Task<PushChannel?> WatchAsync(CalendarConnection connection, string calendarId, Uri callback, string channelToken, CancellationToken cancellation)
    {
        var body = new JsonObject
        {
            ["id"] = Guid.NewGuid().ToString("N"),
            ["type"] = "web_hook",
            ["address"] = callback.AbsoluteUri,
            ["token"] = channelToken,
            ["params"] = new JsonObject { ["ttl"] = ((long)ChannelLife.TotalSeconds).ToString(CultureInfo.InvariantCulture) },
        };
        var opened = await OkAsync(connection, () => Json(HttpMethod.Post, Api($"calendars/{Escape(calendarId)}/events/watch"), body), cancellation);
        var id = GoogleEvents.Text(opened, "id");
        var resource = GoogleEvents.Text(opened, "resourceId");
        if (id is null || resource is null) throw new CalendarProblem(CalendarProblemKind.Refused, "calendar_refused", "Google opened no channel");
        // Milliseconds since the epoch, as text; a week when Google does not say.
        var expires = GoogleEvents.Text(opened, "expiration") is { } text && long.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out var ms)
            ? DateTimeOffset.FromUnixTimeMilliseconds(ms)
            : time.GetUtcNow() + ChannelLife;
        return new PushChannel(id, resource, expires);
    }

    /// <inheritdoc />
    public async Task StopWatchAsync(CalendarConnection connection, PushChannel channel, CancellationToken cancellation)
    {
        var body = new JsonObject { ["id"] = channel.Id, ["resourceId"] = channel.ResourceId };
        var (response, answer) = await SendAsync(connection, () => Json(HttpMethod.Post, Api("channels/stop"), body), cancellation);
        if (response.IsSuccessStatusCode || response.StatusCode == HttpStatusCode.NotFound) return;
        throw GoogleHttp.Problem(response, answer);
    }

    /// <summary>
    /// Ends the account's grant at Google (a disconnect). Not on the port: only Google has a grant to
    /// end. An unreadable secret has nothing to revoke.
    /// </summary>
    public async Task RevokeAsync(CalendarConnection connection, CancellationToken cancellation)
    {
        if (GoogleToken.Read(connection.Secret) is { } token) await oauth.RevokeAsync(token, cancellation);
    }

    private async Task<JsonObject> OkAsync(CalendarConnection connection, Func<HttpRequestMessage> make, CancellationToken cancellation)
    {
        var (response, body) = await SendAsync(connection, make, cancellation);
        if (!response.IsSuccessStatusCode) throw GoogleHttp.Problem(response, body);
        return body ?? throw new CalendarProblem(CalendarProblemKind.Unavailable, "calendar_unavailable", "Google answered with nothing");
    }

    /// <summary>One call with the account's access token; a 401 refreshes it and tries once more.</summary>
    private async Task<(HttpResponseMessage Response, JsonObject? Body)> SendAsync(CalendarConnection connection, Func<HttpRequestMessage> make, CancellationToken cancellation)
    {
        for (var attempt = 0; ; attempt++)
        {
            var access = await AccessAsync(connection, force: attempt > 0, cancellation);
            using var request = make();
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", access);
            var response = await GoogleHttp.SendAsync(http, request, cancellation);
            if (response.StatusCode == HttpStatusCode.Unauthorized && attempt == 0)
            {
                response.Dispose();
                continue;
            }
            using (response)
            {
                return (response, await GoogleHttp.ReadAsync(response, cancellation));
            }
        }
    }

    private async Task<string> AccessAsync(CalendarConnection connection, bool force, CancellationToken cancellation)
    {
        var token = fresh.TryGetValue(connection, out var cached) ? cached : GoogleToken.Read(connection.Secret)
            ?? throw new CalendarProblem(CalendarProblemKind.Auth, "calendar_auth_failed", "the stored Google sign-in can't be read");
        if (!force && token.AccessToken is { } access && token.AccessExpires - GoogleOAuth.RefreshMargin > time.GetUtcNow()) return access;
        GoogleToken renewed;
        try
        {
            renewed = await oauth.RefreshAsync(token, clients.ById(token.ClientId), cancellation);
        }
        catch (CalendarProblem problem)
        {
            // Named here, so the log says the refresh failed and not the call that needed it.
            throw problem.At(CalendarCalls.Refresh);
        }
        fresh.AddOrUpdate(connection, renewed);
        if (connection.SecretChanged is { } save) await save(renewed.Write());
        return renewed.AccessToken!;
    }

    private Uri Api(string pathAndQuery) => new(at.Api, pathAndQuery);

    private static HttpRequestMessage Json(HttpMethod method, Uri address, JsonObject body) =>
        new(method, address) { Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json") };

    private static void IfMatch(HttpRequestMessage request, string etag)
    {
        // Google's etags are quoted already ("\"318...\""); one that is not gets quoted.
        var quoted = etag.StartsWith('"') ? etag : $"\"{etag}\"";
        request.Headers.TryAddWithoutValidation("If-Match", quoted);
    }

    private static string Escape(string id) => Uri.EscapeDataString(id);

    /// <summary>A calendar list entry; null for one the person can only see free and busy times of, or one deleted.</summary>
    private static RemoteCalendar? Calendar(JsonObject entry)
    {
        if (entry["deleted"] is JsonValue deleted && deleted.TryGetValue<bool>(out var gone) && gone) return null;
        var role = GoogleEvents.Text(entry, "accessRole");
        if (role is not ("owner" or "writer" or "reader")) return null;
        var id = GoogleEvents.Text(entry, "id");
        if (id is null) return null;
        var color = GoogleEvents.Text(entry, "backgroundColor");
        return new RemoteCalendar(
            id,
            GoogleEvents.Text(entry, "summaryOverride") ?? GoogleEvents.Text(entry, "summary") ?? id,
            color is not null && ColorPattern().IsMatch(color) ? color.ToUpperInvariant() : null,
            ReadOnly: role == "reader",
            GoogleEvents.Text(entry, "timeZone"));
    }

    [GeneratedRegex("^#[0-9A-Fa-f]{6}$")]
    private static partial Regex ColorPattern();
}
