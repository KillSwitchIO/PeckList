namespace PeckList.Core.Calendars;

/// <summary>What went wrong talking to a calendar service; the sync engine decides what to do on it.</summary>
public enum CalendarProblemKind
{
    /// <summary>The service refused the password or token. The account stops until the person reconnects.</summary>
    Auth,

    /// <summary>The calendar or event is not there (any more).</summary>
    NotFound,

    /// <summary>The etag sent was stale (412): someone changed the event since it was read.</summary>
    Conflict,

    /// <summary>The sync token is no longer accepted: ask again for a full listing.</summary>
    SyncTokenExpired,

    /// <summary>Too many requests; try again after <see cref="CalendarProblem.RetryAfter"/> when given.</summary>
    RateLimited,

    /// <summary>The service could not be reached, timed out or failed (5xx). Tried again later.</summary>
    Unavailable,

    /// <summary>The service refused the request for a reason it gave (403, a 4xx). Shown on the link.</summary>
    Refused,
}

/// <summary>
/// A calendar service's failure, typed so the engine can switch on it. The message reaches logs and
/// may reach the person: it never holds a secret, a URL with its query, or event content.
/// </summary>
/// <param name="code">A snake_case code the API can pass on (<c>calendar_auth_failed</c>, ...).</param>
public sealed class CalendarProblem(CalendarProblemKind kind, string code, string message, TimeSpan? retryAfter = null, Exception? inner = null)
    : Exception(message, inner)
{
    /// <summary>What went wrong.</summary>
    public CalendarProblemKind Kind { get; } = kind;

    /// <summary>A snake_case code for the API and the stored link problem.</summary>
    public string Code { get; } = code;

    /// <summary>How long the service asked to wait, when it said.</summary>
    public TimeSpan? RetryAfter { get; } = retryAfter;

    /// <summary>Worth trying again later without the person doing anything.</summary>
    public bool Transient => Kind is CalendarProblemKind.Unavailable or CalendarProblemKind.RateLimited;

    /// <summary>The call that failed (<see cref="CalendarCalls"/>), for the log; null when nobody said.</summary>
    public string? Call { get; private init; }

    /// <summary>The event the failed call was about, for the log; null for calls about no one event.</summary>
    public string? EventId { get; private init; }

    /// <summary>
    /// This problem, saying which call failed and on which event. A call already named stays: a token
    /// refresh that failed inside an update is still the refresh's failure.
    /// </summary>
    public CalendarProblem At(string call, string? eventId = null) =>
        new(Kind, Code, Message, RetryAfter, this) { Call = Call ?? call, EventId = EventId ?? Loggable(eventId) };

    /// <summary>The most an id is kept to for the log.</summary>
    public const int MaxLoggedId = 100;

    /// <summary>
    /// An event id fit for one log line. A CalDAV id is the href the server sent: a hostile server (or
    /// an invite's UID) can put line breaks in it, it can be long, and its path usually names the
    /// person. So only its last path segment, without control characters, at most <see cref="MaxLoggedId"/>.
    /// </summary>
    public static string? Loggable(string? eventId)
    {
        if (eventId is null) return null;
        var trimmed = eventId.TrimEnd('/');
        var last = trimmed[(trimmed.LastIndexOf('/') + 1)..];
        var clean = new string([.. last.Where(each => !char.IsControl(each))]);
        return clean.Length > MaxLoggedId ? clean[..MaxLoggedId] : clean;
    }

    /// <summary>One line for the log: the code, the service's words (status and reason, never content), the call and the event.</summary>
    public string Describe() =>
        $"{Code} ({Message}){(Call is null ? "" : " in " + Call)}{(EventId is null ? "" : " for event " + EventId)}";
}

/// <summary>The port calls a <see cref="CalendarProblem"/> can name.</summary>
public static class CalendarCalls
{
    public const string List = "list";
    public const string Create = "create";
    public const string Update = "update";
    public const string Delete = "delete";
    public const string Watch = "watch";
    public const string Refresh = "refresh";
}
