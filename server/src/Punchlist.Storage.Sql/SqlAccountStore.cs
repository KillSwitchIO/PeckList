using System.Data.Common;
using System.Globalization;
using Dapper;
using Punchlist.Core.Accounts;

namespace Punchlist.Storage.Sql;

/// <summary>Logins in the <c>accounts</c> table.</summary>
public sealed class SqlAccountStore(SqlDatabase database) : IAccountStore
{
    private const string Columns =
        "id, username, password_hash AS passwordHash, role, must_change_password AS mustChangePassword, " +
        "failed_logins AS failedLogins, locked_until AS lockedUntil, security_stamp AS securityStamp, " +
        "disabled, created_at AS createdAt";

    public async Task<int> CountAsync(CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        return await connection.ExecuteScalarAsync<int>(new CommandDefinition("SELECT COUNT(*) FROM accounts", cancellationToken: cancellation));
    }

    public Task<Account?> FindByIdAsync(string id, CancellationToken cancellation = default) =>
        FindAsync("id = @value", id, cancellation);

    public Task<Account?> FindByUsernameAsync(string username, CancellationToken cancellation = default) =>
        FindAsync("username = @value", username.ToLowerInvariant(), cancellation);

    private async Task<Account?> FindAsync(string where, string value, CancellationToken cancellation)
    {
        await using var connection = await database.OpenAsync(cancellation);
        var row = await connection.QuerySingleOrDefaultAsync<Row>(new CommandDefinition(
            $"SELECT {Columns} FROM accounts WHERE {where}", new { value }, cancellationToken: cancellation));
        return row?.ToAccount();
    }

    public async Task CreateAsync(Account account, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        try
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                INSERT INTO accounts (id, username, password_hash, role, must_change_password, failed_logins,
                    locked_until, security_stamp, disabled, created_at)
                VALUES (@Id, @Username, @PasswordHash, @Role, @MustChangePassword, @FailedLogins,
                    @LockedUntil, @SecurityStamp, @Disabled, @CreatedAt)
                """,
                Row.From(account),
                cancellationToken: cancellation));
        }
        catch (DbException error) when (error.Message.Contains("unique", StringComparison.OrdinalIgnoreCase)
            || error.Message.Contains("duplicate", StringComparison.OrdinalIgnoreCase))
        {
            throw new DuplicateUsernameException(account.Username);
        }
    }

    public async Task UpdateAsync(Account account, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        var changed = await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE accounts SET username = @Username, password_hash = @PasswordHash, role = @Role,
                must_change_password = @MustChangePassword, failed_logins = @FailedLogins,
                locked_until = @LockedUntil, security_stamp = @SecurityStamp, disabled = @Disabled
            WHERE id = @Id
            """,
            Row.From(account),
            cancellationToken: cancellation));
        if (changed == 0) throw new KeyNotFoundException($"no account {account.Id}");
    }

    /// <summary>The table's shape: text times and 0/1 flags, the same on every database.</summary>
    private sealed class Row
    {
        public string Id { get; set; } = "";
        public string Username { get; set; } = "";
        public string? PasswordHash { get; set; }
        public string Role { get; set; } = "";
        public long MustChangePassword { get; set; }
        public long FailedLogins { get; set; }
        public string? LockedUntil { get; set; }
        public string SecurityStamp { get; set; } = "";
        public long Disabled { get; set; }
        public string CreatedAt { get; set; } = "";

        public static Row From(Account account) => new()
        {
            Id = account.Id,
            Username = account.Username.ToLowerInvariant(),
            PasswordHash = account.PasswordHash,
            Role = account.Role.ToString().ToLowerInvariant(),
            MustChangePassword = account.MustChangePassword ? 1 : 0,
            FailedLogins = account.FailedLogins,
            LockedUntil = account.LockedUntil?.ToString("O", CultureInfo.InvariantCulture),
            SecurityStamp = account.SecurityStamp,
            Disabled = account.Disabled ? 1 : 0,
            CreatedAt = account.CreatedAt.ToString("O", CultureInfo.InvariantCulture),
        };

        public Account ToAccount() => new()
        {
            Id = Id,
            Username = Username,
            PasswordHash = PasswordHash,
            Role = Enum.Parse<Role>(Role, ignoreCase: true),
            MustChangePassword = MustChangePassword != 0,
            FailedLogins = (int)FailedLogins,
            LockedUntil = LockedUntil is null ? null : DateTimeOffset.Parse(LockedUntil, CultureInfo.InvariantCulture),
            SecurityStamp = SecurityStamp,
            Disabled = Disabled != 0,
            CreatedAt = DateTimeOffset.Parse(CreatedAt, CultureInfo.InvariantCulture),
        };
    }
}

/// <summary>Named values in the <c>server_secrets</c> table.</summary>
public sealed class SqlSecretStore(SqlDatabase database) : ISecretStore
{
    public async Task<IReadOnlyList<(string Name, string Value)>> ListAsync(string kind, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        var rows = await connection.QueryAsync<(string, string)>(new CommandDefinition(
            "SELECT name, value FROM server_secrets WHERE kind = @kind ORDER BY name", new { kind }, cancellationToken: cancellation));
        return rows.ToList();
    }

    public async Task PutAsync(string kind, string name, string value, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        await connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO server_secrets (kind, name, value) VALUES (@kind, @name, @value)
            ON CONFLICT (kind, name) DO UPDATE SET value = excluded.value
            """,
            new { kind, name, value },
            cancellationToken: cancellation));
    }
}
