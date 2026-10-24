using Punchlist.Core.Sync;

namespace Punchlist.Core.Tests;

/// <summary>The server's own stamps sort after what devices sent, however fast their clocks.</summary>
public sealed class ServerClockTests
{
    private static readonly DateTimeOffset Start = new(2026, 10, 24, 19, 55, 22, 889, TimeSpan.Zero);

    private sealed class Fixed(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    [Fact]
    public void Stamps_after_a_stamp_seen_from_a_device_whose_clock_runs_ahead()
    {
        var clock = new ServerClock(new Fixed(Start));
        var device = "2026-10-24T19:55:22.966Z-0003-hunt2";
        Assert.True(Hlc.Compare(clock.Next(), device) < 0);
        clock.Observe(device);
        var next = clock.Next();
        Assert.True(Hlc.Compare(next, device) > 0, next);
        Assert.Equal("2026-10-24T19:55:22.966Z-0004-server", next);
    }

    [Fact]
    public void Leaves_out_stamps_more_than_a_day_ahead_and_ones_that_are_not_stamps()
    {
        var clock = new ServerClock(new Fixed(Start));
        clock.Observe("2026-10-26T00:00:00.000Z-0000-badclock");
        clock.Observe("yesterday");
        clock.Observe(null);
        Assert.Equal("2026-10-24T19:55:22.889Z-0000-server", clock.Next());
    }

    [Fact]
    public void The_stamp_after_one_moves_its_counter_or_at_the_last_its_time()
    {
        Assert.Equal("2026-10-24T19:55:22.966Z-0004-server", Hlc.After("2026-10-24T19:55:22.966Z-0003-hunt2", "server"));
        Assert.Equal("2026-10-24T19:55:22.967Z-0000-server", Hlc.After("2026-10-24T19:55:22.966Z-9999-hunt2", "server"));
    }
}
