using Dapper;
using PeckList.Core.Calendars;

namespace PeckList.Storage.Sql;

/// <summary>
/// Calendar sync (PL-134) in <c>calendar_accounts</c>, <c>calendar_links</c> and <c>calendar_items</c>.
/// Times are Unix milliseconds; flags are 0 or 1, the same in both dialects.
/// </summary>
public sealed class SqlCalendarStore(SqlDatabase database) : ICalendarStore
{
    private const string AccountColumns =
        "id AS Id, account_id AS AccountId, provider AS Provider, name AS Name, server_url AS ServerUrl, username AS Username, secret AS Secret, status AS Status, problem AS Problem, created_at AS CreatedAt";

    private const string LinkColumns =
        "id AS Id, calendar_account_id AS CalendarAccountId, account_id AS AccountId, remote_id AS RemoteId, name AS Name, color AS Color, read_only AS ReadOnly, mode AS Mode, " +
        "tag_id AS TagId, list_id AS ListId, made_by_pecklist AS MadeByPeckList, sync_token AS SyncToken, task_cursor AS TaskCursor, channel_id AS ChannelId, " +
        "channel_resource AS ChannelResource, channel_expires AS ChannelExpires, channel_token_hash AS ChannelTokenHash, synced_at AS SyncedAt, problem AS Problem, " +
        "failures AS Failures, next_attempt AS NextAttempt";

    private const string ItemColumns =
        "link_id AS LinkId, event_id AS EventId, task_id AS TaskId, etag AS Etag, event_json AS EventJson, snapshot_json AS SnapshotJson, hidden_json AS HiddenJson, updated_at AS UpdatedAt";

    public async Task<IReadOnlyList<CalendarAccount>> AccountsAsync(string accountId, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        var rows = await connection.QueryAsync<AccountRow>(new CommandDefinition(
            $"SELECT {AccountColumns} FROM calendar_accounts WHERE account_id = @accountId ORDER BY created_at, id", new { accountId }, cancellationToken: cancellation));
        return [.. rows.Select(row => row.ToAccount())];
    }

    public async Task<CalendarAccount?> AccountAsync(string id, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        var row = await connection.QuerySingleOrDefaultAsync<AccountRow>(new CommandDefinition(
            $"SELECT {AccountColumns} FROM calendar_accounts WHERE id = @id", new { id }, cancellationToken: cancellation));
        return row?.ToAccount();
    }

    public Task SaveAccountAsync(CalendarAccount account, CancellationToken cancellation = default) =>
        ExecuteAsync(
            """
            INSERT INTO calendar_accounts (id, account_id, provider, name, server_url, username, secret, status, problem, created_at)
            VALUES (@Id, @AccountId, @Provider, @Name, @ServerUrl, @Username, @Secret, @Status, @Problem, @CreatedAt)
            ON CONFLICT (id) DO UPDATE SET name = excluded.name, server_url = excluded.server_url, username = excluded.username,
                secret = excluded.secret, status = excluded.status, problem = excluded.problem
            """,
            new
            {
                account.Id, account.AccountId, account.Provider, account.Name, account.ServerUrl, account.Username, account.Secret,
                account.Status, account.Problem, CreatedAt = account.CreatedAt.ToUnixTimeMilliseconds(),
            },
            cancellation);

    public async Task<bool> UpdateAccountStatusAsync(string id, string status, string? problem, CancellationToken cancellation = default) =>
        await ChangedAsync("UPDATE calendar_accounts SET status = @status, problem = @problem WHERE id = @id", new { id, status, problem }, cancellation) > 0;

    public async Task<bool> UpdateAccountSecretAsync(string id, string secret, CancellationToken cancellation = default) =>
        await ChangedAsync("UPDATE calendar_accounts SET secret = @secret WHERE id = @id", new { id, secret }, cancellation) > 0;

    public async Task DeleteAccountAsync(string id, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        await using var transaction = await database.BeginWriteAsync(connection, cancellation);
        foreach (var sql in new[]
        {
            "DELETE FROM calendar_items WHERE link_id IN (SELECT id FROM calendar_links WHERE calendar_account_id = @id)",
            "DELETE FROM calendar_links WHERE calendar_account_id = @id",
            "DELETE FROM calendar_accounts WHERE id = @id",
        })
        {
            await connection.ExecuteAsync(new CommandDefinition(sql, new { id }, transaction, cancellationToken: cancellation));
        }
        await transaction.CommitAsync(cancellation);
    }

