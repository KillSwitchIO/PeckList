using System.Collections.Immutable;
using System.Text.Json.Nodes;
using PeckList.Core.Storage;

namespace PeckList.Core.Sharing;

/// <summary>
/// The facts sharing depends on, for every entity, kept in memory (spec: Sharing &amp; Permissions).
/// It answers two questions: who may see an entity, and whether someone may write a change to it.
/// Built once from the store at startup, then updated with every write, inside the same lock.
/// </summary>
/// <remarks>
/// Everything is held in immutable maps, with lookups (by list, by task, by group, ...) kept up to
/// date entity by entity. A copy to try a push on is a handful of references, and a change touches
/// only the lookups of the entities it changes (audit P2: copying and re-deriving the whole index
/// on every write cost seconds at 300,000 entities).
/// </remarks>
public sealed class SharingIndex
{
    /// <summary>
    /// What the index holds of one entity. The collections sharing is made of keep their whole
    /// document; everything else keeps the fields it reads as plain text (see <see cref="Read"/>).
    /// </summary>
    private sealed class Facts
    {
        public required string Collection { get; init; }
        public required string Id { get; init; }
        public required string Owner { get; init; }
        public required bool Deleted { get; init; }

        /// <summary>The stored document, for the collections in <see cref="Whole"/>.</summary>
        public JsonObject? Whole { get; init; }

        /// <summary>The fields <see cref="Read"/> names for the collection, as text, in that order.</summary>
        public string?[] Fields { get; init; } = [];

        /// <summary>Assignees that are in, and each one's clock.</summary>
        public (string Key, string? Clock)[] In { get; init; } = [];

        /// <summary>A task's reminder fields (reminders, schedule, due, constantReminder) as JSON text, when it has reminders.</summary>
        public string? Reminders { get; init; }

        public string? Get(string field)
        {
            if (Whole is not null) return Whole[field] is JsonValue value && value.TryGetValue<string>(out var text) ? text : null;
            var at = Array.IndexOf(Read.GetValueOrDefault(Collection) ?? Plain, field);
            return at >= 0 ? Fields[at] : null;
        }

        /// <summary>Members of an element set that are in.</summary>
        public IEnumerable<string> SetMembers(string field)
        {
            if (Whole is not null)
            {
                return Whole[field] is JsonObject set
                    ? set.Where(pair => pair.Value is JsonObject item && (bool?)item["in"] == true).Select(pair => pair.Key)
                    : [];
            }
            return field == "assignees" ? In.Select(each => each.Key) : [];
        }

        /// <summary>
        /// The document: the stored one, or for the rest one made from the kept fields (a fresh
        /// copy each time, so callers may change it).
        /// </summary>
        public JsonObject Doc
        {
            get
            {
                if (Whole is not null) return Whole;
                var doc = new JsonObject { ["id"] = Id };
                var names = Read.GetValueOrDefault(Collection) ?? Plain;
                for (var at = 0; at < names.Length; at++) doc[names[at]] = Fields[at];
                if (Collection == "tasks")
                {
                    var assignees = new JsonObject();
                    foreach (var (key, clock) in In) assignees[key] = new JsonObject { ["in"] = true, ["hlc"] = clock };
                    doc["assignees"] = assignees;
                }
                if (Reminders is not null && JsonNode.Parse(Reminders) is JsonObject kept)
                {
                    foreach (var (name, value) in kept.ToList())
                    {
                        kept.Remove(name);
                        doc[name] = value;
                    }
                }
                return doc;
            }
        }

        public static Facts Of(StoredEntity entity)
        {
            var doc = entity.Doc;
            var deleted = doc["deletedAt"] is not null;
            if (SharingIndex.Whole.Contains(entity.Collection))
            {
                return new Facts { Collection = entity.Collection, Id = entity.Id, Owner = string.Intern(entity.OwnerId), Deleted = deleted, Whole = doc };
            }
            static string? Text(JsonNode? node) => node is JsonValue value && value.TryGetValue<string>(out var text) ? text : null;
            var names = Read.GetValueOrDefault(entity.Collection) ?? Plain;
            var fields = new string?[names.Length];
            for (var at = 0; at < names.Length; at++)
            {
                var text = Text(doc[names[at]]);
                // Lists, people and states repeat across thousands of entities: one copy each.
                fields[at] = text is not null && Shared.Contains(names[at]) ? string.Intern(text) : text;
            }
            var assignees = doc["assignees"] is JsonObject set
                ? set.Where(pair => pair.Value is JsonObject item && (bool?)item["in"] == true)
                    .Select(pair => (string.Intern(pair.Key), Text(pair.Value!["hlc"]))).ToArray()
                : [];
            string? reminders = null;
            if (entity.Collection == "tasks" && doc["reminders"] is JsonArray { Count: > 0 })
            {
                var kept = new JsonObject();
                foreach (var field in ReminderFields)
                {
                    if (doc[field] is { } value) kept[field] = value.DeepClone();
                }
                reminders = kept.ToJsonString();
            }
            return new Facts
            {
                Collection = string.Intern(entity.Collection),
                Id = entity.Id,
                Owner = string.Intern(entity.OwnerId),
                Deleted = deleted,
                Fields = fields,
                In = assignees,
                Reminders = reminders,
            };
        }
    }

