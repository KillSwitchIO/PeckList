using System.Data.Common;
using Dapper;
using Punchlist.Core.Accounts;

namespace Punchlist.Storage.Sql;

/// <summary>Server groups in <c>server_groups</c> and <c>server_group_members</c>.</summary>
public sealed class SqlServerGroupStore(SqlDatabase database) : IServerGroupStore
{
    private const string Columns = "id, name, offered_for_sharing AS offeredForSharing, created_at AS createdAt";

    public async Task<IReadOnlyList<ServerGroup>> ListAsync(CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        var rows = await connection.QueryAsync<Row>(new CommandDefinition(
            $"SELECT {Columns} FROM server_groups ORDER BY name_key, id", cancellationToken: cancellation));
        return rows.Select(row => row.ToGroup()).ToList();
    }

    public Task<ServerGroup?> FindAsync(string id, CancellationToken cancellation = default) =>
        FindWhereAsync("id = @value", id, cancellation);

    public Task<ServerGroup?> FindByNameAsync(string name, CancellationToken cancellation = default) =>
        FindWhereAsync("name_key = @value", Key(name), cancellation);

    private async Task<ServerGroup?> FindWhereAsync(string where, string value, CancellationToken cancellation)
    {
        await using var connection = await database.OpenAsync(cancellation);
        var row = await connection.QuerySingleOrDefaultAsync<Row>(new CommandDefinition(
            $"SELECT {Columns} FROM server_groups WHERE {where}", new { value }, cancellationToken: cancellation));
        return row?.ToGroup();
    }

    public Task CreateAsync(ServerGroup group, CancellationToken cancellation = default) =>
        WriteNamedAsync(group, """
            INSERT INTO server_groups (id, name, name_key, offered_for_sharing, created_at)
            VALUES (@Id, @Name, @NameKey, @OfferedForSharing, @CreatedAt)
            """, cancellation);

    public Task UpdateAsync(ServerGroup group, CancellationToken cancellation = default) =>
        WriteNamedAsync(group, """
            UPDATE server_groups SET name = @Name, name_key = @NameKey, offered_for_sharing = @OfferedForSharing
            WHERE id = @Id
            """, cancellation, mustExist: true);

    private async Task WriteNamedAsync(ServerGroup group, string sql, CancellationToken cancellation, bool mustExist = false)
    {
        await using var connection = await database.OpenAsync(cancellation);
        int changed;
        try
        {
            changed = await connection.ExecuteAsync(new CommandDefinition(sql, Row.From(group), cancellationToken: cancellation));
        }
        catch (DbException error) when (SqlDatabase.IsUniqueViolation(error))
        {
            throw new DuplicateGroupNameException(group.Name);
        }
        if (mustExist && changed == 0) throw new KeyNotFoundException($"no group {group.Id}");
    }

    public async Task<bool> DeleteAsync(string id, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        await using var transaction = await database.BeginWriteAsync(connection, cancellation);
        await connection.ExecuteAsync(new CommandDefinition(
            "DELETE FROM server_group_members WHERE group_id = @id", new { id }, transaction, cancellationToken: cancellation));
        var deleted = await connection.ExecuteAsync(new CommandDefinition(
            "DELETE FROM server_groups WHERE id = @id", new { id }, transaction, cancellationToken: cancellation));
        await transaction.CommitAsync(cancellation);
        return deleted > 0;
    }

    public async Task<IReadOnlyList<GroupMembership>> MembershipsAsync(CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        var rows = await connection.QueryAsync<(string, string, string)>(new CommandDefinition(
            "SELECT group_id, account_id, source FROM server_group_members ORDER BY group_id, account_id, source",
            cancellationToken: cancellation));
        return rows.Select(row => new GroupMembership(row.Item1, row.Item2, row.Item3)).ToList();
    }

    public async Task AddMembershipAsync(GroupMembership membership, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        await connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO server_group_members (group_id, account_id, source) VALUES (@GroupId, @AccountId, @Source)
            ON CONFLICT DO NOTHING
            """,
            membership,
            cancellationToken: cancellation));
    }

    public async Task RemoveMembershipAsync(GroupMembership membership, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        await connection.ExecuteAsync(new CommandDefinition(
            "DELETE FROM server_group_members WHERE group_id = @GroupId AND account_id = @AccountId AND source = @Source",
            membership,
            cancellationToken: cancellation));
    }

    public async Task SetMembershipsAsync(
        string accountId, string source, IReadOnlyCollection<string> groupIds, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        await using var transaction = await database.BeginWriteAsync(connection, cancellation);
        await connection.ExecuteAsync(new CommandDefinition(
            "DELETE FROM server_group_members WHERE account_id = @accountId AND source = @source",
            new { accountId, source }, transaction, cancellationToken: cancellation));
        foreach (var groupId in groupIds.Distinct())
        {
            await connection.ExecuteAsync(new CommandDefinition(
                "INSERT INTO server_group_members (group_id, account_id, source) VALUES (@groupId, @accountId, @source)",
                new { groupId, accountId, source }, transaction, cancellationToken: cancellation));
        }
        await transaction.CommitAsync(cancellation);
    }

    private static string Key(string name) => name.Trim().ToLowerInvariant();

    private sealed class Row
    {
        public string Id { get; set; } = "";
        public string Name { get; set; } = "";
        public string NameKey { get; set; } = "";
        public long OfferedForSharing { get; set; }
        public string CreatedAt { get; set; } = "";

        public static Row From(ServerGroup group) => new()
        {
            Id = group.Id,
            Name = group.Name,
            NameKey = Key(group.Name),
            OfferedForSharing = group.OfferedForSharing ? 1 : 0,
            CreatedAt = SqlTime.Text(group.CreatedAt),
        };

        public ServerGroup ToGroup() => new()
        {
            Id = Id,
            Name = Name,
            OfferedForSharing = OfferedForSharing != 0,
            CreatedAt = SqlTime.Parse(CreatedAt),
        };
    }
}
