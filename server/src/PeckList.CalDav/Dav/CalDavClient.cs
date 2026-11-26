using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;
using static PeckList.CalDav.Dav.DavXml;

namespace PeckList.CalDav.Dav;

/// <summary>A CalDAV account's username and app password (iCloud, Fastmail and Nextcloud all issue app passwords).</summary>
public sealed record CalDavCredentials(string Username, string Password)
{
    /// <summary>Never prints the password, should a record end up in a log.</summary>
    public override string ToString() => $"CalDavCredentials {{ Username = {Username} }}";
}

/// <summary>Where an account's calendars live, found by <see cref="CalDavClient.DiscoverAsync"/>.</summary>
public sealed record DavAccount(Uri Principal, Uri Home);

/// <summary>One calendar in an account's home.</summary>
/// <param name="Url">The collection's address, ending in a slash.</param>
/// <param name="Name">DAV:displayname.</param>
/// <param name="Color">Apple's calendar-color (<c>#RRGGBB</c> or <c>#RRGGBBAA</c>), when set.</param>
/// <param name="CTag">getctag: changes whenever anything in the calendar does (for servers without sync tokens).</param>
/// <param name="SyncToken">The current sync token; null when the server doesn't do sync-collection.</param>
/// <param name="CanWrite">Whether the signed-in person may change events in it.</param>
/// <param name="TimeZone">The calendar's own zone (calendar-timezone) as an IANA name, when it has one PeckList can name.</param>
public sealed record DavCalendar(Uri Url, string? Name, string? Color, string? CTag, string? SyncToken, bool CanWrite, string? TimeZone = null);

/// <summary>An event resource's address and etag.</summary>
public sealed record DavEtag(Uri Href, string ETag);

/// <summary>An event resource with its iCalendar text.</summary>
public sealed record DavObject(Uri Href, string ETag, string Data);

/// <summary>What changed in a calendar since a sync token: the new or changed resources, the removed ones, and the token to store.</summary>
public sealed record DavChanges(IReadOnlyList<DavEtag> Changed, IReadOnlyList<Uri> Removed, string Token);

/// <summary>
/// A CalDAV client (RFC 4791, with RFC 6578 sync and RFC 6764 discovery) for one account. It knows
/// HTTP and WebDAV only; reading and writing the events is <see cref="ICalendar.EventReader"/> and
/// <see cref="ICalendar.EventWriter"/>. Spec: PL-134, decision 4 (one CalDAV connector for iCloud,
/// Fastmail, Nextcloud and the rest).
/// </summary>
/// <remarks>
/// The <see cref="HttpClient"/> must be built on <see cref="CalDavNetworkPolicy.CreateHandler"/>:
/// the client follows redirects itself, and relies on the handler for the address check.
/// </remarks>
public sealed partial class CalDavClient(HttpClient http, CalDavCredentials credentials)
{
    /// <summary>The largest answer read; a calendar's REPORTs are paged well below it.</summary>
    public const int MaxResponseBytes = 32 * 1024 * 1024;

    /// <summary>How many events one calendar-multiget asks for.</summary>
    public const int MultigetBatch = 50;

    private const int MaxRedirects = 5;

    /// <summary>
    /// The longest one request may take, from sending to the last byte of the answer. The
    /// <see cref="HttpClient"/>'s own timeout covers only the headers, as answers are read as they come.
    /// </summary>
    public TimeSpan RequestTimeout { get; init; } = TimeSpan.FromSeconds(60);
    private const int MaxSyncRounds = 100;
    private static readonly MediaTypeHeaderValue XmlType = new("application/xml") { CharSet = "utf-8" };
    private static readonly MediaTypeHeaderValue CalendarType = new("text/calendar") { CharSet = "utf-8" };
    private static readonly HttpMethod PropFindMethod = new("PROPFIND");
    private static readonly HttpMethod ReportMethod = new("REPORT");
    private static readonly HttpMethod MkCalendarMethod = new("MKCALENDAR");

