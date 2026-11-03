using System.Data.Common;
using System.Text.Json;
using Dapper;
using PeckList.Core.Accounts;

namespace PeckList.Storage.Sql;

/// <summary>Linked identities in <c>identities</c>, waiting sign-ins in <c>pending_signins</c>.</summary>
public sealed class SqlIdentityStore(SqlDatabase database) : IIdentityStore
{
    private const string Columns =
        "provider, subject, account_id AS accountId, email, username, linked_at AS linkedAt, last_used_at AS lastUsedAt";

    private const string PendingColumns =
        "provider, subject, username, display_name AS displayName, email, groups_json AS groupsJson, " +
        "first_seen AS firstSeen, last_seen AS lastSeen";

    public async Task<LinkedIdentity?> FindAsync(string provider, string subject, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        var row = await connection.QuerySingleOrDefaultAsync<Row>(new CommandDefinition(
            $"SELECT {Columns} FROM identities WHERE provider = @provider AND subject = @subject",
            new { provider, subject }, cancellationToken: cancellation));
        return row?.ToIdentity();
    }

    public async Task<IReadOnlyList<LinkedIdentity>> ListAsync(CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        var rows = await connection.QueryAsync<Row>(new CommandDefinition(
            $"SELECT {Columns} FROM identities ORDER BY provider, subject", cancellationToken: cancellation));
        return rows.Select(row => row.ToIdentity()).ToList();
    }

