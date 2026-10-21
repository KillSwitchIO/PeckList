using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using Punchlist.Core.Accounts;
using Punchlist.Core.Storage;

namespace Punchlist.Core.Backup;

/// <summary>What an import found wrong; the message says what to do.</summary>
public sealed class BackupException(string message) : Exception(message);

/// <summary>Counts of what an export or import moved, for the CLI to report.</summary>
public sealed record BackupSummary(int Accounts, int Entities, long Cursor);

/// <summary>
/// The whole server as one JSON document (spec: Data Model &amp; Sync, "export, import and migrate-db
/// go through the JSON format"): accounts with their password hashes, every entity with its owner
/// and seq, the visibility index, the cursor and the server's own secrets (cookie keys). Restoring
/// it gives an identical database, so sessions and device cursors keep working. Treat the file
/// like the database: it holds password hashes.
/// </summary>
public sealed class BackupService(IDatabase database, IEntityStore entities, IAccountStore accounts, ISecretStore secrets, TimeProvider time)
{
    public const string Format = "punchlist-server-backup";
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
        json.WriteString("name", "punchlist");
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
    /// step goes here once the schema moves on).
    /// </summary>
    public async Task<BackupSummary> ImportAsync(Stream input, bool replace = false, CancellationToken cancellation = default)
    {
        JsonObject root;
        try
        {
            root = (await JsonNode.ParseAsync(input, cancellationToken: cancellation))?.AsObject()
                ?? throw new BackupException("the file is empty");
        }
        catch (JsonException error)
        {
            throw new BackupException($"not a JSON file: {error.Message}");
        }
        if ((string?)root["format"] != Format) throw new BackupException("not a Punchlist server backup (no \"format\": \"" + Format + "\")");
        if ((int?)root["formatVersion"] != FormatVersion) throw new BackupException($"backup format {(int?)root["formatVersion"]} is not supported (this server reads {FormatVersion})");
        var schema = (int?)root["schemaVersion"];
        if (schema != WorkspaceSchema.CurrentVersion)
        {
            throw new BackupException($"the backup holds schema {schema}; this server speaks {WorkspaceSchema.CurrentVersion}. Use the matching Punchlist version.");
        }
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

        foreach (var node in Array(root, "secrets"))
        {
            var item = node.AsObject();
            await secrets.PutAsync(Required(item, "kind"), Required(item, "name"), Required(item, "value"), cancellation);
        }
        return new BackupSummary(accountList.Count, stored.Count, cursor);
    }

    private static IEnumerable<JsonNode> Array(JsonObject root, string name) =>
        (root[name] as JsonArray ?? throw new BackupException($"the backup has no \"{name}\" list")).Select(node =>
            node ?? throw new BackupException($"an empty item in \"{name}\""));

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
        };
    }
}
