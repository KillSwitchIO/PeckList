using System.Text.Json.Nodes;
using Punchlist.Core.Storage;

namespace Punchlist.Core.Sharing;

/// <summary>
/// The facts sharing depends on, for every entity, kept in memory (spec: Sharing &amp; Permissions).
/// It answers two questions: who may see an entity, and whether someone may write a change to it.
/// Built once from the store at startup, then updated with every write, inside the same lock.
/// </summary>
public sealed class SharingIndex
{
    private sealed record Facts(string Collection, string Id, string Owner, JsonObject Doc)
    {
        public bool Deleted => Doc["deletedAt"] is not null;
        public string? Get(string field) => Doc[field] is JsonValue value && value.TryGetValue<string>(out var text) ? text : null;

        /// <summary>Members of an element set that are in.</summary>
        public IEnumerable<string> SetMembers(string field) =>
            Doc[field] is JsonObject set
                ? set.Where(pair => pair.Value is JsonObject item && (bool?)item["in"] == true).Select(pair => pair.Key)
                : [];
    }

    private readonly Dictionary<string, Facts> byId = new(StringComparer.Ordinal);

    /// <summary>Membership lookups, rebuilt after a change (most reads come between writes).</summary>
    private sealed record Derived(
        ILookup<string, Facts> ListMembers,
        ILookup<string, Facts> GroupMembers,
        IReadOnlyList<Facts> Friendships,
        IReadOnlyList<Facts> Groups,
        IReadOnlyList<Facts> SharedLists);

    private Derived? derived;

    private Derived D => derived ??= new Derived(
        Live("listMembers").ToLookup(each => each.Get("listId") ?? "", StringComparer.Ordinal),
        Live("groupMembers").ToLookup(each => each.Get("groupId") ?? "", StringComparer.Ordinal),
        Live("friendships").ToList(),
        Live("groups").ToList(),
        Live("lists").Where(each => each.Get("visibility") == "shared").ToList());

    /// <summary>Take in an entity as now stored (new or changed).</summary>
    public void Apply(StoredEntity entity)
    {
        byId[entity.Id] = new Facts(entity.Collection, entity.Id, entity.OwnerId, entity.Doc);
        derived = null;
    }

    public void Clear()
    {
        byId.Clear();
        derived = null;
    }

    /// <summary>Forget an entity (undo a tried change that was refused).</summary>
    public void Remove(string id)
    {
        if (byId.Remove(id)) derived = null;
    }

    public bool Contains(string id) => byId.ContainsKey(id);

    /// <summary>An entity's stored document, deleted or not.</summary>
    public JsonObject? DocOf(string id) => byId.TryGetValue(id, out var facts) ? facts.Doc : null;

    /// <summary>The live groups an owner has (the server's own, for <see cref="ServerGroupProjection"/>).</summary>
    public IReadOnlyList<(string Id, JsonObject Doc)> GroupsOwnedBy(string owner) =>
        [.. byId.Values.Where(each => each.Collection == "groups" && !each.Deleted && each.Get("ownerId") == owner).Select(each => (each.Id, each.Doc))];

    /// <summary>Every membership row of a group, left ones too.</summary>
    public IReadOnlyList<(string Id, JsonObject Doc)> MembershipRowsOf(string groupId) =>
        [.. byId.Values.Where(each => each.Collection == "groupMembers" && each.Get("groupId") == groupId).Select(each => (each.Id, each.Doc))];

    /// <summary>The friendship between two people in either direction, deleted ones too.</summary>
    public (string Id, JsonObject Doc)? FriendshipBetween(string a, string b)
    {
        foreach (var facts in byId.Values)
        {
            if (facts.Collection != "friendships") continue;
            var userA = facts.Get("userA");
            var userB = facts.Get("userB");
            if ((userA == a && userB == b) || (userA == b && userB == a)) return (facts.Id, facts.Doc);
        }
        return null;
    }