    public async Task LinkAsync(LinkedIdentity identity, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        try
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                INSERT INTO identities (provider, subject, account_id, email, username, linked_at, last_used_at)
                VALUES (@Provider, @Subject, @AccountId, @Email, @Username, @LinkedAt, @LastUsedAt)
                """,
                Row.From(identity),
                cancellationToken: cancellation));
        }
        catch (DbException error) when (SqlDatabase.IsUniqueViolation(error))
        {
            throw new IdentityTakenException(identity.Provider, identity.Subject);
        }
    }

    public async Task UpdateAsync(LinkedIdentity identity, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        var changed = await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE identities SET account_id = @AccountId, email = @Email, username = @Username, last_used_at = @LastUsedAt
            WHERE provider = @Provider AND subject = @Subject
            """,
            Row.From(identity),
            cancellationToken: cancellation));
        if (changed == 0) throw new KeyNotFoundException($"no {identity.Provider} identity {identity.Subject}");
    }

    public async Task<bool> UnlinkAsync(string provider, string subject, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        return await connection.ExecuteAsync(new CommandDefinition(
            "DELETE FROM identities WHERE provider = @provider AND subject = @subject",
            new { provider, subject }, cancellationToken: cancellation)) > 0;
    }

    public async Task<int> UnlinkProviderAsync(string provider, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        return await connection.ExecuteAsync(new CommandDefinition(
            "DELETE FROM identities WHERE provider = @provider", new { provider }, cancellationToken: cancellation));
    }

    public async Task<IReadOnlyList<PendingSignIn>> ListPendingAsync(CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        var rows = await connection.QueryAsync<PendingRow>(new CommandDefinition(
            $"SELECT {PendingColumns} FROM pending_signins ORDER BY first_seen, provider, subject", cancellationToken: cancellation));
        return rows.Select(row => row.ToPending()).ToList();
    }

    public async Task PutPendingAsync(PendingSignIn pending, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        await connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO pending_signins (provider, subject, username, display_name, email, groups_json, first_seen, last_seen)
            VALUES (@Provider, @Subject, @Username, @DisplayName, @Email, @GroupsJson, @FirstSeen, @LastSeen)
            ON CONFLICT (provider, subject) DO UPDATE SET username = excluded.username,
                display_name = excluded.display_name, email = excluded.email, groups_json = excluded.groups_json,
                first_seen = excluded.first_seen, last_seen = excluded.last_seen
            """,
            PendingRow.From(pending),
            cancellationToken: cancellation));
    }

    public async Task<bool> RemovePendingAsync(string provider, string subject, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        return await connection.ExecuteAsync(new CommandDefinition(
            "DELETE FROM pending_signins WHERE provider = @provider AND subject = @subject",
            new { provider, subject }, cancellationToken: cancellation)) > 0;
    }

    public async Task<IReadOnlyList<IdentityMapping>> ListMappingsAsync(CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        var rows = await connection.QueryAsync<MappingRow>(new CommandDefinition(
            """
            SELECT provider, provider_username AS providerUsername, account_id AS accountId, created_at AS createdAt
            FROM identity_mappings ORDER BY provider, provider_username
            """,
            cancellationToken: cancellation));
        return rows.Select(row => new IdentityMapping
        {
            Provider = row.Provider,
            ProviderUsername = row.ProviderUsername,
            AccountId = row.AccountId,
            CreatedAt = SqlTime.Parse(row.CreatedAt),
        }).ToList();
    }

    public async Task PutMappingAsync(IdentityMapping mapping, CancellationToken cancellation = default)
    {
        var row = new MappingRow
        {
            Provider = mapping.Provider,
            ProviderUsername = mapping.ProviderUsername.ToLowerInvariant(),
            AccountId = mapping.AccountId,
            CreatedAt = SqlTime.Text(mapping.CreatedAt),
        };
        await using var connection = await database.OpenAsync(cancellation);
        await using var transaction = await database.BeginWriteAsync(connection, cancellation);
        await connection.ExecuteAsync(new CommandDefinition(
            "DELETE FROM identity_mappings WHERE provider = @Provider AND provider_username = @ProviderUsername",
            row, transaction, cancellationToken: cancellation));
        await connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO identity_mappings (provider, provider_username, account_id, created_at)
            VALUES (@Provider, @ProviderUsername, @AccountId, @CreatedAt)
            """,
            row, transaction, cancellationToken: cancellation));
        await transaction.CommitAsync(cancellation);
    }

    public async Task<bool> RemoveMappingAsync(string provider, string providerUsername, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        return await connection.ExecuteAsync(new CommandDefinition(
            "DELETE FROM identity_mappings WHERE provider = @provider AND provider_username = @username",
            new { provider, username = providerUsername.ToLowerInvariant() }, cancellationToken: cancellation)) > 0;
    }

    private sealed class Row
    {
        public string Provider { get; set; } = "";
        public string Subject { get; set; } = "";
        public string AccountId { get; set; } = "";
        public string? Email { get; set; }
        public string? Username { get; set; }
        public string LinkedAt { get; set; } = "";
        public string LastUsedAt { get; set; } = "";

        public static Row From(LinkedIdentity identity) => new()
        {
            Provider = identity.Provider,
            Subject = identity.Subject,
            AccountId = identity.AccountId,
            Email = identity.Email,
            Username = identity.Username,
            LinkedAt = SqlTime.Text(identity.LinkedAt),
            LastUsedAt = SqlTime.Text(identity.LastUsedAt),
        };

        public LinkedIdentity ToIdentity() => new()
        {
            Provider = Provider,
            Subject = Subject,
            AccountId = AccountId,
            Email = Email,
            Username = Username,
            LinkedAt = SqlTime.Parse(LinkedAt),
            LastUsedAt = SqlTime.Parse(LastUsedAt),
        };
    }

    private sealed class MappingRow
    {
        public string Provider { get; set; } = "";
        public string ProviderUsername { get; set; } = "";
        public string AccountId { get; set; } = "";
        public string CreatedAt { get; set; } = "";
    }

    private sealed class PendingRow
    {
        public string Provider { get; set; } = "";
        public string Subject { get; set; } = "";
        public string Username { get; set; } = "";
        public string? DisplayName { get; set; }
        public string? Email { get; set; }
        public string GroupsJson { get; set; } = "[]";
        public string FirstSeen { get; set; } = "";
        public string LastSeen { get; set; } = "";

        public static PendingRow From(PendingSignIn pending) => new()
        {
            Provider = pending.Provider,
            Subject = pending.Subject,
            Username = pending.Username,
            DisplayName = pending.DisplayName,
            Email = pending.Email,
            GroupsJson = JsonSerializer.Serialize(pending.Groups),
            FirstSeen = SqlTime.Text(pending.FirstSeen),
            LastSeen = SqlTime.Text(pending.LastSeen),
        };

        public PendingSignIn ToPending() => new()
        {
            Provider = Provider,
            Subject = Subject,
            Username = Username,
            DisplayName = DisplayName,
            Email = Email,
            Groups = JsonSerializer.Deserialize<string[]>(GroupsJson) ?? [],
            FirstSeen = SqlTime.Parse(FirstSeen),
            LastSeen = SqlTime.Parse(LastSeen),
        };
    }
}
