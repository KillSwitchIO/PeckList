namespace PeckList.Core.Api;

/// <summary>Something quick add recognised: what kind, and where it sits in the text (<c>End</c> exclusive).</summary>
public sealed record QuickToken(string Kind, int Start, int End, string Text);

/// <summary>A tag quick add names: an existing one by id, or a new one by name (id null).</summary>
public sealed record QuickTag(string? Id, string Name);

/// <summary>Someone <c>@</c> can name: the assignee picker's people.</summary>
public sealed record QuickPerson(string Principal, string Name, string? Handle);

/// <summary>A list <c>^</c> can name, in the order the app shows them (the inbox first).</summary>
public sealed record QuickList(string Id, string Name, bool IsInbox = false);

/// <summary>What quick add has to go on: the person's lists, tags and people, and their wall clock now.</summary>
public sealed record QuickAddContext(IReadOnlyList<QuickList> Lists, IReadOnlyList<(string Id, string Name)> Tags, IReadOnlyList<QuickPerson> People, DateTime Reference);

/// <summary>A local day and, when the text gave one, a time (<c>HH:mm</c>).</summary>
public sealed record QuickMoment(string Date, string? Time)
{
    public string Value => Time is null ? Date : $"{Date}T{Time}";
}

public sealed record QuickSchedule(QuickMoment Start, QuickMoment? End);

/// <summary>A line of text read as a task.</summary>
public sealed record QuickAddResult(
    string Title,
    IReadOnlyList<QuickToken> Tokens,
    QuickSchedule? Schedule,
    QuickMoment? Due,
    int? Priority,
    string? ListId,
    IReadOnlyList<QuickTag> Tags,
    IReadOnlyList<string> Assignees,
    string? Recurrence);

/// <summary>A line that could not be read within the time or memory a reading may take.</summary>
public sealed class QuickAddTooSlowException(Exception inner) : Exception("quick add ran out of time or memory", inner);

/// <summary>Every reader was busy for longer than a request should wait.</summary>
public sealed class QuickAddBusyException() : Exception("quick add is busy");

/// <summary>
/// Reads a line of text as a task, exactly as the app's quick add does (PL-137): dates and times set
/// the start, "due ..." the due date; #tag, ^list, !priority and @person pick those, and "every ..."
/// makes it repeat. Pinned by the shared cases in <c>schema/fixtures/quick-add/cases.json</c>.
/// </summary>
public interface IQuickAddReader
{
    /// <summary>The longest text read; longer is refused before reading.</summary>
    public const int MaxText = 1000;

    /// <exception cref="QuickAddTooSlowException">The line took too long or too much memory.</exception>
    /// <exception cref="QuickAddBusyException">No reader came free in time.</exception>
    Task<QuickAddResult> ReadAsync(string text, QuickAddContext context, CancellationToken cancellation = default);
}