    /// <summary>
    /// Finds the account's principal and calendar home from the address the person typed: a full
    /// URL (<c>https://cloud.example.com/remote.php/dav</c>) or just a host (<c>caldav.example.com</c>,
    /// which goes through <c>/.well-known/caldav</c>). Redirects to other hosts are followed here,
    /// since iCloud sends each account to its own host.
    /// </summary>
    public async Task<DavAccount> DiscoverAsync(string address, CancellationToken cancellationToken)
    {
        var start = StartUrl(address);
        Answer found;
        try
        {
            found = await SendAsync(PropFindMethod, start, () => Xml(PropFind(D + "current-user-principal")), 0, crossHost: true, cancellationToken);
        }
        catch (CalDavException e) when (e.Failure is CalDavFailure.NotFound or CalDavFailure.Rejected && start.AbsolutePath == "/.well-known/caldav")
        {
            // No well-known redirect: try the root itself.
            start = new Uri(start, "/");
            found = await SendAsync(PropFindMethod, start, () => Xml(PropFind(D + "current-user-principal")), 0, crossHost: true, cancellationToken);
        }
        var principalHref = Read(found, r => r.Ok(D + "current-user-principal")?.Element(D + "href")?.Value.Trim()).FirstOrDefault(h => !string.IsNullOrEmpty(h));
        // A server without current-user-principal: the address given is taken to be the principal.
        var principal = principalHref is null ? found.Url : Resolve(found.Url, principalHref);
        CheckHop(found.Url, principal, crossHost: true, "pointed");
        var home = await SendAsync(PropFindMethod, principal, () => Xml(PropFind(C + "calendar-home-set")), 0, crossHost: true, cancellationToken);
        var homeHref = Read(home, r => r.Ok(C + "calendar-home-set")?.Element(D + "href")?.Value.Trim()).FirstOrDefault(h => !string.IsNullOrEmpty(h))
            ?? throw new CalDavException(CalDavFailure.NotCalDav, "the server named no calendar home");
        var calendarHome = Collection(Resolve(home.Url, homeHref));
        CheckHop(home.Url, calendarHome, crossHost: true, "pointed");
        return new DavAccount(home.Url, calendarHome);
    }

    /// <summary>The event calendars in a home (collections that hold VEVENTs).</summary>
    public async Task<IReadOnlyList<DavCalendar>> CalendarsAsync(Uri home, CancellationToken cancellationToken)
    {
        var answer = await SendAsync(PropFindMethod, home, () => Xml(CalendarProps()), 1, crossHost: false, cancellationToken);
        var calendars = new List<DavCalendar>();
        foreach (var response in Multistatus(answer))
        {
            var url = Collection(Resolve(answer.Url, response.Href));
            if (!SameOrigin(url, home) || url == Collection(home)) continue;
            if (Calendar(url, response) is { } calendar) calendars.Add(calendar);
        }
        return calendars;
    }

    /// <summary>
    /// Makes a new event calendar in the home ("Make a PeckList calendar", spec: PL-134 Settings),
    /// at a fresh address, and returns it as <see cref="CalendarsAsync"/> would.
    /// </summary>
    public async Task<DavCalendar> MakeCalendarAsync(Uri home, string name, CancellationToken cancellationToken)
    {
        var url = new Uri(Collection(home), Guid.NewGuid().ToString("N") + "/");
        await SendAsync(MkCalendarMethod, url, () => Xml(DavXml.MakeCalendar(name)), null, crossHost: false, cancellationToken);
        var answer = await SendAsync(PropFindMethod, url, () => Xml(CalendarProps()), 0, crossHost: false, cancellationToken);
        return Multistatus(answer).Select(r => Calendar(url, r)).FirstOrDefault(c => c is not null)
            ?? throw new CalDavException(CalDavFailure.NotCalDav, "the new calendar does not read back as a calendar");
    }

