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

    // Audit C3: a device stamping an hour ahead pushed every later server-made change an hour into
    // the future, where people's own edits to those fields lost until the wall time caught up.
    [Theory]
    [InlineData("2026-10-26T00:00:00.000Z-0000-badclock")]
    [InlineData("2026-10-24T20:55:22.889Z-0000-anhourahead")]
    [InlineData("2026-10-24T19:56:22.890Z-0000-justoveraminute")]
    [InlineData("2026-13-45T10:00:00.000Z-0000-notadate")]
    [InlineData("yesterday")]
    [InlineData(null)]
    public void Leaves_out_stamps_more_than_a_minute_ahead_and_ones_that_are_not_stamps(string? stamp)
    {
        var clock = new ServerClock(new Fixed(Start));
        clock.Observe(stamp);
        Assert.Equal("2026-10-24T19:55:22.889Z-0000-server", clock.Next());
    }

    [Fact]
    public void Follows_a_stamp_up_to_a_minute_ahead()
    {
        var clock = new ServerClock(new Fixed(Start));
        clock.Observe("2026-10-24T19:56:22.889Z-0002-alittlefast");
        Assert.Equal("2026-10-24T19:56:22.889Z-0003-server", clock.Next());
    }

    [Fact]
    public void The_stamp_after_one_moves_its_counter_or_at_the_last_its_time()
    {
        Assert.Equal("2026-10-24T19:55:22.966Z-0004-server", Hlc.After("2026-10-24T19:55:22.966Z-0003-hunt2", "server"));
        Assert.Equal("2026-10-24T19:55:22.967Z-0000-server", Hlc.After("2026-10-24T19:55:22.966Z-9999-hunt2", "server"));
    }
}
