using System.Text.Json.Nodes;
using PeckList.Calendars.Testing;
using PeckList.Core.Calendars;
using PeckList.Core.Sharing;
using PeckList.Core.Storage;
using PeckList.Core.Sync;
using PeckList.Storage.Sql;
using PeckList.Storage.Sqlite;

namespace PeckList.Calendars.Tests;

/// <summary>A clock the test moves.</summary>
internal sealed class ManualTime(DateTimeOffset now) : TimeProvider
{
    public DateTimeOffset Now { get; set; } = now;

    public override DateTimeOffset GetUtcNow() => Now;

    public void Advance(TimeSpan by) => Now += by;
}

/// <summary>Secrets "encrypted" by a prefix: enough to show the engine stores what it is handed back.</summary>
internal sealed class PrefixSecrets : ICalendarSecrets
{
    public Task<string> ProtectAsync(string secret, CancellationToken cancellation = default) => Task.FromResult("sealed:" + secret);

    public Task<string> UnprotectAsync(string stored, CancellationToken cancellation = default) =>
        Task.FromResult(stored.StartsWith("sealed:", StringComparison.Ordinal) ? stored["sealed:".Length..] : throw new InvalidOperationException("not sealed"));
}

/// <summary>
/// A server's worth of calendar sync on a fresh SQLite database: one person (ben) with an inbox and a
/// tag, a fake calendar account with one calendar linked to the tag, and the engine. Made-up data only.
/// </summary>
internal sealed class CalendarRig : IAsyncDisposable
{
    public const string Ben = "01JDZKBEN000000000000000BN";
    public const string Inbox = "01JDZKINBOX0000000000000IB";
    public const string Tag = "01JDZKTAG00000000000000TAG";
    public const string Zone = "Europe/London";

    private readonly string folder = Directory.CreateTempSubdirectory("pecklist-calendar-").FullName;
    private bool seriesListsOverrides;

    public ManualTime Time { get; } = new(new DateTimeOffset(2026, 11, 26, 9, 0, 0, TimeSpan.Zero));
    public FakeCalendarProvider Fake { get; private set; } = null!;
    public CalendarConnection Connection { get; private set; } = null!;
    public string CalendarId { get; private set; } = "";
    public SqlDatabase Database { get; private set; } = null!;
    public IEntityStore Entities { get; private set; } = null!;
    public SqlCalendarStore Calendars { get; private set; } = null!;
    public SyncService Sync { get; private set; } = null!;
    public ServerClock Clock { get; private set; } = null!;
    public SharingState Sharing { get; private set; } = null!;
    public CalendarSync Engine { get; private set; } = null!;
    public CalendarInstance Instance { get; private set; } = null!;
    public string LinkId { get; private set; } = "link1";

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    public static async Task<CalendarRig> StartAsync(bool seriesListsOverrides = false)
    {
        var rig = new CalendarRig { seriesListsOverrides = seriesListsOverrides };
        await rig.SetUpAsync();
        return rig;
    }

    private async Task SetUpAsync()
    {
        Database = new SqliteDatabase(Path.Combine(folder, "data.db"));
        await Database.MigrateAsync(Token);
        Entities = new SqlEntityStore(Database);
        Calendars = new SqlCalendarStore(Database);
        Sharing = new SharingState();
        await Sharing.LoadAsync(Entities, [Ben], Token);
        Clock = new ServerClock(Time);
        Sync = new SyncService(Entities, Time, new InProcessChangeNotifier(), Sharing, clock: Clock);
        Instance = new CalendarInstance(new SqlSecretStore(Database));
        Fake = new FakeCalendarProvider(Time, push: false, seriesListsOverrides);
        Connection = Fake.AddAccount();
        CalendarId = Fake.AddCalendar(Connection);
        Engine = NewEngine();
        await WriteAsync("lists", New(Inbox, new JsonObject
        {
            ["name"] = "Inbox", ["color"] = null, ["folderId"] = null, ["order"] = "a0", ["isInbox"] = true,
            ["visibility"] = "private", ["viewMode"] = "list",
        }));
        await WriteAsync("tags", New(Tag, new JsonObject { ["name"] = "calendar", ["color"] = "#3366FF", ["order"] = "a0" }));
        var secrets = new PrefixSecrets();
        await Calendars.SaveAccountAsync(new CalendarAccount("acct1", Ben, "fake", "sam", Connection.ServerUrl, Connection.Username,
            await secrets.ProtectAsync(Connection.Secret, Token), CalendarAccount.Ok, null, Time.Now), Token);
        await Calendars.SaveLinkAsync(NewLink(LinkId, CalendarId, Tag), Token);
    }

