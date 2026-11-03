using PeckList.Core.Telemetry;

namespace PeckList.Core.Tests;

public sealed class TelemetryBucketsTests
{
    [Theory]
    [InlineData(0, "0")]
    [InlineData(1, "1")]
    [InlineData(5, "2-5")]
    [InlineData(6, "6-20")]
    [InlineData(100, "21-100")]
    [InlineData(2000, "501-2000")]
    [InlineData(2001, "2001+")]
    public void Counts_fall_into_buckets(long count, string bucket) => Assert.Equal(bucket, TelemetryBuckets.Count(count));

    [Theory]
    [InlineData(1000, "<1MB")]
    [InlineData(5L << 20, "1-10MB")]
    [InlineData(500L << 20, "100MB-1GB")]
    [InlineData(20L << 30, "10GB+")]
    public void Sizes_fall_into_buckets(long bytes, string bucket) => Assert.Equal(bucket, TelemetryBuckets.Bytes(bytes));

    [Theory]
    [InlineData("0.3.0", "release")]
    [InlineData("0.3.0+20261030", "release")]
    [InlineData("0.3.0-rc.1", "pre")]
    [InlineData("0.3.1-edge.1a2b3c4d", "edge")]
    [InlineData("0.0.0-dev", "dev")]
    [InlineData("0.0.0", "dev")]
    public void The_channel_comes_from_the_version(string version, string channel) =>
        Assert.Equal(channel, TelemetryBuckets.ChannelOf(version));

    [Fact]
    public void A_ping_with_anything_but_buckets_and_switches_is_refused()
    {
        var good = Ping();
        Assert.Null(TelemetryBuckets.Problem(good));
        Assert.Equal("installId", TelemetryBuckets.Problem(good with { InstallId = "my-server" }));
        Assert.Equal("channel", TelemetryBuckets.Problem(good with { Channel = "nightly" }));
        Assert.Equal("version", TelemetryBuckets.Problem(good with { Version = "0.3.0 (Ben's box)" }));
        Assert.Equal("schema", TelemetryBuckets.Problem(good with { Schema = 0 }));
        Assert.Equal("text", TelemetryBuckets.Problem(good with { Runtime = good.Runtime with { Os = new string('x', 41) } }));
    }

    public static TelemetryPing Ping(string? installId = null, string version = "0.3.0") => new()
    {
        InstallId = installId ?? Guid.NewGuid().ToString(),
        Version = version,
        Channel = TelemetryBuckets.ChannelOf(version),
        InstallAgeDays = 12,
        Runtime = new TelemetryRuntime("linux", "x64", true, "10.0.0", "sqlite", "1-10MB"),
        Setup = new TelemetrySetup(true, false, 1, "invite", "daily", true, "0", false),
        Scale = new TelemetryScale("2-5", "6-20", "1", "21-100", "101-500", "1-10MB"),
    };
}
