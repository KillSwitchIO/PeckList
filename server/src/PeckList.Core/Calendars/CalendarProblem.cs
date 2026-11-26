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
}