    /// <summary>The lookups kept beside the entities (each maps a key to entity ids, deleted ones included).</summary>
    private enum By
    {
        Collection,
        /// <summary>listId of sections, tasks and list memberships.</summary>
        List,
        /// <summary>listId of list memberships only (a list's people, without walking its thousands of tasks).</summary>
        ListMember,
        /// <summary>taskId of comments and attachments.</summary>
        Task,
        /// <summary>parentId of tasks.</summary>
        Parent,
        /// <summary>groupId of group memberships.</summary>
        Group,
        /// <summary>principal of list memberships.</summary>
        Principal,
        /// <summary>Assignees (in) of tasks.</summary>
        Assignee,
        /// <summary>sha256 of attachments.</summary>
        Sha,
        /// <summary>The people of friendships (both sides) and group memberships.</summary>
        User,
        /// <summary>ownerId of groups.</summary>
        GroupOwner,
        /// <summary>The storage owner of lists.</summary>
        ListOwner,
        /// <summary>Tasks with reminders (one key): the reminder sender reads only these.</summary>
        Reminders,
    }

    /// <summary>
    /// Collections kept whole: the ones sharing is made of, few and small, whose documents the
    /// server writes back (hand-overs, successions, profiles) or reads (settings).
    /// </summary>
    private static readonly HashSet<string> Whole = ["lists", "listMembers", "groups", "groupMembers", "friendships", "users", "settings"];

    /// <summary>
    /// What is kept of everything else, as plain text: the fields sharing, reminders, notification
    /// texts and the server's own changes read. Notes, tags, order and the per-field clocks stay in
    /// the database (audit P1: whole task documents were about 7.5 KB each in memory, and even a
    /// trimmed JSON copy about 3 KB, since every JSON value keeps a document of its own). The
    /// server's changes merge onto the stored copy, so a kept copy without clocks loses to it on
    /// every field the change does not set.
    /// </summary>
    private static readonly Dictionary<string, string[]> Read = new(StringComparer.Ordinal)
    {
        ["tasks"] = ["deletedAt", "createdBy", "listId", "parentId", "title", "status", "recurrence", "pinnedAt"],
        ["comments"] = ["deletedAt", "createdBy", "taskId"],
        ["attachments"] = ["deletedAt", "createdBy", "taskId", "sha256", "name"],
        ["sections"] = ["deletedAt", "createdBy", "listId", "name"],
    };

    /// <summary>What other collections (tags, folders, saved filters) keep.</summary>
    private static readonly string[] Plain = ["deletedAt", "createdBy", "name"];

    /// <summary>Fields whose values repeat (kept once each).</summary>
    private static readonly HashSet<string> Shared = ["createdBy", "listId", "status"];

    /// <summary>A task's fields the reminder sender reads, kept only for tasks with reminders.</summary>
    private static readonly string[] ReminderFields = ["reminders", "schedule", "due", "constantReminder"];

    private static readonly int Lookups = Enum.GetValues<By>().Length;

    private static readonly ImmutableHashSet<string> NoIds = ImmutableHashSet.Create<string>(StringComparer.Ordinal);

    private static readonly ImmutableDictionary<string, ImmutableHashSet<string>> NoLookup =
        ImmutableDictionary.Create<string, ImmutableHashSet<string>>(StringComparer.Ordinal);

    private ImmutableDictionary<string, Facts> byId = ImmutableDictionary.Create<string, Facts>(StringComparer.Ordinal);

    private readonly ImmutableDictionary<string, ImmutableHashSet<string>>[] lookups = Enumerable.Repeat(NoLookup, Lookups).ToArray();

