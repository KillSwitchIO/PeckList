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
            if (group.Get("ownerId") is { } owner) people.Add(owner);
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

    /// <summary>Every entity id the user may see.</summary>
    public HashSet<string> VisibleTo(string userId) =>
        byId.Keys.Where(id => Viewers(id).Contains(userId)).ToHashSet(StringComparer.Ordinal);

    // Permissions --------------------------------------------------------------------------------

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
