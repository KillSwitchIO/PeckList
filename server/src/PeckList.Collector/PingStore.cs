using System.Text.Json;
using Dapper;
using Npgsql;
using PeckList.Core.Telemetry;

namespace PeckList.Collector;

/// <summary>One value of a dimension on the public page, and how many installs have it.</summary>
public sealed record StatValue(string Value, int Installs);

/// <summary>
/// The totals: installs that sent a ping in the last <see cref="WindowDays"/> days, broken
/// down per dimension. A value fewer than <see cref="PingStore.MinInstalls"/> installs share is
/// folded into "other", and "other" itself is left out when it is that small too.
/// </summary>
public sealed record PublicStats(
    DateTimeOffset Generated, int WindowDays, int Installs, IReadOnlyDictionary<string, IReadOnlyList<StatValue>> Breakdown);

/// <summary>The pings and the daily totals, in PostgreSQL.</summary>
public sealed class PingStore(NpgsqlDataSource data)
{
    /// <summary>The fewest installs a value on the public page may stand for.</summary>
    public const int MinInstalls = 5;

    public const int WindowDays = 7;

    /// <summary>The pings are kept this long; the daily totals made from them stay.</summary>
    public const int KeepDays = 90;

    // Each dimension of the totals: its name and where its value is in a ping.
    private const string Dimensions = """
        CROSS JOIN LATERAL (VALUES
            ('version', p.version),
            ('channel', p.channel),
            ('database', p.payload->'runtime'->>'database'),
            ('os', p.payload->'runtime'->>'os'),
            ('arch', p.payload->'runtime'->>'arch'),
            ('container', p.payload->'runtime'->>'container'),
            ('users', p.payload->'scale'->>'users'),
            ('openTasks', p.payload->'scale'->>'openTasks'),
            ('localLogin', p.payload->'setup'->>'localLogin'),
            ('oidc', CASE WHEN (p.payload->'setup'->>'oidcProviders')::int > 0 THEN 'true' ELSE 'false' END),
            ('country', p.country),
            ('timeZone', p.payload->'host'->>'timeZone'),
            ('cpus', p.payload->'host'->>'cpus'),
            ('memory', p.payload->'host'->>'memory'),
            ('containerRuntime', p.payload->'host'->>'containerRuntime'),
            ('kernel', p.payload->'host'->>'kernel'),
            ('email', p.payload->'setup'->>'email'),
            ('passkeys', p.payload->'setup'->>'passkeys'),
            ('storage', p.payload->'storage'->>'attachments'),
            ('diskFree', p.payload->'storage'->>'diskFree')
        ) AS d(dimension, value)
        """;

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>The read-only role dashboards sign in as (<c>COLLECTOR_READER_PASSWORD_FILE</c>).</summary>
    public const string ReaderRole = "telemetry_reader";

    /// <summary>
    /// Make or update <see cref="ReaderRole"/> with <paramref name="password"/>: it may sign in and
    /// read every table, now and later, and change nothing. For Grafana and the like.
    /// </summary>
    public async Task EnsureReaderAsync(string password, CancellationToken cancellation = default)
    {
        await using var connection = await data.OpenConnectionAsync(cancellation);
        // A role's password cannot be a parameter; quoted as a literal, it cannot end the statement.
        var literal = "'" + password.Replace("'", "''", StringComparison.Ordinal) + "'";
        await connection.ExecuteAsync(new CommandDefinition(
            $"""
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{ReaderRole}') THEN
                    CREATE ROLE {ReaderRole} LOGIN;
                END IF;
            END $$;
            ALTER ROLE {ReaderRole} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD {literal};
            GRANT CONNECT ON DATABASE "{connection.Database}" TO {ReaderRole};
            GRANT USAGE ON SCHEMA public TO {ReaderRole};
            GRANT SELECT ON ALL TABLES IN SCHEMA public TO {ReaderRole};
            ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO {ReaderRole};
            """,
            cancellationToken: cancellation));
    }

    public async Task MigrateAsync(CancellationToken cancellation = default)
    {
        await using var stream = typeof(PingStore).Assembly.GetManifestResourceStream("Schema.sql")
            ?? throw new InvalidOperationException("Schema.sql is not embedded");
        using var reader = new StreamReader(stream);
        await using var connection = await data.OpenConnectionAsync(cancellation);
        await connection.ExecuteAsync(new CommandDefinition(await reader.ReadToEndAsync(cancellation), cancellationToken: cancellation));
    }

