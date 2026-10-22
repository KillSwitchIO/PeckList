using Punchlist.Core.Accounts;
using Punchlist.Core.Stats;

namespace Punchlist.Core.Tests;

public sealed class StatsServiceTests
{
    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private sealed class Clock(DateTimeOffset now) : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = now;
        public override DateTimeOffset GetUtcNow() => Now;
    }

    private sealed class Source : IStatsSource
    {
        public long Version { get; set; } = 1;
        public int Reads { get; private set; }
        public List<TaskFacts> Tasks { get; } = [];
        public List<ListFacts> Lists { get; } = [];

        public Task<long> VersionAsync(CancellationToken cancellation = default) => Task.FromResult(Version);

        public Task<IReadOnlyList<TaskFacts>> TasksAsync(CancellationToken cancellation = default)
        {
            Reads++;
            return Task.FromResult<IReadOnlyList<TaskFacts>>([.. Tasks]);
        }

        public Task<IReadOnlyList<ListFacts>> ListsAsync(CancellationToken cancellation = default) => Task.FromResult<IReadOnlyList<ListFacts>>([.. Lists]);

        public Task<IReadOnlyDictionary<string, long>> StorageAsync(CancellationToken cancellation = default) =>
            Task.FromResult<IReadOnlyDictionary<string, long>>(new Dictionary<string, long> { ["U1"] = 2048, ["U2"] = 512 });

        public Task<IReadOnlyList<Activity>> ActivityAsync(DateTimeOffset devicesSince, CancellationToken cancellation = default) =>
            Task.FromResult<IReadOnlyList<Activity>>([new Activity("U1", new DateTimeOffset(2026, 10, 22, 9, 0, 0, TimeSpan.Zero), 2)]);
    }

    private sealed class Accounts : IAccountStore
    {
        private static Account Make(string id, string name) => new()
        {
            Id = id, Username = name, SecurityStamp = "s", CreatedAt = DateTimeOffset.UnixEpoch,
        };

        public Task<IReadOnlyList<Account>> ListAsync(CancellationToken cancellation = default) =>
            Task.FromResult<IReadOnlyList<Account>>([Make("U2", "sam"), Make("U1", "ben")]);

        public Task<Account?> FindByIdAsync(string id, CancellationToken cancellation = default) => throw new NotSupportedException();
        public Task<Account?> FindByUsernameAsync(string username, CancellationToken cancellation = default) => throw new NotSupportedException();
        public Task CreateAsync(Account account, CancellationToken cancellation = default) => throw new NotSupportedException();
        public Task UpdateAsync(Account account, CancellationToken cancellation = default) => throw new NotSupportedException();
        public Task<int> CountAsync(CancellationToken cancellation = default) => throw new NotSupportedException();
        public Task<Account?> FindByFriendCodeAsync(string code, CancellationToken cancellation = default) => throw new NotSupportedException();
    }

    [Fact]
    public async Task Counts_open_closed_and_created_per_person_and_closed_per_month_in_the_server_time_zone()
    {
        var source = new Source();
        source.Tasks.AddRange([
            new TaskFacts("U1", "U1", "open", null),
            new TaskFacts("U1", "U1", "done", "2026-10-03T08:00:00.000Z"),
            // 23:30 UTC on Sep 30 is already October in Berlin.
            new TaskFacts("U1", "U2", "wontdo", "2026-09-30T23:30:00.000Z"),
            new TaskFacts("U1", "U1", "done", "2026-09-15T12:00:00.000Z"),
            new TaskFacts("U1", "U1", "done", "2025-01-15T12:00:00.000Z"),
            new TaskFacts("U2", "U2", "open", null),
        ]);
        source.Lists.AddRange([new ListFacts("U1", "private", Inbox: true), new ListFacts("U1", "shared", false), new ListFacts("U2", "private", false)]);
        var berlin = TimeZoneInfo.FindSystemTimeZoneById("Europe/Berlin");
        var stats = await new StatsService(source, new Accounts(), new Clock(new(2026, 10, 22, 12, 0, 0, TimeSpan.Zero)), berlin).GetAsync(Token);

        Assert.Equal(("Europe/Berlin", 2, 2, 4, 2), (stats.TimeZone, stats.Users, stats.OpenTasks, stats.ClosedTasks, stats.ClosedThisMonth));
        Assert.Equal((2, 1, 2560L), (stats.Lists, stats.SharedLists, stats.StorageBytes));
        Assert.Equal(["ben", "sam"], stats.People.Select(person => person.Username));
        var ben = stats.People[0];
        Assert.Equal((1, 4, 2, 4, 1, 1, 2048L, 2), (ben.OpenTasks, ben.ClosedTasks, ben.ClosedThisMonth, ben.CreatedTasks, ben.Lists, ben.SharedLists, ben.StorageBytes, ben.Devices));
        Assert.Equal(12, ben.ClosedByMonth.Count);
        Assert.Equal(("2025-11", "2026-10"), (ben.ClosedByMonth[0].Month, ben.ClosedByMonth[^1].Month));
        Assert.Equal([1, 2], ben.ClosedByMonth.TakeLast(2).Select(month => month.Closed));
        Assert.Equal(3, ben.ClosedByMonth.Sum(month => month.Closed));
        var sam = stats.People[1];
        Assert.Equal((1, 0, 2, null as DateTimeOffset?), (sam.OpenTasks, sam.ClosedTasks, sam.CreatedTasks, sam.LastActive));
        Assert.Equal(ben.ClosedByMonth, stats.ClosedByMonth);
    }

    [Fact]
    public async Task Keeps_the_numbers_until_a_sync_changes_the_data_or_they_are_a_few_minutes_old()
    {
        var source = new Source();
        var clock = new Clock(new(2026, 10, 22, 12, 0, 0, TimeSpan.Zero));
        var stats = new StatsService(source, new Accounts(), clock, TimeZoneInfo.Utc);
        await stats.GetAsync(Token);
        await stats.ForAsync("U1", Token);
        Assert.Equal(1, source.Reads);
        source.Version = 2;
        await stats.GetAsync(Token);
        Assert.Equal(2, source.Reads);
        clock.Now = clock.Now.AddMinutes(6);
        await stats.GetAsync(Token);
        Assert.Equal(3, source.Reads);
        Assert.Null(await stats.ForAsync("nobody", Token));
    }
}
