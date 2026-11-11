using System.Text.Json.Nodes;
using PeckList.Core;
using PeckList.Core.Api;
using PeckList.Core.Configuration;
using PeckList.Core.Push;
using PeckList.Core.Sharing;
using PeckList.Core.Storage;
using PeckList.Core.Sync;
using PeckList.Server.Push;

namespace PeckList.Server.Api;

/// <summary>
/// The task API's writes (PL-137). Each one is made of whole workspace entities in which only the
/// fields it changes get a fresh clock, pushed through <see cref="SyncService"/> as the person: the
/// same merge, the same sharing rules (a refused change is 403), notifications, history and live
/// events as the apps get. Fields it doesn't change keep the clocks they were read with, so an edit
/// made meanwhile on another device wins over them.
/// </summary>
public sealed class TaskWrites(
    SyncService sync,
    SharingState sharing,
    IEntityStore store,
    ServerClock clock,
    TaskQueries queries,
    Groups groups,
    Invites invites,
    IPushStore push,
    ServerSettings settings,
    TimeProvider time)
{
    public const string Origin = "api";
    public const int MaxSubtaskDepth = 5;
    public const int MaxNewTags = 100;

    /// <summary>The app's tag colors (web/src/core/palette.ts, first families): new tags take the first one free.</summary>
    private static readonly string[] TagColors =
    [
        "#F2A7B5", "#F7C59F", "#F3E1A0", "#CFE3A3", "#A8DCC0", "#A3D8DC", "#A7C7E7", "#CDB4E6", "#E0B3D3",
        "#C98B8B", "#D4A373", "#CDB86E", "#A7B27A", "#8FAE95", "#7FAAA8", "#8BA3C2", "#A592B8", "#BE8FA8",
    ];

    private const string DefaultListColor = "#8BA3C2";

    private sealed class Batch : List<(string Collection, JsonObject Doc)>;

    // Clocks ----------------------------------------------------------------------------------

    /// <summary>A fresh clock for one field: after the server's clock and after the stored one, so this change wins.</summary>
    private string Stamp(string? stored)
    {
        var stamp = clock.Next();
        return Hlc.IsValid(stored) && Hlc.Compare(stored, stamp) >= 0 ? Hlc.After(stored!, ServerClock.Node) : stamp;
    }

    /// <summary>The stored entity with <paramref name="fields"/> set, each with a fresh clock; every other field as read.</summary>
    private JsonObject Changed(JsonObject stored, JsonObject fields)
    {
        var doc = (JsonObject)stored.DeepClone();
        if (doc["_hlc"] is not JsonObject clocks)
        {
            clocks = new JsonObject();
            doc["_hlc"] = clocks;
        }
        foreach (var (field, value) in fields)
        {
            doc[field] = value?.DeepClone();
            clocks[field] = Stamp(ApiShapes.Text(stored["_hlc"] as JsonObject, field));
        }
        return doc;
    }

    /// <summary>Elements of a set put in or taken out, each with a fresh clock (the set's other elements as read).</summary>
    private void SetElements(JsonObject doc, string field, IEnumerable<(string Element, bool In)> changes)
    {
        var set = doc[field] as JsonObject ?? new JsonObject();
        doc[field] = set;
        foreach (var (element, isIn) in changes)
        {
            var old = set[element] as JsonObject;
            set[element] = new JsonObject { ["in"] = isIn, ["hlc"] = Stamp(ApiShapes.Text(old, "hlc")) };
        }
    }

    private JsonObject New(string id, string userId, JsonObject fields) =>
        ServerEntities.New(id, userId, Origin, clock.Now(), clock.Next(), fields);

    // Pushing ----------------------------------------------------------------------------------

    /// <summary>Push the batch as the person; a problem when any of it was refused or invalid, else null.</summary>
    private async Task<IResult?> PushAsync(string userId, Batch batch, CancellationToken cancellation)
    {
        if (batch.Count == 0) return null;
        // Tag paths make their parents too: one request may not fill the workspace with them.
        if (batch.Count(each => each.Collection == "tags") > MaxNewTags)
        {
            return FieldProblem("tags", $"at most {MaxNewTags} new tags, parents included, in one request");
        }
        // All or nothing, so a refused part never leaves the rest half made (a moved task without its subtasks).
        var response = await sync.SyncAsync(
            userId,
            new SyncRequest(WorkspaceSchema.CurrentVersion, long.MaxValue, [.. batch.Select(each => new SyncEntity(each.Collection, each.Doc))]),
            source: null,
            cancellation,
            allOrNothing: true);
        // As after a sync push: an owner who left hands on, a friend request settles assignments.
        await groups.SettleAsync(cancellation);
        await invites.SettleAsync(cancellation);
        if (response.Invalid is { Count: > 0 } invalid)
        {
            var reason = invalid[0].Reason;
            var cut = reason.IndexOf("): ", StringComparison.Ordinal);
            return ApiProblems.Invalid(cut >= 0 ? reason[(cut + 3)..] : reason);
        }
        if (response.Rejected.Count > 0) return ApiProblems.Forbidden("you may not make this change here");
        return null;
    }

    private async Task<string> ZoneAsync(string userId, CancellationToken cancellation)
    {
        var zone = await DeviceZones.ZoneForAsync(sharing.Index, userId, push, settings, cancellation);
        if (zone.HasIanaId) return zone.Id;
        return TimeZoneInfo.TryConvertWindowsIdToIanaId(zone.Id, out var iana) ? iana : "UTC";
    }

    // Lookups ------------------------------------------------------------------------------------

    private async Task<List<StoredEntity>> VisibleAsync(string userId, string collection, bool deleted, Func<JsonObject, bool>? where, CancellationToken cancellation)
    {
        var index = sharing.Index;
        var ids = (await store.VisibleIdsAsync(userId, collection, deleted, cancellation))
            .Where(id => where is null || (index.DocOf(id) is { } facts && where(facts))).ToList();
        return [.. await store.GetManyAsync(ids, cancellation)];
    }

    /// <summary>Task ids under <paramref name="id"/> at any depth (live ones, or all with <paramref name="withDeleted"/>), from the index.</summary>
    private async Task<List<string>> DescendantsAsync(string userId, string id, bool withDeleted, CancellationToken cancellation)
    {
        var index = sharing.Index;
        var all = (await store.VisibleIdsAsync(userId, "tasks", false, cancellation)).ToList();
        if (withDeleted) all.AddRange(await store.VisibleIdsAsync(userId, "tasks", true, cancellation));
        var children = all
            .Select(child => (Id: child, Parent: ApiShapes.Text(index.DocOf(child), "parentId")))
            .Where(each => each.Parent is not null)
            .ToLookup(each => each.Parent!, each => each.Id, StringComparer.Ordinal);
        var found = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal) { id };
        var queue = new Queue<string>([id]);
        while (queue.TryDequeue(out var at))
        {
            foreach (var child in children[at])
            {
                if (!seen.Add(child)) continue;
                found.Add(child);
                queue.Enqueue(child);
            }
        }
        return found;
    }

    private int Depth(string taskId)
    {
        var index = sharing.Index;
        var depth = 0;
        var seen = new HashSet<string>(StringComparer.Ordinal);
        for (var at = ApiShapes.Text(index.DocOf(taskId), "parentId"); at is not null && seen.Add(at); at = ApiShapes.Text(index.DocOf(at), "parentId")) depth++;
        return depth;
    }

    private int Height(string taskId)
    {
        var index = sharing.Index;
        var children = index.LiveChildrenOf(taskId);
        return children.Count == 0 ? 0 : 1 + children.Max(child => Height(child.Id));
    }

    private async Task<string> LastTaskOrderAsync(string userId, string listId, string? parentId, string? except, CancellationToken cancellation)
    {
        var siblings = await VisibleAsync(userId, "tasks", false,
            facts => ApiShapes.Text(facts, "listId") == listId && ApiShapes.Text(facts, "parentId") == parentId, cancellation);
        return OrderKeys.After(OrderKeys.Last(siblings.Where(each => each.Id != except).Select(each => ApiShapes.Text(each.Doc, "order"))));
    }

    /// <summary>The list a task goes in when none is named: the person's new-task list, else their inbox.</summary>
    private async Task<string?> DefaultListAsync(string userId, CancellationToken cancellation)
    {
        var index = sharing.Index;
        var mine = await VisibleAsync(userId, "settings", false, null, cancellation);
        foreach (var doc in mine.Where(each => each.OwnerId == userId).Select(each => each.Doc))
        {
            if (ApiShapes.Text(doc["newTask"] as JsonObject, "listId") is { } chosen
                && index.LiveDocOf(chosen, "lists") is not null && index.ListRole(userId, chosen) is "owner" or "editor")
            {
                return chosen;
            }
        }
        var lists = await VisibleAsync(userId, "lists", false, null, cancellation);
        return lists.Where(each => each.OwnerId == userId && each.Doc["isInbox"] is JsonValue inbox && inbox.TryGetValue<bool>(out var isInbox) && isInbox)
            .Select(each => each.Id).Order(StringComparer.Ordinal).FirstOrDefault();
    }

    /// <summary>Tag ids for these names, making the ones the person lacks (with their parents) into <paramref name="batch"/>.</summary>
    private async Task<List<string>> TagIdsAsync(string userId, IEnumerable<string> names, Batch batch, CancellationToken cancellation)
    {
        var tags = (await queries.TagsAsync(userId, cancellation)).ToList();
        var byName = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var tag in tags) if (ApiShapes.Text(tag.Doc, "name") is { } name) byName.TryAdd(name, tag.Id);
        var used = tags.Select(tag => ApiShapes.Text(tag.Doc, "color")?.ToUpperInvariant()).OfType<string>().ToHashSet(StringComparer.Ordinal);
        var lastOrder = OrderKeys.Last(tags.Select(tag => ApiShapes.Text(tag.Doc, "order")));
        string Make(string path)
        {
            if (byName.TryGetValue(path, out var known)) return known;
            var color = TagColors.FirstOrDefault(each => !used.Contains(each)) ?? TagColors[byName.Count % TagColors.Length];
            used.Add(color);
            lastOrder = OrderKeys.After(lastOrder);
            var id = Ids.NewUlid();
            batch.Add(("tags", New(id, userId, new JsonObject { ["name"] = path, ["color"] = color, ["order"] = lastOrder })));
            byName[path] = id;
            return id;
        }
        var ids = new List<string>();
        foreach (var name in names)
        {
            var parts = name.Split('/');
            for (var depth = 1; depth < parts.Length; depth++) Make(string.Join('/', parts[..depth]));
            ids.Add(Make(name));
        }
        return ids;
    }

    private static IResult FieldProblem(string field, string message) =>
        ApiProblems.Invalid($"{field}: {message}", new Dictionary<string, string[]> { [field] = [message] });

    private static IResult Conflict(string detail) => ApiProblems.Result(StatusCodes.Status409Conflict, "conflict", detail);

    private static IResult IdTaken() => ApiProblems.Result(StatusCodes.Status409Conflict, "id_taken", "that id is already in use");

    private async Task<IResult> TaskResultAsync(string userId, string id, int status, CancellationToken cancellation)
    {
        var task = await queries.TaskAsync(userId, id, cancellation);
        if (task is null) return ApiProblems.NotFound("task", id);
        return status == StatusCodes.Status201Created ? Results.Created($"/api/v1/tasks/{id}", task) : Results.Ok(task);
    }

    // Tasks ---------------------------------------------------------------------------------------

    public async Task<IResult> CreateTaskAsync(string userId, JsonObject body, CancellationToken cancellation)
    {
        await sharing.Loaded.WaitAsync(cancellation);
        var input = TaskInput.Parse(body, create: true);
        if (!input.Valid) return ApiProblems.Invalid("the task has problems", input.Errors);
        if (input.RemoveTags.Count > 0) return FieldProblem("removeTags", "a new task has no tags to remove");

        var id = input.Id ?? Ids.NewUlid();
        if (await store.GetAsync(id, cancellation) is { } existing)
        {
            // The same create again (a retry, a second device): the task as it is.
            return existing.Collection == "tasks" && await queries.TaskAsync(userId, id, cancellation) is { } same
                ? Results.Ok(same)
                : IdTaken();
        }

        var index = sharing.Index;
        string? listId = input.ListId;
        JsonObject? parent = null;
        if (input.ParentId is { } parentId)
        {
            var found = await queries.FindAsync(userId, "tasks", parentId, cancellation);
            if (found is null || found.Doc["deletedAt"] is JsonValue) return FieldProblem("parentId", "no task with this id that you can see");
            parent = found.Doc;
            var parentList = ApiShapes.Text(parent, "listId");
            if (listId is not null && listId != parentList) return Conflict("a subtask is in its parent's list");
            listId = parentList;
            if (Depth(parentId) + 1 > MaxSubtaskDepth) return Conflict("subtasks are nested too deep");
        }
        if (listId is null)
        {
            listId = await DefaultListAsync(userId, cancellation);
            if (listId is null) return FieldProblem("listId", "is required: you have no inbox yet");
        }
        else if (parent is null && (index.LiveDocOf(listId, "lists") is null || !index.Viewers(listId).Contains(userId)))
        {
            return FieldProblem("listId", "no list with this id that you can see");
        }
        if (input.SectionId is { } sectionId && ApiShapes.Text(index.LiveDocOf(sectionId, "sections"), "listId") is var sectionList
            && (sectionList != listId || !index.Viewers(sectionId).Contains(userId)))
        {
            return FieldProblem("sectionId", "no section of this list with this id that you can see");
        }
        if (input.Assignees is { Count: > 0 } people && !index.MayAssign(userId, people))
        {
            return FieldProblem("assignees", "not a person you can assign");
        }

        var batch = new Batch();
        var tagIds = await TagIdsAsync(userId, (input.Tags ?? []).Concat(input.AddTags), batch, cancellation);
        // A subtask starts with its parent's tags, as in the app.
        if (parent is not null) tagIds.AddRange(ApiShapes.Members(parent, "tags"));
        var zone = input.NeedsZone ? await ZoneAsync(userId, cancellation) : null;
        var fields = new JsonObject
        {
            ["title"] = input.Fields["title"]?.DeepClone(),
            ["notes"] = "",
            ["listId"] = listId,
            ["sectionId"] = input.SectionId,
            ["parentId"] = input.ParentId,
            ["order"] = await LastTaskOrderAsync(userId, listId, input.ParentId, null, cancellation),
            ["status"] = "open",
            ["completedAt"] = null,
            ["completedBy"] = null,
            ["priority"] = 0,
            ["schedule"] = null,
            ["due"] = null,
            ["tags"] = new JsonObject(),
            ["assignees"] = new JsonObject(),
            ["blockedBy"] = new JsonObject(),
            ["recurrence"] = null,
            ["progress"] = 0,
        };
        foreach (var (field, value) in input.Fields) fields[field] = value?.DeepClone();
        FillZone(fields, zone);
        if (input.Pinned == true) fields["pinnedAt"] = clock.Now();
        var task = New(id, userId, fields);
        SetElements(task, "tags", tagIds.Distinct(StringComparer.Ordinal).Select(tag => (tag, true)));
        SetElements(task, "assignees", (input.Assignees ?? []).Select(principal => (principal, true)));
        batch.Add(("tasks", task));
        if (await PushAsync(userId, batch, cancellation) is { } problem) return problem;
        return await TaskResultAsync(userId, id, StatusCodes.Status201Created, cancellation);
    }

    // Quick add ----------------------------------------------------------------------------------

    /// <summary>The task and what quick add read in the text (<see cref="QuickToken"/> positions are in the text sent).</summary>
    public sealed record QuickAddAnswer(ApiTask Task, IReadOnlyList<QuickToken> Tokens);

    /// <summary>
    /// A line of text read as the app's quick add reads it (dates, #tags, ^list, !priority, @people,
    /// "every ..."), then made into a task through <see cref="CreateTaskAsync"/>: the same checks,
    /// defaults and sharing rules. Dates are read on the person's wall clock in their time zone.
    /// </summary>
    public async Task<IResult> QuickAddAsync(string userId, JsonObject body, CancellationToken cancellation)
    {
        await sharing.Loaded.WaitAsync(cancellation);
        if (body.Select(pair => pair.Key).FirstOrDefault(name => name is not ("text" or "id" or "listId" or "timeZone")) is { } unknown)
        {
            return FieldProblem(unknown, "is not a quick add field (text, id, listId, timeZone)");
        }
        if (body["text"] is not JsonValue textValue || !textValue.TryGetValue<string>(out var text) || string.IsNullOrWhiteSpace(text))
        {
            return FieldProblem("text", "is required: the line to read");
        }
        if (text.Length > QuickAdd.MaxText) return FieldProblem("text", $"must be at most {QuickAdd.MaxText} characters");
        string zone;
        if (body["timeZone"] is null) zone = await ZoneAsync(userId, cancellation);
        else if (body["timeZone"] is JsonValue zoneValue && zoneValue.TryGetValue<string>(out var given)
            && given.Length <= 64 && TimeZoneInfo.TryFindSystemTimeZoneById(given, out _))
        {
            zone = given;
        }
        else return FieldProblem("timeZone", "must be an IANA zone such as America/Chicago");

        var context = await QuickContextAsync(userId, zone, cancellation);
        QuickAddResult parsed;
        try
        {
            parsed = QuickAdd.Parse(text, context);
        }
        catch (System.Text.RegularExpressions.RegexMatchTimeoutException)
        {
            // Every pattern has a time limit; a line built to make one crawl is refused.
            return FieldProblem("text", "could not be read in time; send a shorter or plainer line");
        }
        // Nothing left but the recognised words: the app keeps such a line as the title.
        var title = parsed.Title.Length > 0 ? parsed.Title : null;
        if (title is null) return FieldProblem("text", "leaves no title once the dates, tags and the rest are read");

        var task = new JsonObject { ["title"] = title };
        if (body["id"] is not null) task["id"] = body["id"]!.DeepClone();
        var listId = parsed.ListId ?? (body["listId"]?.DeepClone());
        if (listId is not null) task["listId"] = listId;
        if (parsed.Priority is { } priority) task["priority"] = priority;
        if (parsed.Tags.Count > 0) task["tags"] = new JsonArray([.. parsed.Tags.Select(tag => (JsonNode)JsonValue.Create(tag.Name))]);
        if (parsed.Assignees.Count > 0) task["assignees"] = new JsonArray([.. parsed.Assignees.Select(principal => (JsonNode)JsonValue.Create(principal))]);
        if (parsed.Recurrence is { } rule) task["recurrence"] = rule;
        if (parsed.Schedule is { } schedule)
        {
            task["schedule"] = new JsonObject
            {
                ["start"] = schedule.Start.Value,
                ["end"] = schedule.End?.Value,
                ["allDay"] = schedule.Start.Time is null,
                ["timeZone"] = zone,
            };
        }
        if (parsed.Due is { } due) task["due"] = new JsonObject { ["at"] = due.Value, ["allDay"] = due.Time is null, ["timeZone"] = zone };

        var made = await CreateTaskAsync(userId, task, cancellation);
        return made switch
        {
            Microsoft.AspNetCore.Http.HttpResults.Created<ApiTask> created =>
                Results.Created(created.Location, new QuickAddAnswer(created.Value!, parsed.Tokens)),
            Microsoft.AspNetCore.Http.HttpResults.Ok<ApiTask> same => Results.Ok(new QuickAddAnswer(same.Value!, parsed.Tokens)),
            _ => made,
        };
    }

    /// <summary>What quick add may name: the person's lists (inbox first, then in order), tags and people, and their wall clock.</summary>
    private async Task<QuickAddContext> QuickContextAsync(string userId, string zone, CancellationToken cancellation)
    {
        var index = sharing.Index;
        static bool Flag(JsonObject doc, string field) => doc[field] is JsonValue value && value.TryGetValue<bool>(out var flag) && flag;

        var lists = (await VisibleAsync(userId, "lists", false, null, cancellation))
            .Where(list => !Flag(list.Doc, "archived") && ApiShapes.Text(list.Doc, "name") is not null)
            .OrderByDescending(list => Flag(list.Doc, "isInbox"))
            .ThenBy(list => ApiShapes.Text(list.Doc, "order") ?? "", StringComparer.Ordinal)
            .ThenBy(list => list.Id, StringComparer.Ordinal)
            .Select(list => new QuickList(list.Id, ApiShapes.Text(list.Doc, "name")!))
            .ToList();

        var tags = (await queries.TagsAsync(userId, cancellation))
            .Where(tag => ApiShapes.Text(tag.Doc, "name") is not null)
            .OrderBy(tag => ApiShapes.Text(tag.Doc, "order") ?? "", StringComparer.Ordinal)
            .ThenBy(tag => tag.Id, StringComparer.Ordinal)
            .Select(tag => (tag.Id, ApiShapes.Text(tag.Doc, "name")!))
            .ToList();

        // As the assignee picker: me first, my groups, then everyone else I may assign, by name.
        var people = new List<QuickPerson>();
        var profiles = await VisibleAsync(userId, "users", false, null, cancellation);
        QuickPerson Person(StoredEntity profile) => new(
            $"user:{profile.Id}",
            ApiShapes.Text(profile.Doc, "displayName") ?? ApiShapes.Text(profile.Doc, "handle") ?? profile.Id,
            ApiShapes.Text(profile.Doc, "handle"));
        if (profiles.FirstOrDefault(profile => profile.Id == userId) is { } me) people.Add(Person(me));
        var groups = (await VisibleAsync(userId, "groups", false, null, cancellation))
            .Where(group => !Flag(group.Doc, "archived") && index.MayAssign(userId, [$"group:{group.Id}"]))
            .Select(group => new QuickPerson($"group:{group.Id}", ApiShapes.Text(group.Doc, "name") ?? group.Id, null))
            .OrderBy(group => group.Name, StringComparer.OrdinalIgnoreCase);
        people.AddRange(groups);
        people.AddRange(profiles
            .Where(profile => profile.Id != userId && index.MayAssign(userId, [$"user:{profile.Id}"]))
            .Select(Person)
            .OrderBy(person => person.Name, StringComparer.OrdinalIgnoreCase));

        var now = TimeZoneInfo.ConvertTime(time.GetUtcNow(), TimeZoneInfo.FindSystemTimeZoneById(zone));
        return new QuickAddContext(lists, tags, people, now.DateTime);
    }

    private static void FillZone(JsonObject fields, string? zone)
    {
        foreach (var field in new[] { "schedule", "due" })
        {
            if (fields[field] is JsonObject moment && ApiShapes.Text(moment, "timeZone") is "" && zone is not null) moment["timeZone"] = zone;
        }
    }

    public async Task<IResult> UpdateTaskAsync(string userId, string id, JsonObject body, CancellationToken cancellation)
    {
        await sharing.Loaded.WaitAsync(cancellation);
        if (await queries.FindAsync(userId, "tasks", id, cancellation) is not { } stored) return ApiProblems.NotFound("task", id);
        var input = TaskInput.Parse(body, create: false);
        if (!input.Valid) return ApiProblems.Invalid("the change has problems", input.Errors);
        var current = stored.Doc;
        if (input.Status is { } status && status != (ApiShapes.Text(current, "status") ?? "open"))
        {
            return FieldProblem("status", "use complete and reopen to change it, so repeats move on");
        }

        var index = sharing.Index;
        var fields = (JsonObject)input.Fields.DeepClone();
        var oldList = ApiShapes.Text(current, "listId");
        var oldParent = ApiShapes.Text(current, "parentId");
        var list = input.ListId ?? oldList;
        var moving = list != oldList;
        var parent = input.HasParent ? input.ParentId : moving ? null : oldParent;

        if (moving && (list is null || index.LiveDocOf(list, "lists") is null || !index.Viewers(list).Contains(userId)))
        {
            return FieldProblem("listId", "no list with this id that you can see");
        }
        if (parent is not null && parent != oldParent)
        {
            var found = await queries.FindAsync(userId, "tasks", parent, cancellation);
            if (found is null || found.Doc["deletedAt"] is JsonValue) return FieldProblem("parentId", "no task with this id that you can see");
            if (ApiShapes.Text(found.Doc, "listId") != list) return Conflict("a subtask is in its parent's list");
            if (parent == id || (await DescendantsAsync(userId, id, false, cancellation)).Contains(parent)) return Conflict("a task cannot go under itself or its own subtask");
            if (Depth(parent) + 1 + Height(id) > MaxSubtaskDepth) return Conflict("subtasks are nested too deep");
        }
        var section = input.HasSection ? input.SectionId : moving ? null : ApiShapes.Text(current, "sectionId");
        if (section is not null && (input.HasSection || moving)
            && (ApiShapes.Text(index.LiveDocOf(section, "sections"), "listId") != list || !index.Viewers(section).Contains(userId)))
        {
            return FieldProblem("sectionId", "no section of this list with this id that you can see");
        }
        if (input.Assignees is { } wanted)
        {
            var added = wanted.Except(ApiShapes.Members(current, "assignees"), StringComparer.Ordinal).ToList();
            if (added.Count > 0 && !index.MayAssign(userId, added)) return FieldProblem("assignees", "not a person you can assign");
        }

        var batch = new Batch();
        if (moving || input.HasParent)
        {
            fields["listId"] = list;
            fields["parentId"] = parent;
            if (moving || parent != oldParent) fields["order"] = await LastTaskOrderAsync(userId, list!, parent, id, cancellation);
        }
        if (input.HasSection || moving) fields["sectionId"] = section;
        if (input.Pinned is { } pin && pin != (current["pinnedAt"] is JsonValue)) fields["pinnedAt"] = pin ? clock.Now() : null;
        FillZone(fields, input.NeedsZone ? await ZoneAsync(userId, cancellation) : null);
        foreach (var unchanged in fields.Where(pair => JsonNode.DeepEquals(pair.Value, current[pair.Key])).Select(pair => pair.Key).ToList()) fields.Remove(unchanged);

        var doc = Changed(current, fields);
        // Tags: the whole set replaces only the tags this person can see; others' private tags stay.
        var names = TaskQueries.TagNames(await queries.TagsAsync(userId, cancellation));
        var tagsIn = ApiShapes.Members(current, "tags").Where(names.ContainsKey).ToHashSet(StringComparer.Ordinal);
        var tagChanges = new List<(string, bool)>();
        if (input.Tags is { } replace)
        {
            var wantedIds = (await TagIdsAsync(userId, replace, batch, cancellation)).ToHashSet(StringComparer.Ordinal);
            tagChanges.AddRange(tagsIn.Where(tag => !wantedIds.Contains(tag)).Select(tag => (tag, false)));
            tagChanges.AddRange(wantedIds.Where(tag => !tagsIn.Contains(tag)).Select(tag => (tag, true)));
        }
        if (input.AddTags.Count > 0)
        {
            tagChanges.AddRange((await TagIdsAsync(userId, input.AddTags, batch, cancellation)).Where(tag => !tagsIn.Contains(tag)).Select(tag => (tag, true)));
        }
        if (input.RemoveTags.Count > 0)
        {
            var byName = names.ToDictionary(pair => pair.Value, pair => pair.Key, StringComparer.OrdinalIgnoreCase);
            tagChanges.AddRange(input.RemoveTags.Select(name => byName.GetValueOrDefault(name)).OfType<string>().Where(tagsIn.Contains).Select(tag => (tag, false)));
        }
        if (tagChanges.Count > 0) SetElements(doc, "tags", tagChanges);
        if (input.Assignees is { } assignees)
        {
            var now = ApiShapes.Members(current, "assignees").ToHashSet(StringComparer.Ordinal);
            var changes = now.Where(each => !assignees.Contains(each)).Select(each => (each, false))
                .Concat(assignees.Where(each => !now.Contains(each)).Select(each => (each, true))).ToList();
            if (changes.Count > 0) SetElements(doc, "assignees", changes);
        }
        if (JsonNode.DeepEquals(doc, current) && batch.Count == 0) return await TaskResultAsync(userId, id, StatusCodes.Status200OK, cancellation);
        batch.Add(("tasks", doc));
        // Its subtasks follow it to the other list.
        if (moving)
        {
            var subtasks = await store.GetManyAsync(await DescendantsAsync(userId, id, false, cancellation), cancellation);
            foreach (var subtask in subtasks) batch.Add(("tasks", Changed(subtask.Doc, new JsonObject { ["listId"] = list, ["sectionId"] = null })));
        }
        if (await PushAsync(userId, batch, cancellation) is { } problem) return problem;
        return await TaskResultAsync(userId, id, StatusCodes.Status200OK, cancellation);
    }

    public async Task<IResult> CompleteAsync(string userId, string id, string status, CancellationToken cancellation)
    {
        await sharing.Loaded.WaitAsync(cancellation);
        if (await queries.FindAsync(userId, "tasks", id, cancellation) is not { } stored || stored.Doc["deletedAt"] is JsonValue)
        {
            return ApiProblems.NotFound("task", id);
        }
        var names = TaskQueries.TagNames(await queries.TagsAsync(userId, cancellation));
        if ((ApiShapes.Text(stored.Doc, "status") ?? "open") != "open")
        {
            return Results.Ok(new CompleteResult(ApiShapes.Task(stored.Doc, names), null));
        }
        var batch = new Batch();
        var now = clock.Now();
        var subtasks = await store.GetManyAsync(await DescendantsAsync(userId, id, false, cancellation), cancellation);
        // A repeating task moves on as the app moves it (RepeatingTask, the code the Android
        // notification uses): a closed copy stays in history, the task itself goes to its next date.
        if (ApiShapes.Text(stored.Doc, "recurrence") is { Length: > 0 })
        {
            var zone = TimeZoneInfo.FindSystemTimeZoneById(await ZoneAsync(userId, cancellation));
            var doneOn = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.Parse(now, System.Globalization.CultureInfo.InvariantCulture), zone).DateTime);
            // Every clock it writes comes after every clock it was read with.
            var newest = subtasks.Select(each => each.Doc).Prepend(stored.Doc).SelectMany(Clocks).Where(Hlc.IsValid).Max(StringComparer.Ordinal);
            var historyId = Ids.NewUlid();
            if (Core.Tasks.RepeatingTask.Complete(stored.Doc, subtasks.Select(each => each.Doc), userId, now, doneOn, historyId, () => Stamp(newest), status) is { } moved)
            {
                batch.AddRange(moved.Select(doc => ("tasks", doc)));
                if (await PushAsync(userId, batch, cancellation) is { } refused) return refused;
                return Results.Ok(new CompleteResult((await queries.TaskAsync(userId, historyId, cancellation))!, await queries.TaskAsync(userId, id, cancellation)));
            }
        }
        foreach (var target in subtasks.Select(each => each.Doc).Prepend(stored.Doc))
        {
            if ((ApiShapes.Text(target, "status") ?? "open") != "open") continue;
            var fields = new JsonObject
            {
                ["status"] = status,
                ["completedAt"] = ApiShapes.Text(target, "completedAt") ?? now,
                ["completedBy"] = ApiShapes.Text(target, "completedBy") ?? userId,
            };
            // Done is done: a pinned task lets go of the top, as in the app.
            if (target["pinnedAt"] is JsonValue) fields["pinnedAt"] = null;
            batch.Add(("tasks", Changed(target, fields)));
        }
        if (await PushAsync(userId, batch, cancellation) is { } problem) return problem;
        return Results.Ok(new CompleteResult((await queries.TaskAsync(userId, id, cancellation))!, null));
    }

    private static IEnumerable<string> Clocks(JsonObject doc) =>
        (doc["_hlc"] as JsonObject)?.Select(pair => pair.Value is JsonValue value && value.TryGetValue<string>(out var text) ? text : null).OfType<string>() ?? [];

    public async Task<IResult> ReopenAsync(string userId, string id, CancellationToken cancellation)
    {
        await sharing.Loaded.WaitAsync(cancellation);
        if (await queries.FindAsync(userId, "tasks", id, cancellation) is not { } stored || stored.Doc["deletedAt"] is JsonValue)
        {
            return ApiProblems.NotFound("task", id);
        }
        if ((ApiShapes.Text(stored.Doc, "status") ?? "open") != "open")
        {
            var batch = new Batch { ("tasks", Changed(stored.Doc, new JsonObject { ["status"] = "open", ["completedAt"] = null, ["completedBy"] = null })) };
            if (await PushAsync(userId, batch, cancellation) is { } problem) return problem;
        }
        return await TaskResultAsync(userId, id, StatusCodes.Status200OK, cancellation);
    }

    public async Task<IResult> DeleteAsync(string userId, string id, CancellationToken cancellation)
    {
        await sharing.Loaded.WaitAsync(cancellation);
        if (await queries.FindAsync(userId, "tasks", id, cancellation) is not { } stored) return ApiProblems.NotFound("task", id);
        if (stored.Doc["deletedAt"] is JsonValue) return Results.NoContent();
        var at = clock.Now();
        var going = (await DescendantsAsync(userId, id, false, cancellation)).Prepend(id).ToHashSet(StringComparer.Ordinal);
        var batch = new Batch();
        foreach (var task in await store.GetManyAsync(going, cancellation)) batch.Add(("tasks", Changed(task.Doc, new JsonObject { ["deletedAt"] = at })));
        // Their comments and files go with them, at the same time (audit B5).
        foreach (var collection in new[] { "comments", "attachments" })
        {
            var following = await VisibleAsync(userId, collection, false, facts => ApiShapes.Text(facts, "taskId") is { } task && going.Contains(task), cancellation);
            foreach (var each in following) batch.Add((collection, Changed(each.Doc, new JsonObject { ["deletedAt"] = at })));
        }
        if (await PushAsync(userId, batch, cancellation) is { } problem) return problem;
        return Results.NoContent();
    }

    public async Task<IResult> RestoreAsync(string userId, string id, CancellationToken cancellation)
    {
        await sharing.Loaded.WaitAsync(cancellation);
        if (await queries.FindAsync(userId, "tasks", id, cancellation) is not { } stored) return ApiProblems.NotFound("task", id);
        if (ApiShapes.Text(stored.Doc, "deletedAt") is not { } wentAt) return await TaskResultAsync(userId, id, StatusCodes.Status200OK, cancellation);
        var index = sharing.Index;
        var batch = new Batch();
        var together = new HashSet<string>(StringComparer.Ordinal) { id };
        var fields = new JsonObject { ["deletedAt"] = null };
        // A restored subtask whose parent is still in the trash moves to the top level.
        if (ApiShapes.Text(stored.Doc, "parentId") is { } parentId && index.LiveDocOf(parentId, "tasks") is null) fields["parentId"] = null;
        batch.Add(("tasks", Changed(stored.Doc, fields)));
        foreach (var subtask in await store.GetManyAsync(await DescendantsAsync(userId, id, true, cancellation), cancellation))
        {
            if (ApiShapes.Text(subtask.Doc, "deletedAt") != wentAt) continue;
            together.Add(subtask.Id);
            batch.Add(("tasks", Changed(subtask.Doc, new JsonObject { ["deletedAt"] = null })));
        }
        // With the comments and files that went with them, not erased ones.
        foreach (var (collection, text) in new[] { ("comments", "body"), ("attachments", "name") })
        {
            var back = await VisibleAsync(userId, collection, true, facts => ApiShapes.Text(facts, "taskId") is { } task && together.Contains(task), cancellation);
            foreach (var each in back.Where(each => ApiShapes.Text(each.Doc, "deletedAt") == wentAt && ApiShapes.Text(each.Doc, text) != SharingIndex.Erased))
            {
                batch.Add((collection, Changed(each.Doc, new JsonObject { ["deletedAt"] = null })));
            }
        }
        if (await PushAsync(userId, batch, cancellation) is { } problem) return problem;
        return await TaskResultAsync(userId, id, StatusCodes.Status200OK, cancellation);
    }

    // Lists and sections ----------------------------------------------------------------------

    public async Task<IResult> CreateListAsync(string userId, JsonObject body, CancellationToken cancellation)
    {
        await sharing.Loaded.WaitAsync(cancellation);
        var input = NamedInput.Parse(body, create: true, "name", "color");
        if (!input.Valid) return ApiProblems.Invalid("the list has problems", input.Errors);
        var id = input.Id ?? Ids.NewUlid();
        if (await store.GetAsync(id, cancellation) is { } existing)
        {
            return existing.Collection == "lists" && await queries.ListAsync(userId, id, cancellation) is { } same ? Results.Ok(same) : IdTaken();
        }
        var lists = await VisibleAsync(userId, "lists", false, null, cancellation);
        var batch = new Batch
        {
            ("lists", New(id, userId, new JsonObject
            {
                ["name"] = input.Name, ["color"] = input.Color ?? DefaultListColor, ["icon"] = null, ["folderId"] = null,
                ["visibility"] = "private", ["archived"] = false,
                ["order"] = OrderKeys.After(OrderKeys.Last(lists.Select(each => ApiShapes.Text(each.Doc, "order")))),
                ["isInbox"] = false,
            })),
        };
        if (await PushAsync(userId, batch, cancellation) is { } problem) return problem;
        return Results.Created($"/api/v1/lists/{id}", await queries.ListAsync(userId, id, cancellation));
    }

    public async Task<IResult> UpdateListAsync(string userId, string id, JsonObject body, CancellationToken cancellation)
    {
        await sharing.Loaded.WaitAsync(cancellation);
        if (await queries.FindAsync(userId, "lists", id, cancellation) is not { } stored) return ApiProblems.NotFound("list", id);
        var input = NamedInput.Parse(body, create: false, "name", "color");
        if (!input.Valid) return ApiProblems.Invalid("the change has problems", input.Errors);
        var fields = new JsonObject();
        if (input.Name is not null && input.Name != ApiShapes.Text(stored.Doc, "name")) fields["name"] = input.Name;
        if (input.Color is not null && input.Color != ApiShapes.Text(stored.Doc, "color")) fields["color"] = input.Color;
        if (fields.Count > 0 && await PushAsync(userId, [("lists", Changed(stored.Doc, fields))], cancellation) is { } problem) return problem;
        return Results.Ok(await queries.ListAsync(userId, id, cancellation));
    }

    public async Task<IResult> CreateSectionAsync(string userId, JsonObject body, CancellationToken cancellation)
    {
        await sharing.Loaded.WaitAsync(cancellation);
        var input = NamedInput.Parse(body, create: true, "name", "listId");
        if (!input.Valid) return ApiProblems.Invalid("the section has problems", input.Errors);
        var id = input.Id ?? Ids.NewUlid();
        if (await store.GetAsync(id, cancellation) is { } existing)
        {
            return existing.Collection == "sections" && await FindSectionAsync(userId, id, cancellation) is { } same ? Results.Ok(same) : IdTaken();
        }
        var index = sharing.Index;
        if (index.LiveDocOf(input.ListId!, "lists") is null || !index.Viewers(input.ListId!).Contains(userId))
        {
            return FieldProblem("listId", "no list with this id that you can see");
        }
        var sections = await VisibleAsync(userId, "sections", false, facts => ApiShapes.Text(facts, "listId") == input.ListId, cancellation);
        var batch = new Batch
        {
            ("sections", New(id, userId, new JsonObject
            {
                ["listId"] = input.ListId, ["name"] = input.Name,
                ["order"] = OrderKeys.After(OrderKeys.Last(sections.Select(each => ApiShapes.Text(each.Doc, "order")))),
            })),
        };
        if (await PushAsync(userId, batch, cancellation) is { } problem) return problem;
        return Results.Created($"/api/v1/sections/{id}", await FindSectionAsync(userId, id, cancellation));
    }

    public async Task<IResult> UpdateSectionAsync(string userId, string id, JsonObject body, CancellationToken cancellation)
    {
        await sharing.Loaded.WaitAsync(cancellation);
        if (await queries.FindAsync(userId, "sections", id, cancellation) is not { } stored) return ApiProblems.NotFound("section", id);
        var input = NamedInput.Parse(body, create: false, "name");
        if (!input.Valid) return ApiProblems.Invalid("the change has problems", input.Errors);
        if (input.Name is not null && input.Name != ApiShapes.Text(stored.Doc, "name")
            && await PushAsync(userId, [("sections", Changed(stored.Doc, new JsonObject { ["name"] = input.Name }))], cancellation) is { } problem)
        {
            return problem;
        }
        return Results.Ok(await FindSectionAsync(userId, id, cancellation));
    }

    private async Task<ApiSection?> FindSectionAsync(string userId, string id, CancellationToken cancellation) =>
        await queries.FindAsync(userId, "sections", id, cancellation) is { } section ? ApiShapes.Section(section.Doc) : null;
}

/// <summary>What complete answers: the closed task, and the next one when it repeats (else null).</summary>
public sealed record CompleteResult(ApiTask Completed, ApiTask? Next);