    /// <summary>A user's live friendships (not ended): the other person and the state.</summary>
    public IReadOnlyList<(string Id, string Other, string State)> FriendshipsOf(string userId)
    {
        var found = new List<(string, string, string)>();
        foreach (var facts in byId.Values)
        {
            if (facts.Collection != "friendships" || facts.Doc["deletedAt"] is not null) continue;
            var userA = facts.Get("userA");
            var userB = facts.Get("userB");
            var other = userA == userId ? userB : userB == userId ? userA : null;
            if (other is not null) found.Add((facts.Id, other, facts.Get("state") ?? "pending"));
        }
        return found;
    }

    /// <summary>
    /// What a user owns that others share in: shared lists and live groups, with how many people
    /// are in each (spec: Account management, ownership).
    /// </summary>
    public IReadOnlyList<OwnedShare> SharedOwnedBy(string userId)
    {
        var found = new List<OwnedShare>();
        foreach (var list in D.SharedLists.Where(each => each.Owner == userId))
        {
            found.Add(new OwnedShare("list", list.Id, list.Get("name") ?? "", ListPeople(list.Id).Count(), list.Doc));
        }
        foreach (var group in D.Groups.Where(each => each.Get("ownerId") == userId && !Archived(each)))
        {
            found.Add(new OwnedShare("group", group.Id, group.Get("name") ?? "", GroupPeople(group.Id, withInvited: false).Count, group.Doc));
        }
        return found;
    }

    /// <summary>A user's membership row in a group, if any (deleted ones too).</summary>
    public (string Id, JsonObject Doc)? GroupMembership(string groupId, string userId) =>
        byId.Values
            .Where(each => each.Collection == "groupMembers" && each.Get("groupId") == groupId && each.Get("userId") == userId)
            .Select(each => ((string, JsonObject)?)(each.Id, each.Doc))
            .FirstOrDefault();

    /// <summary>A copy to try changes on before they are committed.</summary>
    public SharingIndex Clone()
    {
        var copy = new SharingIndex();
        foreach (var (id, facts) in byId) copy.byId[id] = facts;
        return copy;
    }

    // Relations ----------------------------------------------------------------------------------

    private IEnumerable<Facts> Live(string collection) => byId.Values.Where(each => each.Collection == collection && !each.Deleted);

    /// <summary>People in a group: active members (and the owner); with invites, the invited too.</summary>
    private HashSet<string> GroupPeople(string groupId, bool withInvited)
    {
        var people = new HashSet<string>(StringComparer.Ordinal);
        if (byId.TryGetValue(groupId, out var group) && group.Collection == "groups" && !group.Deleted)
        {
            // An archived group has nobody left; its last owner keeps only the group itself.
            if (group.Get("ownerId") is { } owner && !Archived(group)) people.Add(owner);
        }
        else
        {
            return people;
        }
        foreach (var member in D.GroupMembers[groupId])
        {
            var state = member.Get("state");
            if (state == "active" || (withInvited && state == "invited"))
            {
                if (member.Get("userId") is { } user) people.Add(user);
            }
        }
        return people;
    }

    /// <summary>Users behind a principal: <c>user:&lt;id&gt;</c> or <c>group:&lt;id&gt;</c> (active members).</summary>
    private IEnumerable<string> PeopleOf(string principal) =>
        principal.StartsWith("user:", StringComparison.Ordinal) ? [principal[5..]]
        : principal.StartsWith("group:", StringComparison.Ordinal) ? GroupPeople(principal[6..], withInvited: false)
        : [];

    /// <summary>A user's role on a list: owner, editor, viewer, or null (no access).</summary>
    public string? ListRole(string userId, string listId)
    {
        // A deleted list keeps its roles: its owner may restore it from the trash.
        if (!byId.TryGetValue(listId, out var list) || list.Collection != "lists") return null;
        if (list.Owner == userId) return "owner";
        if (list.Get("visibility") != "shared") return null;
        string? best = null;
        foreach (var member in D.ListMembers[listId])
        {
            if (member.Get("principal") is not { } principal || !PeopleOf(principal).Contains(userId)) continue;
            var role = member.Get("role");
            if (Rank(role) > Rank(best)) best = role;
        }
        return best;
    }

