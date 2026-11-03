using System.Text.Json.Nodes;
using PeckList.Core.Accounts;
using PeckList.Core.Storage;
using PeckList.Core.Sync;

namespace PeckList.Core.Sharing;

/// <summary>
/// What a person sees before becoming friends (spec: Sharing &amp; Permissions, Friends): who it is,
/// how long they have been here, and whether they are friends already.
/// </summary>
/// <param name="Friendship">"accepted", "pending", or null.</param>
public sealed record ProfilePreview(
    string UserId,
    string Username,
    string DisplayName,
    string Handle,
    string AvatarColor,
    DateTimeOffset MemberSince,
    bool Self,
    string? Friendship);

/// <summary>
/// Friends: every account's profile entity, friend codes and links, accepting a link, and looking
/// someone up by exact username or handle (no browsing the directory).
/// </summary>
public sealed class Friends(AccountService accounts, IAccountStore store, SyncService sync, SharingState sharing, ServerClock clock)
{
    private static readonly string[] AvatarColors = ["#A7C7E7", "#F4B6C2", "#CFE3A3", "#F7D59C", "#C9B6E4", "#9ED9CC", "#F2C1A0", "#B8C4D9"];

    /// <summary>The server's host for handles (<c>name@host</c>); null keeps bare usernames until <c>PUBLIC_URL</c> is set.</summary>
    public string? Host { get; init; }

    /// <summary>A color per person, the same on every start (string hash codes are not).</summary>
    private static string AvatarColor(string id) => AvatarColors[id.Aggregate(0, (hash, c) => (hash * 31 + c) & 0x7FFFFFFF) % AvatarColors.Length];

    public string HandleOf(Account account) => Host is null ? account.Username : $"{account.Username}@{Host}";

    /// <summary>Write the account's profile entity if it has none yet (devices then sync and edit it).</summary>
    public Task EnsureProfileAsync(Account account, CancellationToken cancellation = default) =>
        EnsureProfileAsync(account, null, cancellation);

    /// <summary>The account's profile, written once; <paramref name="displayName"/> (from an identity provider) instead of the username.</summary>
    public async Task EnsureProfileAsync(Account account, string? displayName, CancellationToken cancellation = default)
    {
        if (sharing.Index.Contains(account.Id)) return;
        var stamp = clock.Next();
        var fields = new JsonObject
        {
            ["handle"] = HandleOf(account),
            ["displayName"] = string.IsNullOrWhiteSpace(displayName) ? account.Username : displayName.Trim(),
            ["avatarColor"] = AvatarColor(account.Id),
            ["homeServer"] = Host ?? "local",
        };
        await sync.WriteAsServerAsync(account.Id, [new IncomingEntity("users", New(account.Id, account.Id, stamp, fields))], cancellation);
    }

    public async Task<string> CodeAsync(string userId, bool rotate = false, CancellationToken cancellation = default) =>
        Format(await accounts.FriendCodeAsync(userId, rotate, cancellation));

    /// <summary><c>7QM4K2XP</c> as people read it: <c>7QM4-K2XP</c>.</summary>
    public static string Format(string code) => code.Length == 8 ? $"{code[..4]}-{code[4..]}" : code;

    public async Task<ProfilePreview?> PreviewByCodeAsync(string viewerId, string code, CancellationToken cancellation = default) =>
        await accounts.FindByFriendCodeAsync(code, cancellation) is { Disabled: false } account ? Preview(viewerId, account) : null;

    /// <summary>Someone by exact username or handle on this server.</summary>
    public async Task<ProfilePreview?> LookupAsync(string viewerId, string query, CancellationToken cancellation = default)
    {
        var name = query.Trim().TrimStart('@');
        if (Host is not null && name.EndsWith($"@{Host}", StringComparison.OrdinalIgnoreCase)) name = name[..^(Host.Length + 1)];
        if (name.Length == 0 || name.Contains('@')) return null;
        return await store.FindByUsernameAsync(name, cancellation) is { Disabled: false } account ? Preview(viewerId, account) : null;
    }

