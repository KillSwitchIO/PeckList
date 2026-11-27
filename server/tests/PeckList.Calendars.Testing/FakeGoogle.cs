using System.Globalization;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

namespace PeckList.Calendars.Testing;

/// <summary>
/// A fake of the Google services the Google adapter calls (PL-134, Google is tested against a recorded
/// fake): the OAuth token and revoke endpoints and the Calendar API v3 calls the adapter makes, built
/// from Google's documented requests and answers. It runs in process as an
/// <see cref="HttpMessageHandler"/>, so no test touches the network or a real account, and the data is
/// made up. It is as strict as Google where the adapter depends on it: bearer tokens, the scopes each
/// call needs, If-Match (412), sync tokens (410), paging, and PKCE on the code swap.
/// </summary>
public sealed class FakeGoogle : HttpMessageHandler
{
    public const string CalendarListScope = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";
    public const string EventsScope = "https://www.googleapis.com/auth/calendar.events";
    public const string AppCreatedScope = "https://www.googleapis.com/auth/calendar.app.created";
    public const string AllScopes = CalendarListScope + " " + EventsScope + " " + AppCreatedScope;

    /// <summary>The base addresses the adapter is pointed at.</summary>
    public static readonly Uri Api = new("https://google.test/calendar/v3/");
    public static readonly Uri TokenUrl = new("https://google.test/token");
    public static readonly Uri RevokeUrl = new("https://google.test/revoke");
    public static readonly Uri AuthorizeUrl = new("https://google.test/o/oauth2/v2/auth");

    private readonly Lock gate = new();
    private readonly Dictionary<string, string> clients = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Grant> refreshTokens = new(StringComparer.Ordinal);
    private readonly Dictionary<string, (Grant Grant, DateTimeOffset Expires)> accessTokens = new(StringComparer.Ordinal);
    private readonly Dictionary<string, PendingCode> codes = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Account> accounts = new(StringComparer.Ordinal);
    private readonly Dictionary<string, (string Calendar, string Resource, string Address, string Token)> channels = new(StringComparer.Ordinal);
    private long sequence;

    /// <summary>Entries per page of a listing; small, so paging is exercised.</summary>
    public int PageSize { get; set; } = 2;

    /// <summary>Calls made, as <c>METHOD path</c>, for tests that check what was asked.</summary>
    public List<string> Calls { get; } = [];

    /// <summary>The time tokens are checked against.</summary>
    public TimeProvider Time { get; set; } = TimeProvider.System;

    /// <summary>Lets a client id and secret use the token endpoint.</summary>
    public void AddClient(string id, string secret)
    {
        lock (gate) clients[id] = secret;
    }

    /// <summary>
    /// A Google account with a primary calendar named after its address, and a refresh token for
    /// <paramref name="clientId"/> with <paramref name="scope"/>. Returns the refresh token.
    /// </summary>
    public string AddAccount(string address, string clientId, string scope = AllScopes, string timeZone = "America/Chicago")
    {
        lock (gate)
        {
            var account = accounts.TryGetValue(address, out var known) ? known : accounts[address] = new Account(address);
            account.Calendars.TryAdd(address, new Calendar(address, address, timeZone, "owner", "#9FE1E7", Primary: true));
            var refresh = "refresh-" + Guid.NewGuid().ToString("N");
            refreshTokens[refresh] = new Grant(address, clientId, scope, refresh);
            return refresh;
        }
    }

    /// <summary>A calendar in an account, as another client would make it.</summary>
    public string AddCalendar(string address, string name, string accessRole = "owner", string timeZone = "America/Chicago", string? color = "#7AE7BF")
    {
        lock (gate)
        {
            var id = Guid.NewGuid().ToString("N") + "@group.calendar.google.com";
            accounts[address].Calendars[id] = new Calendar(id, name, timeZone, accessRole, color, Primary: false);
            return id;
        }
    }

