using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using PeckList.Core.Accounts;
using PeckList.Core.Api;
using static PeckList.Server.Tests.TaskApiWorld;

namespace PeckList.Server.Tests;

/// <summary>
/// Quick add through the task API (PL-137) on SQLite and PostgreSQL: a line read as the app reads it
/// (the grammar itself is pinned by the shared cases in PeckList.Core.Tests), made into a task.
/// </summary>
public sealed class TaskApiQuickAddTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private static async Task<JsonObject> Expect(HttpClient client, object body, HttpStatusCode expected)
    {
        var response = await client.PostAsJsonAsync("/api/v1/tasks/quick", body, Token);
        var text = await response.Content.ReadAsStringAsync(Token);
        Assert.True(response.StatusCode == expected, $"{(int)response.StatusCode} {text}");
        return text.Length == 0 ? [] : JsonNode.Parse(text)!.AsObject();
    }

    private static string[] Strings(JsonNode? array) => [.. array!.AsArray().Select(item => (string)item!)];

    private static async Task<(TaskApiWorld World, Person Ben, Person Sam)> Start(ServerFixture fixture, string kind)
    {
        var world = await StartAsync(fixture, kind);
        var ben = await world.PersonAsync("ben");
        var sam = await world.PersonAsync("sam");
        await world.BefriendAsync(ben, sam);
        // Profiles are written on first use.
        (await sam.Session.GetAsync("/api/v1/me", Token)).EnsureSuccessStatusCode();
        await PushAsync(ben, List("IN", "Inbox", inbox: true), List("L1", "Home"), List("L2", "Work Stuff"), Tag("G1", "home/yard"));
        return (world, ben, sam);
    }

    [Theory]
    [MemberData(nameof(Databases), MemberType = typeof(TaskApiWorld))]
    public async Task A_line_becomes_a_task_with_its_list_tags_priority_person_date_and_repeat(string kind)
    {
        var (world, ben, sam) = await Start(fixture, kind);
        using var _ = world;
        var text = "Renew passport 2026-12-01 ^work !high #yard #errands @sam every month";

        var answer = await Expect(ben.Session, new { id = "01JD00000000000000000000Q1", text, timeZone = "America/Chicago" }, HttpStatusCode.Created);
        var task = answer["task"]!;
        Assert.Equal("01JD00000000000000000000Q1", (string?)task["id"]);
        Assert.Equal("Renew passport", (string?)task["title"]);
        Assert.Equal("L2", (string?)task["listId"]);
        Assert.Equal(3, (int)task["priority"]!);
        // "#yard" is the existing home/yard; "#errands" is new.
        Assert.Equal(["errands", "home/yard"], Strings(task["tags"]));
        Assert.Equal([$"user:{sam.Id}"], Strings(task["assignees"]));
        Assert.Equal("2026-12-01", (string?)task["schedule"]!["start"]);
        Assert.True((bool)task["schedule"]!["allDay"]!);
        Assert.Equal("America/Chicago", (string?)task["schedule"]!["timeZone"]);
        Assert.Equal("FREQ=MONTHLY", (string?)task["recurrence"]);

        var tokens = answer["tokens"]!.AsArray();
        Assert.Equal(["date", "list", "priority", "tag", "tag", "person", "repeat"], tokens.Select(token => (string)token!["kind"]!).ToArray());
        foreach (var token in tokens)
        {
            var (start, end) = ((int)token!["start"]!, (int)token["end"]!);
            Assert.Equal(text[start..end], (string?)token["text"]);
        }

        // The same id again is the task as it is, not a second one.
        var again = await Expect(ben.Session, new { id = "01JD00000000000000000000Q1", text, timeZone = "America/Chicago" }, HttpStatusCode.OK);
        Assert.Equal("01JD00000000000000000000Q1", (string?)again["task"]!["id"]);
        var all = await ben.Session.GetFromJsonAsync<JsonObject>("/api/v1/tasks", Token);
        Assert.Single(all!["items"]!.AsArray());
    }

    [Theory]
    [MemberData(nameof(Databases), MemberType = typeof(TaskApiWorld))]
    public async Task Dates_are_read_on_the_persons_own_clock_and_a_due_word_sets_the_due_date(string kind)
    {
        var (world, ben, _) = await Start(fixture, kind);
        using var __ = world;
        const string zone = "Pacific/Kiritimati";
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, TimeZoneInfo.FindSystemTimeZoneById(zone)).DateTime);
        var tomorrow = today.AddDays(1).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

        var answer = await Expect(ben.Session, new { text = "Sweep due tomorrow 5pm", timeZone = zone, listId = "L1" }, HttpStatusCode.Created);
        var task = answer["task"]!;
        Assert.Equal("Sweep", (string?)task["title"]);
        Assert.Equal("L1", (string?)task["listId"]);
        Assert.Null(task["schedule"]);
        Assert.Equal($"{tomorrow}T17:00", (string?)task["due"]!["at"]);
        Assert.False((bool)task["due"]!["allDay"]!);
        Assert.Equal(zone, (string?)task["due"]!["timeZone"]);

        // Without a zone the account's is used; a ^list beats the listId sent.
        var plain = await Expect(ben.Session, new { text = "Call the bank ^home", listId = "L2" }, HttpStatusCode.Created);
        Assert.Equal("L1", (string?)plain["task"]!["listId"]);
        Assert.Equal("Call the bank", (string?)plain["task"]!["title"]);
    }

    [Theory]
    [MemberData(nameof(Databases), MemberType = typeof(TaskApiWorld))]
    public async Task Someone_you_cannot_assign_stays_in_the_title_and_bad_input_is_refused(string kind)
    {
        var (world, ben, _) = await Start(fixture, kind);
        using var _w = world;
        await world.PersonAsync("stranger");

        var answer = await Expect(ben.Session, new { text = "Ask @stranger about the fence" }, HttpStatusCode.Created);
        Assert.Equal("Ask @stranger about the fence", (string?)answer["task"]!["title"]);
        Assert.Empty(answer["task"]!["assignees"]!.AsArray());
        Assert.Empty(answer["tokens"]!.AsArray());

        Assert.Equal("text", Field(await Expect(ben.Session, new { text = "   " }, HttpStatusCode.BadRequest)));
        Assert.Equal("text", Field(await Expect(ben.Session, new { text = "!high tomorrow" }, HttpStatusCode.BadRequest)));
        Assert.Equal("text", Field(await Expect(ben.Session, new { text = new string('a', 1001) }, HttpStatusCode.BadRequest)));
        Assert.Equal("timeZone", Field(await Expect(ben.Session, new { text = "Mow", timeZone = "Mars/Olympus" }, HttpStatusCode.BadRequest)));
        Assert.Equal("title", Field(await Expect(ben.Session, new { text = "Mow", title = "x" }, HttpStatusCode.BadRequest)));
        Assert.Equal("listId", Field(await Expect(ben.Session, new { text = "Mow", listId = "NOPE" }, HttpStatusCode.BadRequest)));

        // A key needs tasks:write.
        var reader = await world.KeyAsync(ben, "tasks:read");
        Assert.Equal("scope", (string?)(await Expect(reader, new { text = "Mow" }, HttpStatusCode.Forbidden))["code"]);
        var writer = await world.KeyAsync(ben, "tasks:write");
        Assert.Equal("Mow", (string?)(await Expect(writer, new { text = "Mow" }, HttpStatusCode.Created))["task"]!["title"]);
    }

    [Fact]
    public async Task A_busy_quick_add_says_when_to_try_again()
    {
        using var world = await StartAsync(fixture, Sqlite);
        using var busy = world.Server.WithWebHostBuilder(host =>
            host.ConfigureTestServices(services => services.AddSingleton<IQuickAddReader>(new BusyReader())));
        await busy.Services.GetRequiredService<AccountService>()
            .CreateUserAsync("ben", "a long enough password", mustChangePassword: false, cancellation: Token);
        var client = busy.CreateClient();
        (await client.PostAsJsonAsync("/auth/login", new { username = "ben", password = "a long enough password" }, Token)).EnsureSuccessStatusCode();

        var response = await client.PostAsJsonAsync("/api/v1/tasks/quick", new { text = "Mow" }, Token);

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Equal(TimeSpan.FromSeconds(1), response.Headers.RetryAfter?.Delta);
        var problem = JsonNode.Parse(await response.Content.ReadAsStringAsync(Token))!;
        Assert.Equal("busy", (string?)problem["code"]);
        Assert.Equal("Busy", (string?)problem["title"]);
    }

    private sealed class BusyReader : IQuickAddReader
    {
        public Task<QuickAddResult> ReadAsync(string text, QuickAddContext context, CancellationToken cancellation = default) =>
            throw new QuickAddBusyException();
    }

    private static string? Field(JsonObject problem) => problem["errors"] is JsonObject errors ? errors.Select(pair => pair.Key).FirstOrDefault() : null;
}
