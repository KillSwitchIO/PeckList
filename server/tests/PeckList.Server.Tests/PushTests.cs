using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using PeckList.Core;
using PeckList.Core.Accounts;
using PeckList.Core.Push;
using PeckList.Core.Sharing;
using PeckList.Server.Push;

namespace PeckList.Server.Tests;

/// <summary>Web Push and server reminders (spec: PL-061).</summary>
public sealed class PushTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private sealed class FakePush : IPushSender
    {
        public List<(string UserId, PushPayload Payload)> Sent { get; } = [];

        /// <summary>The next send fails, as a push service that is down would.</summary>
        public bool FailNext { get; set; }

        /// <summary>While set, sends wait for it, as a slow push service would.</summary>
        public TaskCompletionSource? Hold { get; set; }

        /// <summary>Sends to these people never answer, as a dead browser's push service might.</summary>
        public HashSet<string> Hung { get; } = [];

        public async Task SendAsync(string userId, PushPayload payload, CancellationToken cancellation = default)
        {
            if (Hold is { } hold) await hold.Task.WaitAsync(cancellation);
            if (Hung.Contains(userId)) await Task.Delay(Timeout.Infinite, cancellation);
            if (FailNext)
            {
                FailNext = false;
                throw new HttpRequestException("push service down");
            }
            lock (Sent) Sent.Add((userId, payload));
        }
    }

    private readonly FakePush push = new();

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    /// <summary>Notification pushes go out after the request (audit B2): wait for them.</summary>
    private static Task Pushed(WebApplicationFactory<Program> server) =>
        server.Services.GetRequiredService<BackgroundQueue>().IdleAsync(Token);

    private async Task<(HttpClient Client, string Id)> SignIn(WebApplicationFactory<Program> server, string username)
    {
        var accounts = server.Services.GetRequiredService<AccountService>();
        const string password = "a long enough password";
        var account = await accounts.CreateUserAsync(username, password, mustChangePassword: false, cancellation: Token);
        var client = server.CreateClient();
        (await client.PostAsJsonAsync("/auth/login", new { username, password }, Token)).EnsureSuccessStatusCode();
        return (client, account.Id);
    }

    private WebApplicationFactory<Program> Server() =>
        fixture.Factory(("ADMIN_PASSWORD", "correct horse battery"))
            .WithWebHostBuilder(host => host.ConfigureTestServices(services => services.AddSingleton<IPushSender>(push)));

    private static JsonObject Entity(string id, string by, JsonObject fields)
    {
        const string stamp = "2026-10-24T10:00:00.000Z-0000-dev1";
        fields["id"] = id;
        fields["createdBy"] = by;
        fields["deletedAt"] ??= null;
        var clocks = new JsonObject();
        foreach (var (field, _) in fields) if (field != "id") clocks[field] = stamp;
        fields["_hlc"] = clocks;
        return fields;
    }

    [Fact]
    public async Task The_server_keeps_one_vapid_key_and_takes_subscriptions_from_the_signed_in()
    {
        using var server = Server();
        var (ben, benId) = await SignIn(server, "ben-p");
        var key = (await ben.GetFromJsonAsync<PushKey>("/api/push/key", Token))!.PublicKey;
        // An uncompressed P-256 point: 65 bytes, base64url.
        Assert.Equal(87, key.Length);
        Assert.Equal(key, (await ben.GetFromJsonAsync<PushKey>("/api/push/key", Token))!.PublicKey);

        Assert.Equal(HttpStatusCode.BadRequest, (await ben.PostAsJsonAsync("/api/push/subscriptions",
            new { endpoint = "http://insecure.example/x", keys = new { p256dh = "p", auth = "a" } }, Token)).StatusCode);
        (await ben.PostAsJsonAsync("/api/push/subscriptions",
            new { endpoint = "https://push.example/ben", keys = new { p256dh = "p", auth = "a" } }, Token)).EnsureSuccessStatusCode();
        var store = server.Services.GetRequiredService<IPushStore>();
        Assert.Equal("https://push.example/ben", (await store.ForUserAsync(benId, Token)).Single().Endpoint);

        // Someone else cannot take it away.
        var (kim, _) = await SignIn(server, "kim-p");
        (await kim.PostAsJsonAsync("/api/push/unsubscribe", new { endpoint = "https://push.example/ben" }, Token)).EnsureSuccessStatusCode();
        Assert.Single(await store.ForUserAsync(benId, Token));
        (await ben.PostAsJsonAsync("/api/push/unsubscribe", new { endpoint = "https://push.example/ben" }, Token)).EnsureSuccessStatusCode();
        Assert.Empty(await store.ForUserAsync(benId, Token));
    }

    [Fact]
    public async Task A_reminder_that_fails_does_not_hold_up_the_rest()
    {
        using var server = Server();
        var (ben, benId) = await SignIn(server, "ben-f");
        JsonObject Reminded(string id) => Entity(id, benId, new JsonObject
        {
            ["listId"] = "FL1",
            ["title"] = id,
            ["parentId"] = null,
            ["status"] = "open",
            ["assignees"] = new JsonObject(),
            ["reminders"] = new JsonArray(new JsonObject { ["at"] = "2026-10-26T09:00" }),
        });
        (await ben.PostAsJsonAsync("/api/sync", new
        {
            schemaVersion = WorkspaceSchema.CurrentVersion,
            cursor = (long?)null,
            changes = new object[]
            {
                new { collection = "lists", entity = Entity("FL1", benId, new JsonObject { ["name"] = "Home", ["visibility"] = "private" }) },
                new { collection = "tasks", entity = Reminded("FT1") },
                new { collection = "tasks", entity = Reminded("FT2") },
            },
        }, Token)).EnsureSuccessStatusCode();

        // The first of the two fails; the run goes on with the other.
        push.FailNext = true;
        var sender = server.Services.GetRequiredService<ReminderSender>();
        await sender.SendDueAsync(new DateTimeOffset(2026, 10, 25, 0, 0, 0, TimeSpan.Zero), new DateTimeOffset(2026, 10, 28, 0, 0, 0, TimeSpan.Zero), Token);
        Assert.Single(push.Sent);
    }

    [Fact]
    public async Task Due_reminders_go_out_once_as_a_notification_and_a_push_to_whom_they_are_for()
    {
        using var server = Server();
        var (ben, benId) = await SignIn(server, "ben-r");
        // Ben's own time zone: reminders count in it.
        var settings = Entity("SET-R", benId, new JsonObject
        {
            ["userId"] = benId,
            ["themeMode"] = "system",
            ["palette"] = new JsonObject(),
            ["pointEventMinutes"] = 30,
            ["dueSoonDays"] = 2,
            ["timeZone"] = "America/Chicago",
            ["sidebar"] = new JsonObject { ["order"] = new JsonArray(), ["hidden"] = new JsonArray(), ["groupOpen"] = false },
        });
        var list = Entity("RL1", benId, new JsonObject { ["name"] = "Home", ["visibility"] = "private" });
        var task = Entity("RT1", benId, new JsonObject
        {
            ["listId"] = "RL1",
            ["title"] = "Dentist",
            ["parentId"] = null,
            ["status"] = "open",
            ["assignees"] = new JsonObject(),
            ["schedule"] = new JsonObject { ["start"] = "2026-10-26T10:30", ["end"] = null, ["allDay"] = false, ["timeZone"] = "America/Chicago" },
            ["reminders"] = new JsonArray(new JsonObject { ["before"] = 30 }),
        });
        (await ben.PostAsJsonAsync("/api/sync", new
        {
            schemaVersion = WorkspaceSchema.CurrentVersion,
            cursor = (long?)null,
            changes = new object[]
            {
                new { collection = "settings", entity = settings },
                new { collection = "lists", entity = list },
                new { collection = "tasks", entity = task },
            },
        }, Token)).EnsureSuccessStatusCode();

        // 10:00 in Chicago (CDT, UTC-5) is 15:00 UTC.
        var due = new DateTimeOffset(2026, 10, 26, 15, 0, 0, TimeSpan.Zero);
        var sender = server.Services.GetRequiredService<ReminderSender>();
        await sender.SendDueAsync(due.AddMinutes(-1), due.AddMinutes(-0.5), Token);
        Assert.Empty(push.Sent);
        await sender.SendDueAsync(due.AddMinutes(-1), due.AddMinutes(1), Token);
        await sender.SendDueAsync(due.AddMinutes(-1), due.AddMinutes(1), Token);

        var (userId, payload) = Assert.Single(push.Sent);
        Assert.Equal(benId, userId);
        Assert.Equal(("Dentist", "Reminder for 10:00 AM", "/today?task=RT1"), (payload.Title, payload.Body, payload.Url));
        Assert.Equal($"RT1@{due.ToUnixTimeMilliseconds()}", payload.Tag);
        var feed = (await ben.GetFromJsonAsync<NotificationFeed>("/api/notifications", Token))!;
        var reminder = Assert.Single(feed.Items);
        Assert.Equal(("reminder", "RT1", due), (reminder.Kind, reminder.TaskId, reminder.At));
    }

    [Fact]
    public async Task A_constant_reminder_comes_again_every_five_minutes_sticky_until_done_and_lists_once()
    {
        using var server = Server();
        var (ben, benId) = await SignIn(server, "ben-c");
        var list = Entity("CL1", benId, new JsonObject { ["name"] = "Home", ["visibility"] = "private" });
        // All day, reminded on the day at 10:00 (an hour after 9:00: a negative "before").
        var task = Entity("CT1", benId, new JsonObject
        {
            ["listId"] = "CL1",
            ["title"] = "Water plants",
            ["parentId"] = null,
            ["status"] = "open",
            ["assignees"] = new JsonObject(),
            ["schedule"] = new JsonObject { ["start"] = "2026-10-26", ["end"] = null, ["allDay"] = true, ["timeZone"] = "UTC" },
            ["reminders"] = new JsonArray(new JsonObject { ["before"] = -60 }),
            ["constantReminder"] = true,
        });
        (await ben.PostAsJsonAsync("/api/sync", new
        {
            schemaVersion = WorkspaceSchema.CurrentVersion,
            cursor = (long?)null,
            changes = new object[]
            {
                new { collection = "lists", entity = list },
                new { collection = "tasks", entity = task },
            },
        }, Token)).EnsureSuccessStatusCode();

        // The server's own zone counts (no settings): pin it by checking the first send's time.
        var sender = server.Services.GetRequiredService<ReminderSender>();
        var first = ServerReminders.Instants(task, TimeZoneInfo.Local).First();
        Assert.Equal(new DateTime(2026, 10, 26, 10, 0, 0), TimeZoneInfo.ConvertTime(first.At, TimeZoneInfo.Local).DateTime);
        await sender.SendDueAsync(first.At.AddMinutes(-1), first.At.AddMinutes(12), Token);

        Assert.Equal(3, push.Sent.Count);
        Assert.All(push.Sent, sent => Assert.True(sent.Payload.Sticky));
        Assert.Single(push.Sent.Select(sent => sent.Payload.Tag).Distinct());
        var feed = (await ben.GetFromJsonAsync<NotificationFeed>("/api/notifications", Token))!;
        Assert.Single(feed.Items);
        Assert.Equal(ServerReminders.ConstantTimes, ServerReminders.Instants(task, TimeZoneInfo.Local).Count());
    }

    [Fact]
    public async Task Dismiss_stops_a_constant_reminders_repeats_and_snooze_brings_it_back_without_changing_the_task()
    {
        using var server = Server();
        var (ben, benId) = await SignIn(server, "ben-d");
        var list = Entity("DL1", benId, new JsonObject { ["name"] = "Home", ["visibility"] = "private" });
        var task = Entity("DT1", benId, new JsonObject
        {
            ["listId"] = "DL1",
            ["title"] = "Stretch",
            ["parentId"] = null,
            ["status"] = "open",
            ["assignees"] = new JsonObject(),
            ["schedule"] = new JsonObject { ["start"] = "2026-10-26T10:00", ["end"] = null, ["allDay"] = false, ["timeZone"] = "UTC" },
            ["reminders"] = new JsonArray(new JsonObject { ["before"] = 0 }),
            ["constantReminder"] = true,
        });
        (await ben.PostAsJsonAsync("/api/sync", new
        {
            schemaVersion = WorkspaceSchema.CurrentVersion,
            cursor = (long?)null,
            changes = new object[] { new { collection = "lists", entity = list }, new { collection = "tasks", entity = task } },
        }, Token)).EnsureSuccessStatusCode();

        var sender = server.Services.GetRequiredService<ReminderSender>();
        var first = ServerReminders.Instants(task, TimeZoneInfo.Local).First().First;
        await sender.SendDueAsync(first.AddMinutes(-1), first.AddMinutes(1), Token);
        Assert.Single(push.Sent);
        (await ben.PostAsJsonAsync("/api/reminders/act", new { taskId = "DT1", first = first.ToUnixTimeMilliseconds(), action = "dismiss" }, Token)).EnsureSuccessStatusCode();
        await sender.SendDueAsync(first.AddMinutes(1), first.AddMinutes(60), Token);
        Assert.Single(push.Sent);

        var before = DateTimeOffset.UtcNow;
        (await ben.PostAsJsonAsync("/api/reminders/act", new { taskId = "DT1", first = first.ToUnixTimeMilliseconds(), action = "snooze" }, Token)).EnsureSuccessStatusCode();
        // The task is as it was (audit B3); the snooze is Ben's alone.
        var stored = server.Services.GetRequiredService<SharingState>().Index.LiveOf("tasks").Single(each => each.Id == "DT1").Doc;
        Assert.Single(Assert.IsType<JsonArray>(stored["reminders"]));
        var snooze = Assert.Single((await ben.GetFromJsonAsync<List<SnoozedReminder>>("/api/reminders/snoozes", Token))!);
        Assert.Equal("DT1", snooze.TaskId);
        var at = DateTimeOffset.FromUnixTimeMilliseconds(snooze.At);
        Assert.InRange((at - before.AddMinutes(PushEndpoints.SnoozeMinutes)).TotalMinutes, -1.5, 1.5);
        Assert.Equal(0, at.Second);
        // It comes back ten minutes on, and as the task's reminder is constant, so is the snooze.
        await sender.SendDueAsync(at.AddMinutes(-1), at.AddMinutes(30), Token);
        Assert.Equal(1 + ServerReminders.ConstantTimes, push.Sent.Count);
        Assert.All(push.Sent.Skip(1), sent => Assert.Equal($"DT1@{snooze.At}", sent.Payload.Tag));
        // Once each.
        await sender.SendDueAsync(at.AddMinutes(-1), at.AddMinutes(30), Token);
        Assert.Equal(1 + ServerReminders.ConstantTimes, push.Sent.Count);

        // Not someone else's.
        var (sam, _) = await SignIn(server, "sam-d");
        Assert.Equal(HttpStatusCode.NotFound, (await sam.PostAsJsonAsync("/api/reminders/act", new { taskId = "DT1", first = 0L, action = "dismiss" }, Token)).StatusCode);

        // A number that is no time is a 400, not a 500 (audit C8).
        foreach (var nonsense in new[] { long.MaxValue, -1L })
        {
            var refused = await ben.PostAsJsonAsync("/api/reminders/act", new { taskId = "DT1", first = nonsense, action = "dismiss" }, Token);
            Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
        }
    }

    [Fact]
    public async Task The_app_check_gives_what_is_new_once_and_the_reminders_ahead()
    {
        using var server = Server();
        var (ben, benId) = await SignIn(server, "ben-k");
        var (_, kimId) = await SignIn(server, "kim-k");
        // Two days from now on Chicago's clock; Ben set no time zone, so the phone's counts.
        var chicago = TimeZoneInfo.FindSystemTimeZoneById("America/Chicago");
        var local = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, chicago).Date.AddDays(2).AddHours(14);
        var due = new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(local, chicago), TimeSpan.Zero);
        var list = Entity("KL1", benId, new JsonObject { ["name"] = "Home", ["visibility"] = "private" });
        var task = Entity("KT1", benId, new JsonObject
        {
            ["listId"] = "KL1",
            ["title"] = "Call the plumber",
            ["parentId"] = null,
            ["status"] = "open",
            ["assignees"] = new JsonObject(),
            ["reminders"] = new JsonArray(new JsonObject { ["at"] = local.ToString("yyyy-MM-dd'T'HH:mm") }),
        });
        // A constant reminder a day later: its repeats too, keyed as the app keys them.
        var nagging = Entity("KT2", benId, new JsonObject
        {
            ["listId"] = "KL1",
            ["title"] = "Take the pills",
            ["parentId"] = null,
            ["status"] = "open",
            ["assignees"] = new JsonObject(),
            ["constantReminder"] = true,
            ["reminders"] = new JsonArray(new JsonObject { ["at"] = local.AddDays(1).ToString("yyyy-MM-dd'T'HH:mm") }),
        });
        (await ben.PostAsJsonAsync("/api/sync", new
        {
            schemaVersion = WorkspaceSchema.CurrentVersion,
            cursor = (long?)null,
            changes = new object[]
            {
                new { collection = "lists", entity = list },
                new { collection = "tasks", entity = task },
                new { collection = "tasks", entity = nagging },
            },
        }, Token)).EnsureSuccessStatusCode();
        var store = server.Services.GetRequiredService<Core.Notifications.INotificationStore>();
        Core.Notifications.Notification Note(string kind) => new()
        {
            Id = Ids.NewUlid(), UserId = benId, Kind = kind, At = DateTimeOffset.UtcNow, ActorId = kimId, ListId = "KL1",
        };
        await store.AddAsync([Note("shared")], Token);

        // The first check is only a starting point: what was there before is not news.
        var first = (await ben.GetFromJsonAsync<AppCheck>("/api/app/check?zone=America/Chicago", Token))!;
        Assert.Empty(first.Notifications);
        var reminder = first.Reminders[0];
        Assert.Equal(($"KT1@{due.ToUnixTimeMilliseconds()}", "Call the plumber", "Reminder for 2:00 PM", "/today?task=KT1"),
            (reminder.Tag, reminder.Title, reminder.Body, reminder.Url));
        var tag = $"KT2@{new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(local.AddDays(1), chicago), TimeSpan.Zero).ToUnixTimeMilliseconds()}";
        Assert.Equal([tag, .. Enumerable.Range(1, ServerReminders.ConstantTimes - 1).Select(again => $"{tag}#{again}")],
            first.Reminders.Skip(1).Select(each => each.Tag));
        Assert.All(first.Reminders.Skip(1), each => Assert.Equal("Reminder for 2:00 PM", each.Body));

        // A reminder's own notification is left to the alarm set ahead.
        await store.AddAsync([Note("shared"), Note("reminder")], Token);
        var next = (await ben.GetFromJsonAsync<AppCheck>($"/api/app/check?after={first.Cursor}", Token))!;
        var news = Assert.Single(next.Notifications);
        Assert.Equal(("kim-k shared Home with you", "/lists/KL1"), (news.Body, news.Url));
        Assert.Empty((await ben.GetFromJsonAsync<AppCheck>($"/api/app/check?after={next.Cursor}", Token))!.Notifications);
    }

    [Fact]
    public async Task Complete_and_snooze_from_the_android_notification_write_the_task_for_every_device()
    {
        using var server = Server();
        var (ben, benId) = await SignIn(server, "ben-a");
        JsonObject Task(string id, string? parent, string? recurrence, string status = "open") => Entity(id, benId, new JsonObject
        {
            ["listId"] = "AL1",
            ["title"] = id,
            ["parentId"] = parent,
            ["status"] = status,
            ["assignees"] = new JsonObject(),
            ["recurrence"] = recurrence,
            ["schedule"] = new JsonObject { ["start"] = "2026-10-26T10:30", ["end"] = null, ["allDay"] = false, ["timeZone"] = null },
            ["reminders"] = new JsonArray(new JsonObject { ["before"] = 30 }),
            ["notes"] = $"notes of {id}",
            ["tags"] = new JsonObject { ["TG1"] = new JsonObject { ["in"] = true, ["hlc"] = "2026-10-24T10:00:00.000Z-0000-dev1" } },
        });
        (await ben.PostAsJsonAsync("/api/sync", new
        {
            schemaVersion = WorkspaceSchema.CurrentVersion,
            cursor = (long?)null,
            changes = new object[]
            {
                new { collection = "lists", entity = Entity("AL1", benId, new JsonObject { ["name"] = "Home", ["visibility"] = "private" }) },
                new { collection = "tasks", entity = Task("AT1", null, null) },
                new { collection = "tasks", entity = Task("AT2", "AT1", null) },
                new { collection = "tasks", entity = Task("AT3", null, "FREQ=DAILY;COUNT=3") },
                new { collection = "tasks", entity = Task("AT4", "AT3", null, status: "done") },
            },
        }, Token)).EnsureSuccessStatusCode();

        (await ben.PostAsJsonAsync("/api/reminders/act", new { taskId = "AT1", first = 0L, action = "complete" }, Token)).EnsureSuccessStatusCode();
        // A repeating task moves to its next date, as the app moves it, without the app.
        (await ben.PostAsJsonAsync("/api/reminders/act", new { taskId = "AT3", first = 0L, action = "complete" }, Token)).EnsureSuccessStatusCode();
        var before = DateTimeOffset.UtcNow;
        (await ben.PostAsJsonAsync("/api/reminders/act", new { taskId = "AT3", first = 0L, action = "snooze", minutes = 60 }, Token)).EnsureSuccessStatusCode();

        var synced = await (await ben.PostAsJsonAsync("/api/sync", new
        {
            schemaVersion = WorkspaceSchema.CurrentVersion,
            cursor = (long?)null,
            changes = Array.Empty<object>(),
        }, Token)).Content.ReadFromJsonAsync<JsonObject>(Token);
        var tasks = synced!["changes"]!.AsArray().Select(each => each!["entity"]!.AsObject()).ToDictionary(each => (string)each["id"]!);
        Assert.Equal(("done", benId), ((string?)tasks["AT1"]["status"], (string?)tasks["AT1"]["completedBy"]));
        Assert.Equal("done", (string?)tasks["AT2"]["status"]);
        Assert.Equal("open", (string?)tasks["AT3"]["status"]);
        Assert.Equal(("2026-10-27T10:30", "FREQ=DAILY;COUNT=2"), ((string?)tasks["AT3"]["schedule"]!["start"], (string?)tasks["AT3"]["recurrence"]));
        Assert.Equal("open", (string?)tasks["AT4"]["status"]);
        // The occurrence done stays in history: a closed copy on the old date, not repeating.
        var copy = Assert.Single(tasks.Values, each => (string?)each["title"] == "AT3" && (string?)each["id"] != "AT3");
        Assert.Equal(("done", benId, "2026-10-26T10:30", null), ((string?)copy["status"], (string?)copy["completedBy"],
            (string?)copy["schedule"]!["start"], (string?)copy["recurrence"]));
        Assert.Equal("notes of AT3", (string?)copy["notes"]);
        Assert.True((bool?)copy["tags"]!["TG1"]!["in"]);
        // The server keeps only some fields of a task in memory; what it writes merges onto the
        // stored copy, so the rest stays (audit P1).
        Assert.All(["AT1", "AT2", "AT3", "AT4"], id => Assert.Equal($"notes of {id}", (string?)tasks[id]["notes"]));
        Assert.True((bool?)tasks["AT3"]["tags"]!["TG1"]!["in"]);
        // Snoozed an hour for Ben: the task keeps its own reminders, and the app's next check sets it.
        Assert.Single(tasks["AT3"]["reminders"]!.AsArray());
        var check = (await ben.GetFromJsonAsync<AppCheck>("/api/app/check", Token))!;
        var snoozed = Assert.Single(check.Reminders, each => each.Tag.StartsWith("AT3@", StringComparison.Ordinal));
        Assert.Equal($"AT3@{snoozed.At}", snoozed.Tag);
        Assert.InRange((DateTimeOffset.FromUnixTimeMilliseconds(snoozed.At) - before.AddMinutes(60)).TotalMinutes, -1.5, 1.5);
    }

    [Fact]
    public async Task A_snooze_on_a_shared_task_is_only_for_the_person_who_snoozed()
    {
        using var server = Server();
        var (sam, samId) = await SignIn(server, "sam-z");
        var (ben, benId) = await SignIn(server, "ben-z");
        await server.BefriendAsync(samId, benId);
        const string stamp = "2026-10-24T10:00:00.000Z-0000-dev1";
        var task = Entity("ZT1", samId, new JsonObject
        {
            ["listId"] = "ZL1",
            ["title"] = "Bins",
            ["parentId"] = null,
            ["status"] = "open",
            ["assignees"] = new JsonObject
            {
                [$"user:{samId}"] = new JsonObject { ["in"] = true, ["hlc"] = stamp },
                [$"user:{benId}"] = new JsonObject { ["in"] = true, ["hlc"] = stamp },
            },
            ["reminders"] = new JsonArray(new JsonObject { ["at"] = "2026-10-26T09:00" }),
        });
        (await sam.PostAsJsonAsync("/api/sync", new
        {
            schemaVersion = WorkspaceSchema.CurrentVersion,
            cursor = (long?)null,
            changes = new object[]
            {
                new { collection = "lists", entity = Entity("ZL1", samId, new JsonObject { ["name"] = "Chores", ["visibility"] = "shared" }) },
                new { collection = "listMembers", entity = Entity("ZM1", samId, new JsonObject { ["listId"] = "ZL1", ["principal"] = $"user:{benId}", ["role"] = "editor" }) },
                new { collection = "tasks", entity = task },
            },
        }, Token)).EnsureSuccessStatusCode();

        (await ben.PostAsJsonAsync("/api/reminders/act", new { taskId = "ZT1", first = 0L, action = "snooze", minutes = 30 }, Token)).EnsureSuccessStatusCode();
        var snooze = Assert.Single((await ben.GetFromJsonAsync<List<SnoozedReminder>>("/api/reminders/snoozes", Token))!);
        Assert.Empty((await sam.GetFromJsonAsync<List<SnoozedReminder>>("/api/reminders/snoozes", Token))!);
        var at = DateTimeOffset.FromUnixTimeMilliseconds(snooze.At);
        // Only the reminder counts here (the share sent Ben its own notices).
        await Pushed(server);
        push.Sent.Clear();
        await server.Services.GetRequiredService<ReminderSender>().SendDueAsync(at.AddMinutes(-1), at.AddMinutes(1), Token);
        var sent = Assert.Single(push.Sent);
        Assert.Equal((benId, $"ZT1@{snooze.At}"), (sent.UserId, sent.Payload.Tag));
        Assert.Single((await ben.GetFromJsonAsync<NotificationFeed>("/api/notifications", Token))!.Items, each => each.Kind == "reminder");
        Assert.DoesNotContain((await sam.GetFromJsonAsync<NotificationFeed>("/api/notifications", Token))!.Items, each => each.Kind == "reminder");
        Assert.Empty((await sam.GetFromJsonAsync<AppCheck>("/api/app/check", Token))!.Reminders);

        // Once Ben is no longer on it, a snooze of his does not come.
        (await ben.PostAsJsonAsync("/api/reminders/act", new { taskId = "ZT1", first = 0L, action = "snooze", minutes = 90 }, Token)).EnsureSuccessStatusCode();
        var later = DateTimeOffset.FromUnixTimeMilliseconds(
            (await ben.GetFromJsonAsync<List<SnoozedReminder>>("/api/reminders/snoozes", Token))!.Max(each => each.At));
        var unassigned = task.DeepClone().AsObject();
        unassigned["assignees"]![$"user:{benId}"] = new JsonObject { ["in"] = false, ["hlc"] = "2026-10-24T11:00:00.000Z-0000-dev1" };
        (await sam.PostAsJsonAsync("/api/sync", new
        {
            schemaVersion = WorkspaceSchema.CurrentVersion,
            cursor = (long?)null,
            changes = new object[] { new { collection = "tasks", entity = unassigned } },
        }, Token)).EnsureSuccessStatusCode();
        Assert.Empty((await ben.GetFromJsonAsync<List<SnoozedReminder>>("/api/reminders/snoozes", Token))!);
        await Pushed(server);
        push.Sent.Clear();
        await server.Services.GetRequiredService<ReminderSender>().SendDueAsync(later.AddMinutes(-1), later.AddMinutes(1), Token);
        Assert.Empty(push.Sent);
    }

    [Fact]
    public async Task A_slow_push_service_does_not_hold_up_the_sync_that_notifies()
    {
        using var server = Server();
        var (_, benId) = await SignIn(server, "ben-q");
        var (sam, samId) = await SignIn(server, "sam-q");
        await server.BefriendAsync(samId, benId);
        await Pushed(server);
        push.Hold = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        var list = Entity("QL1", samId, new JsonObject { ["name"] = "Errands", ["visibility"] = "shared" });
        var member = Entity("QM1", samId, new JsonObject { ["listId"] = "QL1", ["principal"] = $"user:{benId}", ["role"] = "editor" });
        var shared = sam.PostAsJsonAsync("/api/sync", new
        {
            schemaVersion = WorkspaceSchema.CurrentVersion,
            cursor = (long?)null,
            changes = new object[]
            {
                new { collection = "lists", entity = list },
                new { collection = "listMembers", entity = member },
            },
        }, Token);
        // The sync answers while Ben's push is still waiting on the push service.
        var answered = await Task.WhenAny(shared, Task.Delay(TimeSpan.FromSeconds(10), Token));
        Assert.Same(shared, answered);
        (await shared).EnsureSuccessStatusCode();
        Assert.Empty(push.Sent);

        push.Hold.SetResult();
        await Pushed(server);
        Assert.Equal(["sam-q shared Errands with you"], push.Sent.Where(each => each.UserId == benId).Select(each => each.Payload.Body));
    }

    [Fact]
    public async Task A_push_that_never_answers_for_one_person_does_not_stop_another_persons()
    {
        using var server = Server();
        var (_, benId) = await SignIn(server, "ben-h");
        var (_, kimId) = await SignIn(server, "kim-h");
        var (sam, samId) = await SignIn(server, "sam-h");
        await server.BefriendAsync(samId, benId);
        await server.BefriendAsync(samId, kimId);
        await Pushed(server);
        server.Services.GetRequiredService<BackgroundQueue>().Limit = TimeSpan.FromSeconds(1);
        push.Hung.Add(benId);

        // One change tells both, Ben first.
        (await sam.PostAsJsonAsync("/api/sync", new
        {
            schemaVersion = WorkspaceSchema.CurrentVersion,
            cursor = (long?)null,
            changes = new object[]
            {
                new { collection = "lists", entity = Entity("HL1", samId, new JsonObject { ["name"] = "Errands", ["visibility"] = "shared" }) },
                new { collection = "listMembers", entity = Entity("HM1", samId, new JsonObject { ["listId"] = "HL1", ["principal"] = $"user:{benId}", ["role"] = "editor" }) },
                new { collection = "listMembers", entity = Entity("HM2", samId, new JsonObject { ["listId"] = "HL1", ["principal"] = $"user:{kimId}", ["role"] = "editor" }) },
            },
        }, Token)).EnsureSuccessStatusCode();
        await Pushed(server);

        Assert.Equal(["sam-h shared Errands with you"], push.Sent.Where(each => each.UserId == kimId).Select(each => each.Payload.Body));
        Assert.DoesNotContain(push.Sent, each => each.UserId == benId);
    }

    [Fact]
    public async Task A_kind_switched_off_in_settings_is_recorded_but_neither_pushed_nor_handed_to_the_app()
    {
        using var server = Server();
        var (ben, benId) = await SignIn(server, "ben-s");
        var (sam, samId) = await SignIn(server, "sam-s");
        // Ben hears of assignments in the feed only (PL-115).
        var settings = Entity("SET-S", benId, new JsonObject
        {
            ["userId"] = benId,
            ["themeMode"] = "system",
            ["palette"] = new JsonObject(),
            ["pointEventMinutes"] = 30,
            ["dueSoonDays"] = 2,
            ["sidebar"] = new JsonObject { ["order"] = new JsonArray(), ["hidden"] = new JsonArray(), ["groupOpen"] = false },
            ["notifications"] = new JsonObject { ["assignments"] = false },
        });
        (await ben.PostAsJsonAsync("/api/sync", new
        {
            schemaVersion = WorkspaceSchema.CurrentVersion,
            cursor = (long?)null,
            changes = new object[] { new { collection = "settings", entity = settings } },
        }, Token)).EnsureSuccessStatusCode();
        // The app's first check only notes where things stand.
        var first = (await ben.GetFromJsonAsync<AppCheck>("/api/app/check", Token))!;

        await server.BefriendAsync(samId, benId);
        var list = Entity("SL1", samId, new JsonObject { ["name"] = "Chores", ["visibility"] = "shared" });
        var member = Entity("SM1", samId, new JsonObject { ["listId"] = "SL1", ["principal"] = $"user:{benId}", ["role"] = "editor" });
        var task = Entity("ST1", samId, new JsonObject
        {
            ["listId"] = "SL1",
            ["title"] = "Bins",
            ["parentId"] = null,
            ["assignees"] = new JsonObject
            {
                [$"user:{benId}"] = new JsonObject { ["in"] = true, ["hlc"] = "2026-10-24T10:00:00.000Z-0000-dev1" },
            },
        });
        (await sam.PostAsJsonAsync("/api/sync", new
        {
            schemaVersion = WorkspaceSchema.CurrentVersion,
            cursor = (long?)null,
            changes = new object[]
            {
                new { collection = "lists", entity = list },
                new { collection = "listMembers", entity = member },
                new { collection = "tasks", entity = task },
            },
        }, Token)).EnsureSuccessStatusCode();

        // The share went out (shares are on); the assignment did not.
        await Pushed(server);
        Assert.Equal(["sam-s shared Chores with you"], push.Sent.Where(each => each.UserId == benId).Select(each => each.Payload.Body));
        var check = (await ben.GetFromJsonAsync<AppCheck>($"/api/app/check?after={first.Cursor}", Token))!;
        Assert.Equal(["sam-s shared Chores with you"], check.Notifications.Select(each => each.Body));
        // The feed still lists both: the switch is about interruptions, not the record.
        var feed = (await ben.GetFromJsonAsync<NotificationFeed>("/api/notifications", Token))!;
        Assert.Equal(["assigned", "shared"], feed.Items.Select(each => each.Kind).Order());
    }

    [Fact]
    public void Reminders_use_the_settings_a_person_wrote_last_and_never_someone_elses()
    {
        var index = new Core.Sharing.SharingIndex();
        void Put(string id, string owner, string userId, string clock, string format) =>
            index.Apply(new Core.Storage.StoredEntity("settings", id, owner, 0, new JsonObject
            {
                ["id"] = id,
                ["userId"] = userId,
                ["clockFormat"] = format,
                ["deletedAt"] = null,
                ["_hlc"] = new JsonObject { ["clockFormat"] = clock },
            }));
        // Ben's device made settings before the account had any (C7), and Sam wrote one naming Ben (S3).
        Put("SB2", "UBEN", "UBEN", "2026-10-22T10:00:00.000Z-0000-dev1", "24h");
        Put("SB1", "UBEN", "UBEN", "2026-10-21T10:00:00.000Z-0000-dev1", "12h");
        Put("SS1", "USAM", "UBEN", "2026-10-23T10:00:00.000Z-0000-dev2", "12h");
        Assert.Equal("24h", (string?)ReminderSender.SettingsOf(index, "UBEN")?["clockFormat"]);
        Assert.Null(ReminderSender.SettingsOf(index, "USAM"));
    }
}