    /// <summary>
    /// A code as Google's sign-in page would hand back, for the connect flow: valid once, for
    /// <paramref name="redirectUri"/>, with the PKCE challenge from the authorize address.
    /// </summary>
    public string IssueCode(string address, string clientId, string redirectUri, string codeChallenge, string scope = AllScopes)
    {
        lock (gate)
        {
            if (!accounts.ContainsKey(address)) AddAccount(address, clientId, scope);
            var code = "code-" + Guid.NewGuid().ToString("N");
            codes[code] = new PendingCode(new Grant(address, clientId, scope), redirectUri, codeChallenge);
            return code;
        }
    }

    /// <summary>Whether this refresh token was revoked.</summary>
    public bool Revoked(string refreshToken)
    {
        lock (gate) return !refreshTokens.ContainsKey(refreshToken);
    }

    /// <summary>Ends a refresh token as Google would after 7 days of a testing app, or when the person removes access.</summary>
    public void Expire(string refreshToken)
    {
        lock (gate)
        {
            refreshTokens.Remove(refreshToken);
            foreach (var (access, _) in accessTokens.Where(each => each.Value.Grant.RefreshToken == refreshToken).ToList()) accessTokens.Remove(access);
        }
    }

    /// <summary>Open push channels: id, calendar, resource id, callback and token.</summary>
    public IReadOnlyList<(string Id, string Calendar, string Resource, string Address, string Token)> Channels
    {
        get
        {
            lock (gate) return [.. channels.Select(each => (each.Key, each.Value.Calendar, each.Value.Resource, each.Value.Address, each.Value.Token))];
        }
    }

    /// <summary>Puts an event straight into a calendar, as another client would, and returns it as Google lists it.</summary>
    public JsonObject Seed(string address, string calendarId, JsonObject body)
    {
        lock (gate) return (JsonObject)Insert(accounts[address].Calendars[calendarId], body).DeepClone();
    }

