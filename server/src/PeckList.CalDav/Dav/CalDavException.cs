namespace PeckList.CalDav.Dav;

/// <summary>What went wrong talking to a CalDAV server, so the sync engine can act on it.</summary>
public enum CalDavFailure
{
    /// <summary>401: the username or app password is wrong; the person has to sign in again.</summary>
    Unauthorized,

    /// <summary>403: signed in, but not allowed (a read-only calendar, say).</summary>
    Forbidden,

    /// <summary>404 or 410: the calendar or event is gone.</summary>
    NotFound,

    /// <summary>412: the event changed on the server since its etag was read; read it again.</summary>
    Conflict,

    /// <summary>The stored sync token was refused (RFC 6578 valid-sync-token): list everything again.</summary>
    SyncTokenInvalid,

    /// <summary>The server refused what was sent (400, 409, 413, 415, 422), or doesn't support the request.</summary>
    Rejected,

    /// <summary>429, 503, another 5xx or a timeout: try again later, after <see cref="CalDavException.RetryAfter"/> if given.</summary>
    RetryLater,

    /// <summary>The server couldn't be reached (DNS, connection refused, TLS).</summary>
    Unavailable,

    /// <summary>The address is one the network policy refuses (a private address, or plain http to a public one).</summary>
    Blocked,

    /// <summary>The address answered, but not as a CalDAV server (no principal or calendar home, broken XML).</summary>
    NotCalDav,
}

/// <summary>A failed CalDAV request, with the kind of failure the engine switches on.</summary>
public sealed class CalDavException(CalDavFailure failure, string message, Exception? inner = null) : Exception(message, inner)
{
    /// <summary>What kind of failure this is.</summary>
    public CalDavFailure Failure { get; } = failure;

    /// <summary>The HTTP status, when the server answered.</summary>
    public int? Status { get; init; }

    /// <summary>How long the server asked us to wait (Retry-After), when it did.</summary>
    public TimeSpan? RetryAfter { get; init; }
}
