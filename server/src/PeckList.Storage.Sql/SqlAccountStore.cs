using System.Data.Common;
using Dapper;
using PeckList.Core.Accounts;

namespace PeckList.Storage.Sql;

/// <summary>Logins in the <c>accounts</c> table.</summary>
public sealed class SqlAccountStore(SqlDatabase database) : IAccountStore
{
    private const string Columns =
        "id, username, password_hash AS passwordHash, role, must_change_password AS mustChangePassword, " +
        "failed_logins AS failedLogins, locked_until AS lockedUntil, security_stamp AS securityStamp, " +
        "disabled, created_at AS createdAt, friend_code AS friendCode, deleted_at AS deletedAt, " +
        "email, email_verified_at AS emailVerifiedAt";

    public async Task<int> CountAsync(CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        return await connection.ExecuteScalarAsync<int>(new CommandDefinition("SELECT COUNT(*) FROM accounts", cancellationToken: cancellation));
    }

    public async Task<IReadOnlyList<Account>> ListAsync(CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        var rows = await connection.QueryAsync<Row>(new CommandDefinition(
            $"SELECT {Columns} FROM accounts ORDER BY created_at, id", cancellationToken: cancellation));
        return rows.Select(row => row.ToAccount()).ToList();
    }

    public Task<Account?> FindByIdAsync(string id, CancellationToken cancellation = default) =>
        FindAsync("id = @value", id, cancellation);

    public Task<Account?> FindByUsernameAsync(string username, CancellationToken cancellation = default) =>
        FindAsync("username = @value", username.ToLowerInvariant(), cancellation);

    public Task<Account?> FindByFriendCodeAsync(string code, CancellationToken cancellation = default) =>
        FindAsync("friend_code = @value", code, cancellation);

    public async Task<IReadOnlyList<Account>> FindByEmailAsync(string email, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        var rows = await connection.QueryAsync<Row>(new CommandDefinition(
            $"SELECT {Columns} FROM accounts WHERE email = @value ORDER BY created_at, id",
            new { value = email.Trim().ToLowerInvariant() }, cancellationToken: cancellation));
        return rows.Select(row => row.ToAccount()).ToList();
    }

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
                    locked_until, security_stamp, disabled, created_at, friend_code, deleted_at, email, email_verified_at)
                VALUES (@Id, @Username, @PasswordHash, @Role, @MustChangePassword, @FailedLogins,
                    @LockedUntil, @SecurityStamp, @Disabled, @CreatedAt, @FriendCode, @DeletedAt, @Email, @EmailVerifiedAt)
                """,
                Row.From(account),
                cancellationToken: cancellation));
        }
        catch (DbException error) when (SqlDatabase.IsUniqueViolation(error))
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
                locked_until = @LockedUntil, security_stamp = @SecurityStamp, disabled = @Disabled,
                friend_code = @FriendCode, deleted_at = @DeletedAt, email = @Email, email_verified_at = @EmailVerifiedAt
            WHERE id = @Id
            """,
            Row.From(account),
            cancellationToken: cancellation));
        if (changed == 0) throw new KeyNotFoundException($"no account {account.Id}");
    }

    public async Task<bool> DeleteAsync(string id, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        return await connection.ExecuteAsync(new CommandDefinition("DELETE FROM accounts WHERE id = @id", new { id }, cancellationToken: cancellation)) > 0;
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
        public string? FriendCode { get; set; }
        public string? DeletedAt { get; set; }
        public string? Email { get; set; }
        public string? EmailVerifiedAt { get; set; }

        public static Row From(Account account) => new()
        {
            Id = account.Id,
            Username = account.Username.ToLowerInvariant(),
            PasswordHash = account.PasswordHash,
            Role = account.Role.ToString().ToLowerInvariant(),
            MustChangePassword = account.MustChangePassword ? 1 : 0,
            FailedLogins = account.FailedLogins,
            LockedUntil = SqlTime.Text(account.LockedUntil),
            SecurityStamp = account.SecurityStamp,
            Disabled = account.Disabled ? 1 : 0,
            CreatedAt = SqlTime.Text(account.CreatedAt),
            FriendCode = account.FriendCode,
            DeletedAt = SqlTime.Text(account.DeletedAt),
            Email = account.Email?.ToLowerInvariant(),
            EmailVerifiedAt = SqlTime.Text(account.EmailVerifiedAt),
        };

        public Account ToAccount() => new()
        {
            Id = Id,
            Username = Username,
            PasswordHash = PasswordHash,
            Role = Enum.Parse<Role>(Role, ignoreCase: true),
            MustChangePassword = MustChangePassword != 0,
            FailedLogins = (int)FailedLogins,
            LockedUntil = SqlTime.ParseOrNull(LockedUntil),
            SecurityStamp = SecurityStamp,
            Disabled = Disabled != 0,
            CreatedAt = SqlTime.Parse(CreatedAt),
            FriendCode = FriendCode,
            DeletedAt = SqlTime.ParseOrNull(DeletedAt),
            Email = Email,
            EmailVerifiedAt = SqlTime.ParseOrNull(EmailVerifiedAt),
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

    public async Task<IReadOnlyList<(string Kind, string Name, string Value)>> AllAsync(CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        var rows = await connection.QueryAsync<(string, string, string)>(new CommandDefinition(
            "SELECT kind, name, value FROM server_secrets ORDER BY kind, name", cancellationToken: cancellation));
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
