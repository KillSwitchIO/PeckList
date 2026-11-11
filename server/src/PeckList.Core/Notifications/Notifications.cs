using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using PeckList.Core.Sharing;

namespace PeckList.Core.Notifications;

/// <summary>What a notification is about (spec: PL-061).</summary>
public static class NotificationKind
{
    /// <summary>Someone assigned me a task.</summary>
    public const string Assigned = "assigned";

    /// <summary>Someone assigned a task to a group I am in: first to call dibs takes it (R-FB-107).</summary>
    public const string GroupAssigned = "groupAssigned";

    /// <summary>Someone in the group called dibs on a task assigned to it (R-FB-107).</summary>
    public const string Claimed = "claimed";

    /// <summary>Someone commented on a task I can see (R-FB-106).</summary>
    public const string Commented = "commented";

    /// <summary>Someone changed their comment on a task I can see (R-FB-106).</summary>
    public const string CommentEdited = "commentEdited";

    /// <summary>Someone shared a list with me (or a group I am in).</summary>
    public const string Shared = "shared";

    /// <summary>Someone @mentioned me in a comment.</summary>
    public const string Mentioned = "mentioned";

    /// <summary>A task's reminder fired (recorded by the server's reminder sender).</summary>
    public const string Reminder = "reminder";
}

/// <summary>
/// One notification for one person. Ids only, never titles or comment text: the app shows names
/// from its own copy of the data, so nothing private sits in this table.
/// </summary>
public sealed record Notification
{
    /// <summary>Sortable by time (a ULID).</summary>
    public required string Id { get; init; }
    public required string UserId { get; init; }
    public required string Kind { get; init; }
    public required DateTimeOffset At { get; init; }

    /// <summary>Who did it (none for a reminder).</summary>
    public string? ActorId { get; init; }
    public string? TaskId { get; init; }
    public string? ListId { get; init; }
    public string? CommentId { get; init; }
    public DateTimeOffset? ReadAt { get; init; }
}

public interface INotificationStore
{
    Task AddAsync(IReadOnlyList<Notification> notifications, CancellationToken cancellation = default);

    /// <summary>A person's latest notifications, newest first.</summary>
    Task<IReadOnlyList<Notification>> ListAsync(string userId, int limit, CancellationToken cancellation = default);

    Task<int> UnreadCountAsync(string userId, CancellationToken cancellation = default);

    /// <summary>Mark some (null: all) of a person's notifications read.</summary>
    Task MarkReadAsync(string userId, IReadOnlyCollection<string>? ids, DateTimeOffset at, CancellationToken cancellation = default);

    /// <summary>Clear some (null: all) of a person's notifications.</summary>
    Task DeleteAsync(string userId, IReadOnlyCollection<string>? ids, CancellationToken cancellation = default);

    /// <summary>Clear everyone's notifications older than <paramref name="before"/>; how many went.</summary>
    Task<int> PruneAsync(DateTimeOffset before, CancellationToken cancellation = default);
}

/// <summary>One pushed change a notification may come from. <paramref name="Before"/> is null for a new entity.</summary>
public sealed record NotableChange(string Collection, string Id, JsonObject? Before, JsonObject After);

/// <summary>Hears about changes devices push that may notify someone.</summary>
public interface INotificationSink
{
    Task ChangedAsync(string userId, IReadOnlyList<NotableChange> changes, CancellationToken cancellation = default);
}

/// <summary>Who to notify about what, from pushed changes (spec: PL-061). Plain data in, data out.</summary>
public static partial class NotificationRules
{
    /// <summary>The collections whose changes may notify someone.</summary>
    public static bool Watched(string collection) => collection is "tasks" or "listMembers" or "comments";

    // The web app's comment text (web/src/core/commentText.ts), read the same way here (audit D3):
    // paragraphs, then left to right, `code` and a link's label skipped, **bold** and *italic* read
    // inside, and an @ where a word begins (the start, after a space or "("): a letter or digit, then
    // letters, digits and . _ -, not ending in a mark, so "@sam." names sam. Both read
    // schema/fixtures/mentions/cases.json in their tests.
    // Spaces are JavaScript's (its \s and trim), not .NET's: U+FEFF counts, U+0085 doesn't. A letter
    // or digit beyond U+FFFF is a letter, as the app's Unicode patterns read it (see Shadow).
    private const string Space = @"\t\n\v\f\r \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF";

    private static readonly char[] SpaceChars =
        [.. "\t\n\v\f\r \u00A0\u1680\u2028\u2029\u202F\u205F\u3000\uFEFF", .. Enumerable.Range(0x2000, 11).Select(each => (char)each)];

    [GeneratedRegex(@"\G`[^`\n]+`")]
    private static partial Regex CodeSpan();

