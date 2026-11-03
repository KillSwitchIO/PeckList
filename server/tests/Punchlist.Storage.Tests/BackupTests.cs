using System.Text;
using System.Text.Json.Nodes;
using Punchlist.Core;
using Punchlist.Core.Accounts;
using Punchlist.Core.Backup;
using Punchlist.Core.Storage;
using Punchlist.Storage.Sql;

namespace Punchlist.Storage.Tests;

/// <summary>Backups on real databases: export, import, and moving between SQLite and PostgreSQL.</summary>
public sealed class BackupTests(SqliteFiles files, PostgresServer postgres) : IClassFixture<SqliteFiles>, IClassFixture<PostgresServer>
{
    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private sealed class Clock : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(2026, 10, 21, 18, 0, 0, TimeSpan.Zero);
    }

    private static BackupService Backup(SqlDatabase database) =>
        new(database, new SqlEntityStore(database), new SqlAccountStore(database), new SqlServerGroupStore(database), new SqlIdentityStore(database), new SqlSecretStore(database), new Clock());

    /// <summary>Two users, some tasks (one rewritten, one deleted), a group, a linked identity, a waiting sign-in, a secret.</summary>
    private static async Task FillAsync(SqlDatabase database)
    {
        var accounts = new SqlAccountStore(database);
        foreach (var (id, name) in new[] { ("01JBACCT000000000000000001", "ben"), ("01JBACCT000000000000000002", "sam") })
        {
            await accounts.CreateAsync(new Account
            {
                Id = id,
                Username = name,
                PasswordHash = $"hash-{name}",
                Role = name == "ben" ? Role.Admin : Role.User,
                SecurityStamp = $"stamp-{name}",
                LockedUntil = name == "sam" ? new DateTimeOffset(2026, 10, 21, 19, 0, 0, TimeSpan.Zero) : null,
                CreatedAt = new DateTimeOffset(2026, 10, 1, 8, 0, 0, TimeSpan.Zero),
            }, Token);
        }
        var store = new SqlEntityStore(database);
        IncomingEntity Task(string id, string title, string? deletedAt = null) => new("tasks", new JsonObject
        {
            ["id"] = id,
            ["title"] = title,
            ["notes"] = "Café ☕ \"quoted\"\nsecond line",
            ["tags"] = new JsonObject { ["G1"] = new JsonObject { ["in"] = true, ["hlc"] = "2026-10-21T10:00:00.000Z-0000-dev1" } },
            ["deletedAt"] = deletedAt,
            ["_hlc"] = new JsonObject { ["title"] = "2026-10-21T10:00:00.000Z-0000-dev1" },
        });
        JsonObject Take(StoredEntity? _, IncomingEntity incoming) => (JsonObject)incoming.Doc.DeepClone();
        await store.WriteAsync("01JBACCT000000000000000001", [Task("T1", "Mow"), Task("T2", "Rake")], Take, cancellation: Token);
        await store.WriteAsync("01JBACCT000000000000000002", [Task("T3", "Paint")], Take, cancellation: Token);
        await store.WriteAsync("01JBACCT000000000000000001", [Task("T1", "Mow again"), Task("T2", "Rake", "2026-10-21T11:00:00.000Z")], Take, cancellation: Token);
        await new SqlSecretStore(database).PutAsync("dataprotection", "key-1", "<key/>", Token);
        var groups = new SqlServerGroupStore(database);
        await groups.CreateAsync(new ServerGroup
        {
            Id = "01JBGRP0000000000000000001",
            Name = "Family",
            OfferedForSharing = true,
            CreatedAt = new DateTimeOffset(2026, 10, 2, 8, 0, 0, TimeSpan.Zero),
        }, Token);
        await groups.AddMembershipAsync(new("01JBGRP0000000000000000001", "01JBACCT000000000000000001", MembershipSource.Manual), Token);
        await groups.AddMembershipAsync(new("01JBGRP0000000000000000001", "01JBACCT000000000000000002", MembershipSource.Oidc("pocket")), Token);
        var identities = new SqlIdentityStore(database);
        await identities.LinkAsync(new LinkedIdentity
        {
            Provider = "pocket",
            Subject = "sub-sam",
            AccountId = "01JBACCT000000000000000002",
            Email = "sam@example.com",
            LinkedAt = new DateTimeOffset(2026, 10, 3, 8, 0, 0, TimeSpan.Zero),
            LastUsedAt = new DateTimeOffset(2026, 10, 4, 8, 0, 0, TimeSpan.Zero),
        }, Token);
        await identities.PutPendingAsync(new PendingSignIn
        {
            Provider = "pocket",
            Subject = "sub-kim",
            Username = "kim",
            Groups = ["family"],
            FirstSeen = new DateTimeOffset(2026, 10, 5, 8, 0, 0, TimeSpan.Zero),
            LastSeen = new DateTimeOffset(2026, 10, 5, 8, 0, 0, TimeSpan.Zero),
        }, Token);
    }

    private static async Task<string> ExportAsync(SqlDatabase database)
    {
        using var stream = new MemoryStream();
        await Backup(database).ExportAsync(stream, "0.1.0", Token);
        return Encoding.UTF8.GetString(stream.ToArray());
    }

    private static async Task<BackupSummary> ImportAsync(SqlDatabase database, string json, bool replace = false) =>
        await Backup(database).ImportAsync(new MemoryStream(Encoding.UTF8.GetBytes(json)), replace, Token);

    [Fact]
    public async Task A_restore_gives_back_an_identical_database()
    {
        var source = await files.NewDatabaseAsync();
        await FillAsync(source);
        var exported = await ExportAsync(source);

        var target = await files.NewDatabaseAsync();
        var summary = await ImportAsync(target, exported);
        Assert.Equal(new BackupSummary(2, 3, 5), summary);
        Assert.Equal(exported, await ExportAsync(target));

        // It keeps working: the next write continues after the restored cursor.
        var written = await new SqlEntityStore(target).WriteAsync("01JBACCT000000000000000002",
            [new IncomingEntity("tasks", new JsonObject { ["id"] = "T4", ["_hlc"] = new JsonObject() })],
            (_, incoming) => incoming.Doc, cancellation: Token);
        Assert.Equal(6, written.Single().Seq);
        var samSees = await new SqlEntityStore(target).ChangesAsync("01JBACCT000000000000000002", 0, 10, Token);
        Assert.Equal(["T3", "T4"], samSees.Entities.Select(each => each.Id));
    }

    [Fact]
    public async Task Moves_from_sqlite_to_postgres_and_back_unchanged()
    {
        var sqlite = await files.NewDatabaseAsync();
        await FillAsync(sqlite);
        var exported = await ExportAsync(sqlite);

        var pg = await postgres.NewDatabaseAsync();
        await ImportAsync(pg, exported);
        var fromPostgres = await ExportAsync(pg);
        // jsonb may reorder keys inside documents; the content is the same.
        Assert.True(JsonNode.DeepEquals(JsonNode.Parse(exported), JsonNode.Parse(fromPostgres)));

        var back = await files.NewDatabaseAsync();
        await ImportAsync(back, fromPostgres);
        Assert.True(JsonNode.DeepEquals(JsonNode.Parse(exported), JsonNode.Parse(await ExportAsync(back))));
    }

    [Fact]
    public async Task Imports_only_into_an_empty_database_unless_replacing()
    {
        var source = await files.NewDatabaseAsync();
        await FillAsync(source);
        var exported = await ExportAsync(source);
        var error = await Assert.ThrowsAsync<BackupException>(() => ImportAsync(source, exported));
        Assert.Contains("--replace", error.Message);

        await ImportAsync(source, exported, replace: true);
        Assert.Equal(exported, await ExportAsync(source));
    }

    [Fact]
    public async Task Reads_backups_from_before_server_groups()
    {
        var source = await files.NewDatabaseAsync();
        await FillAsync(source);
        var old = JsonNode.Parse(await ExportAsync(source))!.AsObject();
        old.Remove("serverGroups");
        old.Remove("groupMemberships");
        old.Remove("identities");
        old.Remove("pendingSignIns");

        var target = await files.NewDatabaseAsync();
        Assert.Equal(new BackupSummary(2, 3, 5), await ImportAsync(target, old.ToJsonString()));
        Assert.Empty(await new SqlServerGroupStore(target).ListAsync(Token));
    }

    [Theory]
    [InlineData("not json", "not a JSON file")]
    [InlineData("""{"format":"something-else"}""", "not a PeckList server backup")]
    [InlineData("""{"format":"punchlist-server-backup","formatVersion":9}""", "format 9 is not supported")]
    [InlineData("""{"format":"punchlist-server-backup","formatVersion":1,"schemaVersion":1}""", "holds schema 1")]
    public async Task Refuses_what_it_cannot_read(string json, string message)
    {
        var target = await files.NewDatabaseAsync();
        var error = await Assert.ThrowsAsync<BackupException>(() => ImportAsync(target, json));
        Assert.Contains(message, error.Message);
        Assert.True(await target.IsEmptyAsync(Token));
    }

    [Fact]
    public async Task The_export_says_what_it_is()
    {
        var source = await files.NewDatabaseAsync();
        await FillAsync(source);
        var root = JsonNode.Parse(await ExportAsync(source))!;
        Assert.Equal(BackupService.Format, (string?)root["format"]);
        Assert.Equal(WorkspaceSchema.CurrentVersion, (int?)root["schemaVersion"]);
        Assert.Equal("2026-10-21T18:00:00.0000000+00:00", (string?)root["exportedAt"]);
        Assert.Equal(["ben", "sam"], root["accounts"]!.AsArray().Select(account => (string?)account!["username"]));
        Assert.Equal(["T3", "T1", "T2"], root["entities"]!.AsArray().Select(entity => (string?)entity!["entity"]!["id"]));
    }
}