    /// <summary>
    /// What changed since <paramref name="token"/> (null for everything), through sync-collection.
    /// A truncated answer (507) is followed until the server has sent it all.
    /// </summary>
    /// <exception cref="CalDavException">With <see cref="CalDavFailure.SyncTokenInvalid"/> when the server no longer takes the token: list everything again.</exception>
    public async Task<DavChanges> ChangesAsync(Uri calendar, string? token, CancellationToken cancellationToken)
    {
        var changed = new Dictionary<Uri, DavEtag>();
        var removed = new HashSet<Uri>();
        var collection = Collection(calendar);
        for (var round = 0; round < MaxSyncRounds; round++)
        {
            var sent = token;
            var answer = await SendAsync(ReportMethod, collection, () => Xml(SyncCollection(sent)), 1, crossHost: false, cancellationToken);
            var status = Parse(answer);
            var more = false;
            foreach (var response in status.Responses)
            {
                var href = Resolve(answer.Url, response.Href);
                if (Collection(href) == collection)
                {
                    more |= response.Status == 507;
                    continue;
                }
                if (!SameOrigin(href, collection)) continue;
                if (response.Status is 404 or 410)
                {
                    changed.Remove(href);
                    removed.Add(href);
                }
                else if (response.OkText(D + "getetag") is { } etag)
                {
                    removed.Remove(href);
                    changed[href] = new DavEtag(href, ETag(etag));
                }
            }
            token = status.SyncToken ?? throw new CalDavException(CalDavFailure.NotCalDav, "the sync answer has no sync token");
            if (!more) return new DavChanges(changed.Values.ToList(), removed.ToList(), token);
        }
        throw new CalDavException(CalDavFailure.RetryLater, "the server kept truncating the sync answer");
    }

    /// <summary>The events at these addresses, through calendar-multiget in batches. Ones gone meanwhile are left out.</summary>
    public async Task<IReadOnlyList<DavObject>> GetAsync(Uri calendar, IReadOnlyCollection<Uri> hrefs, CancellationToken cancellationToken)
    {
        var collection = Collection(calendar);
        var objects = new List<DavObject>();
        foreach (var batch in hrefs.Where(h => SameOrigin(h, collection)).Distinct().Chunk(MultigetBatch))
        {
            var paths = batch.Select(h => h.GetComponents(UriComponents.Path | UriComponents.KeepDelimiter, UriFormat.UriEscaped)).ToList();
            var answer = await SendAsync(ReportMethod, collection, () => Xml(Multiget(paths)), 1, crossHost: false, cancellationToken);
            objects.AddRange(Objects(answer, collection));
        }
        return objects;
    }

    /// <summary>The events that fall in a time range, with their data (for "show events").</summary>
    public async Task<IReadOnlyList<DavObject>> RangeAsync(Uri calendar, DateTimeOffset from, DateTimeOffset to, CancellationToken cancellationToken)
    {
        var collection = Collection(calendar);
        var answer = await SendAsync(ReportMethod, collection, () => Xml(Query(from, to, withData: true)), 1, crossHost: false, cancellationToken);
        return Objects(answer, collection);
    }

    /// <summary>Every event's address and etag: for servers without sync tokens, compared against the stored etags.</summary>
    public async Task<IReadOnlyList<DavEtag>> EtagsAsync(Uri calendar, CancellationToken cancellationToken)
    {
        var collection = Collection(calendar);
        var answer = await SendAsync(ReportMethod, collection, () => Xml(Query(null, null, withData: false)), 1, crossHost: false, cancellationToken);
        return Multistatus(answer)
            .Select(r => (Href: Resolve(answer.Url, r.Href), ETag: r.OkText(D + "getetag")))
            .Where(r => r.ETag is not null && SameOrigin(r.Href, collection) && Collection(r.Href) != collection)
            .Select(r => new DavEtag(r.Href, ETag(r.ETag!)))
            .ToList();
    }

    /// <summary>One event by address, or null when it is gone.</summary>
    public async Task<DavObject?> GetOneAsync(Uri href, CancellationToken cancellationToken)
    {
        try
        {
            var answer = await SendAsync(HttpMethod.Get, href, null, null, crossHost: false, cancellationToken);
            var etag = answer.ETag ?? await EtagAsync(href, cancellationToken);
            return etag is null ? null : new DavObject(href, ETag(etag), answer.Body);
        }
        catch (CalDavException e) when (e.Failure == CalDavFailure.NotFound)
        {
            return null;
        }
    }

