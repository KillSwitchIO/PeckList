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
/// <param name="Link">
/// What accepting this person's link would do (<see cref="FriendLinkPreviews"/>): "befriend",
/// "ask" (a friendship between them ended, so it sends a request), or "asked" (a request is
/// waiting already). Older servers send none: befriend.
/// </param>
public sealed record ProfilePreview(
    string UserId,
    string Username,
    string DisplayName,
    string Handle,
    string AvatarColor,
    DateTimeOffset MemberSince,
    bool Self,
    string? Friendship,
    string Link = FriendLinkPreviews.Befriend);

/// <summary>What opening a friend link did (<see cref="Friends.AcceptLinkAsync"/>).</summary>
/// <param name="FriendshipId">The friendship row it made, accepted, or found.</param>
/// <param name="State">
/// <see cref="FriendLinkStates.Accepted"/>: friends now. <see cref="FriendLinkStates.Requested"/>: a
/// request to the link's owner is waiting.
/// </param>
public sealed record FriendLinkResult(string FriendshipId, string State);

public static class FriendLinkStates
{
    public const string Accepted = "accepted";
    public const string Requested = "requested";
}

/// <summary>What opening the link would do, for the page shown before (<see cref="ProfilePreview.Link"/>).</summary>
public static class FriendLinkPreviews
{
    /// <summary>Make the two friends (or they are already).</summary>
    public const string Befriend = "befriend";

    /// <summary>Send the owner a request: a friendship between them ended.</summary>
    public const string Ask = "ask";

