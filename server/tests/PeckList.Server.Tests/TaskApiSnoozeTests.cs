using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using PeckList.Core.Accounts;
using PeckList.Server.Push;
using static PeckList.Server.Tests.TaskApiWorld;

namespace PeckList.Server.Tests;

/// <summary>
/// The task API's snooze (PL-119), on SQLite and PostgreSQL: a reminder put off for the caller by
/// the apps' rules (one snooze per reminder, kept by the server, heard by the apps), for Home
/// Assistant and the CLI, which sign in with keys.
/// </summary>
public sealed class TaskApiSnoozeTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private static readonly TimeZoneInfo Chicago = TimeZoneInfo.FindSystemTimeZoneById("America/Chicago");

    private static async Task<(HttpStatusCode Status, JsonObject Body)> Send(HttpClient client, string path, object? body = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, path);
        if (body is not null) request.Content = JsonContent.Create(body);
        var response = await client.SendAsync(request, Token);
        var text = await response.Content.ReadAsStringAsync(Token);
        return (response.StatusCode, text.Length == 0 ? [] : JsonNode.Parse(text)!.AsObject());
    }

    private static async Task<JsonObject> Expect(HttpClient client, string path, object? body, HttpStatusCode expected)
    {
        var (status, json) = await Send(client, path, body);
        Assert.True(status == expected, $"POST {path}: {(int)status} {json.ToJsonString()}");
        return json;
    }

    private static string Iso(DateTimeOffset at) => at.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture);

    /// <summary>
    /// A task made by <paramref name="maker"/> (whom its reminders come to while nobody is assigned),
    /// due at <paramref name="due"/> (written on Chicago's clock, as the app writes it) with these reminders.
    /// </summary>
    private static (string, JsonObject) Reminded(Person maker, string id, string list, string title, DateTimeOffset due, params JsonObject[] reminders)
    {
        var task = Made(maker, Task(id, list, title, due: TimeZoneInfo.ConvertTime(due, Chicago).ToString("yyyy-MM-dd'T'HH:mm", CultureInfo.InvariantCulture)));
        task.Item2["reminders"] = new JsonArray([.. reminders]);
        return task;
    }

    /// <summary>Marked as made by <paramref name="maker"/>, as the app marks what it makes.</summary>
    private static (string, JsonObject) Made(Person maker, (string, JsonObject) task)
    {
        task.Item2["createdBy"] = maker.Id;
        return task;
    }

    private static JsonObject Before(int minutes) => new() { ["before"] = minutes };

    private static async Task<List<SnoozedReminder>> Snoozes(Person person) =>
        (await person.Session.GetFromJsonAsync<List<SnoozedReminder>>("/api/reminders/snoozes", Token))!;

    private static DateTimeOffset Minute()
    {
        var now = DateTimeOffset.UtcNow;
        return now.AddTicks(-(now.UtcTicks % TimeSpan.TicksPerMinute));
    }

    [Theory]
    [MemberData(nameof(Databases), MemberType = typeof(TaskApiWorld))]
    public async Task A_key_snoozes_a_reminder_for_its_person_alone_the_apps_hear_of_it_and_the_task_is_left_alone(string kind)
    {
        using var world = await StartAsync(fixture, kind);
        var ben = await world.PersonAsync("ben");
        var due = Minute().AddMinutes(40);
        // At its time, and an hour before (which came twenty minutes ago).
        await PushAsync(ben, List("L1", "Home"), Reminded(ben, "T1", "L1", "Pills", due, Before(0), Before(60)));
        var key = await world.KeyAsync(ben, ApiScopes.TasksWrite);
        var before = (await ben.Session.GetFromJsonAsync<JsonObject>("/api/v1/tasks/T1", Token))!;

        // Named: the one at its time, for half an hour.
        var snoozed = await Expect(key, "/api/v1/tasks/T1/snooze", new { minutes = 30, first = Iso(due) }, HttpStatusCode.OK);
        Assert.Equal("T1", (string?)snoozed["taskId"]);
        Assert.Equal(Iso(due), (string?)snoozed["first"]);
        var at = DateTimeOffset.Parse((string)snoozed["at"]!, CultureInfo.InvariantCulture);
        Assert.InRange(at, Minute().AddMinutes(29), Minute().AddMinutes(31));
        Assert.Equal(0, at.Second);
        // The apps hear of it as of a snooze pressed there.
        var heard = Assert.Single(await Snoozes(ben));
        Assert.Equal(("T1", at.ToUnixTimeMilliseconds(), due.ToUnixTimeMilliseconds()), (heard.TaskId, heard.At, heard.First));
        // The task itself is as it was.
        var after = (await ben.Session.GetFromJsonAsync<JsonObject>("/api/v1/tasks/T1", Token))!;
        Assert.Equal(before.ToJsonString(), after.ToJsonString());

        // Again with nothing named: that snooze, still to come, is the one put off (replaced), ten minutes by default.
        var again = await Expect(key, "/api/v1/tasks/T1/snooze", null, HttpStatusCode.OK);
        Assert.Equal(Iso(due), (string?)again["first"]);
        var replaced = Assert.Single(await Snoozes(ben));
        Assert.Equal(DateTimeOffset.Parse((string)again["at"]!, CultureInfo.InvariantCulture).ToUnixTimeMilliseconds(), replaced.At);
        Assert.InRange(DateTimeOffset.FromUnixTimeMilliseconds(replaced.At), Minute().AddMinutes(9), Minute().AddMinutes(11));
    }

    [Theory]
    [MemberData(nameof(Databases), MemberType = typeof(TaskApiWorld))]
    public async Task With_nothing_named_it_is_the_reminder_that_came_last_else_the_next_one(string kind)
    {
        using var world = await StartAsync(fixture, kind);
        var ben = await world.PersonAsync("ben");
        var due = Minute().AddMinutes(40);
        await PushAsync(ben, List("L1", "Home"),
            Reminded(ben, "T1", "L1", "Came", due, Before(0), Before(60), Before(90)),
            Reminded(ben, "T2", "L1", "Coming", due, Before(0), Before(20)));
        var key = await world.KeyAsync(ben, ApiScopes.TasksWrite);
        // T1: the hour before came twenty minutes ago, an hour and a half before came fifty minutes ago.
        Assert.Equal(Iso(due.AddMinutes(-60)), (string?)(await Expect(key, "/api/v1/tasks/T1/snooze", new { }, HttpStatusCode.OK))["first"]);
        // T2: none has come; the next one due is twenty minutes before.
        Assert.Equal(Iso(due.AddMinutes(-20)), (string?)(await Expect(key, "/api/v1/tasks/T2/snooze", new { minutes = 60 }, HttpStatusCode.OK))["first"]);
        Assert.Equal(["T1", "T2"], (await Snoozes(ben)).Select(each => each.TaskId).Order(StringComparer.Ordinal));
    }

    [Theory]
    [MemberData(nameof(Databases), MemberType = typeof(TaskApiWorld))]
    public async Task It_refuses_what_is_not_a_snooze_of_your_own_reminder(string kind)
    {
        using var world = await StartAsync(fixture, kind);
        var ben = await world.PersonAsync("ben");
        var sam = await world.PersonAsync("sam");
        var lee = await world.PersonAsync("lee");
        await world.BefriendAsync(ben, sam);
        var due = Minute().AddMinutes(40);
        var samsTask = Reminded(ben, "T4", "SH", "Sam's", due, Before(0));
        samsTask.Item2["assignees"] = Set($"user:{sam.Id}");
        var done = Reminded(ben, "T5", "L1", "Done", due, Before(0));
        done.Item2["status"] = "done";
        await PushAsync(ben,
            List("L1", "Home"), List("SH", "Chores", visibility: "shared"), Member("M1", "SH", sam.Id, "editor"),
            Reminded(ben, "T1", "L1", "Pills", due, Before(0)), Made(ben, Task("T2", "L1", "No reminder")), samsTask, done);
        var key = await world.KeyAsync(ben, ApiScopes.TasksWrite);

        string Code(JsonObject problem) => (string)problem["code"]!;
        // The body.
        foreach (var minutes in new object[] { 0, 10081, "ten", 1.5 })
        {
            var refused = await Expect(key, "/api/v1/tasks/T1/snooze", new { minutes }, HttpStatusCode.BadRequest);
            Assert.NotNull(refused["errors"]!["minutes"]);
        }
        foreach (var first in new object[] { "tomorrow", "2026-11-21T15:00:00", 5, Iso(due.AddMinutes(1)) })
        {
            var refused = await Expect(key, "/api/v1/tasks/T1/snooze", new { first }, HttpStatusCode.BadRequest);
            Assert.NotNull(refused["errors"]!["first"]);
        }
        await Expect(key, "/api/v1/tasks/T1/snooze", new { until = "later" }, HttpStatusCode.BadRequest);
        // The task.
        Assert.Equal("no_reminder", Code(await Expect(key, "/api/v1/tasks/T2/snooze", null, HttpStatusCode.Conflict)));
        Assert.Equal("closed", Code(await Expect(key, "/api/v1/tasks/T5/snooze", null, HttpStatusCode.Conflict)));
        // Assigned to Sam: its reminders are Sam's, so Sam snoozes it and Ben may not.
        Assert.Equal("not_reminded", Code(await Expect(key, "/api/v1/tasks/T4/snooze", null, HttpStatusCode.Conflict)));
        await Expect(await world.KeyAsync(sam, ApiScopes.TasksWrite), "/api/v1/tasks/T4/snooze", null, HttpStatusCode.OK);
        Assert.Equal(["T4"], (await Snoozes(sam)).Select(each => each.TaskId));
        // Not to be seen: not found. A key that only reads: not allowed.
        await Expect(await world.KeyAsync(lee, ApiScopes.TasksWrite), "/api/v1/tasks/T1/snooze", null, HttpStatusCode.NotFound);
        await Expect(key, "/api/v1/tasks/NOPE/snooze", null, HttpStatusCode.NotFound);
        await Expect(await world.KeyAsync(ben, ApiScopes.TasksRead), "/api/v1/tasks/T1/snooze", null, HttpStatusCode.Forbidden);
        // None of that left a snooze of Ben's.
        Assert.Empty(await Snoozes(ben));
    }
}
