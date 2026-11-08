using System.Security.Claims;
using PeckList.Core.Push;
using PeckList.Server.Auth;

namespace PeckList.Server.Push;

/// <summary>
/// The time zone a person's apps report, the device's own (Device Time Zone Design): from sync and
/// from the Android check-in. The server works in it for that person when they picked no zone and
/// the operator did not set TZ. It says roughly where someone is, so it goes nowhere else: not to
/// other devices, the admin pages or the audit log.
/// </summary>
public static class DeviceZones
{
    /// <summary>Longer than any zone name; a report past it is not one.</summary>
    public const int MaxLength = 64;

    /// <summary>The report when it names a zone this server knows, else null (a custom "GMT+09:00", say).</summary>
    public static string? Valid(string? zone) =>
        zone is { Length: > 0 and <= MaxLength } && TimeZoneInfo.TryFindSystemTimeZoneById(zone, out _) ? zone : null;

    /// <summary>
    /// Keep a report as the person's zone. Only from the person themselves: not an API key (a script
    /// on a server somewhere) and not an admin viewing as them, which never writes into their account.
    /// </summary>
    public static async Task ReportAsync(IPushStore store, ClaimsPrincipal user, string? zone, CancellationToken cancellation)
    {
        if (Valid(zone) is not { } valid || user.ByKey() || user.Impersonator() is not null) return;
        var userId = user.UserId();
        if (await store.DeviceZoneAsync(userId, cancellation) != valid) await store.SetDeviceZoneAsync(userId, valid, cancellation);
    }

    /// <summary>The zone the server works in for a person now, by <see cref="ReminderSender.ZoneOf"/>.</summary>
    public static async Task<TimeZoneInfo> ZoneForAsync(
        Core.Sharing.SharingIndex index, string userId, IPushStore store, Core.Configuration.ServerSettings settings, CancellationToken cancellation)
    {
        var device = settings.TimeZoneChosen ? null : await store.DeviceZoneAsync(userId, cancellation);
        return ReminderSender.ZoneOf(ReminderSender.SettingsOf(index, userId), device, settings.TimeZoneChosen);
    }
}