    /// <summary>
    /// Accept a friend link: the link's owner offered it, so the friendship starts accepted. An
    /// earlier request or an ended friendship between them comes back as accepted.
    /// </summary>
    /// <returns>The friendship's id, or null when the code is unknown or the viewer's own.</returns>
    public async Task<string?> AcceptLinkAsync(string viewerId, string code, CancellationToken cancellation = default)
    {
        var owner = await accounts.FindByFriendCodeAsync(code, cancellation);
        var viewer = await store.FindByIdAsync(viewerId, cancellation);
        if (owner is null || owner.Disabled || viewer is null || owner.Id == viewerId) return null;
        return await BefriendAsync(owner, viewer, null, cancellation);
    }

    /// <summary>
    /// An admin makes two people friends (spec: Account management), as if one had accepted the
    /// other's link. Null when either is missing or they are the same person.
    /// </summary>
    /// <param name="admin">Who made it: both people see their name on the friendship.</param>
    public async Task<string?> MakeFriendsAsync(string a, string b, Account? admin = null, CancellationToken cancellation = default)
    {
        var first = await store.FindByIdAsync(a, cancellation);
        var second = await store.FindByIdAsync(b, cancellation);
        if (first is null || second is null || a == b) return null;
        return await BefriendAsync(first, second, admin, cancellation);
    }

    /// <summary>An admin ends a friendship. False when there was none.</summary>
    public async Task<bool> EndFriendshipAsync(string a, string b, CancellationToken cancellation = default)
    {
        if (sharing.Index.FriendshipBetween(a, b) is not { } found || found.Doc["deletedAt"] is not null) return false;
        var ended = ServerEntities.Changed(found.Doc, clock.Next(), new JsonObject { ["deletedAt"] = clock.Now() });
        await sync.WriteAsServerAsync((string?)found.Doc["userA"] ?? a, [new IncomingEntity("friendships", ended)], cancellation);
        return true;
    }

    /// <summary>
    /// The friendship between the two, accepted: an earlier request or ended one comes back. It says
    /// which admin made it (<c>madeBy</c>), or, made by the two themselves, nothing.
    /// </summary>
    private async Task<string> BefriendAsync(Account owner, Account viewer, Account? admin, CancellationToken cancellation)
    {
        JsonNode? madeBy = admin is null ? null : new JsonObject { ["id"] = admin.Id, ["name"] = admin.Username };
        var viewerId = viewer.Id;
        await EnsureProfileAsync(owner, cancellation);
        await EnsureProfileAsync(viewer, cancellation);

        var stamp = clock.Next();
        var existing = sharing.Index.FriendshipBetween(owner.Id, viewerId);
        JsonObject doc;
        if (existing is { } found)
        {
            // The rest stays; the stamped fields win.
            doc = ServerEntities.Changed(found.Doc, stamp, new JsonObject { ["state"] = "accepted", ["deletedAt"] = null, ["madeBy"] = madeBy });
        }
        else
        {
            var fields = new JsonObject
            {
                ["userA"] = owner.Id,
                ["userB"] = viewerId,
                ["state"] = "accepted",
            };
            if (madeBy is not null) fields["madeBy"] = madeBy;
            doc = New(Ids.NewUlid(), viewerId, stamp, fields);
        }
        await sync.WriteAsServerAsync(owner.Id, [new IncomingEntity("friendships", doc)], cancellation);
        return (string)doc["id"]!;
    }

    private ProfilePreview Preview(string viewerId, Account account)
    {
        var friendship = sharing.Index.FriendshipBetween(viewerId, account.Id);
        var state = friendship is { } found && found.Doc["deletedAt"] is null ? (string?)found.Doc["state"] : null;
        return new ProfilePreview(account.Id, account.Username, account.Username, HandleOf(account),
            AvatarColor(account.Id),
            account.CreatedAt, account.Id == viewerId, state);
    }

    /// <summary>A whole entity from this server, every field stamped.</summary>
    private JsonObject New(string id, string createdBy, string stamp, JsonObject fields) =>
        ServerEntities.New(id, createdBy, Host ?? "local", clock.Now(), stamp, fields);
}
