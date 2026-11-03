using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using PeckList.Core.Accounts;
using PeckList.Core.Storage;

namespace PeckList.Core.Backup;

/// <summary>What an import found wrong; the message says what to do.</summary>
public sealed class BackupException(string message) : Exception(message);

/// <summary>A restore the person asking may not do: an admin's account, by someone who is not a super admin.</summary>
public sealed class RestoreRefusedException(string message) : Exception(message);

/// <summary>Counts of what an export or import moved, for the CLI to report.</summary>
public sealed record BackupSummary(int Accounts, int Entities, long Cursor);

/// <summary>
/// The whole server as one JSON document (spec: Data Model &amp; Sync, "export, import and migrate-db
/// go through the JSON format"): accounts with their password hashes, every entity with its owner
/// and seq, the visibility index, the cursor, server groups and the server's own secrets (cookie keys). Restoring
/// it gives an identical database, so sessions and device cursors keep working. Treat the file
/// like the database: it holds password hashes.
/// </summary>
public sealed class BackupService(
    IDatabase database, IEntityStore entities, IAccountStore accounts, IServerGroupStore groups, IIdentityStore identities,
    ISecretStore secrets, TimeProvider time)
{
    public const string Format = "pecklist-server-backup";
    /// <summary>What server backups were called before the rename (PL-127); still read.</summary>
    public const string LegacyFormat = "punchlist-server-backup";
    public const int FormatVersion = 1;

    private static readonly JsonWriterOptions WriterOptions = new()
    {
        Indented = true,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public async Task<BackupSummary> ExportAsync(Stream output, string appVersion, CancellationToken cancellation = default)
    {
        await using var json = new Utf8JsonWriter(output, WriterOptions);
        json.WriteStartObject();
        json.WriteString("format", Format);
        json.WriteNumber("formatVersion", FormatVersion);
        json.WriteNumber("schemaVersion", WorkspaceSchema.CurrentVersion);
        json.WriteStartObject("app");
        json.WriteString("name", "pecklist");
        json.WriteString("version", appVersion);
        json.WriteEndObject();
        json.WriteString("exportedAt", time.GetUtcNow().ToString("O", CultureInfo.InvariantCulture));
        var cursor = await entities.CursorAsync(cancellation);
        json.WriteNumber("cursor", cursor);

        var accountList = await accounts.ListAsync(cancellation);
        json.WriteStartArray("accounts");
        foreach (var account in accountList)
        {
            json.WriteStartObject();
            json.WriteString("id", account.Id);
            json.WriteString("username", account.Username);
            if (account.PasswordHash is null) json.WriteNull("passwordHash");
            else json.WriteString("passwordHash", account.PasswordHash);
            json.WriteString("role", account.Role.ToString().ToLowerInvariant());
            json.WriteBoolean("mustChangePassword", account.MustChangePassword);
            json.WriteNumber("failedLogins", account.FailedLogins);
            if (account.LockedUntil is null) json.WriteNull("lockedUntil");
            else json.WriteString("lockedUntil", account.LockedUntil.Value.ToString("O", CultureInfo.InvariantCulture));
            json.WriteString("securityStamp", account.SecurityStamp);
            json.WriteBoolean("disabled", account.Disabled);
            json.WriteString("createdAt", account.CreatedAt.ToString("O", CultureInfo.InvariantCulture));
            if (account.FriendCode is null) json.WriteNull("friendCode");
            else json.WriteString("friendCode", account.FriendCode);
            // Only when set: backups from before account deletion read the same.
            if (account.DeletedAt is { } deleted) json.WriteString("deletedAt", deleted.ToString("O", CultureInfo.InvariantCulture));
            json.WriteEndObject();
        }
        json.WriteEndArray();

        var count = 0;
        json.WriteStartArray("entities");
        await foreach (var entity in entities.AllAsync(cancellation))
        {
            json.WriteStartObject();
            json.WriteString("collection", entity.Collection);
            json.WriteString("ownerId", entity.OwnerId);
            json.WriteNumber("seq", entity.Seq);
            json.WritePropertyName("entity");
            entity.Doc.WriteTo(json);
            json.WriteEndObject();
            count++;
            if (count % 500 == 0) await json.FlushAsync(cancellation);
        }
        json.WriteEndArray();

        json.WriteStartArray("visibility");
        await foreach (var (userId, entityId) in entities.VisibilityAsync(cancellation))
        {
            json.WriteStartArray();
            json.WriteStringValue(userId);
            json.WriteStringValue(entityId);
            json.WriteEndArray();
        }
        json.WriteEndArray();

        // Added after the format's first release: readers treat these lists as optional.
        json.WriteStartArray("serverGroups");
        foreach (var group in await groups.ListAsync(cancellation))
        {
            json.WriteStartObject();
            json.WriteString("id", group.Id);
            json.WriteString("name", group.Name);
            json.WriteBoolean("offeredForSharing", group.OfferedForSharing);
            json.WriteString("createdAt", group.CreatedAt.ToString("O", CultureInfo.InvariantCulture));
            json.WriteEndObject();
        }
        json.WriteEndArray();
        json.WriteStartArray("groupMemberships");
        foreach (var membership in await groups.MembershipsAsync(cancellation))
        {
            json.WriteStartObject();
            json.WriteString("groupId", membership.GroupId);
            json.WriteString("accountId", membership.AccountId);
            json.WriteString("source", membership.Source);
            json.WriteEndObject();
        }
        json.WriteEndArray();
        json.WriteStartArray("identities");
        foreach (var identity in await identities.ListAsync(cancellation))
        {
            json.WriteStartObject();
            json.WriteString("provider", identity.Provider);
            json.WriteString("subject", identity.Subject);
            json.WriteString("accountId", identity.AccountId);
            if (identity.Email is null) json.WriteNull("email");
            else json.WriteString("email", identity.Email);
            if (identity.Username is null) json.WriteNull("username");
            else json.WriteString("username", identity.Username);
            json.WriteString("linkedAt", identity.LinkedAt.ToString("O", CultureInfo.InvariantCulture));
            json.WriteString("lastUsedAt", identity.LastUsedAt.ToString("O", CultureInfo.InvariantCulture));
            json.WriteEndObject();
        }
        json.WriteEndArray();
        json.WriteStartArray("identityMappings");
        foreach (var mapping in await identities.ListMappingsAsync(cancellation))
        {
            json.WriteStartObject();
            json.WriteString("provider", mapping.Provider);
            json.WriteString("providerUsername", mapping.ProviderUsername);
            json.WriteString("accountId", mapping.AccountId);
            json.WriteString("createdAt", mapping.CreatedAt.ToString("O", CultureInfo.InvariantCulture));
            json.WriteEndObject();
        }
        json.WriteEndArray();
        json.WriteStartArray("pendingSignIns");
        foreach (var pending in await identities.ListPendingAsync(cancellation))
        {
            json.WriteStartObject();
            json.WriteString("provider", pending.Provider);
            json.WriteString("subject", pending.Subject);
            json.WriteString("username", pending.Username);
            if (pending.DisplayName is null) json.WriteNull("displayName");
            else json.WriteString("displayName", pending.DisplayName);
            if (pending.Email is null) json.WriteNull("email");
            else json.WriteString("email", pending.Email);
            json.WriteStartArray("groups");
            foreach (var group in pending.Groups) json.WriteStringValue(group);
            json.WriteEndArray();
            json.WriteString("firstSeen", pending.FirstSeen.ToString("O", CultureInfo.InvariantCulture));
            json.WriteString("lastSeen", pending.LastSeen.ToString("O", CultureInfo.InvariantCulture));
            json.WriteEndObject();
        }
        json.WriteEndArray();

        json.WriteStartArray("secrets");
        foreach (var (kind, name, value) in await secrets.AllAsync(cancellation))
        {
            json.WriteStartObject();
            json.WriteString("kind", kind);
            json.WriteString("name", name);
            json.WriteString("value", value);
            json.WriteEndObject();
        }
        json.WriteEndArray();
        json.WriteEndObject();
        await json.FlushAsync(cancellation);
        return new BackupSummary(accountList.Count, count, cursor);
    }

    /// <summary>
    /// Load a backup. The database must be empty unless <paramref name="replace"/>, which deletes
    /// what is there first. Backups from another schema version are refused (for now; a migration
    /// step goes here once the schema moves on). <paramref name="shiftDates"/>: a seed's dates move
    /// on by the days since it was made (<see cref="SeedDates"/>).
    /// </summary>
    public async Task<BackupSummary> ImportAsync(Stream input, bool replace = false, CancellationToken cancellation = default, bool shiftDates = false)
    {
        var root = await ParseAsync(input, cancellation);
        Check(root);
        var shift = shiftDates ? SeedDates.DaysSince(root, DateOnly.FromDateTime(time.GetUtcNow().UtcDateTime)) : 0;
        if (!await database.IsEmptyAsync(cancellation))
        {
            if (!replace) throw new BackupException("the database is not empty; import into a new one, or pass --replace to delete what is there first");
            await database.WipeAsync(cancellation);
        }

        var accountList = Array(root, "accounts").Select(ReadAccount).ToList();
        foreach (var account in accountList) await accounts.CreateAsync(account, cancellation);

        var stored = Array(root, "entities").Select(node =>
        {
            var item = node.AsObject();
            var doc = item["entity"]?.AsObject() ?? throw new BackupException("an entity without its JSON");
            item.Remove("entity");
            SeedDates.Shift(doc, shift);
            return new StoredEntity(
                Required(item, "collection"),
                (string?)doc["id"] ?? throw new BackupException("an entity without an id"),
                Required(item, "ownerId"),
                (long?)item["seq"] ?? throw new BackupException("an entity without a seq"),
                doc);
        }).ToList();
        var visibility = Array(root, "visibility").Select(node =>
        {
            var pair = node.AsArray();
            return ((string)pair[0]!, (string)pair[1]!);
        }).ToList();
        var cursor = (long?)root["cursor"] ?? stored.Select(entity => entity.Seq).DefaultIfEmpty(0).Max();
        await entities.RestoreAsync(stored, visibility, cursor, cancellation);

        foreach (var node in OptionalArray(root, "serverGroups"))
        {
            var item = node.AsObject();
            await groups.CreateAsync(new ServerGroup
            {
                Id = Required(item, "id"),
                Name = Required(item, "name"),
                OfferedForSharing = (bool?)item["offeredForSharing"] ?? false,
                CreatedAt = DateTimeOffset.Parse(Required(item, "createdAt"), CultureInfo.InvariantCulture),
            }, cancellation);
        }
        foreach (var node in OptionalArray(root, "groupMemberships"))
        {
            var item = node.AsObject();
            await groups.AddMembershipAsync(
                new GroupMembership(Required(item, "groupId"), Required(item, "accountId"), Required(item, "source")), cancellation);
        }

        DateTimeOffset Time(JsonObject item, string name) => DateTimeOffset.Parse(Required(item, name), CultureInfo.InvariantCulture);
        foreach (var node in OptionalArray(root, "identities"))
        {
            var item = node.AsObject();
            await identities.LinkAsync(new LinkedIdentity
            {
                Provider = Required(item, "provider"),
                Subject = Required(item, "subject"),
                AccountId = Required(item, "accountId"),
                Email = (string?)item["email"],
                Username = (string?)item["username"],
                LinkedAt = Time(item, "linkedAt"),
                LastUsedAt = Time(item, "lastUsedAt"),
            }, cancellation);
        }
        foreach (var node in OptionalArray(root, "identityMappings"))
        {
            var item = node.AsObject();
            await identities.PutMappingAsync(new IdentityMapping
            {
                Provider = Required(item, "provider"),
                ProviderUsername = Required(item, "providerUsername"),
                AccountId = Required(item, "accountId"),
                CreatedAt = Time(item, "createdAt"),
            }, cancellation);
        }
        foreach (var node in OptionalArray(root, "pendingSignIns"))
        {
            var item = node.AsObject();
            await identities.PutPendingAsync(new PendingSignIn
            {
                Provider = Required(item, "provider"),
                Subject = Required(item, "subject"),
                Username = Required(item, "username"),
                DisplayName = (string?)item["displayName"],
                Email = (string?)item["email"],
                Groups = (item["groups"] as JsonArray ?? []).Select(group => (string?)group ?? "").ToList(),
                FirstSeen = Time(item, "firstSeen"),
                LastSeen = Time(item, "lastSeen"),
            }, cancellation);
        }

        foreach (var node in Array(root, "secrets"))
        {
            var item = node.AsObject();
            await secrets.PutAsync(Required(item, "kind"), Required(item, "name"), Required(item, "value"), cancellation);
        }
        // Devices synced against the data this replaced: a new epoch makes them start over. A
        // backup without one gets a fresh one at the first sync, which differs from theirs too.
        if (Array(root, "secrets").Any(node => (string?)node["kind"] == Sync.ServerEpoch.Kind && (string?)node["name"] == Sync.ServerEpoch.Name))
        {
            await Sync.ServerEpoch.RenewAsync(secrets, cancellation);
        }
        return new BackupSummary(accountList.Count, stored.Count, cursor);
    }

    /// <summary>Whether a file is a server backup this server can restore, without restoring it.</summary>
    /// <exception cref="BackupException">It is not, and why.</exception>
    public static async Task CheckAsync(Stream input, CancellationToken cancellation = default) =>
        Check(await ParseAsync(input, cancellation));

    /// <summary>A backup file as JSON, whatever kind of backup it is.</summary>
    /// <exception cref="BackupException">Not JSON, not an object, or empty.</exception>
    internal static async Task<JsonObject> ParseAsync(Stream input, CancellationToken cancellation)
    {
        try
        {
            return (await JsonNode.ParseAsync(input, cancellationToken: cancellation))?.AsObject()
                ?? throw new BackupException("the file is empty");
        }
        catch (Exception error) when (error is JsonException or InvalidOperationException)
        {
            throw new BackupException($"not a JSON file: {error.Message}");
        }
    }

    private static void Check(JsonObject root)
    {
        if ((string?)root["format"] is not (Format or LegacyFormat)) throw new BackupException("not a PeckList server backup (no \"format\": \"" + Format + "\")");
        if ((int?)root["formatVersion"] != FormatVersion) throw new BackupException($"backup format {(int?)root["formatVersion"]} is not supported (this server reads {FormatVersion})");
        var schema = (int?)root["schemaVersion"];
        if (!WorkspaceSchema.Readable(schema))
        {
            throw new BackupException($"the backup holds schema {schema}; this server speaks {WorkspaceSchema.CurrentVersion}. Use the matching PeckList version.");
        }
    }

    private static IEnumerable<JsonNode> Array(JsonObject root, string name) =>
        (root[name] as JsonArray ?? throw new BackupException($"the backup has no \"{name}\" list")).Select(node =>
            node ?? throw new BackupException($"an empty item in \"{name}\""));

    private static IEnumerable<JsonNode> OptionalArray(JsonObject root, string name) =>
        root[name] is null ? [] : Array(root, name);

    private static string Required(JsonObject item, string name) =>
        (string?)item[name] ?? throw new BackupException($"an item without \"{name}\"");

    private static Account ReadAccount(JsonNode node)
    {
        var item = node.AsObject();
        DateTimeOffset Time(string name) => DateTimeOffset.Parse(Required(item, name), CultureInfo.InvariantCulture);
        return new Account
        {
            Id = Required(item, "id"),
            Username = Required(item, "username"),
            PasswordHash = (string?)item["passwordHash"],
            Role = Enum.Parse<Role>(Required(item, "role"), ignoreCase: true),
            MustChangePassword = (bool?)item["mustChangePassword"] ?? false,
            FailedLogins = (int?)item["failedLogins"] ?? 0,
            LockedUntil = item["lockedUntil"] is null ? null : Time("lockedUntil"),
            SecurityStamp = Required(item, "securityStamp"),
            Disabled = (bool?)item["disabled"] ?? false,
            CreatedAt = Time("createdAt"),
            FriendCode = (string?)item["friendCode"],
            DeletedAt = item["deletedAt"] is null ? null : Time("deletedAt"),
        };
    }
}