    private static int Rank(string? role) => role switch { "owner" => 3, "editor" => 2, "viewer" => 1, _ => 0 };

    private IEnumerable<string> ListPeople(string listId)
    {
        // A deleted list still reaches its people, so its tombstone (and its tasks') syncs.
        if (!byId.TryGetValue(listId, out var list) || list.Collection != "lists") return [];
        var people = new HashSet<string>(StringComparer.Ordinal) { list.Owner };
        if (list.Get("visibility") == "shared")
        {
            foreach (var member in D.ListMembers[listId])
            {
                if (member.Get("principal") is { } principal) people.UnionWith(PeopleOf(principal));
            }
        }
        return people;
    }

    /// <summary>Users a task is assigned to (directly or through a group), and to its ancestors.</summary>
    private HashSet<string> Assigned(Facts task)
    {
        var people = new HashSet<string>(StringComparer.Ordinal);
        var seen = new HashSet<string>(StringComparer.Ordinal);
        for (var current = task; current is not null && seen.Add(current.Id);)
        {
            foreach (var principal in current.SetMembers("assignees")) people.UnionWith(PeopleOf(principal));
            current = current.Get("parentId") is { } parent && byId.TryGetValue(parent, out var next) ? next : null;
        }
        return people;
    }

    // Visibility ---------------------------------------------------------------------------------

    /// <summary>Everyone who may see the entity (deleted ones too: the tombstone must reach them).</summary>
    public HashSet<string> Viewers(string id)
    {
        var viewers = new HashSet<string>(StringComparer.Ordinal);
        if (!byId.TryGetValue(id, out var entity)) return viewers;
        switch (entity.Collection)
        {
            case "lists":
                viewers.UnionWith(ListPeople(entity.Id));
                viewers.Add(entity.Owner);
                break;
            case "sections":
                viewers.UnionWith(entity.Get("listId") is { } sectionList ? ListPeople(sectionList) : []);
                viewers.Add(entity.Owner);
                break;
            case "tasks":
                if (entity.Get("listId") is { } taskList)
                {
                    viewers.UnionWith(ListPeople(taskList));
                    // A task in a list the creator no longer owns or sees still reaches the list's people only.
                    if (!byId.ContainsKey(taskList)) viewers.Add(entity.Owner);
                }
                else
                {
                    viewers.Add(entity.Owner);
                }
                viewers.UnionWith(Assigned(entity));
                break;
            case "comments":
            case "attachments":
                // Whoever sees the task sees its comments and files; one on a task gone from the
                // index stays its author's.
                if (entity.Get("taskId") is { } commented && byId.ContainsKey(commented)) viewers.UnionWith(Viewers(commented));
                else viewers.Add(entity.Owner);
                break;
            case "listMembers":
                viewers.UnionWith(entity.Get("listId") is { } memberList ? ListPeople(memberList) : []);
                if (entity.Get("principal") is { } principal) viewers.UnionWith(PeopleOf(principal));
                viewers.Add(entity.Owner);
                break;
            case "groups":
                viewers.UnionWith(GroupPeople(entity.Id, withInvited: true));
                viewers.Add(entity.Owner);
                break;
            case "groupMembers":
                viewers.UnionWith(entity.Get("groupId") is { } group ? GroupPeople(group, withInvited: true) : []);
                if (entity.Get("userId") is { } memberUser) viewers.Add(memberUser);
                viewers.Add(entity.Owner);
                break;
            case "friendships":
                if (entity.Get("userA") is { } a) viewers.Add(a);
                if (entity.Get("userB") is { } b) viewers.Add(b);
                break;
            case "users":
                viewers.Add(entity.Id);
                viewers.UnionWith(Acquaintances(entity.Id));
                break;
            default:
                // tags, folders, saved filters, settings: personal.
                viewers.Add(entity.Owner);
                break;
        }
        return viewers;
    }

