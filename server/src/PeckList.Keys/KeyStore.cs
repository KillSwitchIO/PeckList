using Dapper;
using Microsoft.Data.Sqlite;
using PeckList.Core.Supporters;

namespace PeckList.Keys;

/// <summary>A key issued for an order: which order, its place in it, the key, and whether it was emailed.</summary>
public sealed record IssuedKey(string TransactionId, int Item, SupporterKind Kind, string Key, DateTimeOffset IssuedAt, DateTimeOffset? EmailedAt);

/// <summary>
/// The keys issued, in SQLite: one row a key, keyed by the Paddle transaction and the key's place in
/// it, so a repeated notification finds the keys already made. Nothing about the buyer is kept: no
/// email (it is looked up when a mail goes out), no name, no card; Paddle's customer id only until
/// the mail has gone out or been given up on.
/// </summary>
public sealed class KeyStore(KeySettings settings)
{
    private const string Schema = """
        CREATE TABLE IF NOT EXISTS issued_keys (
            transaction_id TEXT NOT NULL,
            item INTEGER NOT NULL,
            kind TEXT NOT NULL,
            key TEXT NOT NULL,
            customer_id TEXT,
            issued_at TEXT NOT NULL,
            emailed_at TEXT,
            mail_tries INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (transaction_id, item)
        );
        """;

    private readonly SemaphoreSlim writing = new(1, 1);

    private SqliteConnection Open()
    {
        var connection = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = settings.Database, Pooling = false }.ToString());
        connection.Open();
        return connection;
    }

    public async Task MigrateAsync()
    {
        if (Path.GetDirectoryName(Path.GetFullPath(settings.Database)) is { } folder) Directory.CreateDirectory(folder);
        await using var connection = Open();
        await connection.ExecuteAsync("PRAGMA journal_mode=WAL;" + Schema);
    }

    /// <summary>The order's keys: made now, or the ones made the first time this order arrived.</summary>
    public async Task<IReadOnlyList<IssuedKey>> IssueAsync(PaidOrder order, KeyIssuer issuer, DateTimeOffset now, CancellationToken cancellation)
    {
        await writing.WaitAsync(cancellation);
        try
        {
            await using var connection = Open();
            var existing = await ForAsync(connection, order.TransactionId);
            if (existing.Count > 0) return existing;
            await using var transaction = await connection.BeginTransactionAsync(cancellation);
            var item = 0;
            foreach (var (kind, count) in new[] { (SupporterKind.Person, order.PersonKeys), (SupporterKind.Server, order.ServerKeys) })
            {
                for (var each = 0; each < count; each++)
                {
                    await connection.ExecuteAsync(
                        "INSERT INTO issued_keys (transaction_id, item, kind, key, customer_id, issued_at) VALUES (@Id, @Item, @Kind, @Key, @Customer, @At)",
                        new
                        {
                            Id = order.TransactionId,
                            Item = item++,
                            Kind = kind == SupporterKind.Person ? "person" : "server",
                            Key = issuer.Issue(kind, order.Purchased).Text,
                            Customer = order.CustomerId,
                            At = now.ToString("O"),
                        }, transaction);
                }
            }
            await transaction.CommitAsync(cancellation);
            return await ForAsync(connection, order.TransactionId);
        }
        finally
        {
            writing.Release();
        }
    }

    public async Task<IReadOnlyList<IssuedKey>> ForAsync(string transactionId)
    {
        await using var connection = Open();
        return await ForAsync(connection, transactionId);
    }

    /// <summary>Orders whose keys still need emailing, oldest first, with the customer to email.</summary>
    public async Task<IReadOnlyList<(string TransactionId, string? CustomerId, int Tries)>> UnmailedAsync(int maxTries)
    {
        await using var connection = Open();
        var rows = await connection.QueryAsync<(string, string?, long)>(
            "SELECT transaction_id, MAX(customer_id), MAX(mail_tries) FROM issued_keys WHERE emailed_at IS NULL GROUP BY transaction_id HAVING MAX(mail_tries) < @maxTries ORDER BY MIN(issued_at)",
            new { maxTries });
        return [.. rows.Select(row => (row.Item1, row.Item2, (int)row.Item3))];
    }

    public async Task MarkMailedAsync(string transactionId, DateTimeOffset at)
    {
        await using var connection = Open();
        await connection.ExecuteAsync("UPDATE issued_keys SET emailed_at = @At, customer_id = NULL WHERE transaction_id = @Id", new { Id = transactionId, At = at.ToString("O") });
    }

    /// <summary>One more failed try; at the last one the customer id goes, since nothing will ask Paddle again.</summary>
    public async Task MarkTriedAsync(string transactionId, int maxTries)
    {
        await using var connection = Open();
        await connection.ExecuteAsync(
            "UPDATE issued_keys SET mail_tries = mail_tries + 1, customer_id = CASE WHEN mail_tries + 1 >= @maxTries THEN NULL ELSE customer_id END WHERE transaction_id = @Id",
            new { Id = transactionId, maxTries });
    }

    private static async Task<IReadOnlyList<IssuedKey>> ForAsync(SqliteConnection connection, string transactionId)
    {
        var rows = await connection.QueryAsync<(string, long, string, string, string, string?)>(
            "SELECT transaction_id, item, kind, key, issued_at, emailed_at FROM issued_keys WHERE transaction_id = @transactionId ORDER BY item",
            new { transactionId });
        return [.. rows.Select(row => new IssuedKey(row.Item1, (int)row.Item2, row.Item3 == "person" ? SupporterKind.Person : SupporterKind.Server, row.Item4,
            DateTimeOffset.Parse(row.Item5, System.Globalization.CultureInfo.InvariantCulture),
            row.Item6 is null ? null : DateTimeOffset.Parse(row.Item6, System.Globalization.CultureInfo.InvariantCulture)))];
    }
}
