using Dapper;
using PeckList.Core.Telemetry;

namespace PeckList.Storage.Sql;

/// <summary>The daily report's storage facts, counted in SQL.</summary>
public sealed class SqlTelemetrySource(SqlDatabase database) : ITelemetrySource
{
    public async Task<long> ActiveApiKeysAsync(DateTimeOffset now, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        return Convert.ToInt64(await connection.ExecuteScalarAsync(new CommandDefinition(
            "SELECT COUNT(*) FROM api_keys WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > @now)",
            new { now = now.ToUnixTimeMilliseconds() }, cancellationToken: cancellation)));
    }

    public async Task<bool> AnyPushSubscriptionAsync(CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        return Convert.ToInt64(await connection.ExecuteScalarAsync(new CommandDefinition(
            "SELECT COUNT(*) FROM push_subscriptions", cancellationToken: cancellation))) > 0;
    }

    public async Task<long> DatabaseBytesAsync(CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        return Convert.ToInt64(await connection.ExecuteScalarAsync(new CommandDefinition(
            database.DatabaseBytes, cancellationToken: cancellation)));
    }
}