    /// <summary>People whose profile a user sees: friends (and requests), group mates, list mates.</summary>
    private HashSet<string> Acquaintances(string userId)
    {
        var people = new HashSet<string>(StringComparer.Ordinal);
        foreach (var friendship in D.Friendships)
        {
            var a = friendship.Get("userA");
            var b = friendship.Get("userB");
            if (a == userId && b is not null) people.Add(b);
            if (b == userId && a is not null) people.Add(a);
        }
        foreach (var group in D.Groups)
        {
            var members = GroupPeople(group.Id, withInvited: true);
            if (members.Contains(userId)) people.UnionWith(members);
        }
        foreach (var list in D.SharedLists)
        {
            var members = ListPeople(list.Id).ToHashSet(StringComparer.Ordinal);
            if (members.Contains(userId)) people.UnionWith(members);
        }
        people.Remove(userId);
        return people;
    }

    /// <summary>Whether the user sees a live attachment with these bytes (so may download them).</summary>
    public bool SeesFile(string userId, string sha256) =>
        Live("attachments").Any(each => each.Get("sha256") == sha256 && Viewers(each.Id).Contains(userId));

    /// <summary>
    /// File hashes still wanted: live attachments, and deleted ones newer than <paramref name="keepDeletedSince"/>
    /// (they can still be restored from the trash or undone).
    /// </summary>
    public HashSet<string> WantedFiles(DateTimeOffset keepDeletedSince) =>
        byId.Values
            .Where(each => each.Collection == "attachments"
                && (!each.Deleted || (DateTimeOffset.TryParse(each.Get("deletedAt"), System.Globalization.CultureInfo.InvariantCulture,
                    System.Globalization.DateTimeStyles.AssumeUniversal, out var at) && at >= keepDeletedSince)))
            .Select(each => each.Get("sha256"))
            .OfType<string>()
            .ToHashSet(StringComparer.Ordinal);

    /// <summary>Every entity id the user may see.</summary>
    public HashSet<string> VisibleTo(string userId) =>
        byId.Keys.Where(id => Viewers(id).Contains(userId)).ToHashSet(StringComparer.Ordinal);

    private static bool Archived(Facts group) => group.Doc["archived"] is JsonValue value && value.TryGetValue<bool>(out var archived) && archived;

    // Succession ---------------------------------------------------------------------------------

    /// <summary>
    /// Groups whose owner has left (their membership is deleted and none is active), and what
    /// happens to each: the longest-standing active member takes over, or with nobody left the
    /// group is archived and the tasks assigned to it lose that assignee.
    /// </summary>
    public IReadOnlyList<GroupSuccession> PendingSuccessions()
    {
        var pending = new List<GroupSuccession>();
        foreach (var group in D.Groups)
        {
            if (Archived(group) || group.Get("ownerId") is not { } owner) continue;
            var rows = byId.Values.Where(each => each.Collection == "groupMembers" && each.Get("groupId") == group.Id).ToList();
            var ownerRows = rows.Where(each => each.Get("userId") == owner).ToList();
            // An owner who never had a membership is a member by ownership: nothing to do.
            if (ownerRows.Count == 0 || ownerRows.Any(each => !each.Deleted && each.Get("state") == "active")) continue;
            var heir = rows
                .Where(each => !each.Deleted && each.Get("state") == "active" && each.Get("userId") != owner)
                .OrderBy(each => each.Get("joinedAt"), StringComparer.Ordinal)
                .ThenBy(each => each.Id, StringComparer.Ordinal)
                .Select(each => each.Get("userId"))
                .FirstOrDefault();
            var assigned = heir is null
                ? Live("tasks").Where(task => task.SetMembers("assignees").Contains($"group:{group.Id}")).Select(task => (task.Id, task.Doc)).ToList()
                : [];
            pending.Add(new GroupSuccession(group.Id, group.Doc, heir, assigned));
        }
        return pending;
    }

    // Invites -------------------------------------------------------------------------------------

