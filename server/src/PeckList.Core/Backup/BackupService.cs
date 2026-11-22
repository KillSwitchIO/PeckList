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
/// and seq, the visibility index, the cursor, server groups, API keys (their hashes) and the
/// server's own secrets (cookie keys). Restoring it gives an identical database, so sessions,
/// device cursors and API keys keep working, and nothing made after it survives (but a key revoked
/// or a passkey removed by then stays that way: <see cref="CredentialRevocation"/>). Treat the file
/// like the database: it holds password hashes.
/// </summary>
public sealed class BackupService(
    IDatabase database, IEntityStore entities, IAccountStore accounts, IServerGroupStore groups, IIdentityStore identities,
    ISecretStore secrets, TimeProvider time, IPasskeyStore? passkeys = null, IApiKeyStore? apiKeys = null,
    ICredentialRevocationStore? revocations = null, Attachments.IFileHolderStore? fileHolders = null)
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

    /// <param name="leaveOut">
    /// Given a server secret's kind and value, whether to leave it out. Restoring such a file makes
    /// new ones or goes without, so whatever they backed (sessions, one-time links, saved
    /// passwords) stops working.
    /// </param>
    public async Task<BackupSummary> ExportAsync(
        Stream output, string appVersion, CancellationToken cancellation = default, Func<string, string, bool>? leaveOut = null)
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
            // Only when set, likewise (PL-122).
            if (account.Email is { } email) json.WriteString("email", email);
            if (account.EmailVerifiedAt is { } verified) json.WriteString("emailVerifiedAt", verified.ToString("O", CultureInfo.InvariantCulture));
            // A role a provider renews keeps its lease across a restore (audit S10 follow-up).
            if (account.RoleProvider is { } roleProvider) json.WriteString("roleProvider", roleProvider);
            if (account.RoleRenewedAt is { } renewed) json.WriteString("roleRenewedAt", renewed.ToString("O", CultureInfo.InvariantCulture));
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
        // Passkeys (PL-123): only their public keys, like the identities a way to sign in.
        json.WriteStartArray("passkeys");
        foreach (var passkey in passkeys is null ? [] : await passkeys.AllAsync(cancellation))
        {
            WritePasskey(json, passkey);
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
        // API keys (added in 0.14.0): only the hash of each secret, as stored. Older backups have no
        // list, and restoring one leaves the server with no keys (the restore wipes them).
        if (apiKeys is not null)
        {
            json.WriteStartArray("apiKeys");
            foreach (var key in await apiKeys.AllAsync(cancellation)) WriteApiKey(json, key);
            json.WriteEndArray();
        }
        // Keys revoked and passkeys removed, for good (0022): a restore onto a new server still keeps
        // them out, even a key whose row was pruned before the backup.
        if (revocations is not null)
        {
            json.WriteStartArray("credentialRevocations");
            foreach (var revocation in await revocations.AllAsync(cancellation))
            {
                json.WriteStartObject();
                json.WriteString("kind", revocation.Kind);
                json.WriteString("id", revocation.Id);
                json.WriteString("accountId", revocation.AccountId);
                json.WriteString("revokedAt", revocation.RevokedAt.ToString("O", CultureInfo.InvariantCulture));
                json.WriteEndObject();
            }
            json.WriteEndArray();
        }
        // Who holds which file (1.0): a restore gives back exactly who may download what. Older
        // backups have no list; restoring one counts every attachment's owner as holding its file.
        if (fileHolders is not null)
        {
            json.WriteStartArray("fileHolders");
            foreach (var (sha256, accountId) in await fileHolders.AllAsync(cancellation))
            {
                json.WriteStartObject();
                json.WriteString("sha256", sha256);
                json.WriteString("accountId", accountId);
                json.WriteEndObject();
            }
            json.WriteEndArray();
        }

        json.WriteStartArray("secrets");
        foreach (var (kind, name, value) in await secrets.AllAsync(cancellation))
        {
            if (leaveOut?.Invoke(kind, value) == true) continue;
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
        // Keys revoked and passkeys removed stay that way, whatever the backup says: one taken away
        // because it leaked, or with a lost phone, must not come back with an older backup. What
        // this server knows now (kept for good since 0022, and keys' own rows) and what the backup
        // knows both count; the wipe leaves credential_revocations alone.
        var revoked = new Dictionary<(string Kind, string Id), DateTimeOffset>();
        void Revoked(string kind, string id, DateTimeOffset at) =>
            revoked[(kind, id)] = revoked.TryGetValue((kind, id), out var known) && known < at ? known : at;
        if (!await database.IsEmptyAsync(cancellation))
        {
            if (!replace) throw new BackupException("the database is not empty; import into a new one, or pass --replace to delete what is there first");
            if (apiKeys is not null)
            {
                foreach (var key in await apiKeys.AllAsync(cancellation))
                {
                    if (key.RevokedAt is { } at) Revoked(CredentialRevocation.ApiKey, key.Id, at);
                }
            }
            if (revocations is not null)
            {
                foreach (var revocation in await revocations.AllAsync(cancellation)) Revoked(revocation.Kind, revocation.Id, revocation.RevokedAt);
            }
            await database.WipeAsync(cancellation);
        }
        if (revocations is not null)
        {
            foreach (var node in OptionalArray(root, "credentialRevocations"))
            {
                var item = node.AsObject();
                var revocation = new CredentialRevocation(Required(item, "kind"), Required(item, "id"), Required(item, "accountId"),
                    DateTimeOffset.Parse(Required(item, "revokedAt"), CultureInfo.InvariantCulture));
                await revocations.AddAsync(revocation, cancellation);
                Revoked(revocation.Kind, revocation.Id, revocation.RevokedAt);
            }
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
        if (fileHolders is not null)
        {
            foreach (var (sha256, accountId) in FileHoldersOf(root, stored)) await fileHolders.AddAsync(sha256, accountId, cancellation);
        }

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
        if (passkeys is not null)
        {
            foreach (var node in OptionalArray(root, "passkeys"))
            {
                var passkey = ReadPasskey(node.AsObject());
                if (!revoked.ContainsKey((CredentialRevocation.Passkey, passkey.Id))) await passkeys.AddAsync(passkey, cancellation);
            }
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

        if (apiKeys is not null)
        {
            foreach (var node in OptionalArray(root, "apiKeys"))
            {
                var key = ReadApiKey(node.AsObject());
                if (key.RevokedAt is null && revoked.TryGetValue((CredentialRevocation.ApiKey, key.Id), out var at)) key = key with { RevokedAt = at };
                await apiKeys.AddAsync(key, cancellation);
            }
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

    /// <summary>
    /// Who holds which file, from a server backup: its list (1.0), else, for an older backup, every
    /// attachment's owner, as the migration counted them. A restore trusts its file: only restore
    /// backups a PeckList server made.
    /// </summary>
    internal static IEnumerable<(string Sha256, string AccountId)> FileHoldersOf(JsonObject root, IEnumerable<StoredEntity> stored)
    {
        if (root["fileHolders"] is JsonArray list)
        {
            return list.OfType<JsonObject>()
                .Select(item => ((string?)item["sha256"], (string?)item["accountId"]))
                .Where(pair => Attachments.AttachmentHash.IsValid(pair.Item1) && pair.Item2 is not null)
                .Select(pair => (pair.Item1!, pair.Item2!))
                .Distinct();
        }
        return stored
            .Where(entity => entity.Collection == "attachments" && Attachments.AttachmentHash.IsValid((string?)entity.Doc["sha256"]))
            .Select(entity => ((string)entity.Doc["sha256"]!, entity.OwnerId))
            .Distinct();
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

    internal static void WritePasskey(Utf8JsonWriter json, Passkey passkey)
    {
        json.WriteStartObject();
        json.WriteString("id", passkey.Id);
        json.WriteString("accountId", passkey.AccountId);
        json.WriteString("name", passkey.Name);
        json.WriteString("publicKey", passkey.PublicKey);
        json.WriteNumber("signCount", passkey.SignCount);
        if (passkey.Transports is { } transports) json.WriteString("transports", transports);
        json.WriteBoolean("backedUp", passkey.BackedUp);
        json.WriteString("createdAt", passkey.CreatedAt.ToString("O", CultureInfo.InvariantCulture));
        if (passkey.LastUsedAt is { } used) json.WriteString("lastUsedAt", used.ToString("O", CultureInfo.InvariantCulture));
        json.WriteEndObject();
    }

    internal static Passkey ReadPasskey(JsonObject item, string? accountId = null) => new()
    {
        Id = Required(item, "id"),
        AccountId = accountId ?? Required(item, "accountId"),
        Name = Required(item, "name"),
        PublicKey = Required(item, "publicKey"),
        SignCount = (long?)item["signCount"] ?? 0,
        Transports = (string?)item["transports"],
        BackedUp = (bool?)item["backedUp"] ?? false,
        CreatedAt = DateTimeOffset.Parse(Required(item, "createdAt"), CultureInfo.InvariantCulture),
        LastUsedAt = item["lastUsedAt"] is null ? null : DateTimeOffset.Parse(Required(item, "lastUsedAt"), CultureInfo.InvariantCulture),
    };

    private static void WriteApiKey(Utf8JsonWriter json, ApiKey key)
    {
        static string When(DateTimeOffset at) => at.ToString("O", CultureInfo.InvariantCulture);
        json.WriteStartObject();
        json.WriteString("id", key.Id);
        json.WriteString("userId", key.UserId);
        json.WriteString("name", key.Name);
        json.WriteString("secretHash", key.SecretHash);
        json.WriteStartArray("scopes");
        foreach (var scope in key.Scopes) json.WriteStringValue(scope);
        json.WriteEndArray();
        json.WriteString("createdAt", When(key.CreatedAt));
        if (key.ExpiresAt is { } expires) json.WriteString("expiresAt", When(expires));
        if (key.LastUsedAt is { } used) json.WriteString("lastUsedAt", When(used));
        if (key.RevokedAt is { } revoked) json.WriteString("revokedAt", When(revoked));
        json.WriteEndObject();
    }

    private static ApiKey ReadApiKey(JsonObject item)
    {
        DateTimeOffset? Maybe(string name) =>
            item[name] is null ? null : DateTimeOffset.Parse(Required(item, name), CultureInfo.InvariantCulture);
        return new ApiKey
        {
            Id = Required(item, "id"),
            UserId = Required(item, "userId"),
            Name = Required(item, "name"),
            SecretHash = Required(item, "secretHash"),
            Scopes = (item["scopes"] as JsonArray ?? throw new BackupException("an API key without \"scopes\""))
                .Select(scope => (string?)scope ?? throw new BackupException("an empty API key scope")).ToList(),
            CreatedAt = DateTimeOffset.Parse(Required(item, "createdAt"), CultureInfo.InvariantCulture),
            ExpiresAt = Maybe("expiresAt"),
            LastUsedAt = Maybe("lastUsedAt"),
            RevokedAt = Maybe("revokedAt"),
        };
    }

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
            Email = (string?)item["email"],
            EmailVerifiedAt = item["emailVerifiedAt"] is null ? null : Time("emailVerifiedAt"),
            RoleProvider = (string?)item["roleProvider"],
            RoleRenewedAt = item["roleRenewedAt"] is null ? null : Time("roleRenewedAt"),
        };
    }
}
