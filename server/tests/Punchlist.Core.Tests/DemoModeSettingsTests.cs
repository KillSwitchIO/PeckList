using System.Text.Json.Nodes;
using Punchlist.Core.Backup;
using Punchlist.Core.Configuration;

namespace Punchlist.Core.Tests;

/// <summary>What <c>DEMO_MODE</c> forces, whatever else is set (PL-117), and the seed's moving dates.</summary>
public sealed class DemoModeSettingsTests
{
    private static ServerSettings Read(Dictionary<string, string> env) =>
        ServerSettings.Read(new FileAwareSecretSource(name => env.GetValueOrDefault(name), path => throw new FileNotFoundException(path)), inContainer: true);

    private static readonly Dictionary<string, string> Against = new()
    {
        ["DEMO_MODE"] = "true",
        ["REGISTRATION"] = "closed",
        ["ACCOUNT_DELETE_GRACE_DAYS"] = "30",
        ["ATTACHMENT_MAX_MB"] = "100",
        ["TELEMETRY"] = "true",
        ["UPDATE_CHECK"] = "true",
    };

    [Fact]
    public void Demo_mode_opens_sign_up()
    {
        Assert.Equal(Registration.Open, Read(Against).Registration);
    }

    [Fact]
    public void Demo_mode_removes_deleted_accounts_at_once()
    {
        Assert.Equal(0, Read(Against).AccountDeleteGraceDays);
    }

    [Fact]
    public void Demo_mode_keeps_files_small_but_never_raises_a_lower_limit()
    {
        Assert.Equal(ServerSettings.DemoAttachmentMaxMb, Read(Against).AttachmentMaxMb);
        Assert.Equal(1, Read(new(Against) { ["ATTACHMENT_MAX_MB"] = "1" }).AttachmentMaxMb);
    }

    [Fact]
    public void Demo_mode_sends_no_usage_report_and_checks_no_releases()
    {
        var settings = Read(Against);
        Assert.False(settings.Telemetry);
        Assert.False(settings.UpdateCheck);
    }

    [Fact]
    public void A_value_saved_on_the_settings_page_cannot_undo_it()
    {
        var page = new Dictionary<string, string> { ["REGISTRATION"] = "invite", ["TELEMETRY"] = "true", ["ACCOUNT_DELETE_GRACE_DAYS"] = "7" };
        var layers = LayeredSettings.FromEnvironment(
            new FileAwareSecretSource(name => name == "DEMO_MODE" ? "true" : null, path => throw new FileNotFoundException(path)), page);
        var settings = ServerSettings.Read(layers, inContainer: true);
        Assert.Equal(Registration.Open, settings.Registration);
        Assert.False(settings.Telemetry);
        Assert.Equal(0, settings.AccountDeleteGraceDays);
    }

    [Fact]
    public void Without_demo_mode_nothing_is_forced()
    {
        var settings = Read(new(Against) { ["DEMO_MODE"] = "false" });
        Assert.False(settings.DemoMode);
        Assert.Equal(Registration.Closed, settings.Registration);
        Assert.Equal(30, settings.AccountDeleteGraceDays);
        Assert.Equal(100, settings.AttachmentMaxMb);
        Assert.True(settings.Telemetry);
        Assert.True(settings.UpdateCheck);
    }

    [Fact]
    public void Reads_the_demo_accounts_and_reset_time()
    {
        var settings = Read(new()
        {
            ["DEMO_MODE"] = "on",
            ["DEMO_ACCOUNTS"] = "Demo-Sam:try-punchlist-sam, demo-alex:try-punchlist-alex",
            ["DEMO_RESET_TIME"] = "03:30",
        });
        Assert.Equal([new DemoAccount("demo-sam", "try-punchlist-sam"), new DemoAccount("demo-alex", "try-punchlist-alex")], settings.DemoAccounts);
        Assert.Equal("03:30", settings.DemoResetTime);
        Assert.Equal("04:00", Read(new() { ["DEMO_MODE"] = "on" }).DemoResetTime);
        Assert.Equal(1440, Read(new() { ["DEMO_MODE"] = "on" }).DemoResetEvery);
        Assert.Equal(60, Read(new() { ["DEMO_MODE"] = "on", ["DEMO_RESET_EVERY"] = "60" }).DemoResetEvery);
        // Listed in logs and dumps without the password.
        Assert.Equal("demo-sam:***", settings.DemoAccounts[0].ToString());
    }

