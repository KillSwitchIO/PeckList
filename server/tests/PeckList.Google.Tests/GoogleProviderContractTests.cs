using System.Globalization;
using System.Text.Json.Nodes;
using PeckList.Calendars.Testing;
using PeckList.Core.Calendars;

namespace PeckList.Google.Tests;

/// <summary>
/// The calendar adapter contract on the Google adapter, against the fake Google (spec: PL-134, Google
/// is tested against a recorded fake). Each test gets a fresh account with one new calendar.
/// </summary>
public sealed class GoogleProviderContractTests : CalendarProviderContract
{
    protected override Task<CalendarTestTarget> TargetAsync(CancellationToken cancellation)
    {
        var rig = new GoogleRig();
        var calendarId = rig.Google.AddCalendar(rig.Address, "Work");
        var connection = rig.Connection();
        return Task.FromResult(new CalendarTestTarget(
            rig.Provider,
            connection,
            calendarId,
            // Shaped as the fake's own, but never issued for this calendar.
            RejectedSyncToken: "sync:another-calendar:1",
            // A refresh token Google does not know: what a revoked sign-in looks like.
            WrongPassword: rig.Connection(refreshToken: "refresh-unknown-0000"),
            SeedWithExtras: async (calendar, data, token) =>
            {
                var body = new JsonObject
                {
                    ["summary"] = data.Summary,
                    ["description"] = data.Description,
                    ["start"] = Time(data.Start),
                    ["end"] = Time(data.End!),
                    ["location"] = "Main Street 1",
                    ["reminders"] = new JsonObject
                    {
                        ["useDefault"] = false,
                        ["overrides"] = new JsonArray(new JsonObject { ["method"] = "popup", ["minutes"] = 15 }),
                    },
                };
                var id = (string)rig.Google.Seed(rig.Address, calendar, body)["id"]!;
                var listed = await rig.Provider.ChangesAsync(connection, calendar, null, token);
                return Assert.Single(listed.Changed, each => each.Id == id);
            },
            HasExtras: remote =>
            {
                var raw = JsonNode.Parse(remote.Raw!)!.AsObject();
                return (string?)raw["location"] == "Main Street 1" && raw["reminders"]?["overrides"] is JsonArray { Count: > 0 };
            },
            SeedOverride: (calendar, seriesId, original, moved, _) =>
            {
                rig.Google.SeedOverride(rig.Address, calendar, seriesId, Time(original), Time(moved.Start), Time(moved.End!), moved.Summary);
                return Task.CompletedTask;
            }));
    }

    /// <summary>A time as Google writes it: a date, or a dateTime with its offset and the zone.</summary>
    internal static JsonObject Time(CalendarTime time)
    {
        if (time.IsDate) return new JsonObject { ["date"] = time.Value };
        var zone = TimeZoneInfo.FindSystemTimeZoneById(time.TimeZone ?? "UTC");
        var local = DateTime.Parse(time.Value, CultureInfo.InvariantCulture);
        var offset = zone.GetUtcOffset(local);
        return new JsonObject
        {
            ["dateTime"] = new DateTimeOffset(local, offset).ToString("yyyy-MM-dd'T'HH:mm:sszzz", CultureInfo.InvariantCulture),
            ["timeZone"] = time.TimeZone,
        };
    }
}
