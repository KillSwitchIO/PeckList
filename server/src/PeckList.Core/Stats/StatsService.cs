using PeckList.Core.Accounts;

namespace PeckList.Core.Stats;

/// <summary>A task as the stats see it: no title, no notes, nothing but what is counted.</summary>
public sealed record TaskFacts(string OwnerId, string? CreatedBy, string? Status, string? CompletedAt);

/// <summary>A list as the stats see it.</summary>
public sealed record ListFacts(string OwnerId, string? Visibility, bool Inbox);

/// <summary>When someone was last seen and how many devices synced lately (from the access log).</summary>
public sealed record Activity(string AccountId, DateTimeOffset? LastActive, int Devices);

/// <summary>What the stats are made from: the entity store (live entities only) and the access log.</summary>
public interface IStatsSource
{
    /// <summary>Changes whenever any entity is written: the stats are refreshed after syncs.</summary>
    Task<long> VersionAsync(CancellationToken cancellation = default);

    Task<IReadOnlyList<TaskFacts>> TasksAsync(CancellationToken cancellation = default);

    Task<IReadOnlyList<ListFacts>> ListsAsync(CancellationToken cancellation = default);

    /// <summary>Bytes of stored entities per owner.</summary>
    Task<IReadOnlyDictionary<string, long>> StorageAsync(CancellationToken cancellation = default);

    /// <summary>Per person: their latest request or event, and distinct devices that synced since <paramref name="devicesSince"/>.</summary>
    Task<IReadOnlyList<Activity>> ActivityAsync(DateTimeOffset devicesSince, CancellationToken cancellation = default);
}

public sealed record MonthCount(string Month, int Closed);

/// <summary>One person's numbers (spec: Server stats). Counts only, never content.</summary>
public sealed record UserStats(
    string Id,
    string Username,
    int OpenTasks,
    int ClosedTasks,
    int ClosedThisMonth,
    int CreatedTasks,
    int Lists,
    int SharedLists,
    long StorageBytes,
    int Devices,
    DateTimeOffset? LastActive,
    IReadOnlyList<MonthCount> ClosedByMonth);

public sealed record ServerStats(
    DateTimeOffset Computed,
    string TimeZone,
    int Users,
    int OpenTasks,
    int ClosedTasks,
    int ClosedThisMonth,
    int Lists,
    int SharedLists,
    long StorageBytes,
    IReadOnlyList<MonthCount> ClosedByMonth,
    IReadOnlyList<UserStats> People);

/// <summary>
/// Server stats in the spirit of Immich's: totals, then a row per person, with closed tasks per month
/// for the last 12 months in the server's time zone. Kept in memory and made again when the data
/// has changed (a sync wrote something) or the cached copy is a few minutes old.
/// </summary>
public sealed class StatsService(IStatsSource source, IAccountStore accounts, TimeProvider time, TimeZoneInfo? zone = null)
{
    /// <summary>Devices count when they synced within this many days.</summary>
    public const int DeviceDays = 30;

    private static readonly TimeSpan MaxAge = TimeSpan.FromMinutes(5);
    private readonly TimeZoneInfo zone = zone ?? TimeZoneInfo.Local;
    private readonly SemaphoreSlim gate = new(1, 1);
    private (ServerStats Stats, long Version)? cached;

    public async Task<ServerStats> GetAsync(CancellationToken cancellation = default)
    {
        var version = await source.VersionAsync(cancellation);
        if (Fresh(version) is { } hit) return hit;
        await gate.WaitAsync(cancellation);
        try
        {
            if (Fresh(version) is { } again) return again;
            var stats = await ComputeAsync(cancellation);
            cached = (stats, version);
            return stats;
        }
        finally
        {
            gate.Release();
        }
    }

    /// <summary>One person's numbers, the same as the admin sees.</summary>
    public async Task<UserStats?> ForAsync(string accountId, CancellationToken cancellation = default) =>
        (await GetAsync(cancellation)).People.FirstOrDefault(person => person.Id == accountId);