    [GeneratedRegex(@"\G\[[^\]\n]+\]\(([^)" + Space + @"]+)\)")]
    private static partial Regex LinkSpan();

    [GeneratedRegex(@"^(https?://|mailto:)", RegexOptions.IgnoreCase)]
    private static partial Regex FollowedHref();

    [GeneratedRegex(@"\G\*\*(?=[^" + Space + @"])([^\n]*?[^" + Space + @"])\*\*")]
    private static partial Regex Bold();

    [GeneratedRegex(@"\G\*(?=[^" + Space + @"])([^*\n]*?[^" + Space + @"])\*")]
    private static partial Regex Italic();

    [GeneratedRegex(@"\G_(?=[^" + Space + @"])([^_\n]*?[^" + Space + @"])_(?![\p{L}\p{N}])")]
    private static partial Regex UnderscoreItalic();

    [GeneratedRegex(@"\Ghttps?://[^" + Space + @"<>()]+[^" + Space + @"<>().,;:!?'""]")]
    private static partial Regex BareLink();

    [GeneratedRegex(@"\G@([\p{L}\p{N}](?:[\p{L}\p{N}._-]*[\p{L}\p{N}])?)")]
    private static partial Regex Mention();

    [GeneratedRegex(@"\r\n?")]
    private static partial Regex LineEnd();

    [GeneratedRegex(@"\n{2,}")]
    private static partial Regex ParagraphBreak();

    /// <summary>The names a comment body @mentions, in order (repeats kept).</summary>
    public static IReadOnlyList<string> MentionedNames(string body)
    {
        var names = new List<string>();
        foreach (var paragraph in ParagraphBreak().Split(LineEnd().Replace(body, "\n")))
        {
            var text = paragraph.Trim(SpaceChars);
            if (text.Length > 0) MentionsIn(text, Shadow(text), names);
        }
        return names;
    }

    /// <summary>
    /// The text with each letter or digit beyond U+FFFF (two UTF-16 units) written as "aa", for the
    /// patterns to match on: .NET's \p{L} sees one unit at a time, the app's Unicode patterns the
    /// whole character. The same length, so a match is at the same place in the text itself.
    /// </summary>
    private static string Shadow(string text)
    {
        char[]? shadow = null;
        for (var at = 0; at + 1 < text.Length; at++)
        {
            if (!char.IsSurrogatePair(text[at], text[at + 1])) continue;
            var category = CharUnicodeInfo.GetUnicodeCategory(char.ConvertToUtf32(text[at], text[at + 1]));
            if (category is <= UnicodeCategory.OtherLetter or (>= UnicodeCategory.DecimalDigitNumber and <= UnicodeCategory.OtherNumber))
            {
                shadow ??= text.ToCharArray();
                shadow[at] = shadow[at + 1] = 'a';
            }
            at++;
        }
        return shadow is null ? text : new string(shadow);
    }

    private static void MentionsIn(string text, string shadow, List<string> names)
    {
        var at = 0;
        while (at < text.Length)
        {
            var wordStart = at == 0 || SpaceChars.Contains(shadow[at - 1]) || shadow[at - 1] == '(';
            var skip = CodeSpan().Match(shadow, at);
            if (!skip.Success && LinkSpan().Match(shadow, at) is { Success: true } link && FollowedHref().IsMatch(link.Groups[1].Value)) skip = link;
            if (skip.Success)
            {
                at += skip.Length;
                continue;
            }
            var inner = Bold().Match(shadow, at);
            if (!inner.Success) inner = Italic().Match(shadow, at);
            if (!inner.Success && wordStart) inner = UnderscoreItalic().Match(shadow, at);
            if (inner.Success)
            {
                var part = inner.Groups[1];
                MentionsIn(text.Substring(part.Index, part.Length), part.Value, names);
                at += inner.Length;
                continue;
            }
            if (wordStart && BareLink().Match(shadow, at) is { Success: true } bare)
            {
                at += bare.Length;
                continue;
            }
            if (wordStart && Mention().Match(shadow, at) is { Success: true } mention)
            {
                var name = mention.Groups[1];
                names.Add(text.Substring(name.Index, name.Length));
                at += mention.Length;
                continue;
            }
            at++;
        }
    }

    public sealed record Found(string UserId, string Kind, string? TaskId, string? ListId, string? CommentId);