    /// <summary>
    /// Creates an event at <paramref name="name"/> in the calendar, refusing to overwrite one that
    /// is already there (If-None-Match: *). Returns its address and etag.
    /// </summary>
    /// <exception cref="CalDavException">With <see cref="CalDavFailure.Conflict"/> when something already has that name.</exception>
    public async Task<DavEtag> CreateAsync(Uri calendar, string name, string data, CancellationToken cancellationToken)
    {
        if (!ResourceName().IsMatch(name)) throw new ArgumentException("a resource name is letters, digits, '-', '_' and '.', ending in .ics", nameof(name));
        var href = new Uri(Collection(calendar), name);
        var answer = await SendAsync(HttpMethod.Put, href, () => Calendar(data), null, crossHost: false, cancellationToken,
            r => r.Headers.IfNoneMatch.Add(EntityTagHeaderValue.Any));
        return new DavEtag(href, await StoredEtagAsync(answer, href, cancellationToken));
    }

    /// <summary>Replaces an event, only if it still has <paramref name="etag"/>. Returns the new etag.</summary>
    /// <exception cref="CalDavException">With <see cref="CalDavFailure.Conflict"/> when it changed on the server meanwhile.</exception>
    public async Task<string> UpdateAsync(Uri href, string etag, string data, CancellationToken cancellationToken)
    {
        var answer = await SendAsync(HttpMethod.Put, href, () => Calendar(data), null, crossHost: false, cancellationToken,
            r => r.Headers.TryAddWithoutValidation("If-Match", ETag(etag)));
        return await StoredEtagAsync(answer, href, cancellationToken);
    }

    /// <summary>
    /// Deletes an event, only if it still has <paramref name="etag"/> when one is given. An event
    /// already gone counts as deleted.
    /// </summary>
    /// <exception cref="CalDavException">With <see cref="CalDavFailure.Conflict"/> when it changed on the server meanwhile.</exception>
    public async Task DeleteAsync(Uri href, string? etag, CancellationToken cancellationToken)
    {
        try
        {
            await SendAsync(HttpMethod.Delete, href, null, null, crossHost: false, cancellationToken,
                r => { if (etag is not null) r.Headers.TryAddWithoutValidation("If-Match", ETag(etag)); });
        }
        catch (CalDavException e) when (e.Failure == CalDavFailure.NotFound)
        {
            // Already gone: that's what was asked for.
        }
    }

    /// <summary>
    /// An etag in the quoted form If-Match needs. A few servers send getetag without the quotes
    /// their ETag header has; stored and compared etags always go through this.
    /// </summary>
    public static string ETag(string etag)
    {
        var trimmed = etag.Trim();
        return trimmed.StartsWith('"') || trimmed.StartsWith("W/", StringComparison.Ordinal) ? trimmed : "\"" + trimmed + "\"";
    }

    private static string CalendarProps() => PropFind(D + "resourcetype", D + "displayname", A + "calendar-color", CS + "getctag",
        D + "sync-token", C + "supported-calendar-component-set", D + "current-user-privilege-set", C + "calendar-timezone");

    private static DavCalendar? Calendar(Uri url, DavResponse response)
    {
        if (response.Ok(D + "resourcetype")?.Element(C + "calendar") is null) return null;
        var components = response.Ok(C + "supported-calendar-component-set")?.Elements(C + "comp")
            .Select(c => (string?)c.Attribute("name")).ToList();
        if (components is { Count: > 0 } && !components.Any(c => string.Equals(c, "VEVENT", StringComparison.OrdinalIgnoreCase))) return null;
        var privileges = response.Ok(D + "current-user-privilege-set")?.Elements(D + "privilege").SelectMany(p => p.Elements()).Select(e => e.Name).ToList();
        var canWrite = privileges is null || privileges.Any(p => p == D + "all" || p == D + "write" || p == D + "write-content");
        return new DavCalendar(url, response.OkText(D + "displayname"), response.OkText(A + "calendar-color"),
            response.OkText(CS + "getctag"), response.OkText(D + "sync-token"), canWrite, CalendarZone(response.OkText(C + "calendar-timezone")));
    }

