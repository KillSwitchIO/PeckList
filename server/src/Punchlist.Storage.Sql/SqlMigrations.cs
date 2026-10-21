using System.Data.Common;
using System.Reflection;
using System.Text.RegularExpressions;
using Dapper;

namespace Punchlist.Storage.Sql;

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

    public static async Task RunAsync(DbConnection connection, Assembly assembly, CancellationToken cancellation)
    {
        await connection.ExecuteAsync(new CommandDefinition(
            "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
            cancellationToken: cancellation));
        var applied = (await connection.QueryAsync<int>(new CommandDefinition(
            "SELECT version FROM schema_migrations", cancellationToken: cancellation))).ToHashSet();
        foreach (var (version, sql) in Load(assembly))
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
