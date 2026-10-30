namespace Punchlist.Core.Configuration;

/// <summary>
/// The settings that apply while the server runs (<see cref="SettingDefinition.Live"/>): a save on
/// the admin settings page takes effect at once instead of at the next restart. Everything else in
/// <see cref="Current"/> stays as the server started.
/// </summary>
public sealed class LiveSettings(ServerSettings start)
{
    private ServerSettings current = start;

    public ServerSettings Current => Volatile.Read(ref current);

    /// <summary>Take the live settings from <paramref name="next"/> (a full, checked read of every layer).</summary>
    public void Apply(ServerSettings next)
    {
        var before = Current;
        Volatile.Write(ref current, before with
        {
            Registration = next.Registration,
            LocalLoginDisabled = next.LocalLoginDisabled,
            AccountDeleteGraceDays = next.AccountDeleteGraceDays,
            AttachmentMaxMb = next.AttachmentMaxMb,
            UpdateCheck = next.UpdateCheck,
            Telemetry = next.Telemetry,
            TelemetryUrl = next.TelemetryUrl,
            SnapshotSchedule = next.SnapshotSchedule,
            SnapshotKeep = next.SnapshotKeep,
            AuditRetentionDays = next.AuditRetentionDays,
            AccessLogRetentionDays = next.AccessLogRetentionDays,
            AuditArchive = next.AuditArchive,
            Logging = next.Logging,
        });
    }
}