    /// <summary>
    /// Assignments waiting on a friend request (<c>invite:&lt;user&gt;:&lt;inviter&gt;</c>, spec: Friends,
    /// invite on assign) that can now be settled: accepted, the invite becomes <c>user:&lt;user&gt;</c>;
    /// declined or taken back (no live friendship), it goes. Pending ones wait.
    /// </summary>
    public IReadOnlyList<InviteSettlement> PendingInvites()
    {
        var settled = new List<InviteSettlement>();
        foreach (var task in Live("tasks"))
        {
            foreach (var key in task.SetMembers("assignees"))
            {
                if (!key.StartsWith("invite:", StringComparison.Ordinal)) continue;
                var parts = key.Split(':');
                if (parts.Length != 3) continue;
                var friendship = FriendshipBetween(parts[1], parts[2]);
                var live = friendship is { } found && found.Doc["deletedAt"] is null;
                var accepted = live && (string?)friendship!.Value.Doc["state"] == "accepted";
                if (accepted || !live) settled.Add(new InviteSettlement(task.Id, task.Doc, key, accepted ? $"user:{parts[1]}" : null));
            }
        }
        return settled;
    }

    // Permissions --------------------------------------------------------------------------------

    /// <summary>Whether the user may change the task: owner or editor on its list, assigned to it, or its creator when it has no list.</summary>
    private static bool MayEditTask(SharingIndex index, string userId, string taskId)
    {
        if (!index.byId.TryGetValue(taskId, out var task)) return false;
        if (task.Get("listId") is { } listId) return index.ListRole(userId, listId) is "owner" or "editor" || index.Assigned(task).Contains(userId);
        return task.Owner == userId || index.Assigned(task).Contains(userId);
    }