    // calendar-timezone holds a whole VCALENDAR with one VTIMEZONE; only its TZID matters here.
    private static string? CalendarZone(string? text)
    {
        if (text is null) return null;
        try
        {
            var id = ICalendar.CalText.Parse(text).Components("VTIMEZONE").FirstOrDefault()?.Property("TZID")?.Value;
            return id is null ? null : ICalendar.CalZones.IanaName(id);
        }
        catch (ICalendar.CalendarFormatException)
        {
            return null;
        }
    }

    private List<DavObject> Objects(Answer answer, Uri collection) =>
        Multistatus(answer)
            .Select(r => (Href: Resolve(answer.Url, r.Href), ETag: r.OkText(D + "getetag"), Data: r.Ok(C + "calendar-data")?.Value))
            .Where(r => r.ETag is not null && !string.IsNullOrWhiteSpace(r.Data) && SameOrigin(r.Href, collection))
            .Select(r => new DavObject(r.Href, ETag(r.ETag!), r.Data!))
            .ToList();

    private async Task<string> StoredEtagAsync(Answer answer, Uri href, CancellationToken cancellationToken) =>
        answer.ETag is { } etag
            ? ETag(etag)
            // Servers that rewrite what was PUT (iCloud, some others) may answer with no ETag.
            : ETag(await EtagAsync(href, cancellationToken) ?? throw new CalDavException(CalDavFailure.NotCalDav, "the server gave no etag for the event"));

    private async Task<string?> EtagAsync(Uri href, CancellationToken cancellationToken)
    {
        var answer = await SendAsync(PropFindMethod, href, () => Xml(PropFind(D + "getetag")), 0, crossHost: false, cancellationToken);
        return Multistatus(answer).Select(r => r.OkText(D + "getetag")).FirstOrDefault(e => e is not null);
    }

    private static Uri StartUrl(string address)
    {
        var text = address.Trim();
        if (!text.Contains("://", StringComparison.Ordinal)) text = "https://" + text;
        if (!Uri.TryCreate(text, UriKind.Absolute, out var url) || (url.Scheme != Uri.UriSchemeHttps && url.Scheme != Uri.UriSchemeHttp)
            || !string.IsNullOrEmpty(url.UserInfo))
            throw new CalDavException(CalDavFailure.Rejected, "not a server address");
        return url.AbsolutePath is "" or "/" ? new Uri(url, "/.well-known/caldav") : url;
    }

    private static Uri Resolve(Uri baseUrl, string href) =>
        Uri.TryCreate(baseUrl, href, out var url) ? url : throw new CalDavException(CalDavFailure.NotCalDav, "the server sent an address that is not one");

    private static Uri Collection(Uri url) =>
        url.AbsolutePath.EndsWith('/') ? url : new UriBuilder(url) { Path = url.AbsolutePath + "/" }.Uri;

    private static bool SameOrigin(Uri a, Uri b) =>
        Uri.Compare(a, b, UriComponents.SchemeAndServer, UriFormat.SafeUnescaped, StringComparison.OrdinalIgnoreCase) == 0;

    private static IEnumerable<DavResponse> Multistatus(Answer answer) => Parse(answer).Responses;

    private static IEnumerable<string?> Read(Answer answer, Func<DavResponse, string?> pick) => Multistatus(answer).Select(pick);

    private static DavMultistatus Parse(Answer answer)
    {
        try
        {
            return DavXml.Multistatus(answer.Body);
        }
        catch (XmlException e)
        {
            throw new CalDavException(CalDavFailure.NotCalDav, "the server's answer is not a WebDAV multistatus", e) { Status = answer.Status };
        }
    }