    /// <summary>Where an entity sits in the lookups.</summary>
    private static IEnumerable<(By Lookup, string Key)> KeysOf(Facts facts)
    {
        yield return (By.Collection, facts.Collection);
        switch (facts.Collection)
        {
            case "sections" or "tasks" or "listMembers":
                if (facts.Get("listId") is { } list) yield return (By.List, list);
                break;
            case "comments" or "attachments":
                if (facts.Get("taskId") is { } task) yield return (By.Task, task);
                break;
        }
        switch (facts.Collection)
        {
            case "tasks":
                if (facts.Get("parentId") is { } parent) yield return (By.Parent, parent);
                if (facts.Reminders is not null) yield return (By.Reminders, "");
                foreach (var assignee in facts.SetMembers("assignees")) yield return (By.Assignee, assignee);
                break;
            case "listMembers":
                if (facts.Get("principal") is { } principal) yield return (By.Principal, principal);
                if (facts.Get("listId") is { } memberOf) yield return (By.ListMember, memberOf);
                break;
            case "groupMembers":
                if (facts.Get("groupId") is { } group) yield return (By.Group, group);
                if (facts.Get("userId") is { } member) yield return (By.User, member);
                break;
            case "friendships":
                if (facts.Get("userA") is { } a) yield return (By.User, a);
                if (facts.Get("userB") is { } b) yield return (By.User, b);
                break;
            case "attachments":
                if (facts.Get("sha256") is { } sha) yield return (By.Sha, sha);
                break;
            case "groups":
                if (facts.Get("ownerId") is { } owner) yield return (By.GroupOwner, owner);
                break;
            case "lists":
                yield return (By.ListOwner, facts.Owner);
                break;
        }
    }

    private ImmutableHashSet<string> Ids(By lookup, string key) => lookups[(int)lookup].GetValueOrDefault(key) ?? NoIds;

    private IEnumerable<Facts> Each(By lookup, string key)
    {
        foreach (var id in Ids(lookup, key))
        {
            if (byId.TryGetValue(id, out var facts)) yield return facts;
        }
    }

    private IEnumerable<Facts> EachLive(By lookup, string key) => Each(lookup, key).Where(each => !each.Deleted);

    private void Index(Facts facts, bool add)
    {
        foreach (var (lookup, key) in KeysOf(facts).Distinct())
        {
            var map = lookups[(int)lookup];
            var ids = map.GetValueOrDefault(key) ?? NoIds;
            ids = add ? ids.Add(facts.Id) : ids.Remove(facts.Id);
            lookups[(int)lookup] = ids.IsEmpty ? map.Remove(key) : map.SetItem(key, ids);
        }
    }

    /// <summary>Take in an entity as now stored (new or changed).</summary>
    public void Apply(StoredEntity entity)
    {
        if (byId.TryGetValue(entity.Id, out var old)) Index(old, add: false);
        var facts = Facts.Of(entity);
        byId = byId.SetItem(entity.Id, facts);
        Index(facts, add: true);
    }

    /// <summary>An index of many entities at once (startup), built in one go rather than one by one.</summary>
    public static SharingIndex Build(IEnumerable<StoredEntity> entities)
    {
        var builder = new Builder();
        foreach (var entity in entities) builder.Add(entity);
        return builder.Build();
    }

    /// <summary>
    /// Takes entities as they stream from the store, keeping only what the index keeps of each, so
    /// whole documents never pile up in memory (at startup they did: every one, about 2 GB at
    /// 300,000 entities, before the index was built).
    /// </summary>
    public sealed class Builder
    {
        private readonly ImmutableDictionary<string, Facts>.Builder all = ImmutableDictionary.CreateBuilder<string, Facts>(StringComparer.Ordinal);

        public int Count => all.Count;

        public void Add(StoredEntity entity) =>
            all[entity.Id] = Facts.Of(entity);

        public SharingIndex Build()
        {
            var keyed = Enumerable.Range(0, Lookups).Select(_ => new Dictionary<string, ImmutableHashSet<string>.Builder>(StringComparer.Ordinal)).ToArray();
            foreach (var facts in all.Values)
            {
                foreach (var (lookup, key) in KeysOf(facts))
                {
                    if (!keyed[(int)lookup].TryGetValue(key, out var ids)) keyed[(int)lookup][key] = ids = NoIds.ToBuilder();
                    ids.Add(facts.Id);
                }
            }
            var index = new SharingIndex { byId = all.ToImmutable() };
            for (var lookup = 0; lookup < Lookups; lookup++)
            {
                index.lookups[lookup] = keyed[lookup].ToImmutableDictionary(pair => pair.Key, pair => pair.Value.ToImmutable(), StringComparer.Ordinal);
            }
            return index;
        }
    }

    public void Clear()
    {
        byId = byId.Clear();
        Array.Fill(lookups, NoLookup);
    }

    /// <summary>Forget an entity (undo a tried change that was refused).</summary>
    public void Remove(string id)
    {
        if (!byId.TryGetValue(id, out var old)) return;
        Index(old, add: false);
        byId = byId.Remove(id);
    }

    public bool Contains(string id) => byId.ContainsKey(id);