    /// <summary>Moves one occurrence of a series, as another client would: an event of its own with <c>recurringEventId</c>.</summary>
    public void SeedOverride(string address, string calendarId, string seriesId, JsonObject originalStart, JsonObject start, JsonObject end, string summary)
    {
        lock (gate)
        {
            var calendar = accounts[address].Calendars[calendarId];
            var series = calendar.Events[seriesId];
            var stamp = DateTimeOffset.Parse((string)(originalStart["dateTime"] ?? originalStart["date"])!, CultureInfo.InvariantCulture)
                .UtcDateTime.ToString("yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture);
            Insert(calendar, new JsonObject
            {
                ["id"] = $"{seriesId}_{stamp}",
                ["summary"] = summary,
                ["description"] = series["description"]?.DeepClone(),
                ["start"] = start,
                ["end"] = end,
                ["recurringEventId"] = seriesId,
                ["originalStartTime"] = originalStart,
            });
        }
    }

    /// <summary>The event as stored, or null.</summary>
    public JsonObject? Event(string address, string calendarId, string eventId)
    {
        lock (gate) return accounts[address].Calendars[calendarId].Events.GetValueOrDefault(eventId)?.DeepClone() as JsonObject;
    }

    /// <summary>When set, Google takes every call and never answers, as when its addresses are black-holed.</summary>
    public bool Silent { get; set; }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (Silent) await Task.Delay(Timeout.Infinite, cancellationToken);
        var body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken);
        lock (gate)
        {
            Calls.Add($"{request.Method} {request.RequestUri!.AbsolutePath}");
            var url = request.RequestUri!;
            if (url.AbsoluteUri.StartsWith(TokenUrl.AbsoluteUri, StringComparison.Ordinal)) return TokenEndpoint(Form(body));
            if (url.AbsoluteUri.StartsWith(RevokeUrl.AbsoluteUri, StringComparison.Ordinal)) return RevokeEndpoint(Form(body));
            if (!url.AbsoluteUri.StartsWith(Api.AbsoluteUri, StringComparison.Ordinal)) return Error(HttpStatusCode.NotFound, "notFound");
            var bearer = request.Headers.Authorization is { Scheme: "Bearer", Parameter: { } given } ? given : null;
            if (bearer is null || !accessTokens.TryGetValue(bearer, out var access) || access.Expires <= Time.GetUtcNow() || !refreshTokens.ContainsKey(access.Grant.RefreshToken))
            {
                return Error(HttpStatusCode.Unauthorized, "authError");
            }
            var path = url.AbsolutePath[Api.AbsolutePath.Length..].Split('/').Select(Uri.UnescapeDataString).ToArray();
            var query = Query(url.Query);
            var ifMatch = request.Headers.TryGetValues("If-Match", out var values) ? values.First() : null;
            var json = body.Length > 0 ? JsonNode.Parse(body) as JsonObject : null;
            return CalendarApi(access.Grant, request.Method, path, query, ifMatch, json);
        }
    }

    private HttpResponseMessage CalendarApi(Grant grant, HttpMethod method, string[] path, Dictionary<string, string> query, string? ifMatch, JsonObject? body)
    {
        var account = accounts[grant.Address];
        bool Has(string scope) => grant.Scope.Split(' ').Contains(scope);
        switch (path)
        {
            case ["users", "me", "calendarList"] when method == HttpMethod.Get:
                if (!Has(CalendarListScope)) return Error(HttpStatusCode.Forbidden, "insufficientPermissions");
                return Page(account.Calendars.Values.Select(each => each.Entry()).ToList(), query, null);
            case ["users", "me", "calendarList", var id] when method == HttpMethod.Get:
                if (!Has(CalendarListScope)) return Error(HttpStatusCode.Forbidden, "insufficientPermissions");
                var entry = id == "primary" ? account.Calendars.Values.First(each => each.Primary) : account.Calendars.GetValueOrDefault(id);
                return entry is null ? Error(HttpStatusCode.NotFound, "notFound") : Ok(entry.Entry());
            case ["calendars"] when method == HttpMethod.Post:
                if (!Has(AppCreatedScope)) return Error(HttpStatusCode.Forbidden, "insufficientPermissions");
                var madeId = Guid.NewGuid().ToString("N") + "@group.calendar.google.com";
                var made = new Calendar(madeId, (string)body!["summary"]!, (string?)body["timeZone"] ?? "UTC", "owner", "#A4BDFC", Primary: false);
                account.Calendars[madeId] = made;
                return Ok(new JsonObject { ["kind"] = "calendar#calendar", ["id"] = madeId, ["summary"] = made.Name, ["timeZone"] = made.TimeZone });
            case ["channels", "stop"] when method == HttpMethod.Post:
                return channels.Remove((string)body!["id"]!) ? new HttpResponseMessage(HttpStatusCode.NoContent) : Error(HttpStatusCode.NotFound, "notFound");
        }
        if (path is not ["calendars", var calendarId, "events", ..] || !account.Calendars.TryGetValue(calendarId, out var calendar)) return Error(HttpStatusCode.NotFound, "notFound");
        if (!Has(EventsScope)) return Error(HttpStatusCode.Forbidden, "insufficientPermissions");
        var writable = calendar.AccessRole is "owner" or "writer";
        switch (path[3..])
        {
            case [] when method == HttpMethod.Get:
                return Events(calendar, query);
            case [] when method == HttpMethod.Post:
                if (!writable) return Error(HttpStatusCode.Forbidden, "forbidden");
                if (body?["end"] is null) return Error(HttpStatusCode.BadRequest, "required");
                return Ok(Insert(calendar, body).DeepClone());
            case ["watch"] when method == HttpMethod.Post:
                var channelId = (string)body!["id"]!;
                var resource = "resource-" + calendar.Id.GetHashCode(StringComparison.Ordinal).ToString("x", CultureInfo.InvariantCulture);
                channels[channelId] = (calendar.Id, resource, (string)body["address"]!, (string)body["token"]!);
                var ttl = long.Parse((string?)body["params"]?["ttl"] ?? "604800", CultureInfo.InvariantCulture);
                return Ok(new JsonObject
                {
                    ["kind"] = "api#channel",
                    ["id"] = channelId,
                    ["resourceId"] = resource,
                    ["expiration"] = (Time.GetUtcNow() + TimeSpan.FromSeconds(ttl)).ToUnixTimeMilliseconds().ToString(CultureInfo.InvariantCulture),
                });
            case [var eventId] when method == HttpMethod.Patch || method == HttpMethod.Delete:
                if (!writable) return Error(HttpStatusCode.Forbidden, "forbidden");
                if (!calendar.Events.TryGetValue(eventId, out var stored)) return Error(HttpStatusCode.NotFound, "notFound");
                if ((string?)stored["status"] == "cancelled") return Error(HttpStatusCode.Gone, "deleted");
                if (ifMatch is not null && ifMatch != (string)stored["etag"]!) return Error(HttpStatusCode.PreconditionFailed, "conditionNotMet");
                if (method == HttpMethod.Delete)
                {
                    Cancel(calendar, eventId);
                    return new HttpResponseMessage(HttpStatusCode.NoContent);
                }
                // Google keeps birthday events to itself: a change is refused with a 400. The reason
                // name is the fake's own; only the status matters to the adapter.
                if ((string?)stored["eventType"] == "birthday") return Error(HttpStatusCode.BadRequest, "eventTypeRestriction");
                Merge(stored, body!);
                Touch(calendar, stored);
                return Ok(stored.DeepClone());
        }
        return Error(HttpStatusCode.NotFound, "notFound");
    }

    private HttpResponseMessage Events(Calendar calendar, Dictionary<string, string> query)
    {
        List<JsonNode> items;
        if (query.TryGetValue("syncToken", out var token))
        {
            if (!token.StartsWith("sync:" + calendar.Id + ":", StringComparison.Ordinal) || !long.TryParse(token.AsSpan(token.LastIndexOf(':') + 1), CultureInfo.InvariantCulture, out var since))
            {
                return Error(HttpStatusCode.Gone, "fullSyncRequired");
            }
            items = [.. calendar.Events.Values.Where(each => (long)each["_seq"]! > since).Select(Public)];
        }
        else
        {
            var showDeleted = query.GetValueOrDefault("showDeleted") == "true";
            // As Google: deleted events are left out, but cancelled occurrences of a series still come.
            items = [.. calendar.Events.Values
                .Where(each => showDeleted || (string?)each["status"] != "cancelled" || each["recurringEventId"] is not null)
                .Select(Public)];
        }
        return Page(items, query, $"sync:{calendar.Id}:{sequence}", calendar.TimeZone);
    }

    private HttpResponseMessage Page(List<JsonNode> items, Dictionary<string, string> query, string? syncToken, string? timeZone = null)
    {
        var start = query.TryGetValue("pageToken", out var page) ? int.Parse(page, CultureInfo.InvariantCulture) : 0;
        var answer = new JsonObject { ["items"] = new JsonArray([.. items.Skip(start).Take(PageSize).Select(each => each.DeepClone())]) };
        if (timeZone is not null) answer["timeZone"] = timeZone;
        if (start + PageSize < items.Count) answer["nextPageToken"] = (start + PageSize).ToString(CultureInfo.InvariantCulture);
        else if (syncToken is not null) answer["nextSyncToken"] = syncToken;
        return Ok(answer);
    }

    private JsonObject Insert(Calendar calendar, JsonObject body)
    {
        var stored = (JsonObject)body.DeepClone();
        stored["kind"] = "calendar#event";
        stored["id"] ??= Guid.NewGuid().ToString("N");
        stored["status"] ??= "confirmed";
        stored["iCalUID"] = (string)stored["id"]! + "@google.com";
        stored["htmlLink"] = "https://calendar.google.test/event?eid=" + (string)stored["id"]!;
        calendar.Events[(string)stored["id"]!] = stored;
        Touch(calendar, stored);
        return Public(stored);
    }

    private void Cancel(Calendar calendar, string eventId)
    {
        var stored = calendar.Events[eventId];
        // What a token listing gives for a deleted event: its id and status, little else.
        var cancelled = new JsonObject { ["kind"] = "calendar#event", ["id"] = eventId, ["status"] = "cancelled" };
        if (stored["recurringEventId"] is { } series) cancelled["recurringEventId"] = series.DeepClone();
        if (stored["originalStartTime"] is { } original) cancelled["originalStartTime"] = original.DeepClone();
        calendar.Events[eventId] = cancelled;
        Touch(calendar, cancelled);
        // A deleted series takes its occurrences with it.
        foreach (var (id, _) in calendar.Events.Where(each => (string?)each.Value["recurringEventId"] == eventId && (string?)each.Value["status"] != "cancelled").ToList())
        {
            Cancel(calendar, id);
        }
    }

    private void Touch(Calendar calendar, JsonObject stored)
    {
        // As Google: a local dateTime given with a zone is answered with its offset.
        foreach (var name in new[] { "start", "end", "originalStartTime" })
        {
            if (stored[name] is not JsonObject time || (string?)time["dateTime"] is not { } text || (string?)time["timeZone"] is not { } zoneName) continue;
            if (text.EndsWith('Z') || text.LastIndexOfAny(['+', '-']) > text.IndexOf('T', StringComparison.Ordinal)) continue;
            var local = DateTime.Parse(text, CultureInfo.InvariantCulture);
            var offset = TimeZoneInfo.FindSystemTimeZoneById(zoneName).GetUtcOffset(local);
            time["dateTime"] = new DateTimeOffset(local, offset).ToString("yyyy-MM-dd'T'HH:mm:sszzz", CultureInfo.InvariantCulture);
        }
        sequence++;
        stored["_seq"] = sequence;
        stored["etag"] = $"\"{3181159875584000 + sequence}\"";
        stored["updated"] = new DateTimeOffset(2026, 11, 1, 0, 0, 0, TimeSpan.Zero).AddSeconds(sequence).ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
    }

    private static JsonObject Public(JsonObject stored)
    {
        var copy = (JsonObject)stored.DeepClone();
        copy.Remove("_seq");
        return copy;
    }

    /// <summary>Patch semantics: named fields replace, objects merge, null removes, arrays replace.</summary>
    private static void Merge(JsonObject target, JsonObject patch)
    {
        foreach (var (name, value) in patch.ToList())
        {
            if (value is null) target.Remove(name);
            else if (value is JsonObject inner && target[name] is JsonObject existing) Merge(existing, inner);
            else target[name] = value.DeepClone();
        }
    }

    private HttpResponseMessage TokenEndpoint(Dictionary<string, string> form)
    {
        if (!form.TryGetValue("client_id", out var clientId) || !clients.TryGetValue(clientId, out var secret) || form.GetValueOrDefault("client_secret") != secret)
        {
            return OAuthError(HttpStatusCode.Unauthorized, "invalid_client");
        }
        switch (form.GetValueOrDefault("grant_type"))
        {
            case "refresh_token":
                if (!refreshTokens.TryGetValue(form.GetValueOrDefault("refresh_token") ?? "", out var grant) || grant.ClientId != clientId)
                {
                    return OAuthError(HttpStatusCode.BadRequest, "invalid_grant");
                }
                return Ok(Tokens(grant with { RefreshToken = form["refresh_token"] }, includeRefresh: false));
            case "authorization_code":
                if (!codes.Remove(form.GetValueOrDefault("code") ?? "", out var pending) || pending.Grant.ClientId != clientId
                    || pending.RedirectUri != form.GetValueOrDefault("redirect_uri")
                    || Challenge(form.GetValueOrDefault("code_verifier") ?? "") != pending.Challenge)
                {
                    return OAuthError(HttpStatusCode.BadRequest, "invalid_grant");
                }
                var refresh = "refresh-" + Guid.NewGuid().ToString("N");
                var granted = pending.Grant with { RefreshToken = refresh };
                refreshTokens[refresh] = granted;
                return Ok(Tokens(granted, includeRefresh: true));
            default:
                return OAuthError(HttpStatusCode.BadRequest, "unsupported_grant_type");
        }
    }

    private JsonObject Tokens(Grant grant, bool includeRefresh)
    {
        var access = "access-" + Guid.NewGuid().ToString("N");
        accessTokens[access] = (grant, Time.GetUtcNow().AddHours(1));
        var answer = new JsonObject { ["access_token"] = access, ["expires_in"] = 3599, ["scope"] = grant.Scope, ["token_type"] = "Bearer" };
        if (includeRefresh) answer["refresh_token"] = grant.RefreshToken;
        return answer;
    }

    private HttpResponseMessage RevokeEndpoint(Dictionary<string, string> form)
    {
        var token = form.GetValueOrDefault("token") ?? "";
        if (!refreshTokens.ContainsKey(token)) return OAuthError(HttpStatusCode.BadRequest, "invalid_token");
        Expire(token);
        return new HttpResponseMessage(HttpStatusCode.OK);
    }

    /// <summary>PKCE S256 of a verifier, as Google checks it.</summary>
    public static string Challenge(string verifier) =>
        Convert.ToBase64String(SHA256.HashData(Encoding.ASCII.GetBytes(verifier))).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static HttpResponseMessage Ok(JsonNode body) =>
        new(HttpStatusCode.OK) { Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json") };

    private static HttpResponseMessage Error(HttpStatusCode status, string reason) =>
        new(status)
        {
            Content = new StringContent(new JsonObject
            {
                ["error"] = new JsonObject
                {
                    ["code"] = (int)status,
                    ["message"] = "fake error",
                    ["errors"] = new JsonArray(new JsonObject { ["domain"] = "global", ["reason"] = reason }),
                },
            }.ToJsonString(), Encoding.UTF8, "application/json"),
        };

    private static HttpResponseMessage OAuthError(HttpStatusCode status, string error) =>
        new(status) { Content = new StringContent(new JsonObject { ["error"] = error }.ToJsonString(), Encoding.UTF8, "application/json") };

    private static Dictionary<string, string> Form(string body) => Query(body);

    private static Dictionary<string, string> Query(string text) =>
        text.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries).Select(pair => pair.Split('=', 2))
            .ToDictionary(pair => Uri.UnescapeDataString(pair[0].Replace('+', ' ')), pair => pair.Length > 1 ? Uri.UnescapeDataString(pair[1].Replace('+', ' ')) : "", StringComparer.Ordinal);

    private sealed record Grant(string Address, string ClientId, string Scope, string RefreshToken = "");

    private sealed record PendingCode(Grant Grant, string RedirectUri, string Challenge);

    private sealed class Account(string address)
    {
        public string Address { get; } = address;

        public Dictionary<string, Calendar> Calendars { get; } = new(StringComparer.Ordinal);
    }

    private sealed record Calendar(string Id, string Name, string TimeZone, string AccessRole, string? Color, bool Primary)
    {
        public Dictionary<string, JsonObject> Events { get; } = new(StringComparer.Ordinal);

        public JsonNode Entry()
        {
            var entry = new JsonObject
            {
                ["kind"] = "calendar#calendarListEntry",
                ["id"] = Id,
                ["summary"] = Name,
                ["timeZone"] = TimeZone,
                ["accessRole"] = AccessRole,
            };
            if (Color is not null) entry["backgroundColor"] = Color;
            if (Primary) entry["primary"] = true;
            return entry;
        }
    }
}