    private static StringContent Xml(string body) => new(body, Encoding.UTF8, XmlType);

    private static StringContent Calendar(string data) => new(data, Encoding.UTF8, CalendarType);

    /// <summary>
    /// Sends one request, following redirects (same scheme or up to https; to another host only
    /// when <paramref name="crossHost"/>), and returns the 2xx answer with the address that gave it.
    /// Anything else becomes a <see cref="CalDavException"/>.
    /// </summary>
    private async Task<Answer> SendAsync(HttpMethod method, Uri url, Func<HttpContent>? content, int? depth, bool crossHost,
        CancellationToken cancellationToken, Action<HttpRequestMessage>? headers = null)
    {
        var resent = 0;
        for (var hop = 0; ; hop++)
        {
            // One deadline for the headers and the whole body: HttpClient's own timeout stops at the
            // headers when reading as they come, and a server trickling a body a byte at a time
            // would otherwise hold the sync for as long as it liked.
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            deadline.CancelAfter(RequestTimeout);
            using var request = new HttpRequestMessage(method, url) { Content = content?.Invoke() };
            request.Headers.Authorization = new AuthenticationHeaderValue("Basic",
                Convert.ToBase64String(Encoding.UTF8.GetBytes(credentials.Username + ":" + credentials.Password)));
            if (depth is not null) request.Headers.TryAddWithoutValidation("Depth", depth.Value.ToString(System.Globalization.CultureInfo.InvariantCulture));
            headers?.Invoke(request);
            HttpResponseMessage response;
            try
            {
                response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
            }
            catch (HttpRequestException e) when (e.HttpRequestError == HttpRequestError.ResponseEnded && resent++ < 2)
            {
                // The connection closed before any answer, so the server never handled the request:
                // a server that drops connections after each answer (Radicale's built-in server,
                // HTTP/1.0) leaves .NET a pooled connection that is already gone. .NET resends
                // requests without a body by itself; ours carry one. Every request here is a read
                // or a conditional write, so sending it again is safe.
                hop--;
                continue;
            }
            catch (HttpRequestException e) when (Blocked(e) is { } blocked)
            {
                throw new CalDavException(CalDavFailure.Blocked, blocked.Message, e);
            }
            catch (HttpRequestException e)
            {
                throw new CalDavException(CalDavFailure.Unavailable, $"{url.Host} could not be reached: {e.Message}", e);
            }
            catch (OperationCanceledException e) when (!cancellationToken.IsCancellationRequested)
            {
                throw new CalDavException(CalDavFailure.RetryLater, $"{url.Host} took too long to answer", e);
            }
            using var _ = response;
            var status = (int)response.StatusCode;
            if (status is 301 or 302 or 307 or 308 && response.Headers.Location is { } location)
            {
                var next = location.IsAbsoluteUri ? location : new Uri(url, location);
                if (hop + 1 >= MaxRedirects) throw new CalDavException(CalDavFailure.NotCalDav, "too many redirects") { Status = status };
                CheckHop(url, next, crossHost, "redirected");
                url = next;
                continue;
            }
            string body;
            try
            {
                body = await ReadAsync(response, deadline.Token);
            }
            catch (Exception e) when (e is HttpRequestException or IOException)
            {
                throw new CalDavException(CalDavFailure.Unavailable, $"{url.Host} stopped answering part way: {e.Message}", e) { Status = status };
            }
            catch (OperationCanceledException e) when (!cancellationToken.IsCancellationRequested)
            {
                throw new CalDavException(CalDavFailure.RetryLater, $"{url.Host} took too long to answer", e) { Status = status };
            }
            if (status is >= 200 and < 300) return new Answer(url, status, response.Headers.ETag?.ToString(), body);
            throw Failure(response, body, url);
        }
    }