    public CalendarSync NewEngine(CalendarInstance? instance = null, TimeSpan? deadline = null) =>
        new(Calendars, [Fake], new PrefixSecrets(), Entities, Sync, Sharing, Clock, instance ?? Instance, Time, (_, _) => Task.FromResult(Zone))
        {
            RunDeadline = deadline ?? TimeSpan.FromMinutes(5),
        };

    public static CalendarLink NewLink(string id, string remoteId, string tag) =>
        new(id, "acct1", Ben, remoteId, "Personal", null, false, CalendarModes.Sync, tag, null, false, null, 0, null, null, null, null, 0, null);

    public JsonObject New(string id, JsonObject fields) => ServerEntities.New(id, Ben, "test", Clock.Now(), Clock.Next(), fields);

    public async Task WriteAsync(string collection, JsonObject doc) =>
        await Sync.WriteAsServerAsync(Ben, [new IncomingEntity(collection, doc)], Token);

    /// <summary>A new task, tagged for the calendar unless told otherwise.</summary>
    public async Task<string> AddTaskAsync(string title, JsonObject? schedule, bool tagged = true, string? recurrence = null, string? tag = null)
    {
        var id = Core.Ids.NewUlid(Time);
        var stamp = Clock.Next();
        var fields = new JsonObject
        {
            ["title"] = title, ["notes"] = "", ["listId"] = Inbox, ["sectionId"] = null, ["parentId"] = null, ["order"] = "a" + id[^4..],
            ["status"] = "open", ["completedAt"] = null, ["completedBy"] = null, ["priority"] = 0, ["schedule"] = schedule, ["due"] = null,
            ["tags"] = tagged ? new JsonObject { [tag ?? Tag] = new JsonObject { ["in"] = true, ["hlc"] = stamp } } : new JsonObject(),
            ["assignees"] = new JsonObject(), ["blockedBy"] = new JsonObject(), ["recurrence"] = recurrence, ["progress"] = 0,
        };
        await WriteAsync("tasks", ServerEntities.New(id, Ben, "test", Clock.Now(), stamp, fields));
        return id;
    }

    /// <summary>The person edits a task on a device, now.</summary>
    public async Task EditTaskAsync(string id, JsonObject fields)
    {
        var doc = await TaskAsync(id) ?? throw new InvalidOperationException($"no task {id}");
        await WriteAsync("tasks", ServerEntities.Changed(doc, Clock.Next(), fields));
    }

    public async Task UntagAsync(string id, string? tag = null)
    {
        var doc = await TaskAsync(id) ?? throw new InvalidOperationException($"no task {id}");
        var change = ServerEntities.Change(id, Clock.Next(), new JsonObject());
        change["tags"] = new JsonObject { [tag ?? Tag] = new JsonObject { ["in"] = false, ["hlc"] = Clock.Next() } };
        await WriteAsync("tasks", Merge.Entity((JsonObject)doc.DeepClone(), change, ["tags"]));
    }

    public async Task<JsonObject?> TaskAsync(string id) => (await Entities.GetAsync(id, Token))?.Doc;

    public async Task<IReadOnlyList<JsonObject>> TasksAsync(bool deleted = false)
    {
        var ids = await Entities.VisibleIdsAsync(Ben, "tasks", deleted, Token);
        return [.. (await Entities.GetManyAsync(ids, Token)).Select(each => each.Doc).OrderBy(doc => (string)doc["id"]!, StringComparer.Ordinal)];
    }

    public Task<CalendarRun> RunAsync(string? linkId = null) => Engine.SyncLinkAsync(linkId ?? LinkId, Token);

    public static JsonObject Day(string day) => new() { ["start"] = day, ["end"] = null, ["allDay"] = true, ["timeZone"] = Zone };

    public static JsonObject At(string start, string? end = null) => new() { ["start"] = start, ["end"] = end, ["allDay"] = false, ["timeZone"] = Zone };

    public async ValueTask DisposeAsync()
    {
        if (Database is IAsyncDisposable disposable) await disposable.DisposeAsync();
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        try
        {
            Directory.Delete(folder, recursive: true);
        }
        catch (IOException)
        {
            // A file still held on Windows: the temp folder is cleaned by the system later.
        }
    }
}