    /// <summary>Nothing more: a request from the viewer is waiting.</summary>
    public const string Asked = "asked";
}

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

    /// <summary>
    /// Bring handles in line with the server's address. A profile is written once, so one made before
    /// <c>PUBLIC_URL</c> changed, or was set, would name the old address for good. Only these two
    /// fields change; without an address there is nothing to bring them in line with.
    /// </summary>
    public async Task<int> RefreshHandlesAsync(CancellationToken cancellation = default)
    {
        if (Host is null) return 0;
        var changed = 0;
        foreach (var account in await store.ListAsync(cancellation))
        {
            if (sharing.Index.LiveDocOf(account.Id, "users") is not { } profile) continue;
            var handle = HandleOf(account);
            if ((string?)profile["handle"] == handle && (string?)profile["homeServer"] == Host) continue;
            var fields = new JsonObject { ["handle"] = handle, ["homeServer"] = Host };
            await sync.WriteAsServerAsync(account.Id,
                [new IncomingEntity("users", ServerEntities.Changed(profile, clock.Next(), fields))], cancellation);
            changed++;
        }
        return changed;
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
    /// Open a friend link. Between two people who were never friends and never turned a request
    /// down, the owner offered it, so the friendship starts accepted (an earlier request between
    /// them is accepted too).
    /// <para>
    /// Once a friendship or request between them has ended, ending it works as a block (audit U5):
    /// a link, old or new, only ever asks. Opening it sends one request to the owner, as a request
    /// by username would, and opening it again finds that request instead of accepting it or
    /// sending another. A declined request is never overridden: opening a link afterwards sends one
    /// new request, which the owner can decline again.
    /// </para>
    /// </summary>
    /// <returns>What it did, or null when the code is unknown or the viewer's own.</returns>
    public async Task<FriendLinkResult?> AcceptLinkAsync(string viewerId, string code, CancellationToken cancellation = default)
    {
        var owner = await accounts.FindByFriendCodeAsync(code, cancellation);
        var viewer = await store.FindByIdAsync(viewerId, cancellation);
        if (owner is null || owner.Disabled || viewer is null || owner.Id == viewerId) return null;
        await EnsureProfileAsync(owner, cancellation);
        await EnsureProfileAsync(viewer, cancellation);

        // Decided and written under the sharing gate, so two opens at once (or an open racing a
        // device's request or an end) make one request and never revive an ended row.
        FriendLinkResult? result = null;
        await sync.WriteAsServerAsync(viewerId, index =>
        {
            var stamp = clock.Next();
            var (plan, found) = Plan(index, owner.Id, viewerId);
            switch (plan)
            {
                case LinkPlan.Friends:
                    result = new FriendLinkResult(found!.Value.Id, FriendLinkStates.Accepted);
                    return [];
                case LinkPlan.Waiting:
                    result = new FriendLinkResult(found!.Value.Id, FriendLinkStates.Requested);
                    return [];
                case LinkPlan.AcceptTheirs:
                    // That very row, live and from the owner: accepted, as Accept under Requests would.
                    var accepted = ServerEntities.Changed(found!.Value.Doc, stamp, new JsonObject { ["state"] = "accepted" });
                    result = new FriendLinkResult(found.Value.Id, FriendLinkStates.Accepted);
                    return [new IncomingEntity("friendships", accepted)];
                case LinkPlan.Request:
                    var fields = new JsonObject { ["userA"] = viewerId, ["userB"] = owner.Id, ["state"] = "pending" };
                    var request = New(Ids.NewUlid(), viewerId, stamp, fields);
                    result = new FriendLinkResult((string)request["id"]!, FriendLinkStates.Requested);
                    return [new IncomingEntity("friendships", request)];
                default:
                    // A new row is the link owner's, as before; an earlier request keeps its owner.
                    var made = index.FriendshipBetween(owner.Id, viewerId) is null;
                    var doc = BefriendDoc(index, owner.Id, viewerId, null, stamp);
                    result = new FriendLinkResult((string)doc["id"]!, FriendLinkStates.Accepted);
                    return [made ? new IncomingEntity("friendships", doc) { Owner = owner.Id } : new IncomingEntity("friendships", doc)];
            }
        }, cancellation);
        return result;
    }

    private enum LinkPlan
    {
        /// <summary>Never ended between them: friends in one step, as before U5.</summary>
        Befriend,
        Friends,
        AcceptTheirs,
        Waiting,
        Request,
    }

    /// <summary>
    /// What opening <paramref name="ownerId"/>'s link does for <paramref name="viewerId"/>, and the
    /// row it concerns. Once any row between them has ended (an ended friendship, a declined or
    /// withdrawn request), the link only asks (audit U5).
    /// </summary>
    private static (LinkPlan Plan, (string Id, JsonObject Doc)? Row) Plan(SharingIndex index, string ownerId, string viewerId)
    {
        var rows = index.FriendshipRowsBetween(ownerId, viewerId);
        var ended = rows.Where(row => row.Doc["deletedAt"] is not null).ToList();
        if (ended.Count == 0) return (LinkPlan.Befriend, null);
        var live = rows.Where(row => row.Doc["deletedAt"] is null).ToList();
        if (live.FirstOrDefault(row => State(row.Doc) == "accepted") is { Id: not null } friends) return (LinkPlan.Friends, friends);
        // The owner has asked the viewer already: opening the owner's link says yes to that.
        if (live.FirstOrDefault(row => (string?)row.Doc["userA"] == ownerId) is { Id: not null } theirs) return (LinkPlan.AcceptTheirs, theirs);
        // The viewer's request is waiting: one per pair, so nothing new to send or show the owner.
        if (live.FirstOrDefault() is { Id: not null } waiting) return (LinkPlan.Waiting, waiting);
        return (LinkPlan.Request, null);
    }

    private static string State(JsonObject doc) => (string?)doc["state"] ?? "pending";


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

    /// <summary>
    /// An admin ends a friendship, or an account's removal does: every live row between the two, so
    /// none is left behind where two requests made two. False when there was none.
    /// </summary>
    public async Task<bool> EndFriendshipAsync(string a, string b, CancellationToken cancellation = default)
    {
        var live = sharing.Index.LiveFriendshipsBetween(a, b);
        if (live.Count == 0) return false;
        var ended = live
            .Select(found => new IncomingEntity("friendships",
                ServerEntities.Changed(found.Doc, clock.Next(), new JsonObject { ["deletedAt"] = clock.Now() })))
            .ToList();
        await sync.WriteAsServerAsync((string?)live[0].Doc["userA"] ?? a, ended, cancellation);
        return true;
    }

    /// <summary>
    /// The friendship between the two, accepted: an earlier request or ended one comes back. It says
    /// which admin made it (<c>madeBy</c>), or, made by the two themselves, nothing.
    /// </summary>
    private async Task<string> BefriendAsync(Account owner, Account viewer, Account? admin, CancellationToken cancellation)
    {
        JsonNode? madeBy = admin is null ? null : new JsonObject { ["id"] = admin.Id, ["name"] = admin.Username };
        await EnsureProfileAsync(owner, cancellation);
        await EnsureProfileAsync(viewer, cancellation);
        string id = "";
        await sync.WriteAsServerAsync(owner.Id, index =>
        {
            var doc = BefriendDoc(index, owner.Id, viewer.Id, madeBy, clock.Next());
            id = (string)doc["id"]!;
            return [new IncomingEntity("friendships", doc)];
        }, cancellation);
        return id;
    }

    /// <summary>The friendship between the two, accepted: the best row there is (revived if ended), else a new one.</summary>
    private JsonObject BefriendDoc(SharingIndex index, string ownerId, string viewerId, JsonNode? madeBy, string stamp)
    {
        if (index.FriendshipBetween(ownerId, viewerId) is { } found)
        {
            // The rest stays; the stamped fields win.
            return ServerEntities.Changed(found.Doc, stamp,
                new JsonObject { ["state"] = "accepted", ["deletedAt"] = null, ["madeBy"] = madeBy?.DeepClone() });
        }
        var fields = new JsonObject
        {
            ["userA"] = ownerId,
            ["userB"] = viewerId,
            ["state"] = "accepted",
        };
        if (madeBy is not null) fields["madeBy"] = madeBy.DeepClone();
        return New(Ids.NewUlid(), viewerId, stamp, fields);
    }

    private ProfilePreview Preview(string viewerId, Account account)
    {
        var index = sharing.Index;
        var friendship = index.FriendshipBetween(viewerId, account.Id);
        var state = friendship is { } found && found.Doc["deletedAt"] is null ? (string?)found.Doc["state"] : null;
        var link = account.Id == viewerId ? FriendLinkPreviews.Befriend : Plan(index, account.Id, viewerId).Plan switch
        {
            LinkPlan.Request => FriendLinkPreviews.Ask,
            LinkPlan.Waiting => FriendLinkPreviews.Asked,
            _ => FriendLinkPreviews.Befriend,
        };
        return new ProfilePreview(account.Id, account.Username, account.Username, HandleOf(account),
            AvatarColor(account.Id),
            account.CreatedAt, account.Id == viewerId, state, link);
    }

    /// <summary>A whole entity from this server, every field stamped.</summary>
    private JsonObject New(string id, string createdBy, string stamp, JsonObject fields) =>
        ServerEntities.New(id, createdBy, Host ?? "local", clock.Now(), stamp, fields);
}