    [Theory]
    [InlineData("DEMO_ACCOUNTS", "demo-sam:short", "at least 12 characters")]
    [InlineData("DEMO_ACCOUNTS", "no-password", "is not name:password")]
    [InlineData("DEMO_ACCOUNTS", "admin:a long enough password", "is the server's admin")]
    [InlineData("DEMO_ACCOUNTS", "sam:a long enough password,Sam:another long password", "listed twice")]
    [InlineData("DEMO_RESET_TIME", "4am", "is not a time like 04:00")]
    [InlineData("DEMO_RESET_EVERY", "1h", "is not a whole number of at least 5")]
    [InlineData("AUTH_MODE", "none", "DEMO_MODE needs AUTH_MODE=local")]
    public void Refuses_demo_settings_that_cannot_work(string key, string value, string message)
    {
        var error = Assert.Throws<SettingsException>(() => Read(new() { ["DEMO_MODE"] = "true", [key] = value }));
        Assert.Contains(message, error.Message);
    }

    [Fact]
    public void Demo_accounts_need_demo_mode()
    {
        var error = Assert.Throws<SettingsException>(() => Read(new() { ["DEMO_ACCOUNTS"] = "sam:a long enough password" }));
        Assert.Contains("DEMO_ACCOUNTS needs DEMO_MODE=true", error.Message);
    }

    [Fact]
    public void Sign_ups_per_address_are_limited_by_default_and_can_be_unlimited()
    {
        Assert.Equal(5, Read([]).SignUpRateLimit);
        Assert.Equal(0, Read(new() { ["SIGNUP_RATE_LIMIT"] = "0" }).SignUpRateLimit);
        Assert.Throws<SettingsException>(() => Read(new() { ["SIGNUP_RATE_LIMIT"] = "-1" }));
    }

    [Fact]
    public void A_seeds_dates_move_on_by_whole_days_and_its_clock_stamps_stay()
    {
        var doc = JsonNode.Parse("""
            {
              "id": "01K0000000000000000000000A",
              "title": "2026-01-01 is in the title, not a date",
              "createdAt": "2025-12-20T09:15:00.000Z",
              "schedule": { "start": "2026-01-01T14:30", "end": "2026-01-03", "allDay": false, "timeZone": "UTC" },
              "reminders": [{ "at": "2026-01-01T14:00:00+01:00" }],
              "deletedAt": null,
              "_hlc": { "title": "2025-12-20T09:15:00.000Z-0001-demo01" }
            }
            """)!.AsObject();
        SeedDates.Shift(doc, 10);
        Assert.Equal("2026-01-01 is in the title, not a date", (string?)doc["title"]);
        Assert.Equal("2025-12-30T09:15:00.000Z", (string?)doc["createdAt"]);
        Assert.Equal("2026-01-11T14:30", (string?)doc["schedule"]!["start"]);
        Assert.Equal("2026-01-13", (string?)doc["schedule"]!["end"]);
        Assert.Equal("2026-01-11T14:00:00+01:00", (string?)doc["reminders"]![0]!["at"]);
        Assert.Null(doc["deletedAt"]);
        Assert.Equal("2025-12-20T09:15:00.000Z-0001-demo01", (string?)doc["_hlc"]!["title"]);
    }

    [Fact]
    public void Counts_the_days_from_when_the_seed_was_made()
    {
        var root = new JsonObject { ["exportedAt"] = "2026-01-01T00:00:00.000Z" };
        Assert.Equal(302, SeedDates.DaysSince(root, new DateOnly(2026, 10, 30)));
        Assert.Throws<BackupException>(() => SeedDates.DaysSince(new JsonObject(), new DateOnly(2026, 10, 30)));
    }
}
