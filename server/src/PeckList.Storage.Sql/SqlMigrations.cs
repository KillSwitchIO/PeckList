using System.Data.Common;
using System.Reflection;
using System.Text.RegularExpressions;
using Dapper;

namespace PeckList.Storage.Sql;

/// <summary>
/// Numbered SQL migrations, one set per database, embedded as <c>Migrations/NNNN_name.sql</c>.
/// Each runs once, in its own transaction, recorded in <c>schema_migrations</c>.
/// </summary>
public static partial class SqlMigrations
{
    [GeneratedRegex(@"^Migrations\.(\d{4})_[a-z0-9_]+\.sql$")]
    private static partial Regex ResourceName();

    public static IReadOnlyList<(int Version, string Sql)> Load(Assembly assembly)
    {
        var migrations = new List<(int, string)>();
        foreach (var name in assembly.GetManifestResourceNames())
        {
            var match = ResourceName().Match(name);
            if (!match.Success) continue;
            using var stream = assembly.GetManifestResourceStream(name)!;
            using var reader = new StreamReader(stream);
            migrations.Add((int.Parse(match.Groups[1].Value), reader.ReadToEnd()));
        }
        migrations.Sort((a, b) => a.Item1.CompareTo(b.Item1));
        for (var index = 0; index < migrations.Count; index++)
        {
            if (migrations[index].Item1 != index + 1)
            {
                throw new InvalidOperationException($"migrations must be numbered 1, 2, 3...; found {migrations[index].Item1} at position {index + 1}");
            }
        }
        return migrations;
    }

    /// <summary>The schema a newer version left and the newest this one knows, or null (reads only).</summary>
    public static async Task<(int Database, int Known)?> NewerAsync(DbConnection connection, Assembly assembly, CancellationToken cancellation)
    {
        int? newest;
        try
        {
            newest = await connection.ExecuteScalarAsync<int?>(new CommandDefinition(
                "SELECT MAX(version) FROM schema_migrations", cancellationToken: cancellation));
        }
        catch (DbException)
        {
            // No schema_migrations yet: a new database.
            return null;
        }
        var known = Load(assembly).Count;
        return newest is { } database && database > known ? (database, known) : null;
    }

    public static async Task RunAsync(DbConnection connection, Assembly assembly, CancellationToken cancellation)
    {
        await connection.ExecuteAsync(new CommandDefinition(
            "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
            cancellationToken: cancellation));
        var applied = (await connection.QueryAsync<int>(new CommandDefinition(
            "SELECT version FROM schema_migrations", cancellationToken: cancellation))).ToHashSet();
        var migrations = Load(assembly);
        // An older server would otherwise skip what it finds applied and run its old code on a schema
        // it has never seen, which is how a rollback quietly damages data (spec: Versioning & Releases).
        if (applied.Count > 0 && applied.Max() > migrations.Count)
        {
            throw new NewerDatabaseException(applied.Max(), migrations.Count);
        }
        foreach (var (version, sql) in migrations)
        {
            if (applied.Contains(version)) continue;
            await using var transaction = await connection.BeginTransactionAsync(cancellation);
            await connection.ExecuteAsync(new CommandDefinition(sql, transaction: transaction, cancellationToken: cancellation));
            await connection.ExecuteAsync(new CommandDefinition(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (@version, @at)",
                new { version, at = DateTimeOffset.UtcNow.ToString("O") },
                transaction,
                cancellationToken: cancellation));
            await transaction.CommitAsync(cancellation);
        }
    }
}

/// <summary>The database holds migrations this version does not know: a newer version upgraded it.</summary>
public sealed class NewerDatabaseException(int database, int known) : Exception(Text(database, known))
{
    /// <summary>What the server says, in one line, when it will not start on such a database.</summary>
    public static string Text(int database, int known) =>
        $"This database was upgraded by a newer PeckList (schema {database}; this version knows up to {known}). "
        + "Run that version or newer, or restore a backup from before the upgrade into an empty database: see Upgrading, If something goes wrong.";
}
