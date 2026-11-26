using PeckList.Calendars.Testing;

namespace PeckList.Calendars.Tests;

/// <summary>The fake passes the adapter contract, so the engine's tests stand on a provider that behaves like a real one.</summary>
public sealed class FakeCalendarProviderContractTests : CalendarProviderContract
{
    protected override Task<CalendarTestTarget> TargetAsync(CancellationToken cancellation) => Target(push: true);

    internal static Task<CalendarTestTarget> Target(bool push, bool seriesListsOverrides = false)
    {
        var fake = new FakeCalendarProvider(push: push, seriesListsOverrides: seriesListsOverrides);
        var connection = fake.AddAccount();
        var calendarId = fake.AddCalendar(connection);
        return Task.FromResult(new CalendarTestTarget(
            fake,
            connection,
            calendarId,
            RejectedSyncToken: $"{calendarId}~7~0",
            WrongPassword: connection with { Secret = "not-the-password" },
            SeedWithExtras: (calendar, data, _) => Task.FromResult(fake.SeedWithExtras(calendar, data)),
            HasExtras: FakeCalendarProvider.HasExtras,
            SeedOverride: (calendar, seriesId, original, moved, _) =>
            {
                fake.AddOverride(calendar, seriesId, original, moved);
                return Task.CompletedTask;
            }));
    }
}

/// <summary>The same contract as a CalDAV-like provider: no push, and a changed series listed with its overrides.</summary>
public sealed class FakeCalendarProviderWithoutPushContractTests : CalendarProviderContract
{
    protected override Task<CalendarTestTarget> TargetAsync(CancellationToken cancellation) => FakeCalendarProviderContractTests.Target(push: false, seriesListsOverrides: true);
}