    private ServerStats? Fresh(long version) =>
        cached is { } hit && hit.Version == version && time.GetUtcNow() - hit.Stats.Computed < MaxAge ? hit.Stats : null;

    private async Task<ServerStats> ComputeAsync(CancellationToken cancellation)
    {
        var now = time.GetUtcNow();
        var thisMonth = Month(now);
        var months = Enumerable.Range(0, 12).Select(back => Month(TimeZoneInfo.ConvertTime(now, zone).AddMonths(-back))).Reverse().ToList();
        var people = await accounts.ListAsync(cancellation);
        var tasks = await source.TasksAsync(cancellation);
        // Everyone has an inbox: the lists they made count.
        var lists = (await source.ListsAsync(cancellation)).Where(list => !list.Inbox).ToList();
        var storage = await source.StorageAsync(cancellation);
        var activity = (await source.ActivityAsync(now.AddDays(-DeviceDays), cancellation)).ToDictionary(each => each.AccountId);

        var closedMonth = new Dictionary<(string Owner, string Month), int>();
        var open = new Dictionary<string, int>();
        var closed = new Dictionary<string, int>();
        var created = new Dictionary<string, int>();
        foreach (var task in tasks)
        {
            if (task.CreatedBy is { } maker) Add(created, maker);
            if (task.Status is "done" or "wontdo")
            {
                Add(closed, task.OwnerId);
                if (task.CompletedAt is { } at && DateTimeOffset.TryParse(at, System.Globalization.CultureInfo.InvariantCulture,
                        System.Globalization.DateTimeStyles.AssumeUniversal, out var when))
                {
                    var key = (task.OwnerId, Month(when));
                    closedMonth[key] = closedMonth.GetValueOrDefault(key) + 1;
                }
            }
            else
            {
                Add(open, task.OwnerId);
            }
        }
        var listCount = lists.GroupBy(list => list.OwnerId).ToDictionary(group => group.Key, group => group.Count());
        var sharedCount = lists.Where(list => list.Visibility == "shared").GroupBy(list => list.OwnerId).ToDictionary(group => group.Key, group => group.Count());

        IReadOnlyList<MonthCount> ByMonth(Func<string, bool> owner) =>
            [.. months.Select(month => new MonthCount(month, closedMonth.Where(pair => pair.Key.Month == month && owner(pair.Key.Owner)).Sum(pair => pair.Value)))];

        var rows = people.OrderBy(person => person.Username, StringComparer.Ordinal).Select(person => new UserStats(
            person.Id,
            person.Username,
            open.GetValueOrDefault(person.Id),
            closed.GetValueOrDefault(person.Id),
            closedMonth.GetValueOrDefault((person.Id, thisMonth)),
            created.GetValueOrDefault(person.Id),
            listCount.GetValueOrDefault(person.Id),
            sharedCount.GetValueOrDefault(person.Id),
            storage.GetValueOrDefault(person.Id),
            activity.GetValueOrDefault(person.Id)?.Devices ?? 0,
            activity.GetValueOrDefault(person.Id)?.LastActive,
            ByMonth(owner => owner == person.Id))).ToList();

        return new ServerStats(
            now,
            zone.Id,
            people.Count,
            rows.Sum(row => row.OpenTasks),
            rows.Sum(row => row.ClosedTasks),
            rows.Sum(row => row.ClosedThisMonth),
            rows.Sum(row => row.Lists),
            rows.Sum(row => row.SharedLists),
            storage.Values.Sum(),
            ByMonth(owner => people.Any(person => person.Id == owner)),
            rows);
    }

    private string Month(DateTimeOffset when) =>
        TimeZoneInfo.ConvertTime(when, zone).ToString("yyyy-MM", System.Globalization.CultureInfo.InvariantCulture);

    private static void Add(Dictionary<string, int> counts, string key) => counts[key] = counts.GetValueOrDefault(key) + 1;
}