    public Task<IReadOnlyList<CalendarLink>> LinksAsync(string accountId, CancellationToken cancellation = default) =>
        LinksWhereAsync("account_id = @accountId ORDER BY name, id", new { accountId }, cancellation);

    public Task<IReadOnlyList<CalendarLink>> ActiveLinksAsync(CancellationToken cancellation = default) =>
        LinksWhereAsync("mode <> 'off' ORDER BY id", null, cancellation);

    public async Task<CalendarLink?> LinkAsync(string id, CancellationToken cancellation = default) =>
        (await LinksWhereAsync("id = @id", new { id }, cancellation)).SingleOrDefault();

    public async Task<CalendarLink?> LinkByChannelAsync(string channelId, CancellationToken cancellation = default) =>
        (await LinksWhereAsync("channel_id = @channelId", new { channelId }, cancellation)).FirstOrDefault();

    public Task SaveLinkAsync(CalendarLink link, CancellationToken cancellation = default) =>
        ExecuteAsync(
            """
            INSERT INTO calendar_links (id, calendar_account_id, account_id, remote_id, name, color, read_only, mode, tag_id, list_id, made_by_pecklist,
                sync_token, task_cursor, channel_id, channel_resource, channel_expires, channel_token_hash, synced_at, problem, failures, next_attempt)
            VALUES (@Id, @CalendarAccountId, @AccountId, @RemoteId, @Name, @Color, @ReadOnly, @Mode, @TagId, @ListId, @MadeByPeckList,
                @SyncToken, @TaskCursor, @ChannelId, @ChannelResource, @ChannelExpires, @ChannelTokenHash, @SyncedAt, @Problem, @Failures, @NextAttempt)
            ON CONFLICT (id) DO UPDATE SET name = excluded.name, color = excluded.color, read_only = excluded.read_only, mode = excluded.mode,
                tag_id = excluded.tag_id, list_id = excluded.list_id, made_by_pecklist = excluded.made_by_pecklist, sync_token = excluded.sync_token,
                task_cursor = excluded.task_cursor, channel_id = excluded.channel_id, channel_resource = excluded.channel_resource,
                channel_expires = excluded.channel_expires, channel_token_hash = excluded.channel_token_hash, synced_at = excluded.synced_at,
                problem = excluded.problem, failures = excluded.failures, next_attempt = excluded.next_attempt
            """,
            new
            {
                link.Id, link.CalendarAccountId, link.AccountId, link.RemoteId, link.Name, link.Color, ReadOnly = link.ReadOnly ? 1L : 0L, link.Mode,
                link.TagId, link.ListId, MadeByPeckList = link.MadeByPeckList ? 1L : 0L, link.SyncToken, link.TaskCursor,
                ChannelId = link.Channel?.Id, ChannelResource = link.Channel?.ResourceId, ChannelExpires = link.Channel?.Expires.ToUnixTimeMilliseconds(),
                link.ChannelTokenHash, SyncedAt = link.SyncedAt?.ToUnixTimeMilliseconds(), link.Problem, Failures = (long)link.Failures,
                NextAttempt = link.NextAttempt?.ToUnixTimeMilliseconds(),
            },
            cancellation);

    // The link as a run went by it: there, in the same use. Writes are serialized (SQLite's immediate
    // transactions, Postgres's write lock), so a check inside a write transaction holds until it commits.
    private const string SameUse = "id = @Id AND mode = @Mode AND COALESCE(tag_id, '') = @Tag";

    public async Task<bool> UpdateLinkRunAsync(CalendarLink link, CancellationToken cancellation = default) =>
        await ChangedAsync(
            $"""
            UPDATE calendar_links SET sync_token = @SyncToken, task_cursor = @TaskCursor, synced_at = @SyncedAt, problem = @Problem,
                failures = @Failures, next_attempt = @NextAttempt
            WHERE {SameUse}
            """,
            new
            {
                link.Id, link.Mode, Tag = link.TagId ?? "", link.SyncToken, link.TaskCursor, SyncedAt = link.SyncedAt?.ToUnixTimeMilliseconds(),
                link.Problem, Failures = (long)link.Failures, NextAttempt = link.NextAttempt?.ToUnixTimeMilliseconds(),
            },
            cancellation) > 0;

    public async Task<bool> UpdateLinkChannelAsync(string id, PushChannel? channel, string? channelTokenHash, CancellationToken cancellation = default) =>
        await ChangedAsync(
            """
            UPDATE calendar_links SET channel_id = @ChannelId, channel_resource = @ChannelResource, channel_expires = @ChannelExpires,
                channel_token_hash = @channelTokenHash
            WHERE id = @id
            """,
            new { id, ChannelId = channel?.Id, ChannelResource = channel?.ResourceId, ChannelExpires = channel?.Expires.ToUnixTimeMilliseconds(), channelTokenHash },
            cancellation) > 0;