    /// <summary>How many entities are held (deleted ones too).</summary>
    public int Count => byId.Count;

    /// <summary>Every entity id held (deleted ones too).</summary>
    public IEnumerable<string> Ids() => byId.Keys;

    /// <summary>
    /// An entity's document as the index keeps it, deleted or not: whole for the sharing
    /// collections, the read fields only for tasks, comments, files and the rest (see <see cref="Read"/>).
    /// </summary>
    public JsonObject? DocOf(string id) => byId.TryGetValue(id, out var facts) ? facts.Doc : null;

    /// <summary>A live entity's document (of <paramref name="collection"/> when given), or null when it is deleted or unknown.</summary>
    public JsonObject? LiveDocOf(string id, string? collection = null) =>
        byId.TryGetValue(id, out var facts) && !facts.Deleted && (collection is null || facts.Collection == collection) ? facts.Doc : null;

    /// <summary>Every live entity of a collection: its id, owner and document (the reminder sender reads tasks).</summary>
    public IEnumerable<(string Id, string Owner, JsonObject Doc)> LiveOf(string collection) =>
        Live(collection).Select(each => (each.Id, each.Owner, each.Doc));

    /// <summary>Live tasks that have reminders (the reminder sender and the Android check read these).</summary>
    public IEnumerable<(string Id, string Owner, JsonObject Doc)> LiveTasksWithReminders() =>
        EachLive(By.Reminders, "").Where(each => each.Collection == "tasks").Select(each => (each.Id, each.Owner, each.Doc));

    /// <summary>The live subtasks of a task.</summary>
    public IReadOnlyList<(string Id, JsonObject Doc)> LiveChildrenOf(string taskId) =>
        [.. EachLive(By.Parent, taskId).Where(each => each.Collection == "tasks").Select(each => (each.Id, each.Doc))];

    /// <summary>The live groups an owner has (the server's own, for <see cref="ServerGroupProjection"/>).</summary>
    public IReadOnlyList<(string Id, JsonObject Doc)> GroupsOwnedBy(string owner) =>
        [.. EachLive(By.GroupOwner, owner).Select(each => (each.Id, each.Doc))];

    /// <summary>
    /// Names of the groups people made that a user is in (owner or active member), for admins;
    /// archived ones and the server's own (see <see cref="ServerGroupProjection"/>) are left out.
    /// </summary>
    public IReadOnlyList<string> GroupNamesOf(string userId) =>
        [.. GroupsOf(userId)
            .Select(id => byId[id])
            .Where(each => !Archived(each) && each.Get("ownerId") != ServerGroupProjection.Owner
                && GroupPeople(each.Id, withInvited: false).Contains(userId))
            .Select(each => each.Get("name") ?? "")
            .Where(name => name.Length > 0)
            .Order(StringComparer.OrdinalIgnoreCase)];

    /// <summary>Every membership row of a group, left ones too.</summary>
    public IReadOnlyList<(string Id, JsonObject Doc)> MembershipRowsOf(string groupId) =>
        [.. Each(By.Group, groupId).Select(each => (each.Id, each.Doc))];