    /// <summary>
    /// What one change tells whom. <paramref name="actorId"/> is never told about their own doing;
    /// <paramref name="userByName"/> finds an account by username (for @mentions), and only people
    /// who can see the task hear of a mention.
    /// </summary>
    public static IEnumerable<Found> For(string actorId, NotableChange change, SharingIndex index, Func<string, string?> userByName)
    {
        if (change.After["deletedAt"] is not null) return [];
        var found = change.Collection switch
        {
            "tasks" => Assignments(actorId, change, index),
            "listMembers" when change.Before is null || change.Before["deletedAt"] is not null =>
                Field(change.After, "principal") is { } principal
                    ? index.PeopleOf(principal).Select(user =>
                        new Found(user, NotificationKind.Shared, null, Field(change.After, "listId"), null))
                    : [],
            // A mention says more than a comment, so it comes first (one notice per person).
            "comments" when change.Before is null =>
                Mentioned(change, index, userByName).Concat(Commented(change, index, NotificationKind.Commented)),
            "comments" when Field(change.Before, "body") != Field(change.After, "body") =>
                Commented(change, index, NotificationKind.CommentEdited),
            _ => [],
        };
        return found.Where(each => each.UserId != actorId).DistinctBy(each => each.UserId);
    }

    /// <summary>
    /// A task newly assigned to a person tells them; newly assigned to a group, its members
    /// (R-FB-107); a group's task taken by one of them (dibs: the group out, they in) tells the
    /// rest of the group (R-FB-108).
    /// </summary>
    private static IEnumerable<Found> Assignments(string actorId, NotableChange change, SharingIndex index)
    {
        static HashSet<string> In(JsonObject? task)
        {
            var set = new HashSet<string>(StringComparer.Ordinal);
            if (task?["assignees"] is not JsonObject assignees) return set;
            foreach (var (principal, state) in assignees)
            {
                if (state?["in"] is JsonValue value && value.TryGetValue<bool>(out var isIn) && isIn) set.Add(principal);
            }
            return set;
        }
        var before = In(change.Before);
        var after = In(change.After);
        var listId = Field(change.After, "listId");
        var added = after.Where(principal => !before.Contains(principal)).ToList();
        var direct = added.Where(principal => !principal.StartsWith("group:", StringComparison.Ordinal))
            .SelectMany(index.PeopleOf)
            .Select(user => new Found(user, NotificationKind.Assigned, change.Id, listId, null));
        var group = added.Where(principal => principal.StartsWith("group:", StringComparison.Ordinal))
            .SelectMany(index.PeopleOf)
            .Select(user => new Found(user, NotificationKind.GroupAssigned, change.Id, listId, null));
        var claimed = added.Contains($"user:{actorId}")
            ? before.Where(principal => principal.StartsWith("group:", StringComparison.Ordinal) && !after.Contains(principal))
                .SelectMany(index.PeopleOf)
                .Select(user => new Found(user, NotificationKind.Claimed, change.Id, listId, null))
            : [];
        return direct.Concat(group).Concat(claimed);
    }

    /// <summary>Everyone who can see the comment's task hears of it (R-FB-106).</summary>
    private static IEnumerable<Found> Commented(NotableChange change, SharingIndex index, string kind)
    {
        if (Field(change.After, "taskId") is not { } taskId) return [];
        return index.Viewers(taskId).Order(StringComparer.Ordinal)
            .Select(user => new Found(user, kind, taskId, null, change.Id));
    }

    private static IEnumerable<Found> Mentioned(NotableChange change, SharingIndex index, Func<string, string?> userByName)
    {
        if (Field(change.After, "taskId") is not { } taskId || Field(change.After, "body") is not { } body) return [];
        var viewers = index.Viewers(taskId);
        return MentionedNames(body)
            .Select(userByName)
            .OfType<string>()
            .Where(viewers.Contains)
            .Select(user => new Found(user, NotificationKind.Mentioned, taskId, null, change.Id));
    }

    private static string? Field(JsonObject? doc, string name) =>
        doc?[name] is JsonValue value && value.TryGetValue<string>(out var text) ? text : null;
}

/// <summary>
/// The person's notification switches (settings.notifications, schema 17, PL-115): which kinds
/// reach them as a push, a check-in notice or a reminder. Absent, or an absent switch: on. The
/// notifications feed itself lists every kind regardless.
/// </summary>
public static class NotificationSwitches
{
    /// <summary>The switch a kind of notification is behind.</summary>
    public static string SwitchOf(string kind) => kind switch
    {
        NotificationKind.Reminder => "reminders",
        NotificationKind.Shared => "shares",
        NotificationKind.Commented or NotificationKind.CommentEdited or NotificationKind.Mentioned => "comments",
        _ => "assignments",
    };

    public static bool Allows(JsonObject? settings, string kind) =>
        settings?["notifications"] is not JsonObject switches
        || switches[SwitchOf(kind)] is not JsonValue value
        || !value.TryGetValue<bool>(out var on)
        || on;
}