    /// <summary>
    /// The rules for going from one address to another the server named, whether by a redirect or
    /// in discovery's principal and home hrefs: never from https to http, only to http(s), to
    /// another host only when <paramref name="crossHost"/> (discovery), and to another host only
    /// over https, since the password goes along.
    /// </summary>
    private static void CheckHop(Uri from, Uri to, bool crossHost, string how)
    {
        if (to.Scheme != Uri.UriSchemeHttps && to.Scheme != Uri.UriSchemeHttp)
            throw new CalDavException(CalDavFailure.NotCalDav, $"the server {how} to an address that is not http");
        if (from.Scheme == Uri.UriSchemeHttps && to.Scheme != Uri.UriSchemeHttps)
            throw new CalDavException(CalDavFailure.Blocked, $"the server {how} from https to http");
        if (SameOrigin(from, to)) return;
        if (!crossHost) throw new CalDavException(CalDavFailure.Rejected, $"the server {how} to another host");
        // A same-host hop goes back to the server that already has the password (Radicale's
        // well-known redirect on a private http address); a new host gets it only over https.
        if (to.Scheme != Uri.UriSchemeHttps)
            throw new CalDavException(CalDavFailure.Blocked, $"the server {how} to another host over plain http");
    }

    private static CalDavBlockedException? Blocked(Exception e)
    {
        for (Exception? inner = e; inner is not null; inner = inner.InnerException)
            if (inner is CalDavBlockedException blocked) return blocked;
        return null;
    }

    private static async Task<string> ReadAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        if (response.Content.Headers.ContentLength > MaxResponseBytes) throw TooLarge();
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var buffer = new MemoryStream();
        var chunk = new byte[81920];
        int read;
        while ((read = await stream.ReadAsync(chunk, cancellationToken)) > 0)
        {
            if (buffer.Length + read > MaxResponseBytes) throw TooLarge();
            buffer.Write(chunk, 0, read);
        }
        var charset = response.Content.Headers.ContentType?.CharSet?.Trim('"');
        Encoding encoding;
        try
        {
            encoding = string.IsNullOrEmpty(charset) ? Encoding.UTF8 : Encoding.GetEncoding(charset);
        }
        catch (ArgumentException)
        {
            encoding = Encoding.UTF8;
        }
        return encoding.GetString(buffer.GetBuffer(), 0, (int)buffer.Length);

        static CalDavException TooLarge() => new(CalDavFailure.Rejected, "the server's answer is too large");
    }

    private static CalDavException Failure(HttpResponseMessage response, string body, Uri url)
    {
        var status = (int)response.StatusCode;
        var retry = response.Headers.RetryAfter is { } after
            ? after.Delta ?? (after.Date is { } date ? date - DateTimeOffset.UtcNow : null)
            : null;
        var (failure, message) = status switch
        {
            401 => (CalDavFailure.Unauthorized, "the username or app password was not accepted"),
            403 or 409 when IsInvalidSyncToken(body) => (CalDavFailure.SyncTokenInvalid, "the server no longer accepts the sync token"),
            403 => (CalDavFailure.Forbidden, "not allowed"),
            404 or 410 => (CalDavFailure.NotFound, "not found"),
            412 => (CalDavFailure.Conflict, "it changed on the server"),
            // Before the 5xx arm: 501 says the server lacks the feature, which waiting won't change.
            405 or 501 => (CalDavFailure.Rejected, "the server does not support this request"),
            429 or >= 500 => (CalDavFailure.RetryLater, "the server is busy or failing"),
            _ => (CalDavFailure.Rejected, "the server refused the request"),
        };
        return new CalDavException(failure, $"{url.Host}: {message} ({status.ToString(System.Globalization.CultureInfo.InvariantCulture)})")
        {
            Status = status,
            RetryAfter = retry is { } r && r > TimeSpan.Zero ? r : null,
        };
    }

    /// <summary>A 2xx answer: the address that gave it (after redirects), its status, ETag header and body.</summary>
    private sealed record Answer(Uri Url, int Status, string? ETag, string Body);

    [GeneratedRegex(@"^[A-Za-z0-9_.-]{1,200}\.ics$", RegexOptions.CultureInvariant)]
    private static partial Regex ResourceName();
}