    public async Task DeleteLinkAsync(string id, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        await using var transaction = await database.BeginWriteAsync(connection, cancellation);
        await connection.ExecuteAsync(new CommandDefinition("DELETE FROM calendar_items WHERE link_id = @id", new { id }, transaction, cancellationToken: cancellation));
        await connection.ExecuteAsync(new CommandDefinition("DELETE FROM calendar_links WHERE id = @id", new { id }, transaction, cancellationToken: cancellation));
        await transaction.CommitAsync(cancellation);
    }

    public async Task<IReadOnlyList<CalendarItem>> ItemsAsync(string linkId, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        var rows = await connection.QueryAsync<ItemRow>(new CommandDefinition(
            $"SELECT {ItemColumns} FROM calendar_items WHERE link_id = @linkId ORDER BY event_id", new { linkId }, cancellationToken: cancellation));
        return [.. rows.Select(row => row.ToItem())];
    }

    public Task SaveItemsAsync(string linkId, IReadOnlyList<CalendarItem> put, IReadOnlyList<string> removed, CancellationToken cancellation = default) =>
        PutItemsAsync(linkId, "id = @Id", new { Id = linkId }, put, removed, cancellation);

    public Task<bool> SaveRunItemsAsync(CalendarLink link, IReadOnlyList<CalendarItem> put, IReadOnlyList<string> removed, CancellationToken cancellation = default) =>
        PutItemsAsync(link.Id, SameUse, new { link.Id, link.Mode, Tag = link.TagId ?? "" }, put, removed, cancellation);

    /// <summary>Items put and removed in one transaction, only while a link matching <paramref name="linkWhere"/> is there.</summary>
    private async Task<bool> PutItemsAsync(string linkId, string linkWhere, object linkParameters, IReadOnlyList<CalendarItem> put, IReadOnlyList<string> removed,
        CancellationToken cancellation)
    {
        if (put.Count == 0 && removed.Count == 0) return true;
        await using var connection = await database.OpenAsync(cancellation);
        await using var transaction = await database.BeginWriteAsync(connection, cancellation);
        var there = await connection.ExecuteScalarAsync<long>(new CommandDefinition(
            $"SELECT COUNT(*) FROM calendar_links WHERE {linkWhere}", linkParameters, transaction, cancellationToken: cancellation));
        // Gone or started over meanwhile: its items went with it, and none come back.
        if (there == 0) return false;
        foreach (var eventId in removed)
        {
            await connection.ExecuteAsync(new CommandDefinition(
                "DELETE FROM calendar_items WHERE link_id = @linkId AND event_id = @eventId", new { linkId, eventId }, transaction, cancellationToken: cancellation));
        }
        foreach (var item in put)
        {
            if (item.LinkId != linkId) throw new ArgumentException($"item of link {item.LinkId} saved under {linkId}");
            await connection.ExecuteAsync(new CommandDefinition(
                """
                INSERT INTO calendar_items (link_id, event_id, task_id, etag, event_json, snapshot_json, hidden_json, updated_at)
                VALUES (@LinkId, @EventId, @TaskId, @Etag, @EventJson, @SnapshotJson, @HiddenJson, @UpdatedAt)
                ON CONFLICT (link_id, event_id) DO UPDATE SET task_id = excluded.task_id, etag = excluded.etag, event_json = excluded.event_json,
                    snapshot_json = excluded.snapshot_json, hidden_json = excluded.hidden_json, updated_at = excluded.updated_at
                """,
                new { item.LinkId, item.EventId, item.TaskId, item.Etag, item.EventJson, item.SnapshotJson, item.HiddenJson, UpdatedAt = item.UpdatedAt.ToUnixTimeMilliseconds() },
                transaction, cancellationToken: cancellation));
        }
        await transaction.CommitAsync(cancellation);
        return true;
    }

    public Task ClearItemsAsync(string linkId, CancellationToken cancellation = default) =>
        ExecuteAsync("DELETE FROM calendar_items WHERE link_id = @linkId", new { linkId }, cancellation);

    public async Task RemoveUserAsync(string accountId, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        await using var transaction = await database.BeginWriteAsync(connection, cancellation);
        foreach (var sql in new[]
        {
            "DELETE FROM calendar_items WHERE link_id IN (SELECT id FROM calendar_links WHERE account_id = @accountId)",
            "DELETE FROM calendar_links WHERE account_id = @accountId",
            "DELETE FROM calendar_accounts WHERE account_id = @accountId",
        })
        {
            await connection.ExecuteAsync(new CommandDefinition(sql, new { accountId }, transaction, cancellationToken: cancellation));
        }
        await transaction.CommitAsync(cancellation);
    }

