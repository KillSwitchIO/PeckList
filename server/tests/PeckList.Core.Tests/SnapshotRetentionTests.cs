using PeckList.Core.Backup;

namespace PeckList.Core.Tests;

public class SnapshotRetentionTests
{
    // Daily snapshots at 03:00 from 2026-11-30 (a Monday) back 60 days, newest first.
    private static readonly IReadOnlyList<(string Path, DateTimeOffset Taken)> Daily = Enumerable.Range(0, 60)
        .Select(day => new DateTimeOffset(2026, 11, 30, 3, 0, 0, TimeSpan.Zero).AddDays(-day))
        .Select(taken => ($"pecklist-{taken:yyyyMMdd}.json.gz", taken))
        .ToList();

    private static List<string> Kept(int keep, int weekly)
    {
        var expired = Snapshots.Expired(Daily, keep, weekly).ToHashSet();
        return Daily.Select(each => each.Path).Where(path => !expired.Contains(path)).ToList();
    }

    [Fact]
    public void Keeps_a_week_of_dailies_and_then_the_newest_of_each_of_four_weeks()
    {
        Assert.Equal(
        [
            // The newest seven: Nov 30 back to Nov 24, which cover the weeks of Nov 30 and Nov 23.
            "pecklist-20261130.json.gz", "pecklist-20261129.json.gz", "pecklist-20261128.json.gz", "pecklist-20261127.json.gz",
            "pecklist-20261126.json.gz", "pecklist-20261125.json.gz", "pecklist-20261124.json.gz",
            // Then the newest of each of the four weeks before: their Sundays.
            "pecklist-20261122.json.gz", "pecklist-20261115.json.gz", "pecklist-20261108.json.gz", "pecklist-20261101.json.gz",
        ], Kept(7, 4));
    }

    [Fact]
    public void No_weeklies_keeps_only_the_newest()
    {
        Assert.Equal(Daily.Take(3).Select(each => each.Path), Kept(3, 0));
    }

    [Fact]
    public void Fewer_snapshots_than_the_rules_allow_are_all_kept()
    {
        Assert.Empty(Snapshots.Expired(Daily.Take(5).ToList(), 7, 4));
    }

    [Fact]
    public void Hourly_snapshots_keep_the_newest_hours_and_one_per_week()
    {
        var hourly = Enumerable.Range(0, 24 * 21)
            .Select(hour => new DateTimeOffset(2026, 11, 30, 12, 0, 0, TimeSpan.Zero).AddHours(-hour))
            .Select(taken => ($"pecklist-{taken:yyyyMMdd-HH}.json.gz", taken))
            .ToList();
        var expired = Snapshots.Expired(hourly, 7, 4).ToHashSet();
        var kept = hourly.Where(each => !expired.Contains(each.Item1)).Select(each => each.Item1).ToList();
        // Seven hours today, then the last hour of each of the three earlier weeks on file.
        Assert.Equal(10, kept.Count);
        Assert.Equal(["pecklist-20261129-23.json.gz", "pecklist-20261122-23.json.gz", "pecklist-20261115-23.json.gz"], kept[7..]);
    }
}
