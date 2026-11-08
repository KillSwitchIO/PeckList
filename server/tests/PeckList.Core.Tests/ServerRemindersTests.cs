using System.Globalization;
using System.Text.Json.Nodes;
using PeckList.Core.Push;

namespace PeckList.Core.Tests;

/// <summary>When a reminder set for a local time fires, in a person's zone.</summary>
public sealed class ServerRemindersTests
{
    private static DateTimeOffset At(string local, TimeZoneInfo zone) =>
        ServerReminders.Instants(new JsonObject { ["reminders"] = new JsonArray(new JsonObject { ["at"] = local }) }, zone).Single().At;

    [Fact]
    public void A_time_the_clocks_skip_happens_as_much_later_as_they_jumped()
    {
        var chicago = TimeZoneInfo.FindSystemTimeZoneById("America/Chicago");
        // 14 March 2027 the clocks go from 02:00 to 03:00, so 02:30 is 03:30, 08:30 UTC.
        Assert.Equal(new DateTimeOffset(2027, 3, 14, 8, 30, 0, TimeSpan.Zero), At("2027-03-14T02:30", chicago));
        Assert.Equal(new DateTimeOffset(2027, 3, 14, 7, 30, 0, TimeSpan.Zero), At("2027-03-14T01:30", chicago));
    }

    [Fact]
    public void Dates_far_outside_any_calendar_in_use_set_no_reminder()
    {
        JsonObject Starting(string start) => new()
        {
            ["schedule"] = new JsonObject { ["start"] = start },
            ["reminders"] = new JsonArray(new JsonObject { ["before"] = 30 }, new JsonObject { ["at"] = start }),
        };
        foreach (var start in new[] { "0001-01-01T00:10", "1899-12-31", "2201-01-01T09:00", "9999-12-31T23:50" })
        {
            Assert.Empty(ServerReminders.Instants(Starting(start), TimeZoneInfo.Utc));
        }
        Assert.Equal(2, ServerReminders.Instants(Starting("2200-12-31T09:00"), TimeZoneInfo.Utc).Count());
    }

    [Fact]
    public void Every_skipped_time_in_every_zone_has_a_time()
    {
        var start = new DateTimeOffset(2027, 1, 1, 0, 0, 0, TimeSpan.Zero);
        var checkedAny = false;
        foreach (var zone in TimeZoneInfo.GetSystemTimeZones())
        {
            for (var t = start; t < start.AddYears(1); t = t.AddHours(1))
            {
                var before = zone.GetUtcOffset(t);
                var after = zone.GetUtcOffset(t.AddHours(1));
                if (after <= before) continue;
                // The clocks jumped forward in this hour: every local time they skip counts at the old offset.
                for (var local = (t + before).DateTime; local <= (t.AddHours(1) + after).DateTime; local = local.AddMinutes(15))
                {
                    if (!zone.IsInvalidTime(local)) continue;
                    var text = local.ToString("yyyy-MM-dd'T'HH:mm", CultureInfo.InvariantCulture);
                    Assert.Equal(new DateTimeOffset(local - before, TimeSpan.Zero), At(text, zone));
                    checkedAny = true;
                }
            }
        }
        Assert.True(checkedAny);
    }
}