    private async Task<IReadOnlyList<CalendarLink>> LinksWhereAsync(string where, object? parameters, CancellationToken cancellation)
    {
        await using var connection = await database.OpenAsync(cancellation);
        var rows = await connection.QueryAsync<LinkRow>(new CommandDefinition(
            $"SELECT {LinkColumns} FROM calendar_links WHERE {where}", parameters, cancellationToken: cancellation));
        return [.. rows.Select(row => row.ToLink())];
    }

    /// <summary>One write in its own transaction; the rows it changed.</summary>
    private async Task<int> ChangedAsync(string sql, object parameters, CancellationToken cancellation)
    {
        await using var connection = await database.OpenAsync(cancellation);
        await using var transaction = await database.BeginWriteAsync(connection, cancellation);
        var changed = await connection.ExecuteAsync(new CommandDefinition(sql, parameters, transaction, cancellationToken: cancellation));
        await transaction.CommitAsync(cancellation);
        return changed;
    }

    private async Task ExecuteAsync(string sql, object parameters, CancellationToken cancellation)
    {
        await using var connection = await database.OpenAsync(cancellation);
        await using var transaction = await database.BeginWriteAsync(connection, cancellation);
        await connection.ExecuteAsync(new CommandDefinition(sql, parameters, transaction, cancellationToken: cancellation));
        await transaction.CommitAsync(cancellation);
    }

    private static DateTimeOffset? Time(long? milliseconds) => milliseconds is { } value ? DateTimeOffset.FromUnixTimeMilliseconds(value) : null;

    private sealed class AccountRow
    {
        public string Id { get; set; } = "";
        public string AccountId { get; set; } = "";
        public string Provider { get; set; } = "";
        public string Name { get; set; } = "";
        public string ServerUrl { get; set; } = "";
        public string? Username { get; set; }
        public string Secret { get; set; } = "";
        public string Status { get; set; } = "";
        public string? Problem { get; set; }
        public long CreatedAt { get; set; }

        public CalendarAccount ToAccount() =>
            new(Id, AccountId, Provider, Name, ServerUrl, Username, Secret, Status, Problem, DateTimeOffset.FromUnixTimeMilliseconds(CreatedAt));
    }

    private sealed class LinkRow
    {
        public string Id { get; set; } = "";
        public string CalendarAccountId { get; set; } = "";
        public string AccountId { get; set; } = "";
        public string RemoteId { get; set; } = "";
        public string Name { get; set; } = "";
        public string? Color { get; set; }
        public long ReadOnly { get; set; }
        public string Mode { get; set; } = "";
        public string? TagId { get; set; }
        public string? ListId { get; set; }
        public long MadeByPeckList { get; set; }
        public string? SyncToken { get; set; }
        public long TaskCursor { get; set; }
        public string? ChannelId { get; set; }
        public string? ChannelResource { get; set; }
        public long? ChannelExpires { get; set; }
        public string? ChannelTokenHash { get; set; }
        public long? SyncedAt { get; set; }
        public string? Problem { get; set; }
        public long Failures { get; set; }
        public long? NextAttempt { get; set; }

        public CalendarLink ToLink() => new(
            Id, CalendarAccountId, AccountId, RemoteId, Name, Color, ReadOnly != 0, Mode, TagId, ListId, MadeByPeckList != 0, SyncToken, TaskCursor,
            ChannelId is not null && ChannelResource is not null && ChannelExpires is { } expires
                ? new PushChannel(ChannelId, ChannelResource, DateTimeOffset.FromUnixTimeMilliseconds(expires))
                : null,
            ChannelTokenHash, Time(SyncedAt), Problem, (int)Failures, Time(NextAttempt));
    }

    private sealed class ItemRow
    {
        public string LinkId { get; set; } = "";
        public string EventId { get; set; } = "";
        public string? TaskId { get; set; }
        public string Etag { get; set; } = "";
        public string EventJson { get; set; } = "";
        public string SnapshotJson { get; set; } = "";
        public string? HiddenJson { get; set; }
        public long UpdatedAt { get; set; }

        public CalendarItem ToItem() =>
            new(LinkId, EventId, TaskId, Etag, EventJson, SnapshotJson, HiddenJson, DateTimeOffset.FromUnixTimeMilliseconds(UpdatedAt));
    }
}
