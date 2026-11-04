namespace PeckList.Core.Telemetry;

/// <summary>The few storage facts the daily report needs beyond the server stats: counts and a size only.</summary>
public interface ITelemetrySource
{
    /// <summary>API keys that work at <paramref name="now"/> (not revoked, not expired).</summary>
    Task<long> ActiveApiKeysAsync(DateTimeOffset now, CancellationToken cancellation = default);

    /// <summary>Whether any browser or phone has a push subscription.</summary>
    Task<bool> AnyPushSubscriptionAsync(CancellationToken cancellation = default);

    /// <summary>The database's size on disk in bytes.</summary>
    Task<long> DatabaseBytesAsync(CancellationToken cancellation = default);

    /// <summary>Rows by <see cref="TelemetryRows.Names"/>: synced records not deleted, by collection, and the server's tables.</summary>
    Task<IReadOnlyDictionary<string, long>> RowCountsAsync(CancellationToken cancellation = default);
}
