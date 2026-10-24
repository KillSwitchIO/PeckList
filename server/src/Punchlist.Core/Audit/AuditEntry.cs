namespace Punchlist.Core.Audit;

/// <summary>The two streams (spec: Access and event log).</summary>
public static class AuditKind
{
    /// <summary>Sign-ins, account and role changes, sharing, settings, backups: what people did.</summary>
    public const string Event = "event";

    /// <summary>Every API and sign-in request: who, from where, which route, the answer and how long.</summary>
    public const string Access = "access";
}

/// <summary>How an event or request ended.</summary>
public static class AuditOutcome
{
    public const string Ok = "ok";

    /// <summary>Wrong password, a provider refusing, a sign-in that did not work.</summary>
    public const string Failed = "failed";

    /// <summary>Not allowed (403).</summary>
    public const string Denied = "denied";

    /// <summary>The server said no to the request itself (bad input, not found, a rule).</summary>
    public const string Refused = "refused";

    /// <summary>Too many attempts (429).</summary>
    public const string Throttled = "throttled";

    /// <summary>An account locked after failed sign-ins (423).</summary>
    public const string Locked = "locked";

    /// <summary>A provider let someone in who now waits for an admin.</summary>
    public const string Pending = "pending";

    public const string Error = "error";

    /// <summary>The outcome an HTTP status means.</summary>
    public static string Of(int status) => status switch
    {
        < 400 => Ok,
        401 => Failed,
        403 => Denied,
        423 => Locked,
        429 => Throttled,
        >= 500 => Error,
        _ => Refused,
    };
}

/// <summary>
/// One entry of the access or event log. Who did it (and the admin viewing as them, if one was),
/// what to whom, how it ended, and from where. Never request bodies, query strings or task content:
/// <see cref="Route"/> is the route template and <see cref="Detail"/> a short note.
/// </summary>
public sealed record AuditEntry
{
    /// <summary>Sortable by time (a ULID).</summary>
    public required string Id { get; init; }

    public required DateTimeOffset Time { get; init; }

    /// <summary><see cref="AuditKind"/>.</summary>
    public required string Kind { get; init; }

    /// <summary><c>auth.sign-in</c>, <c>admin.role-changed</c>, ...; for access entries <c>request</c>.</summary>
    public required string Type { get; init; }

    /// <summary><see cref="AuditOutcome"/>.</summary>
    public required string Outcome { get; init; }

    public string? ActorId { get; init; }
    public string? ActorName { get; init; }

    /// <summary>The admin viewing the app as the actor, when one was.</summary>
    public string? ImpersonatorId { get; init; }

    public string? ImpersonatorName { get; init; }
    public string? TargetId { get; init; }
    public string? TargetName { get; init; }
    public string? Ip { get; init; }

    /// <summary>The User-Agent, cut short.</summary>
    public string? Device { get; init; }

    public string? Method { get; init; }

    /// <summary>The route template (<c>/api/admin/users/{id}/role</c>), never the query string.</summary>
    public string? Route { get; init; }

    public int? Status { get; init; }
    public int? DurationMs { get; init; }
    public string? RequestId { get; init; }

    /// <summary>A short note: the new role, the backup's name, the settings changed (names, never values).</summary>
    public string? Detail { get; init; }
}

/// <summary>What the dashboard asks for. Every filter is optional.</summary>
public sealed record AuditQuery
{
    public string Kind { get; init; } = AuditKind.Event;

    /// <summary>Matches type, actor, target, impersonator, IP, route and detail.</summary>
    public string? Text { get; init; }

    /// <summary>Entries where this person (name or id) is the actor, the target or the impersonator.</summary>
    public string? User { get; init; }

    /// <summary>An exact type, or a prefix ending in a dot (<c>auth.</c>).</summary>
    public string? Type { get; init; }

    public string? Outcome { get; init; }
    public string? Ip { get; init; }
    public DateTimeOffset? From { get; init; }
    public DateTimeOffset? To { get; init; }

    /// <summary>Oldest first instead of newest first.</summary>
    public bool Ascending { get; init; }

    public int Offset { get; init; }
    public int Limit { get; init; } = 100;
}

/// <summary>A page of entries; <see cref="More"/> when the query has more after it.</summary>
public sealed record AuditPage(IReadOnlyList<AuditEntry> Entries, bool More);

/// <summary>The access and event log's own store, apart from synced data and never in backups.</summary>
public interface IAuditStore
{
    Task AppendAsync(IReadOnlyList<AuditEntry> entries, CancellationToken cancellation = default);

    Task<AuditPage> QueryAsync(AuditQuery query, CancellationToken cancellation = default);

    /// <summary>Entries of a kind older than <paramref name="before"/>, oldest first, a page at a time (for archiving).</summary>
    Task<IReadOnlyList<AuditEntry>> OlderAsync(string kind, DateTimeOffset before, int limit, CancellationToken cancellation = default);

    /// <summary>Delete entries of a kind older than <paramref name="before"/>; how many went.</summary>
    Task<int> PruneAsync(string kind, DateTimeOffset before, CancellationToken cancellation = default);
}
