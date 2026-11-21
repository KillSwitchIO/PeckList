using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using PeckList.Core;
using PeckList.Core.Accounts;
using PeckList.Core.Mail;
using PeckList.Core.Notifications;
using PeckList.Core.Push;
using PeckList.Core.Sharing;
using PeckList.Core.Text;
using PeckList.Server.Push;
using PeckList.Server.Text;

namespace PeckList.Server.Tests;

/// <summary>
/// The server's own text in the person's language (PL-148), checked in the pseudo-language: every
/// word of a reminder, a notification, a check-in and an email goes through the catalog, and the
/// language follows the person's pick, else the device's, else English.
/// </summary>
public sealed class ServerTextTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private static readonly JsonTextCatalog Pseudo = new(new Dictionary<string, IReadOnlyDictionary<string, string>>
    {
        [JsonTextCatalog.Source] = JsonTextCatalog.Embedded.EnglishMessages,
        [PseudoLocale.Tag] = PseudoLocale.Of(JsonTextCatalog.Embedded.EnglishMessages),
    });

    private static readonly Words XA = new(Pseudo, PseudoLocale.Tag);

    private static readonly TimeZoneInfo Chicago = TimeZoneInfo.FindSystemTimeZoneById("America/Chicago");

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    /// <summary>Records each device's payload, worded for the languages that device subscribed with.</summary>
    private sealed class FakePush : IPushSender
    {
        public IPushStore? Store { get; set; }

        public List<(string UserId, string? Languages, PushPayload Payload)> Sent { get; } = [];

        public Task SendAsync(string userId, PushPayload payload, CancellationToken cancellation = default) =>
            SendAsync(userId, _ => payload, cancellation);

        /// <summary>Set: sending waits for it, as for a slow push service.</summary>
        public TaskCompletionSource? Hold { get; set; }

        public async Task SendAsync(string userId, Func<string?, PushPayload> payloadFor, CancellationToken cancellation = default)
        {
            if (Hold is { } hold) await hold.Task.WaitAsync(cancellation);
            foreach (var device in await Store!.ForUserAsync(userId, cancellation))
            {
                lock (Sent) Sent.Add((userId, device.Languages, payloadFor(device.Languages)));
            }
        }
    }

    private readonly FakePush push = new();

    private WebApplicationFactory<Program> Server()
    {
        var server = fixture.Factory(("ADMIN_PASSWORD", "correct horse battery"))
            .WithWebHostBuilder(host => host.ConfigureTestServices(services =>
            {
                services.AddSingleton<IPushSender>(push);
                services.AddSingleton<ITextCatalog>(Pseudo);
            }));
        push.Store = server.Services.GetRequiredService<IPushStore>();
        return server;
    }

    private static async Task<(HttpClient Client, string Id)> SignIn(WebApplicationFactory<Program> server, string username)
    {
        var accounts = server.Services.GetRequiredService<AccountService>();
        const string password = "a long enough password";
        var account = await accounts.CreateUserAsync(username, password, mustChangePassword: false, cancellation: Token);
        var client = server.CreateClient();
        (await client.PostAsJsonAsync("/auth/login", new { username, password }, Token)).EnsureSuccessStatusCode();
        return (client, account.Id);
    }

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

    private static async Task SyncAsync(HttpClient client, string? zone, params (string Collection, JsonObject Entity)[] changes) =>
        (await client.PostAsJsonAsync("/api/sync", new
        {
            schemaVersion = WorkspaceSchema.CurrentVersion,
            cursor = (long?)null,
            changes = changes.Select(each => new { collection = each.Collection, entity = each.Entity }).ToArray(),
            zone,
        }, Token)).EnsureSuccessStatusCode();

    private static async Task SubscribeAsync(HttpClient client, string endpoint, string? acceptLanguage)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/push/subscriptions")
        {
            Content = JsonContent.Create(new { endpoint, keys = new { p256dh = "p", auth = "a" } }),
        };
        if (acceptLanguage is not null) request.Headers.TryAddWithoutValidation("Accept-Language", acceptLanguage);
        (await client.SendAsync(request, Token)).EnsureSuccessStatusCode();
    }

    private static async Task<AppCheck> CheckAsync(HttpClient client, string query, string? acceptLanguage)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/app/check" + query);
        if (acceptLanguage is not null) request.Headers.TryAddWithoutValidation("Accept-Language", acceptLanguage);
        var response = await client.SendAsync(request, Token);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<AppCheck>(Token))!;
    }

    private static void AllTranslated(string text) =>
        Assert.False(PseudoLocale.HasPlainLetters(text), $"English left in: {text}");

    [Theory]
    // Shown at 5:00 AM on Thursday 2026-11-19 in Chicago: every shape a reminder's body takes.
    [InlineData("due", "2026-11-19T15:00", null, null)]
    [InlineData("schedule", "2026-11-19T15:00", null, null)]
    [InlineData("due", "2026-11-19T15:00", "24h", null)]
    [InlineData("due", "2026-11-20T06:00", null, null)]
    [InlineData("due", "2026-11-18T06:00", null, null)]
    [InlineData("due", "2026-11-26T06:00", null, null)]
    [InlineData("due", "2026-11-26T06:00", null, "DD/MM/YYYY")]
    [InlineData("schedule", "2027-01-04T09:30", null, null)]
    [InlineData("due", "2026-11-19", null, null)]
    [InlineData("due", "2026-11-20", null, null)]
    [InlineData("due", "2026-11-18", null, null)]
    [InlineData("schedule", "2026-11-23", null, null)]
    [InlineData(null, null, null, null)]
    public void Every_reminder_body_is_worded_by_the_catalog(string? field, string? at, string? clock, string? dateFormat)
    {
        var task = new JsonObject { ["reminders"] = new JsonArray(new JsonObject { ["before"] = 1440 }) };
        if (field is not null)
        {
            task[field] = field == "due"
                ? new JsonObject { ["at"] = at, ["allDay"] = at!.Length == 10, ["timeZone"] = "America/Chicago" }
                : new JsonObject { ["start"] = at, ["end"] = null, ["allDay"] = at!.Length == 10, ["timeZone"] = "America/Chicago" };
        }
        var settings = new JsonObject { ["clockFormat"] = clock, ["dateFormat"] = dateFormat };
        var shown = new DateTimeOffset(2026, 11, 19, 11, 0, 0, TimeSpan.Zero);
        var body = ReminderSender.BodyOf(task, shown, Chicago, settings, XA);
        AllTranslated(body);
        Assert.NotEqual(body, ReminderSender.BodyOf(task, shown, Chicago, settings));
    }

    [Fact]
    public void Every_notification_and_its_buttons_are_worded_by_the_catalog()
    {
        var index = new SharingIndex();
        string[] kinds =
        [
            NotificationKind.Assigned, NotificationKind.Shared, NotificationKind.Mentioned, NotificationKind.Commented,
            NotificationKind.CommentEdited, NotificationKind.GroupAssigned, NotificationKind.Claimed,
        ];
        foreach (var kind in kinds)
        {
            var each = new Notification
            {
                Id = "N1", UserId = "U1", Kind = kind, At = DateTimeOffset.UnixEpoch,
                TaskId = kind == NotificationKind.Shared ? null : "T1", ListId = "L1", CommentId = kind == NotificationKind.Commented ? "C1" : null,
            };
            // No name for the actor, the task or the list: the catalog's own words stand in.
            var (body, url) = NotificationText.Of(each, null, index, XA);
            AllTranslated(body);
            foreach (var action in NotificationText.ActionsOf(each, url, XA).Where(action => action.Action != "like"))
            {
                AllTranslated(action.Title);
            }
        }
    }

    [Fact]
    public void Every_email_is_worded_by_the_catalog()
    {
        // Values with no letters, so any letter left is the template's own.
        OutgoingMail[] mails =
        [
            MailTemplates.Reset("1@2.3", "10.0.0.1", "007", "/1/2", TimeSpan.FromMinutes(30), XA),
            MailTemplates.Reset("1@2.3", "10.0.0.1", "007", "/1/2", TimeSpan.FromHours(24), XA),
            MailTemplates.Confirm("1@2.3", "10.0.0.1", "007", "/1/2", XA),
            MailTemplates.Invite("1@2.3", "10.0.0.1", "42", "/1/2", new DateTimeOffset(2026, 11, 26, 12, 0, 0, TimeSpan.Zero), XA),
            MailTemplates.Test("1@2.3", "10.0.0.1", XA),
        ];
        foreach (var mail in mails)
        {
            AllTranslated(mail.Subject);
            AllTranslated(mail.Text);
        }
        // The plural follows the count, in either language.
        Assert.Contains("30", mails[0].Text);
        Assert.Contains("24", mails[1].Text);
        Assert.Contains("30 minutes", MailTemplates.Reset("a@b.c", "x", "u", "/l", TimeSpan.FromMinutes(30)).Text);
        Assert.Contains("2 hours", MailTemplates.Reset("a@b.c", "x", "u", "/l", TimeSpan.FromHours(2)).Text);
    }

    [Fact]
    public async Task A_subscription_keeps_the_languages_its_browser_asked_for()
    {
        using var server = Server();
        var (ben, benId) = await SignIn(server, "ben-t1");
        await SubscribeAsync(ben, "https://push.example/de", "de-DE,de;q=0.9,*;q=0.1,fr;q=0");
        await SubscribeAsync(ben, "https://push.example/none", null);
        var store = server.Services.GetRequiredService<IPushStore>();
        var devices = (await store.ForUserAsync(benId, Token)).ToDictionary(each => each.Endpoint, each => each.Languages);
        Assert.Equal("de-DE,de", devices["https://push.example/de"]);
        Assert.Null(devices["https://push.example/none"]);

        // Subscribing again from a browser now set to another language takes the new one.
        await SubscribeAsync(ben, "https://push.example/de", "en-XA");
        Assert.Equal("en-XA", (await store.ForUserAsync(benId, Token)).Single(each => each.Endpoint == "https://push.example/de").Languages);
    }

    [Fact]
    public async Task A_reminder_push_is_worded_for_each_device_in_its_own_language()
    {
        using var server = Server();
        var (ben, benId) = await SignIn(server, "ben-t2");
        await SubscribeAsync(ben, "https://push.example/pseudo", "en-XA");
        await SubscribeAsync(ben, "https://push.example/plain", null);
        await SyncAsync(ben, "Asia/Tokyo",
            ("lists", Entity("TL1", benId, new JsonObject { ["name"] = "Home", ["visibility"] = "private" })),
            ("tasks", Entity("TT1", benId, new JsonObject
            {
                ["listId"] = "TL1",
                ["title"] = "",
                ["parentId"] = null,
                ["status"] = "open",
                ["assignees"] = new JsonObject(),
                ["reminders"] = new JsonArray(new JsonObject { ["at"] = "2026-10-26T09:00" }),
            })));

        var due = new DateTimeOffset(2026, 10, 26, 0, 0, 0, TimeSpan.Zero);
        await server.Services.GetRequiredService<ReminderSender>().SendDueAsync(due.AddMinutes(-1), due.AddMinutes(1), Token);
        var sent = push.Sent.ToDictionary(each => each.Languages ?? "", each => each.Payload);
        Assert.Equal(("Untitled task", "Reminder"), (sent[""].Title, sent[""].Body));
        AllTranslated(sent["en-XA"].Title);
        AllTranslated(sent["en-XA"].Body);
        Assert.Equal(XA["reminder.complete"], Assert.Single(sent["en-XA"].Actions ?? [], each => each.Action == "complete").Title);
    }

    [Fact]
    public async Task A_notification_push_is_worded_for_each_device_in_its_own_language()
    {
        using var server = Server();
        var (sam, samId) = await SignIn(server, "sam-t3");
        var (ben, benId) = await SignIn(server, "ben-t3");
        await SubscribeAsync(ben, "https://push.example/pseudo", "fr-FR, en-XA;q=0.8");
        await SubscribeAsync(ben, "https://push.example/plain", "fr-FR");
        await server.BefriendAsync(samId, benId);
        await server.Services.GetRequiredService<BackgroundQueue>().IdleAsync(Token);
        push.Sent.Clear();
        await SyncAsync(sam, null,
            ("lists", Entity("TL3", samId, new JsonObject { ["name"] = "Chores", ["visibility"] = "shared" })),
            ("listMembers", Entity("TM3", samId, new JsonObject { ["listId"] = "TL3", ["principal"] = $"user:{benId}", ["role"] = "editor" })));
        await server.Services.GetRequiredService<BackgroundQueue>().IdleAsync(Token);

        var sent = push.Sent.Where(each => each.UserId == benId).ToDictionary(each => each.Languages!, each => each.Payload);        Assert.Equal("sam-t3 shared Chores with you", sent["fr-FR"].Body);
        // Kept as "fr-FR,en-XA": French has no catalog, so the next language the browser asked for.
        Assert.Equal(XA.Get("notify.shared", ("actor", "sam-t3"), ("list", "Chores")), sent["fr-FR,en-XA"].Body);
        Assert.Equal(XA["notify.openList"], Assert.Single(sent["fr-FR,en-XA"].Actions!).Title);
    }

    [Fact]
    public async Task A_notification_push_names_the_list_as_it_was_when_the_notification_came()
    {
        using var server = Server();
        var (sam, samId) = await SignIn(server, "sam-t7");
        var (ben, benId) = await SignIn(server, "ben-t7");
        await SubscribeAsync(ben, "https://push.example/plain", null);
        await server.BefriendAsync(samId, benId);
        await server.Services.GetRequiredService<BackgroundQueue>().IdleAsync(Token);
        push.Sent.Clear();
        push.Hold = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        await SyncAsync(sam, null,
            ("lists", Entity("TL7", samId, new JsonObject { ["name"] = "Chores", ["visibility"] = "shared" })),
            ("listMembers", Entity("TM7", samId, new JsonObject { ["listId"] = "TL7", ["principal"] = $"user:{benId}", ["role"] = "editor" })));
        // Renamed while the push still waits on the push service.
        var renamed = Entity("TL7", samId, new JsonObject { ["name"] = "Errands", ["visibility"] = "shared" });
        renamed["_hlc"]!["name"] = "2026-10-24T10:05:00.000Z-0000-dev1";
        await SyncAsync(sam, null, ("lists", renamed));

        push.Hold.SetResult();
        await server.Services.GetRequiredService<BackgroundQueue>().IdleAsync(Token);
        Assert.Equal("sam-t7 shared Chores with you", Assert.Single(push.Sent, each => each.UserId == benId).Payload.Body);
    }

    [Fact]
    public async Task The_check_in_is_worded_in_the_phones_language()
    {
        using var server = Server();
        var (sam, samId) = await SignIn(server, "sam-t4");
        var (ben, benId) = await SignIn(server, "ben-t4");
        var local = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, Chicago).Date.AddDays(2).AddHours(14);
        await SyncAsync(ben, "America/Chicago",
            ("lists", Entity("TL4", benId, new JsonObject { ["name"] = "Home", ["visibility"] = "private" })),
            ("tasks", Entity("TT4", benId, new JsonObject
            {
                ["listId"] = "TL4",
                ["title"] = "",
                ["parentId"] = null,
                ["status"] = "open",
                ["assignees"] = new JsonObject(),
                ["reminders"] = new JsonArray(new JsonObject { ["at"] = local.ToString("yyyy-MM-dd'T'HH:mm") }),
            })));
        var first = await CheckAsync(ben, "?zone=America/Chicago", "en-XA,en;q=0.5");
        var reminder = Assert.Single(first.Reminders);
        AllTranslated(reminder.Title);
        AllTranslated(reminder.Body);
        var english = Assert.Single((await CheckAsync(ben, "?zone=America/Chicago", "de-DE")).Reminders);
        Assert.Equal(("Untitled task", "Reminder"), (english.Title, english.Body));

        var store = server.Services.GetRequiredService<INotificationStore>();
        await store.AddAsync([new Notification { Id = Ids.NewUlid(), UserId = benId, Kind = "shared", At = DateTimeOffset.UtcNow, ActorId = samId, ListId = "TL4" }], Token);
        var news = Assert.Single((await CheckAsync(ben, $"?after={first.Cursor}&reminders=0", "en-XA")).Notifications);
        Assert.Equal(XA.Get("notify.shared", ("actor", "sam-t4"), ("list", "Home")), news.Body);
        Assert.Equal(XA["notify.openList"], Assert.Single(news.Actions).Title);
    }

    [Fact]
    public async Task A_picked_language_wins_over_every_device_and_one_without_a_catalog_leaves_it_to_the_device()
    {
        using var server = Server();
        var (ben, benId) = await SignIn(server, "ben-t6");
        await SubscribeAsync(ben, "https://push.example/german", "de-DE");
        JsonObject Settings(string? language) => Entity("TS6", benId, new JsonObject
        {
            ["userId"] = benId,
            ["themeMode"] = "system",
            ["palette"] = new JsonObject(),
            ["pointEventMinutes"] = 30,
            ["dueSoonDays"] = 2,
            ["sidebar"] = new JsonObject { ["order"] = new JsonArray(), ["hidden"] = new JsonArray(), ["groupOpen"] = false },
            ["language"] = language,
        });
        // Synced from Settings > Language (schema 20, piece 4).
        await SyncAsync(ben, "Asia/Tokyo",
            ("settings", Settings("en-XA")),
            ("lists", Entity("TL6", benId, new JsonObject { ["name"] = "Home", ["visibility"] = "private" })),
            ("tasks", Entity("TT6", benId, new JsonObject
            {
                ["listId"] = "TL6",
                ["title"] = "",
                ["parentId"] = null,
                ["status"] = "open",
                ["assignees"] = new JsonObject(),
                ["reminders"] = new JsonArray(new JsonObject { ["at"] = "2026-10-26T09:00" }),
            })));

        var due = new DateTimeOffset(2026, 10, 26, 0, 0, 0, TimeSpan.Zero);
        await server.Services.GetRequiredService<ReminderSender>().SendDueAsync(due.AddMinutes(-1), due.AddMinutes(1), Token);
        AllTranslated(Assert.Single(push.Sent).Payload.Body);
        var words = server.Services.GetRequiredService<ServerWords>();
        Assert.Equal(PseudoLocale.Tag, words.For(benId, ["de-DE"]).Language);

        // A language the server has no catalog for is automatic here: the device's, else English.
        var stamp = "2026-10-24T10:05:00.000Z-0000-dev1";
        var italian = Settings("it");
        italian["_hlc"]!["language"] = stamp;
        await SyncAsync(ben, null, ("settings", italian));
        Assert.Equal(PseudoLocale.Tag, words.For(benId, ["en-XA"]).Language);
        Assert.Equal(JsonTextCatalog.Source, words.For(benId, ["de-DE"]).Language);
    }

    [Fact]
    public async Task Server_words_follow_the_device_for_someone_with_no_pick()
    {
        using var server = Server();
        var (_, benId) = await SignIn(server, "ben-t5");
        var words = server.Services.GetRequiredService<ServerWords>();
        Assert.Equal(PseudoLocale.Tag, words.For(benId, ["de", "en-XA"]).Language);
        Assert.Equal(JsonTextCatalog.Source, words.For(benId, ["de"]).Language);
        Assert.Equal(PseudoLocale.Tag, words.For(null, ["en-XA"]).Language);
        Assert.Equal(JsonTextCatalog.Source, words.For(null).Language);
    }
}
