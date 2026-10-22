using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using Punchlist.Core.Accounts;
using Punchlist.Core.Storage;
using Punchlist.Core.Sync;

namespace Punchlist.Core.Backup;

/// <summary>What a user restore did, for the admin to read.</summary>
public sealed record UserRestoreResult(string Username, bool Created, int Restored, int Removed, int Dropped);

/// <summary>
/// One person's data on its own (spec: Backup and restore): export it, or restore it from their own
/// backup or from a whole-server one. A restore is written like any server change with fresh
/// clocks, so it wins over what devices hold and every device converges by syncing; what they own
/// now and the backup lacks is deleted the same way. Links to people this server does not have are
/// dropped and counted.
/// </summary>
public sealed class UserBackups(
    IEntityStore entities,
    IAccountStore accounts,
    IIdentityStore identities,
    SyncService sync,
    ServerClock clock,
    TimeProvider time)
{
    public const string Format = "punchlist-user-backup";
    public const int FormatVersion = 1;

    private static readonly JsonWriterOptions WriterOptions = new()
    {
        Indented = true,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    /// <summary>The account (with its password hash), its linked identities and everything it owns.</summary>
    public async Task<int> ExportAsync(string userId, Stream output, string appVersion, CancellationToken cancellation = default)
    {
        var account = await accounts.FindByIdAsync(userId, cancellation) ?? throw new KeyNotFoundException($"no account {userId}");
        var root = new JsonObject
        {
            ["format"] = Format,
            ["formatVersion"] = FormatVersion,
            ["schemaVersion"] = WorkspaceSchema.CurrentVersion,
            ["app"] = new JsonObject { ["name"] = "punchlist", ["version"] = appVersion },
            ["exportedAt"] = time.GetUtcNow().ToString("O", CultureInfo.InvariantCulture),
            ["account"] = new JsonObject
            {
                ["id"] = account.Id,
                ["username"] = account.Username,
                ["passwordHash"] = account.PasswordHash,
                ["role"] = account.Role.Name(),
                ["createdAt"] = account.CreatedAt.ToString("O", CultureInfo.InvariantCulture),
            },
        };
        var links = new JsonArray();
        foreach (var identity in (await identities.ListAsync(cancellation)).Where(each => each.AccountId == userId))
        {
            links.Add(new JsonObject { ["provider"] = identity.Provider, ["subject"] = identity.Subject, ["email"] = identity.Email });
        }
        root["identities"] = links;
        var owned = new JsonArray();
        await foreach (var entity in entities.AllAsync(cancellation))
        {
            if (entity.OwnerId != userId) continue;
            owned.Add(new JsonObject { ["collection"] = entity.Collection, ["entity"] = entity.Doc.DeepClone() });
        }
        root["entities"] = owned;
        await using var json = new Utf8JsonWriter(output, WriterOptions);
        root.WriteTo(json);
        await json.FlushAsync(cancellation);
        return owned.Count;
    }

    /// <summary>
    /// Restore one person from a user backup, or from a server backup (then <paramref name="username"/>
    /// says who). Their account is made when missing, with its password hash and identity links;
    /// an existing one is kept as it is.
    /// </summary>
    /// <exception cref="BackupException">The file cannot be used, or names someone else's account.</exception>
    public async Task<UserRestoreResult> RestoreAsync(Stream input, string? username, CancellationToken cancellation = default)
    {
        JsonObject root;
        try
        {
            root = (await JsonNode.ParseAsync(input, cancellationToken: cancellation))?.AsObject() ?? throw new BackupException("the file is empty");
        }
        catch (JsonException error)
        {
            throw new BackupException($"not a JSON file: {error.Message}");
        }
        var schema = (int?)root["schemaVersion"];
        if (schema != WorkspaceSchema.CurrentVersion)
        {
            throw new BackupException($"the backup holds schema {schema}; this server speaks {WorkspaceSchema.CurrentVersion}");
        }

        JsonObject accountNode;
        List<(string Collection, JsonObject Doc)> saved;
        JsonArray links;
        switch ((string?)root["format"])
        {
            case Format:
                accountNode = root["account"]?.AsObject() ?? throw new BackupException("the backup has no account");
                saved = Entities(root, owner: null);
                links = root["identities"] as JsonArray ?? [];
                break;
            case BackupService.Format:
                if (string.IsNullOrWhiteSpace(username)) throw new BackupException("say whose data to restore from this server backup");
                accountNode = (root["accounts"] as JsonArray ?? [])
                    .OfType<JsonObject>()
                    .FirstOrDefault(each => string.Equals((string?)each["username"], username.Trim(), StringComparison.OrdinalIgnoreCase))
                    ?? throw new BackupException($"the backup has nobody named {username.Trim()}");
                var id = (string)accountNode["id"]!;
                saved = Entities(root, owner: id);
                links = new JsonArray((root["identities"] as JsonArray ?? [])
                    .OfType<JsonObject>()
                    .Where(each => (string?)each["accountId"] == id)
                    .Select(each => (JsonNode)each.DeepClone())
                    .ToArray());
                break;
            default:
                throw new BackupException("not a Punchlist backup");
        }

        var userId = (string?)accountNode["id"] ?? throw new BackupException("the account has no id");
        var name = (string?)accountNode["username"] ?? throw new BackupException("the account has no username");
        var account = await accounts.FindByIdAsync(userId, cancellation);
        var created = false;
        if (account is null)
        {
            if (await accounts.FindByUsernameAsync(name, cancellation) is not null)
            {
                throw new BackupException($"another account here is already named {name}");
            }
            await accounts.CreateAsync(new Account
            {
                Id = userId,
                Username = name,
                PasswordHash = (string?)accountNode["passwordHash"],
                Role = Roles.TryParse((string?)accountNode["role"], out var role) && role != Role.SuperAdmin ? role : Role.User,
                SecurityStamp = Ids.NewUlid(time),
                CreatedAt = DateTimeOffset.TryParse((string?)accountNode["createdAt"], CultureInfo.InvariantCulture, DateTimeStyles.None, out var at) ? at : time.GetUtcNow(),
            }, cancellation);
            created = true;
            foreach (var link in links.OfType<JsonObject>())
            {
                var provider = (string?)link["provider"];
                var subject = (string?)link["subject"];
                if (provider is null || subject is null || await identities.FindAsync(provider, subject, cancellation) is not null) continue;
                var now = time.GetUtcNow();
                await identities.LinkAsync(new LinkedIdentity
                {
                    Provider = provider, Subject = subject, AccountId = userId, Email = (string?)link["email"], LinkedAt = now, LastUsedAt = now,
                }, cancellation);
            }
        }

        var people = (await accounts.ListAsync(cancellation)).Select(each => each.Id).ToHashSet(StringComparer.Ordinal);
        var writes = new List<IncomingEntity>();
        var dropped = 0;
        var restoredIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var (collection, doc) in saved)
        {
            var id = (string?)doc["id"];
            if (id is null) continue;
            // An id another person owns here is theirs: leave it.
            var existing = await entities.GetAsync(id, cancellation);
            if (existing is not null && existing.OwnerId != userId)
            {
                dropped++;
                continue;
            }
            if (!Keep(collection, doc, people))
            {
                dropped++;
                continue;
            }
            dropped += ForgetMissingAssignees(collection, doc, people);
            var stamp = clock.Next();
            var restored = Restamp(collection, doc, stamp);
            if (existing is not null) TakeOutNewerElements(collection, restored, existing.Doc, stamp);
            writes.Add(new IncomingEntity(collection, restored) { Owner = userId });
            restoredIds.Add(id);
        }
        // What they own now and the backup lacks goes, as a deletion every device hears of.
        var removed = 0;
        await foreach (var entity in entities.AllAsync(cancellation))
        {
            if (entity.OwnerId != userId || restoredIds.Contains(entity.Id) || entity.Doc["deletedAt"] is not null) continue;
            var stamp = clock.Next();
            writes.Add(new IncomingEntity(entity.Collection, new JsonObject
            {
                ["id"] = entity.Id,
                ["deletedAt"] = clock.Now(),
                ["_hlc"] = new JsonObject { ["deletedAt"] = stamp },
            }));
            removed++;
        }
        if (writes.Count > 0) await sync.WriteAsServerAsync(userId, writes, cancellation);
        return new UserRestoreResult(name, created, restoredIds.Count, removed, dropped);
    }

    private static List<(string, JsonObject)> Entities(JsonObject root, string? owner) =>
        (root["entities"] as JsonArray ?? [])
            .OfType<JsonObject>()
            .Where(item => owner is null || (string?)item["ownerId"] == owner)
            .Select(item => ((string?)item["collection"] ?? "", (item["entity"] as JsonObject)?.DeepClone().AsObject()))
            .Where(pair => pair.Item1.Length > 0 && pair.Item2 is not null)
            .Select(pair => (pair.Item1, pair.Item2!))
            .ToList();

    /// <summary>Entities that only make sense with people this server has.</summary>
    private static bool Keep(string collection, JsonObject doc, HashSet<string> people)
    {
        string? Field(string name) => (string?)doc[name];
        bool Known(string? id) => id is null || people.Contains(id);
        return collection switch
        {
            "friendships" => Known(Field("userA")) && Known(Field("userB")),
            "groupMembers" => Known(Field("userId")),
            "listMembers" => Field("principal") is not { } principal || !principal.StartsWith("user:", StringComparison.Ordinal) || Known(principal[5..]),
            _ => true,
        };
    }

    /// <summary>Assignees who are not on this server come off the task. Returns how many.</summary>
    private static int ForgetMissingAssignees(string collection, JsonObject doc, HashSet<string> people)
    {
        if (collection != "tasks" || doc["assignees"] is not JsonObject assignees) return 0;
        var gone = assignees
            .Select(pair => pair.Key)
            .Where(key => (key.StartsWith("user:", StringComparison.Ordinal) && !people.Contains(key[5..]))
                || key.StartsWith("invite:", StringComparison.Ordinal))
            .ToList();
        foreach (var key in gone) assignees.Remove(key);
        return gone.Count;
    }

    /// <summary>
    /// Sets merge by element, so an element added since the backup would stay: mark it out.
    /// </summary>
    private static void TakeOutNewerElements(string collection, JsonObject restored, JsonObject current, string stamp)
    {
        foreach (var field in WorkspaceSchema.ElementSetFields(collection))
        {
            if (current[field] is not JsonObject now) continue;
            var then = restored[field] as JsonObject ?? new JsonObject();
            foreach (var (key, _) in now)
            {
                if (!then.ContainsKey(key)) then[key] = new JsonObject { ["in"] = false, ["hlc"] = stamp };
            }
            restored[field] = then;
        }
    }

    /// <summary>Every field (and every element of a set) stamped now, so the restored copy wins.</summary>
    private static JsonObject Restamp(string collection, JsonObject doc, string stamp)
    {
        var sets = WorkspaceSchema.ElementSetFields(collection);
        var clocks = new JsonObject();
        foreach (var (field, value) in doc)
        {
            if (field is "id" or "_hlc") continue;
            clocks[field] = stamp;
            if (sets.Contains(field) && value is JsonObject set)
            {
                foreach (var (_, item) in set)
                {
                    if (item is JsonObject element) element["hlc"] = stamp;
                }
            }
        }
        doc["_hlc"] = clocks;
        return doc;
    }
}