    /// <summary>
    /// Whether <paramref name="userId"/> may write <paramref name="after"/> over <paramref name="before"/>
    /// (null: a new entity). <paramref name="after"/> must already be applied to this index (try changes
    /// on a <see cref="Clone"/>); <paramref name="before"/> is checked against the index as it was.
    /// </summary>
    public bool MayWrite(string userId, StoredEntity? before, StoredEntity after, SharingIndex beforeIndex)
    {
        var doc = after.Doc;
        string? Field(JsonObject source, string name) => source[name] is JsonValue value && value.TryGetValue<string>(out var text) ? text : null;
        bool Changed(string name) => before is null || !JsonNode.DeepEquals(before.Doc[name], doc[name]);

        switch (after.Collection)
        {
            case "tasks":
            case "sections":
            {
                // Its list (old and new) must be editable, or the task assigned to this user.
                bool CanEditIn(SharingIndex index, string? listId, string id) =>
                    (listId is not null && index.ListRole(userId, listId) is "owner" or "editor")
                    || (after.Collection == "tasks" && index.byId.TryGetValue(id, out var task) && index.Assigned(task).Contains(userId));
                var newList = Field(doc, "listId");
                // Not in any list: personal, like a tag.
                if (newList is null && (before is null || Field(before.Doc, "listId") is null))
                {
                    return before is null || before.OwnerId == userId;
                }
                if (before is null) return CanEditIn(this, newList, after.Id) || (newList is not null && beforeIndex.ListRole(userId, newList) is "owner" or "editor");
                var oldList = Field(before.Doc, "listId");
                if (!CanEditIn(beforeIndex, oldList, before.Id)) return false;
                // Moving needs the destination too.
                return oldList == newList || (newList is not null && ListRole(userId, newList) is "owner" or "editor");
            }
            case "comments":
            {
                var taskId = Field(doc, "taskId");
                if (taskId is null || (before is not null && Changed("taskId"))) return false;
                // Writing on a task needs the right to change it: owners, editors, assignees.
                // A task made in the same push is in this index only.
                if (before is null) return after.OwnerId == userId && MayEditTask(beforeIndex.Contains(taskId) ? beforeIndex : this, userId, taskId);
                // The author changes or deletes it; the list's owner may delete it.
                if (before.OwnerId == userId) return true;
                var listId = beforeIndex.byId.TryGetValue(taskId, out var task) ? task.Get("listId") : null;
                return listId is not null && beforeIndex.ListRole(userId, listId) == "owner"
                    && doc["deletedAt"] is not null && !Changed("body");
            }
            case "attachments":
            {
                var taskId = Field(doc, "taskId");
                if (taskId is null || (before is not null && (Changed("taskId") || Changed("sha256") || Changed("size")))) return false;
                if (before is null) return after.OwnerId == userId && MayEditTask(beforeIndex.Contains(taskId) ? beforeIndex : this, userId, taskId);
                // Who added it renames or removes it; the list's owner may remove it.
                if (before.OwnerId == userId) return true;
                var listId = beforeIndex.byId.TryGetValue(taskId, out var task) ? task.Get("listId") : null;
                return listId is not null && beforeIndex.ListRole(userId, listId) == "owner"
                    && doc["deletedAt"] is not null && !Changed("name");
            }
            case "lists":
                // Only owners change a list; a new list is the writer's own.
                return before is null ? after.OwnerId == userId : beforeIndex.ListRole(userId, before.Id) == "owner";
            case "listMembers":
            {
                var listId = Field(doc, "listId");
                if (listId is null) return false;
                // A list made in this same push has its owner in this index only.
                var role = beforeIndex.Contains(listId) ? beforeIndex.ListRole(userId, listId) : ListRole(userId, listId);
                if (role == "owner") return true;
                // Anyone may leave: delete their own membership, changing nothing else.
                return before is not null
                    && Field(before.Doc, "principal") == $"user:{userId}"
                    && doc["deletedAt"] is not null
                    && !Changed("listId") && !Changed("principal") && !Changed("role");
            }
            case "groups":
            {
                if (before is null) return Field(doc, "ownerId") == userId;
                return Field(before.Doc, "ownerId") == userId;
            }
            case "groupMembers":
            {
                var groupId = Field(doc, "groupId");
                var groupOwner = groupId is not null && beforeIndex.byId.TryGetValue(groupId, out var group) ? group.Get("ownerId") : null;
                // A brand-new group's members arrive with it: its owner is in this index already.
                groupOwner ??= groupId is not null && byId.TryGetValue(groupId, out var newGroup) ? newGroup.Get("ownerId") : null;
                // A server group's memberships are the server's: nobody leaves or changes them in the app.
                if (groupOwner == ServerGroupProjection.Owner) return false;
                if (groupOwner == userId) return before is null ? Field(doc, "state") is "invited" or "active" : true;
                // The invited accept (invited -> active) or leave; nothing else.
                return before is not null
                    && Field(before.Doc, "userId") == userId
                    && !Changed("groupId") && !Changed("userId")
                    && (Field(doc, "state") is "active" || doc["deletedAt"] is not null);
            }
            case "friendships":
            {
                var a = Field(doc, "userA");
                var b = Field(doc, "userB");
                if (before is null) return a == userId && b is not null && b != userId && Field(doc, "state") == "pending";
                if (Changed("userA") || Changed("userB")) return false;
                if (a != userId && b != userId) return false;
                // Only the asked side accepts; either side may end it.
                return !Changed("state") || (Field(doc, "state") == "accepted" && b == userId) || doc["deletedAt"] is not null;
            }
            case "users":
                return after.Id == userId;
            default:
                return before is null || before.OwnerId == userId;
        }
    }
}

/// <summary>A group whose owner left: its new owner, or null to archive it (with the tasks assigned to it).</summary>
public sealed record GroupSuccession(
    string GroupId,
    JsonObject Group,
    string? NewOwner,
    IReadOnlyList<(string Id, JsonObject Doc)> AssignedTasks);

/// <summary>An invite assignment to settle: replaced by <paramref name="Assignee"/>, or dropped when null.</summary>
/// <summary>A shared list or a group someone owns.</summary>
public sealed record OwnedShare(string Kind, string Id, string Name, int People, JsonObject Doc);

public sealed record InviteSettlement(string TaskId, JsonObject Task, string Invite, string? Assignee);