    /// <summary>
    /// The friendship between two people in either direction: a live accepted one, then a live
    /// pending one, then an ended one. A new request makes another row, so several can exist.
    /// </summary>
    public (string Id, JsonObject Doc)? FriendshipBetween(string a, string b)
    {
        var best = Each(By.User, a)
            .OrderBy(each => each.Deleted)
            .ThenBy(each => each.Get("state") != "accepted")
            .ThenBy(each => each.Id, StringComparer.Ordinal);
        foreach (var facts in best)
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
        foreach (var facts in EachLive(By.User, userId))
        {
            if (facts.Collection != "friendships") continue;
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
        foreach (var list in EachLive(By.ListOwner, userId).Where(each => each.Get("visibility") == "shared"))
        {
            found.Add(new OwnedShare("list", list.Id, list.Get("name") ?? "", ListPeople(list.Id).Count(), list.Doc));
        }
        foreach (var group in EachLive(By.GroupOwner, userId).Where(each => !Archived(each)))
        {
            found.Add(new OwnedShare("group", group.Id, group.Get("name") ?? "", GroupPeople(group.Id, withInvited: false).Count, group.Doc));
        }
        return found;
    }

    /// <summary>A user's membership row in a group, if any (deleted ones too).</summary>
    public (string Id, JsonObject Doc)? GroupMembership(string groupId, string userId) =>
        Each(By.Group, groupId)
            .Where(each => each.Get("userId") == userId)
            .OrderBy(each => each.Id, StringComparer.Ordinal)
            .Select(each => ((string, JsonObject)?)(each.Id, each.Doc))
            .FirstOrDefault();

    /// <summary>A copy to try changes on before they are committed (the maps are immutable: nothing is copied).</summary>
    public SharingIndex Clone()
    {
        var copy = new SharingIndex { byId = byId };
        Array.Copy(lookups, copy.lookups, Lookups);
        return copy;
    }

    // Relations ----------------------------------------------------------------------------------

    private IEnumerable<Facts> Live(string collection) => EachLive(By.Collection, collection);

    /// <summary>Live groups a user owns or has a live membership row in (any state).</summary>
    private HashSet<string> GroupsOf(string userId)
    {
        var groups = new HashSet<string>(StringComparer.Ordinal);
        foreach (var group in EachLive(By.GroupOwner, userId)) groups.Add(group.Id);
        foreach (var row in EachLive(By.User, userId))
        {
            if (row.Collection == "groupMembers" && row.Get("groupId") is { } id && byId.TryGetValue(id, out var group) && group.Collection == "groups" && !group.Deleted)
            {
                groups.Add(id);
            }
        }
        return groups;
    }

    /// <summary>Live shared lists a user owns or is on (directly or through a group they are in).</summary>
    private HashSet<string> SharedListsOf(string userId)
    {
        var lists = new HashSet<string>(StringComparer.Ordinal);
        void Consider(string? listId)
        {
            if (listId is not null && byId.TryGetValue(listId, out var list) && list.Collection == "lists" && !list.Deleted && list.Get("visibility") == "shared") lists.Add(listId);
        }
        foreach (var list in Each(By.ListOwner, userId)) Consider(list.Id);
        foreach (var member in EachLive(By.Principal, $"user:{userId}")) Consider(member.Get("listId"));
        foreach (var group in GroupsOf(userId))
        {
            foreach (var member in EachLive(By.Principal, $"group:{group}")) Consider(member.Get("listId"));
        }
        return lists;
    }

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
        foreach (var member in EachLive(By.Group, groupId))
        {
            var state = member.Get("state");
            if (state == "active" || (withInvited && state == "invited"))
            {
                if (member.Get("userId") is { } user) people.Add(user);
            }
        }
        return people;
    }

    /// <summary>Live memberships of a list.</summary>
    private IEnumerable<Facts> ListMembers(string listId) => EachLive(By.ListMember, listId);

