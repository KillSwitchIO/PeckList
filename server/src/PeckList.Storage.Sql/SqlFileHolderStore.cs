using Dapper;
using PeckList.Core.Attachments;

namespace PeckList.Storage.Sql;

/// <summary>Who holds which file's bytes, in <c>file_holders</c> (0025).</summary>
public sealed class SqlFileHolderStore(SqlDatabase database) : IFileHolderStore
{
    public async Task<IReadOnlyList<(string Sha256, string AccountId)>> AllAsync(CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        var rows = await connection.QueryAsync<Row>(new CommandDefinition(
            "SELECT sha256, account_id AS accountId FROM file_holders ORDER BY sha256, account_id",
            cancellationToken: cancellation));
        return [.. rows.Select(row => (row.Sha256, row.AccountId))];
    }

    public Task AddAsync(string sha256, string accountId, CancellationToken cancellation = default) =>
        WriteAsync("INSERT INTO file_holders (sha256, account_id) VALUES (@sha256, @accountId) ON CONFLICT DO NOTHING",
            new { sha256, accountId }, cancellation);

    public Task DeleteForFileAsync(string sha256, CancellationToken cancellation = default) =>
        WriteAsync("DELETE FROM file_holders WHERE sha256 = @sha256", new { sha256 }, cancellation);

    private async Task WriteAsync(string sql, object values, CancellationToken cancellation)
    {
        await using var connection = await database.OpenAsync(cancellation);
        await using var transaction = await database.BeginWriteAsync(connection, cancellation);
        await connection.ExecuteAsync(new CommandDefinition(sql, values, transaction, cancellationToken: cancellation));
        await transaction.CommitAsync(cancellation);
    }

    private sealed record Row
    {
        public string Sha256 { get; init; } = "";
        public string AccountId { get; init; } = "";
    }
}