    /// <summary>
    /// Keep <paramref name="ping"/> as its install's ping for the day it came in (a later one that
    /// day replaces it), with the <paramref name="country"/> it came from when known.
    /// </summary>
    public async Task SaveAsync(TelemetryPing ping, DateTimeOffset received, CancellationToken cancellation = default, string? country = null)
    {
        await using var connection = await data.OpenConnectionAsync(cancellation);
        await connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO pings (install_id, day, received_at, schema, version, channel, payload, country)
            VALUES (@Install, @Day::date, @Received, @Schema, @Version, @Channel, @Payload::jsonb, @Country)
            ON CONFLICT (install_id, day) DO UPDATE SET
                received_at = excluded.received_at, schema = excluded.schema, version = excluded.version,
                channel = excluded.channel, payload = excluded.payload, country = excluded.country
            """,
            new
            {
                Install = Guid.Parse(ping.InstallId),
                Day = Iso(DateOnly.FromDateTime(received.UtcDateTime)),
                Received = received.UtcDateTime,
                ping.Schema,
                ping.Version,
                ping.Channel,
                // The checked record, not the request's body: a field the collector does not know is not kept.
                Payload = JsonSerializer.Serialize(ping, Json),
                Country = country,
            },
            cancellationToken: cancellation));
    }

    /// <summary>Keep a crash report as it came, checked (a field the collector does not know is not kept).</summary>
    public async Task SaveCrashAsync(CrashReport report, DateTimeOffset received, CancellationToken cancellation = default)
    {
        await using var connection = await data.OpenConnectionAsync(cancellation);
        await connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO crashes (received_at, install_id, source, version, channel, kind, fingerprint, payload)
            VALUES (@Received, @Install, @Source, @Version, @Channel, @Kind, @Fingerprint, @Payload::jsonb)
            """,
            new
            {
                Received = received.UtcDateTime,
                Install = report.InstallId is { } id ? Guid.Parse(id) : (Guid?)null,
                report.Source,
                report.Version,
                report.Channel,
                report.Kind,
                report.Fingerprint,
                Payload = JsonSerializer.Serialize(report, Json),
            },
            cancellationToken: cancellation));
    }

    public async Task<PublicStats> StatsAsync(DateTimeOffset now, CancellationToken cancellation = default)
    {
        var since = DateOnly.FromDateTime(now.UtcDateTime).AddDays(-(WindowDays - 1));
        await using var connection = await data.OpenConnectionAsync(cancellation);
        var rows = (await connection.QueryAsync<(string Dimension, string? Value, int Installs)>(new CommandDefinition(
            $"""
            WITH p AS (
                SELECT DISTINCT ON (install_id) version, channel, payload, country
                FROM pings WHERE day >= @Since::date ORDER BY install_id, day DESC
            )
            SELECT d.dimension, d.value, count(*)::int FROM p {Dimensions}
            GROUP BY d.dimension, d.value
            """,
            new { Since = Iso(since) },
            cancellationToken: cancellation))).ToList();
        var installs = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            "SELECT count(DISTINCT install_id)::int FROM pings WHERE day >= @Since::date", new { Since = Iso(since) }, cancellationToken: cancellation));

        var breakdown = new Dictionary<string, IReadOnlyList<StatValue>>();
        foreach (var dimension in rows.GroupBy(row => row.Dimension))
        {
            var shown = dimension.Where(row => row.Installs >= MinInstalls)
                .Select(row => new StatValue(row.Value ?? "unknown", row.Installs))
                .OrderByDescending(value => value.Installs).ThenBy(value => value.Value, StringComparer.Ordinal)
                .ToList();
            var other = dimension.Where(row => row.Installs < MinInstalls).Sum(row => row.Installs);
            if (other >= MinInstalls) shown.Add(new StatValue("other", other));
            breakdown[dimension.Key] = shown;
        }
        return new PublicStats(now, WindowDays, installs, breakdown);
    }

    /// <summary>
    /// Total up every finished day not yet totalled (days before <paramref name="today"/>), then
    /// drop pings older than <see cref="KeepDays"/>.
    /// </summary>
    public async Task TotalAndPruneAsync(DateOnly today, CancellationToken cancellation = default)
    {
        await using var connection = await data.OpenConnectionAsync(cancellation);
        await using var transaction = await connection.BeginTransactionAsync(cancellation);
        await connection.ExecuteAsync(new CommandDefinition(
            $"""
            INSERT INTO daily_totals (day, dimension, value, installs)
            SELECT p.day, d.dimension, coalesce(d.value, 'unknown'), count(*)
            FROM pings p {Dimensions}
            WHERE p.day < @Today::date AND NOT EXISTS (SELECT 1 FROM daily_totals t WHERE t.day = p.day)
            GROUP BY p.day, d.dimension, coalesce(d.value, 'unknown')
            ON CONFLICT DO NOTHING
            """,
            new { Today = Iso(today) }, transaction, cancellationToken: cancellation));
        await connection.ExecuteAsync(new CommandDefinition(
            "DELETE FROM pings WHERE day < @Oldest::date", new { Oldest = Iso(today.AddDays(-KeepDays)) }, transaction, cancellationToken: cancellation));
        await connection.ExecuteAsync(new CommandDefinition(
            "DELETE FROM crashes WHERE received_at < @Oldest::date", new { Oldest = Iso(today.AddDays(-KeepDays)) }, transaction, cancellationToken: cancellation));
        await transaction.CommitAsync(cancellation);
    }

    // Dates go in as ISO text cast to date in SQL, the same whatever the driver makes of DateOnly.
    private static string Iso(DateOnly day) => day.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
}