    /// <summary>Users behind a principal: <c>user:&lt;id&gt;</c> or <c>group:&lt;id&gt;</c> (active members).</summary>
    public IEnumerable<string> PeopleOf(string principal) =>
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
        foreach (var member in ListMembers(listId))
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
            foreach (var member in ListMembers(listId))
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
        foreach (var friendship in EachLive(By.User, userId))
        {
            if (friendship.Collection != "friendships") continue;
            var a = friendship.Get("userA");
            var b = friendship.Get("userB");
            if (a == userId && b is not null) people.Add(b);
            if (b == userId && a is not null) people.Add(a);
        }
        foreach (var group in GroupsOf(userId))
        {
            var members = GroupPeople(group, withInvited: true);
            if (members.Contains(userId)) people.UnionWith(members);
        }
        foreach (var list in SharedListsOf(userId))
        {
            var members = ListPeople(list).ToHashSet(StringComparer.Ordinal);
            if (members.Contains(userId)) people.UnionWith(members);
        }
        people.Remove(userId);
        return people;
    }

    /// <summary>
    /// Whether <paramref name="userId"/> may share with, assign or invite <paramref name="other"/>:
    /// themselves, an accepted friend, an active mate in a group, or someone on a shared list with
    /// them (spec: Friends; the app offers only these). Requests and invitations do not count: either
    /// side can make those alone.
    /// </summary>
    public bool Knows(string userId, string other)
    {
        if (userId == other) return true;
        foreach (var friendship in EachLive(By.User, userId))
        {
            if (friendship.Collection != "friendships") continue;
            var a = friendship.Get("userA");
            var b = friendship.Get("userB");
            if (friendship.Get("state") == "accepted" && ((a == userId && b == other) || (a == other && b == userId))) return true;
        }
        foreach (var group in GroupsOf(userId))
        {
            if (Archived(byId[group])) continue;
            var members = GroupPeople(group, withInvited: false);
            if (members.Contains(userId) && members.Contains(other)) return true;
        }
        foreach (var list in SharedListsOf(userId))
        {
            var members = ListPeople(list).ToHashSet(StringComparer.Ordinal);
            if (members.Contains(userId) && members.Contains(other)) return true;
        }
        return false;
    }

    /// <summary>Whether the user sees a live attachment with these bytes (so may download them).</summary>
    public bool SeesFile(string userId, string sha256) =>
        EachLive(By.Sha, sha256).Any(each => each.Collection == "attachments" && Viewers(each.Id).Contains(userId));

    /// <summary>
    /// File hashes still wanted: live attachments, and deleted ones newer than <paramref name="keepDeletedSince"/>
    /// (they can still be restored from the trash or undone).
    /// </summary>
    public HashSet<string> WantedFiles(DateTimeOffset keepDeletedSince) =>
        Each(By.Collection, "attachments")
            .Where(each => !each.Deleted || (DateTimeOffset.TryParse(each.Get("deletedAt"), System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.AssumeUniversal, out var at) && at >= keepDeletedSince))
            .Select(each => each.Get("sha256"))
            .OfType<string>()
            .ToHashSet(StringComparer.Ordinal);

    /// <summary>Every entity id the user may see (a whole scan: tests and checks; writes use <see cref="Dependents"/>).</summary>
    public HashSet<string> VisibleTo(string userId) =>
        byId.Keys.Where(id => Viewers(id).Contains(userId)).ToHashSet(StringComparer.Ordinal);

    /// <summary>
    /// The entities whose viewers can change when <paramref name="id"/> changes, itself included: a
    /// list's (or list membership's) sections, tasks, memberships, the tasks' comments, files and
    /// subtasks, and the profiles of its people; a group's memberships, the lists shared with it
    /// and the tasks assigned to it; a task's comments, files and subtasks; the two profiles of a
    /// friendship. Taken on the index as it is: a write needs it before and after the change.
    /// </summary>
    public HashSet<string> Dependents(string id)
    {
        var found = new HashSet<string>(StringComparer.Ordinal) { id };
        if (!byId.TryGetValue(id, out var entity)) return found;
        switch (entity.Collection)
        {
            case "lists":
                AddList(entity.Id, found);
                break;
            case "listMembers":
                if (entity.Get("listId") is { } list) AddList(list, found);
                if (entity.Get("principal") is { } principal) foreach (var person in PeopleOf(principal)) found.Add(person);
                break;
            case "groups":
                AddGroup(entity.Id, found);
                break;
            case "groupMembers":
                if (entity.Get("groupId") is { } group) AddGroup(group, found);
                if (entity.Get("userId") is { } member) found.Add(member);
                break;
            case "tasks":
                AddTask(entity.Id, found);
                break;
            case "friendships":
                if (entity.Get("userA") is { } a) found.Add(a);
                if (entity.Get("userB") is { } b) found.Add(b);
                break;
        }
        return found;
    }

    /// <summary>A list's contents and the profiles of its people (they are acquainted through it).</summary>
    private void AddList(string listId, HashSet<string> found)
    {
        found.Add(listId);
        foreach (var person in ListPeople(listId)) found.Add(person);
        foreach (var item in Each(By.List, listId))
        {
            if (item.Collection == "tasks") AddTask(item.Id, found);
            else found.Add(item.Id);
        }
    }

    /// <summary>A group's memberships, lists shared with it, tasks assigned to it, and its people's profiles.</summary>
    private void AddGroup(string groupId, HashSet<string> found)
    {
        found.Add(groupId);
        foreach (var person in GroupPeople(groupId, withInvited: true)) found.Add(person);
        foreach (var row in Each(By.Group, groupId)) found.Add(row.Id);
        foreach (var member in Each(By.Principal, $"group:{groupId}"))
        {
            found.Add(member.Id);
            if (member.Get("listId") is { } list) AddList(list, found);
        }
        foreach (var task in Each(By.Assignee, $"group:{groupId}")) AddTask(task.Id, found);
    }

    /// <summary>A task, its comments and files, and its subtasks (their assignees include its own), all the way down.</summary>
    private void AddTask(string taskId, HashSet<string> found)
    {
        var pending = new Stack<string>();
        pending.Push(taskId);
        var seen = new HashSet<string>(StringComparer.Ordinal);
        while (pending.Count > 0)
        {
            var current = pending.Pop();
            if (!seen.Add(current)) continue;
            found.Add(current);
            foreach (var item in Each(By.Task, current)) found.Add(item.Id);
            foreach (var child in Each(By.Parent, current)) pending.Push(child.Id);
        }
    }

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
        foreach (var group in Live("groups"))
        {
            if (Archived(group) || group.Get("ownerId") is not { } owner) continue;
            var rows = Each(By.Group, group.Id).ToList();
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
                ? EachLive(By.Assignee, $"group:{group.Id}").Where(task => task.Collection == "tasks").Select(task => (task.Id, task.Doc)).ToList()
                : [];
            pending.Add(new GroupSuccession(group.Id, group.Doc, heir, assigned));
        }
        return pending;
    }

    /// <summary>
    /// Who takes a shared list when its owner's account is removed (audit B4): the person on it
    /// with the highest role, longest on it first; a group's people count by its share. Null when
    /// nobody else with an account in <paramref name="accounts"/> is on it.
    /// </summary>
    public string? ListHeir(string listId, string leaving, IReadOnlySet<string> accounts)
    {
        var rows = ListMembers(listId)
            .OrderByDescending(each => Rank(each.Get("role")))
            .ThenBy(each => each.Get("createdAt"), StringComparer.Ordinal)
            .ThenBy(each => each.Id, StringComparer.Ordinal);
        foreach (var row in rows)
        {
            if (row.Get("principal") is not { } principal) continue;
            var heir = PeopleOf(principal).Where(person => person != leaving && accounts.Contains(person)).Order(StringComparer.Ordinal).FirstOrDefault();
            if (heir is not null) return heir;
        }
        return null;
    }

    /// <summary>
    /// Who takes a group when its owner's account is removed: its longest-standing active member
    /// with an account (as when an owner leaves). Null when nobody is left.
    /// </summary>
    public string? GroupHeir(string groupId, string leaving, IReadOnlySet<string> accounts) =>
        EachLive(By.Group, groupId)
            .Where(each => each.Get("state") == "active" && each.Get("userId") is { } user && user != leaving && accounts.Contains(user))
            .OrderBy(each => each.Get("joinedAt"), StringComparer.Ordinal)
            .ThenBy(each => each.Id, StringComparer.Ordinal)
            .Select(each => each.Get("userId"))
            .FirstOrDefault();

    // Invites -------------------------------------------------------------------------------------

    /// <summary>
    /// Assignments waiting on a friend request (<c>invite:&lt;user&gt;:&lt;inviter&gt;</c>, spec: Friends,
    /// invite on assign) that can now be settled: accepted, the invite becomes <c>user:&lt;user&gt;</c>;
    /// declined or taken back (no live friendship), it goes. Pending ones wait.
    /// </summary>
    public IReadOnlyList<InviteSettlement> PendingInvites()
    {
        var settled = new List<InviteSettlement>();
        foreach (var (key, ids) in lookups[(int)By.Assignee])
        {
            if (!key.StartsWith("invite:", StringComparison.Ordinal)) continue;
            var parts = key.Split(':');
            if (parts.Length != 3) continue;
            var friendship = FriendshipBetween(parts[1], parts[2]);
            var live = friendship is { } found && found.Doc["deletedAt"] is null;
            var accepted = live && (string?)friendship!.Value.Doc["state"] == "accepted";
            if (!accepted && live) continue;
            foreach (var id in ids.Order(StringComparer.Ordinal))
            {
                if (byId.TryGetValue(id, out var task) && task.Collection == "tasks" && !task.Deleted)
                {
                    settled.Add(new InviteSettlement(task.Id, task.Doc, key, accepted ? $"user:{parts[1]}" : null));
                }
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

    /// <summary>What a purged comment or attachment holds. Must match <c>ERASED</c> in web/src/core/trash.ts.</summary>
    public const string Erased = "-";

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

        // The author is whoever made it, and stays so: a client cannot put words in someone else's
        // mouth (comments) or send them reminders for a task they cannot see (audit S3).
        var author = Field(doc, "createdBy");
        var wasAuthor = before is null ? null : Field(before.Doc, "createdBy");
        if (wasAuthor is null ? author is not null && author != userId : author != wasAuthor) return false;

        switch (after.Collection)
        {
            case "tasks":
            case "sections":
            {
                if (!PrincipalsAllowed(userId, AddedMembers(before, doc, "assignees"), beforeIndex)) return false;
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
                // The author changes or deletes it; the list's owner may delete it, and a purge erases it.
                if (before.OwnerId == userId) return true;
                var listId = beforeIndex.byId.TryGetValue(taskId, out var task) ? task.Get("listId") : null;
                return listId is not null && beforeIndex.ListRole(userId, listId) == "owner"
                    && doc["deletedAt"] is not null && (!Changed("body") || Field(doc, "body") == Erased);
            }
            case "attachments":
            {
                var taskId = Field(doc, "taskId");
                if (taskId is null || (before is not null && (Changed("taskId") || Changed("sha256") || Changed("size")))) return false;
                if (before is null) return after.OwnerId == userId && MayEditTask(beforeIndex.Contains(taskId) ? beforeIndex : this, userId, taskId);
                // Who added it renames or removes it; the list's owner may remove it, and a purge erases it.
                if (before.OwnerId == userId) return true;
                var listId = beforeIndex.byId.TryGetValue(taskId, out var task) ? task.Get("listId") : null;
                return listId is not null && beforeIndex.ListRole(userId, listId) == "owner"
                    && doc["deletedAt"] is not null && (!Changed("name") || Field(doc, "name") == Erased);
            }
            case "lists":
                // Only owners change a list; a new list is the writer's own. Only the server hands
                // a list to someone else (an admin's hand-over), so clients keep ownerId as it is.
                if (before is null) return after.OwnerId == userId && (Field(doc, "ownerId") ?? userId) == userId;
                return beforeIndex.ListRole(userId, before.Id) == "owner" && !Changed("ownerId");
            case "listMembers":
            {
                var listId = Field(doc, "listId");
                if (listId is null) return false;
                // A list made in this same push has its owner in this index only.
                var role = beforeIndex.Contains(listId) ? beforeIndex.ListRole(userId, listId) : ListRole(userId, listId);
                if (role == "owner")
                {
                    // Shared only with people the owner knows (and groups they are in).
                    return !Changed("principal") || PrincipalsAllowed(userId, Field(doc, "principal") is { } principal ? [principal] : [], beforeIndex);
                }
                // Anyone may leave: delete their own membership, changing nothing else.
                return before is not null
                    && Field(before.Doc, "principal") == $"user:{userId}"
                    && doc["deletedAt"] is not null
                    && !Changed("listId") && !Changed("principal") && !Changed("role");
            }
            case "groups":
            {
                if (before is null) return Field(doc, "ownerId") == userId;
                if (Field(before.Doc, "ownerId") != userId) return false;
                // Handed on only to someone already in it (audit S3).
                return !Changed("ownerId") || (Field(doc, "ownerId") is { } heir && beforeIndex.GroupPeople(before.Id, withInvited: false).Contains(heir));
            }
            case "groupMembers":
            {
                var groupId = Field(doc, "groupId");
                var groupOwner = groupId is not null && beforeIndex.byId.TryGetValue(groupId, out var group) ? group.Get("ownerId") : null;
                // A brand-new group's members arrive with it: its owner is in this index already.
                groupOwner ??= groupId is not null && byId.TryGetValue(groupId, out var newGroup) ? newGroup.Get("ownerId") : null;
                // A server group's memberships are the server's: nobody leaves or changes them in the app.
                if (groupOwner == ServerGroupProjection.Owner) return false;
                if (groupOwner == userId)
                {
                    var member = Field(doc, "userId");
                    // The owner's own membership.
                    if (member == userId && (before is null || Field(before.Doc, "userId") == userId)) return before is not null || Field(doc, "state") is "invited" or "active";
                    // Someone else is invited, never made a member: they join by accepting. Only
                    // people the owner knows are invited (audit S3).
                    if (before is null) return member is not null && Field(doc, "state") == "invited" && beforeIndex.Knows(userId, member);
                    return !Changed("groupId") && !Changed("userId")
                        && (Field(doc, "state") != "active" || Field(before.Doc, "state") == "active");
                }
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
            case "settings":
                // The reminder sender reads a person's time zone from the settings naming them.
                return (before is null || before.OwnerId == userId) && (Field(doc, "userId") ?? userId) == userId;
            default:
                return before is null || before.OwnerId == userId;
        }
    }

    /// <summary>Elements of an element set that are in now and were not before (all of them for a new entity).</summary>
    private static List<string> AddedMembers(StoredEntity? before, JsonObject doc, string field)
    {
        static bool In(JsonNode? item) => item is JsonObject state && state["in"] is JsonValue value && value.TryGetValue<bool>(out var isIn) && isIn;
        var added = new List<string>();
        if (doc[field] is not JsonObject set) return added;
        var old = before?.Doc[field] as JsonObject;
        foreach (var (element, state) in set)
        {
            if (In(state) && !In(old?[element])) added.Add(element);
        }
        return added;
    }

    /// <summary>
    /// Whether the user may newly give these principals a list or a task: people they know (see
    /// <see cref="Knows"/>), groups they are in, and invites in their own name. Anything else would
    /// show a stranger's tasks to them, and them to the list's people, with a notice they never asked for.
    /// </summary>
    private bool PrincipalsAllowed(string userId, IEnumerable<string> principals, SharingIndex beforeIndex)
    {
        foreach (var principal in principals)
        {
            var allowed = principal.Split(':') switch
            {
                ["user", var other] => beforeIndex.Knows(userId, other),
                // A group made in this same push is in this index only.
                ["group", var group] => GroupPeople(group, withInvited: false).Contains(userId),
                // invite:<them>:<me>: settled to user:<them> once they accept my friend request.
                ["invite", _, var inviter] => inviter == userId,
                _ => false,
            };
            if (!allowed) return false;
        }
        return true;
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
