using Dapper;
using Microsoft.Data.Sqlite;
using PeckList.Core.Supporters;

namespace PeckList.Keys;

/// <summary>A key issued for an order: whose order, its place in it, the key, and whether it was emailed.</summary>
public sealed record IssuedKey(string Provider, string OrderId, int Item, SupporterKind Kind, string Key, DateTimeOffset IssuedAt, DateTimeOffset? EmailedAt);

/// <summary>An order whose keys still need emailing: who to ask for the buyer's email, and how often it was tried.</summary>
public sealed record UnmailedOrder(string Provider, string OrderId, string? Contact, int Tries);

/// <summary>
/// The keys issued, in SQLite: one row a key, keyed by the provider, its order id and the key's
/// place in the order, so a repeated notification finds the keys already made. Nothing about the
/// buyer is kept: no email (it is looked up when a mail goes out), no name, no card; the provider's
/// contact (Paddle's customer id, the BTCPay invoice) only until the mail has gone out or been given up on.
/// </summary>
public sealed class KeyStore(KeySettings settings)
{
    private const string Table = """
        CREATE TABLE IF NOT EXISTS issued_keys (
            provider TEXT NOT NULL,
            order_id TEXT NOT NULL,
            item INTEGER NOT NULL,
            kind TEXT NOT NULL,
            key TEXT NOT NULL,
            contact TEXT,
            issued_at TEXT NOT NULL,
            emailed_at TEXT,
            mail_tries INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (provider, order_id, item)
        );
        """;

    // Before BTCPay (0.14): Paddle only, keyed by its transaction id. Its rows become Paddle's.
    private const string FromPaddleOnly = "ALTER TABLE issued_keys RENAME TO issued_keys_paddle_only;" + Table + """
        INSERT INTO issued_keys (provider, order_id, item, kind, key, contact, issued_at, emailed_at, mail_tries)
            SELECT 'paddle', transaction_id, item, kind, key, customer_id, issued_at, emailed_at, mail_tries FROM issued_keys_paddle_only;
        DROP TABLE issued_keys_paddle_only;
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
        await connection.ExecuteAsync("PRAGMA journal_mode=WAL;");
        var columns = (await connection.QueryAsync<string>("SELECT name FROM pragma_table_info('issued_keys')")).ToHashSet(StringComparer.Ordinal);
        if (columns.Contains("transaction_id"))
        {
            await using var transaction = await connection.BeginTransactionAsync();
            await connection.ExecuteAsync(FromPaddleOnly, transaction: transaction);
            await transaction.CommitAsync();
        }
        await connection.ExecuteAsync(Table);
    }

    /// <summary>The order's keys: made now, or the ones made the first time this order arrived.</summary>
    public async Task<IReadOnlyList<IssuedKey>> IssueAsync(PaidOrder order, KeyIssuer issuer, DateTimeOffset now, CancellationToken cancellation)
    {
        await writing.WaitAsync(cancellation);
        try
        {
            await using var connection = Open();
            var existing = await ForAsync(connection, order.Provider, order.OrderId);
            if (existing.Count > 0) return existing;
            await using var transaction = await connection.BeginTransactionAsync(cancellation);
            var item = 0;
            foreach (var (kind, count) in new[] { (SupporterKind.Person, order.PersonKeys), (SupporterKind.Server, order.ServerKeys) })
            {
                for (var each = 0; each < count; each++)
                {
                    await connection.ExecuteAsync(
                        "INSERT INTO issued_keys (provider, order_id, item, kind, key, contact, issued_at) VALUES (@Provider, @Id, @Item, @Kind, @Key, @Contact, @At)",
                        new
                        {
                            order.Provider,
                            Id = order.OrderId,
                            Item = item++,
                            Kind = kind == SupporterKind.Person ? "person" : "server",
                            Key = issuer.Issue(kind, order.Purchased).Text,
                            order.Contact,
                            At = now.ToString("O"),
                        }, transaction);
                }
            }
            await transaction.CommitAsync(cancellation);
            return await ForAsync(connection, order.Provider, order.OrderId);
        }
        finally
        {
            writing.Release();
        }
    }

    public async Task<IReadOnlyList<IssuedKey>> ForAsync(string provider, string orderId)
    {
        await using var connection = Open();
        return await ForAsync(connection, provider, orderId);
    }

    /// <summary>Orders whose keys still need emailing, oldest first, with who to ask for the email.</summary>
    public async Task<IReadOnlyList<UnmailedOrder>> UnmailedAsync(int maxTries)
    {
        await using var connection = Open();
        var rows = await connection.QueryAsync<(string, string, string?, long)>(
            "SELECT provider, order_id, MAX(contact), MAX(mail_tries) FROM issued_keys WHERE emailed_at IS NULL GROUP BY provider, order_id HAVING MAX(mail_tries) < @maxTries ORDER BY MIN(issued_at)",
            new { maxTries });
        return [.. rows.Select(row => new UnmailedOrder(row.Item1, row.Item2, row.Item3, (int)row.Item4))];
    }

    public async Task MarkMailedAsync(string provider, string orderId, DateTimeOffset at)
    {
        await using var connection = Open();
        await connection.ExecuteAsync(
            "UPDATE issued_keys SET emailed_at = @At, contact = NULL WHERE provider = @Provider AND order_id = @Id",
            new { Provider = provider, Id = orderId, At = at.ToString("O") });
    }

    /// <summary>One more failed try; at the last one the contact goes, since nothing will ask the provider again.</summary>
    public async Task MarkTriedAsync(string provider, string orderId, int maxTries)
    {
        await using var connection = Open();
        await connection.ExecuteAsync(
            "UPDATE issued_keys SET mail_tries = mail_tries + 1, contact = CASE WHEN mail_tries + 1 >= @maxTries THEN NULL ELSE contact END WHERE provider = @Provider AND order_id = @Id",
            new { Provider = provider, Id = orderId, maxTries });
    }

    private static async Task<IReadOnlyList<IssuedKey>> ForAsync(SqliteConnection connection, string provider, string orderId)
    {
        var rows = await connection.QueryAsync<(string, string, long, string, string, string, string?)>(
            "SELECT provider, order_id, item, kind, key, issued_at, emailed_at FROM issued_keys WHERE provider = @provider AND order_id = @orderId ORDER BY item",
            new { provider, orderId });
        return [.. rows.Select(row => new IssuedKey(row.Item1, row.Item2, (int)row.Item3, row.Item4 == "person" ? SupporterKind.Person : SupporterKind.Server, row.Item5,
            DateTimeOffset.Parse(row.Item6, System.Globalization.CultureInfo.InvariantCulture),
            row.Item7 is null ? null : DateTimeOffset.Parse(row.Item7, System.Globalization.CultureInfo.InvariantCulture)))];
    }
}
