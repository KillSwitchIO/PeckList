using System.Text.Json.Nodes;

namespace PeckList.Client.Tests;

/// <summary>
/// The task list and task view (PL-142): a table people can read (names, a clear status, dates as
/// people say them, subtasks under their parent, short ids), filters that reach the API, and
/// everything about one task in <c>tasks show</c>.
/// </summary>
public sealed class TaskListTests
{
    private const string Server = "https://tasks.example.com";

    /// <summary>Thursday 12 November 2026, 15:00 UTC: "today" in these tests.</summary>
    private static readonly DateTimeOffset Now = new(2026, 11, 12, 15, 0, 0, TimeSpan.Zero);

    private static readonly DateOnly Today = new(2026, 11, 12);

    private const string Roses = "01JD00000000000000004QH7ZK";
    private const string Hose = "01JD0000000000000000VX2M0D";
    private const string Milk = "01JD00000000000000009KD3TA";
    private const string Gate = "01JD0000000000000000F0PB8W";
    private const string Report = "01JD0000000000000000J3N9VE";

    private static async Task<MemoryTokenStore> SignedInAsync()
    {
        var store = new MemoryTokenStore();
        await store.SaveAsync("default", new CliProfile(Server, "pl_test_key", "K1", "ben"), Cli.Token);
        return store;
    }

    private static string Tasks(params string[] items) => $$"""{"items":[{{string.Join(',', items)}}],"next":null}""";

    private static readonly string[] Five =
    [
        $$"""{"id":"{{Roses}}","title":"Water the roses","status":"open","priority":3,"due":{"at":"2026-11-12T09:00","allDay":false,"timeZone":"UTC"},"schedule":null,"listId":"L1","listName":"Yard","sectionName":null,"parentId":null,"tags":["garden"],"assignees":[],"assigneeNames":{},"createdAt":"2026-11-01T10:00:00.000Z","updatedAt":"2026-11-11T08:30:00.000Z","deletedAt":null}""",
        $$"""{"id":"{{Hose}}","title":"Buy a hose","status":"open","priority":0,"due":null,"schedule":{"start":"2026-11-14","end":null,"allDay":true,"timeZone":"UTC"},"listId":"L1","listName":"Yard","sectionName":null,"parentId":"{{Roses}}","tags":["errands"],"assignees":[],"assigneeNames":{},"createdAt":"2026-11-02T10:00:00.000Z","updatedAt":"2026-11-02T10:00:00.000Z","deletedAt":null}""",
        $$"""{"id":"{{Milk}}","title":"Oat milk","status":"open","priority":2,"due":{"at":"2026-11-10","allDay":true,"timeZone":"UTC"},"schedule":null,"listId":"L3","listName":"Groceries","sectionName":null,"parentId":null,"tags":["errands"],"assignees":["user:U2"],"assigneeNames":{"user:U2":"Sam Lee"},"createdAt":"2026-11-03T10:00:00.000Z","updatedAt":"2026-11-12T07:00:00.000Z","deletedAt":null}""",
        $$"""{"id":"{{Gate}}","title":"Fix the gate","status":"done","priority":0,"due":null,"schedule":{"start":"2026-11-09","end":null,"allDay":true,"timeZone":"UTC"},"listId":"L2","listName":"Home","sectionName":null,"parentId":null,"tags":[],"assignees":[],"assigneeNames":{},"createdAt":"2026-11-04T10:00:00.000Z","updatedAt":"2026-11-09T10:00:00.000Z","deletedAt":null}""",
        $$"""{"id":"{{Report}}","title":"Send the report","status":"wontdo","priority":1,"due":null,"schedule":null,"listId":"L4","listName":"Work","sectionName":"Q4","parentId":null,"tags":[],"assignees":[],"assigneeNames":{},"createdAt":"2026-11-05T10:00:00.000Z","updatedAt":"2026-11-06T10:00:00.000Z","deletedAt":null}""",
    ];

    private static FakeApi Api() => new()
    {
        Answers =
        {
            ["api/v1/lists?archived=true"] = """{"items":[{"id":"L1","name":"Yard"},{"id":"L2","name":"Home"},{"id":"L3","name":"Groceries"},{"id":"L4","name":"Work"}]}""",
            ["api/v1/people"] = """{"items":[{"id":"user:U1","name":"Ben","handle":"ben","me":true},{"id":"group:G1","name":"Family","handle":null,"me":false},{"id":"user:U2","name":"Sam Lee","handle":"sam","me":false}]}""",
            ["api/v1/tasks?status=all&limit=500"] = Tasks(Five),
        },
    };

    /// <summary>A table line with these column widths, as the table pads them.</summary>
    private static string Line(int[] widths, params string[] cells) =>
        string.Concat(cells.Select((cell, column) => column < cells.Length - 1 ? cell.PadRight(widths[column]) + "  " : cell)).TrimEnd();

    // The table ------------------------------------------------------------------------------------

    [Fact]
    public async Task The_table_says_status_date_priority_list_title_and_tags_with_subtasks_under_their_parent()
    {
        var ran = await Cli.RunAtAsync(Api(), await SignedInAsync(), Now, null, "tasks", "list", "-a");
        Assert.True(ran.Code == 0, ran.Err);
        int[] widths = [6, 8, 16, 6, 9, 15];
        Assert.Equal(string.Join('\n',
            Line(widths, "ID", "STATUS", "DATE", "PRI", "LIST", "TITLE", "TAGS"),
            Line(widths, "F0PB8W", "done", "Mon 9 Nov", "", "Home", "Fix the gate", ""),
            Line(widths, "9KD3TA", "open", "Tue 10 Nov, late", "medium", "Groceries", "Oat milk", "#errands"),
            Line(widths, "4QH7ZK", "open", "today 09:00", "high", "Yard", "Water the roses", "#garden"),
            Line(widths, "VX2M0D", "open", "Sat 14 Nov", "", "Yard", "  - Buy a hose", "#errands"),
            Line(widths, "J3N9VE", "won't do", "", "low", "Work / Q4", "Send the report", ""),
            "5 tasks: 3 open, 1 done, 1 won't do") + "\n", ran.Out);
        // The Command line page shows this very table.
        var docs = File.ReadAllText(Path.Combine(Cli.RepositoryRoot(), "docs", "reference", "cli.md")).ReplaceLineEndings("\n");
        Assert.Contains("```text\n" + ran.Out + "```", docs);
    }

    [Fact]
    public async Task Long_titles_are_cut_to_the_terminal_but_never_when_piped()
    {
        var api = Api();
        var title = "Call the plumber about the kitchen tap that drips all night";
        api.Answers["api/v1/tasks?status=all&limit=500"] = Tasks($$"""{"id":"{{Milk}}","title":"{{title}}","status":"open","priority":0,"listId":"L2","listName":"Home","tags":[]}""");
        var store = await SignedInAsync();

        var narrow = await Cli.RunAtAsync(api, store, Now, 56, "tasks", "list", "-a");
        Assert.Contains("Call the plumb...", narrow.Out);
        Assert.DoesNotContain(title, narrow.Out);
        Assert.All(narrow.Out.TrimEnd().Split('\n'), line => Assert.True(line.Length <= 56, $"too wide: '{line}'"));

        Assert.Contains(title, (await Cli.RunAtAsync(api, store, Now, null, "tasks", "list", "-a")).Out);
    }

    [Fact]
    public async Task Wide_adds_start_and_due_apart_people_repeat_progress_times_and_the_whole_id()
    {
        var ran = await Cli.RunAtAsync(Api(), await SignedInAsync(), Now, null, "tasks", "list", "-a", "-w");
        Assert.True(ran.Code == 0, ran.Err);
        var lines = ran.Out.Split('\n');
        Assert.StartsWith("ID", lines[0]);
        foreach (var column in new[] { "START", "DUE", "ASSIGNED", "REPEATS", "PROGRESS", "CREATED", "CHANGED" }) Assert.Contains(column, lines[0]);
        var milk = lines.Single(line => line.StartsWith(Milk, StringComparison.Ordinal));
        Assert.Contains("Sam Lee", milk);
        Assert.Contains("2026-11-12 07:00", milk);
    }

    [Fact]
    public async Task Nothing_found_says_so_and_how_to_see_more()
    {
        var api = Api();
        api.Answers["api/v1/tasks?limit=500"] = Tasks();
        var store = await SignedInAsync();
        Assert.Equal("No open tasks match. Add -a for every status.\n", (await Cli.RunAtAsync(api, store, Now, null, "tasks", "list")).Out);
        api.Answers["api/v1/tasks?status=all&limit=500"] = Tasks();
        Assert.Equal("No tasks match.\n", (await Cli.RunAtAsync(api, store, Now, null, "tasks", "list", "-a")).Out);
    }

    [Fact]
    public async Task A_server_before_names_still_gets_list_names_from_the_lists()
    {
        var api = Api();
        api.Answers["api/v1/tasks?status=all&limit=500"] = Tasks($$"""{"id":"{{Gate}}","title":"Fix the gate","status":"open","listId":"L2","tags":[]}""");
        var ran = await Cli.RunAtAsync(api, await SignedInAsync(), Now, null, "tasks", "list", "-a");
        Assert.Contains("Home", ran.Out);
        Assert.Contains("GET /api/v1/lists?archived=true", api.Requests);
    }

    // Filters, sorting, JSON -------------------------------------------------------------------------

    [Fact]
    public async Task Every_filter_reaches_the_api_and_names_become_ids()
    {
        var api = Api();
        const string query = "api/v1/tasks?listId=L1&listId=L3&tag=errands&tag=garden&status=done&dueBefore=2026-11-18&dueAfter=2026-11-12"
            + "&priority=2%2C3&assignee=user%3AU2&q=kitchen%20tap&limit=500";
        api.Answers[query] = Tasks(Five[2]);
        var ran = await Cli.RunAtAsync(api, await SignedInAsync(), Now, null,
            "tasks", "list", "-l", "Yard", "-lGroceries", "-t", "errands", "-t", "garden", "--status", "done", "-d", "week", "-p", "medium+", "-u", "sam", "-S", "kitchen tap");
        Assert.True(ran.Code == 0, ran.Err);
        Assert.Contains($"GET /{query}", api.Requests);
        Assert.Contains("Oat milk", ran.Out);

        // The other ways to say when and who.
        api.Answers["api/v1/tasks?dueBefore=2026-11-11&assignee=me&limit=500"] = Tasks();
        Assert.Equal(0, (await Cli.RunAtAsync(api, await SignedInAsync(), Now, null, "tasks", "list", "-d", "overdue", "-u", "me")).Code);
        api.Answers["api/v1/tasks?dueBefore=2026-11-30&dueAfter=2026-11-01&assignee=group%3AG1&limit=500"] = Tasks();
        Assert.Equal(0, (await Cli.RunAtAsync(api, await SignedInAsync(), Now, null, "tasks", "list", "--due=2026-11-01..2026-11-30", "--assigned", "family")).Code);
        api.Answers["api/v1/tasks?status=all&deleted=true&limit=500"] = Tasks();
        Assert.Equal(0, (await Cli.RunAtAsync(api, await SignedInAsync(), Now, null, "tasks", "list", "--status", "deleted")).Code);
        api.Answers["api/v1/tasks?status=done&deleted=true&limit=500"] = Tasks();
        Assert.Equal(0, (await Cli.RunAtAsync(api, await SignedInAsync(), Now, null, "tasks", "list", "--deleted", "--status", "done")).Code);
    }

    [Fact]
    public async Task Sort_and_limit_shape_the_json_too_which_keeps_the_items_shape()
    {
        // Priority sorts high first; a - in front reverses it (ties by date, then title).
        var ran = await Cli.RunAtAsync(Api(), await SignedInAsync(), Now, null, "tasks", "list", "-a", "-o", "priority", "--limit", "2", "-j");
        Assert.True(ran.Code == 0, ran.Err);
        var items = JsonNode.Parse(ran.Out)!["items"]!.AsArray();
        Assert.Equal([Roses, Milk], items.Select(item => (string)item!["id"]!));
        Assert.Equal("Yard", (string?)items[0]!["listName"]);
        var reversed = JsonNode.Parse((await Cli.RunAtAsync(Api(), await SignedInAsync(), Now, null, "tasks", "list", "-a", "-o", "-priority", "-j")).Out)!["items"]!.AsArray();
        Assert.Equal([Report, Milk, Roses], reversed.Select(item => (string)item!["id"]!).Skip(2));

        var api = Api();
        api.Answers[$"api/v1/tasks/{Roses}"] = Five[0];
        var table = await Cli.RunAtAsync(api, await SignedInAsync(), Now, null, "tasks", "list", "-a", "--sort", "title", "--limit", "3");
        var lines = table.Out.TrimEnd().Split('\n');
        Assert.Equal(5, lines.Length);
        Assert.Contains("Buy a hose (in: Water the roses)", lines[1]);
        Assert.Contains("Fix the gate", lines[2]);
        Assert.Contains("Oat milk", lines[3]);
        Assert.Equal("5 tasks: 3 open, 1 done, 1 won't do (showing 3)", lines[^1]);
    }

    [Theory]
    [InlineData("--status", "later", "--status is open, done, wontdo, deleted or all")]
    [InlineData("-d", "someday", "--due 'someday' is not one of")]
    [InlineData("-d", "2026-11-30..2026-11-01", "the range ends before it starts")]
    [InlineData("-p", "urgent", "--priority is high, medium, low or none")]
    [InlineData("-o", "colour", "--sort is one of due, priority")]
    [InlineData("--limit", "0", "--limit is a number above 0")]
    [InlineData("--due-before", "nonsense", "--due-before 'nonsense' is not a date like 2026-11-30")]
    [InlineData("--due-after", "2026-02-30", "--due-after '2026-02-30' is not a date like 2026-11-30")]
    [InlineData("-S", "a b c d e f g h i", "--search takes up to 8 different words")]
    public async Task A_wrong_filter_is_bad_usage_and_asks_the_server_nothing(string option, string value, string message)
    {
        var api = Api();
        var ran = await Cli.RunAtAsync(api, await SignedInAsync(), Now, null, "tasks", "list", option, value);
        Assert.Equal(ClientCli.BadUsage, ran.Code);
        Assert.Contains(message, ran.Err);
        Assert.Contains("usage: pecklist tasks list", ran.Err);
        Assert.Empty(api.Requests);

        var both = await Cli.RunAtAsync(api, await SignedInAsync(), Now, null, "tasks", "list", "-d", "today", "--due-after", "2026-01-01");
        Assert.Equal(ClientCli.BadUsage, both.Code);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Assigned_names_someone_you_may_assign_or_says_who_it_could_be()
    {
        var api = Api();
        var nobody = await Cli.RunAtAsync(api, await SignedInAsync(), Now, null, "tasks", "list", "-u", "zed");
        Assert.Equal(ClientCli.Failed, nobody.Code);
        Assert.Contains("nobody matches 'zed'", nobody.Err);
        Assert.DoesNotContain(api.Requests, request => request.StartsWith("GET /api/v1/tasks", StringComparison.Ordinal));
    }

    // Short ids and show ---------------------------------------------------------------------------

    [Fact]
    public async Task Any_command_takes_the_short_id_the_table_shows()
    {
        var api = Api();
        api.Answers["api/v1/tasks?status=all&idSuffix=4QH7ZK&limit=10"] = Tasks(Five[0]);
        api.Answers[$"POST api/v1/tasks/{Roses}/complete"] = """{"completed":{"title":"Water the roses"},"next":null}""";
        var done = await Cli.RunAtAsync(api, await SignedInAsync(), Now, null, "tasks", "done", "4QH7ZK");
        Assert.True(done.Code == 0, done.Err);
        Assert.Equal("Done: Water the roses\n", done.Out);
        Assert.Contains($"POST /api/v1/tasks/{Roses}/complete", api.Requests);

        // Two that end alike: every command refuses, naming them, and never acts on the first.
        api.Requests.Clear();
        api.Answers["api/v1/tasks?status=all&idSuffix=ZZZZ&limit=10"] = Tasks(
            """{"id":"01JD0000000000000000AAZZZZ","title":"Water the roses","status":"open"}""",
            """{"id":"01JD0000000000000000BBZZZZ","title":"Buy a hose","status":"open"}""");
        api.Answers["api/v1/tasks?status=all&idSuffix=ZZZZ&deleted=true&limit=10"] = Tasks(
            """{"id":"01JD0000000000000000CCZZZZ","title":"Fix the gate","status":"done"}""",
            """{"id":"01JD0000000000000000DDZZZZ","title":"Send the report","status":"wontdo"}""");
        string[][] commands =
        [
            ["tasks", "done", "ZZZZ"], ["tasks", "done", "ZZZZ", "--wontdo"], ["tasks", "rm", "ZZZZ"], ["tasks", "delete", "ZZZZ"],
            ["tasks", "edit", "ZZZZ", "-T", "New"], ["tasks", "reopen", "ZZZZ"], ["tasks", "restore", "ZZZZ"], ["tasks", "show", "ZZZZ"],
        ];
        foreach (var line in commands)
        {
            var two = await Cli.RunAtAsync(api, await SignedInAsync(), Now, null, line);
            Assert.True(two.Code == ClientCli.Failed, $"{string.Join(' ', line)}: {two.Code} {two.Err}");
            Assert.Contains("several tasks end with ZZZZ", two.Err);
            Assert.Contains("give more of the id", two.Err);
        }
        Assert.Contains("Water the roses", (await Cli.RunAtAsync(api, await SignedInAsync(), Now, null, "tasks", "done", "ZZZZ")).Err);
        Assert.DoesNotContain(api.Requests, request => !request.StartsWith("GET ", StringComparison.Ordinal));

        // Only ids that really end so count: a task the server sends back that doesn't is never acted on.
        api.Requests.Clear();
        api.Answers["api/v1/tasks?status=all&idSuffix=QQQQ&limit=10"] = Tasks(Five[0]);
        api.Answers["api/v1/tasks?status=all&idSuffix=QQQQ&deleted=true&limit=10"] = Tasks(Five[3]);
        await Cli.RunAtAsync(api, await SignedInAsync(), Now, null, "tasks", "done", "QQQQ");
        Assert.Contains("POST /api/v1/tasks/QQQQ/complete", api.Requests);
        Assert.DoesNotContain(api.Requests, request => request.Contains(Roses, StringComparison.Ordinal) || request.Contains(Gate, StringComparison.Ordinal));

        // Restore looks in the trash first.
        api.Requests.Clear();
        api.Answers["api/v1/tasks?status=all&idSuffix=F0PB8W&deleted=true&limit=10"] = Tasks(Five[3]);
        api.Answers[$"POST api/v1/tasks/{Gate}/restore"] = """{"title":"Fix the gate"}""";
        Assert.Equal("Restored: Fix the gate\n", (await Cli.RunAtAsync(api, await SignedInAsync(), Now, null, "tasks", "restore", "F0PB8W")).Out);
        Assert.Equal("GET /api/v1/tasks?status=all&idSuffix=F0PB8W&deleted=true&limit=10", api.Requests[0]);
    }

    [Fact]
    public async Task Show_gives_everything_with_names_dates_reminders_checklist_subtasks_and_notes()
    {
        var api = Api();
        api.Answers[$"api/v1/tasks/{Hose}"] = $$"""
            {"id":"{{Hose}}","title":"Buy a hose","notes":"Get a long one.\n- [x] Measure the yard\n- [ ] Pick a colour\nGreen is fine.","status":"done",
             "priority":2,"listId":"L1","listName":"Yard","sectionName":"Beds","parentId":"{{Roses}}",
             "schedule":{"start":"2026-11-14T09:00","end":"2026-11-14T10:00","allDay":false,"timeZone":"America/Chicago"},
             "due":{"at":"2026-11-15","allDay":true,"timeZone":"America/Chicago"},"recurrence":"FREQ=WEEKLY",
             "reminders":[{"before":30},{"before":1440},{"at":"2026-11-14T08:00"}],"constantReminder":true,
             "tags":["errands","garden"],"assignees":["group:G1","user:U2"],"assigneeNames":{"group:G1":"Family","user:U2":"Sam Lee"},
             "progress":40,"pinned":true,"createdAt":"2026-11-02T10:00:00.000Z","createdByName":"Ben","updatedAt":"2026-11-12T09:30:00.000Z",
             "completedAt":"2026-11-12T11:00:00.000Z","completedByName":"Sam Lee","deletedAt":null}
            """;
        api.Answers[$"api/v1/tasks/{Roses}"] = Five[0];
        api.Answers[$"api/v1/tasks?parentId={Hose}&status=all&limit=500"] = Tasks($$"""{"id":"01JD0000000000000000SUB001","title":"Find the tap","status":"open"}""");
        api.Answers["api/v1/tasks?status=all&idSuffix=VX2M0D&limit=10"] = Tasks(Five[1]);

        var ran = await Cli.RunAtAsync(api, await SignedInAsync(), Now, null, "tasks", "show", "VX2M0D");
        Assert.True(ran.Code == 0, ran.Err);
        Assert.Equal("""
            Buy a hose
              Id:         01JD0000000000000000VX2M0D (short: VX2M0D)
              Status:     done
              List:       Yard / Beds
              Parent:     Water the roses (4QH7ZK)
              Priority:   medium
              Start:      Sat 14 Nov 09:00 to Sat 14 Nov 10:00 (America/Chicago)
              Due:        Sun 15 Nov (America/Chicago)
              Repeats:    FREQ=WEEKLY
              Reminders:  30 minutes before; 1 day before; Sat 14 Nov 08:00, again every 5 minutes for an hour until done
              Tags:       #errands #garden
              Assigned:   Family, Sam Lee
              Progress:   40%
              Pinned:     yes
              Created:    2026-11-02 10:00 by Ben
              Changed:    2026-11-12 09:30
              Done:       2026-11-12 11:00 by Sam Lee
              Checklist:  1 of 2 done
                [x] Measure the yard
                [ ] Pick a colour
              Subtasks:   1 of 1 open
                open      SUB001  Find the tap
              Notes:
                Get a long one.
                Green is fine.

            """.ReplaceLineEndings("\n"), ran.Out);
    }

    // The view's rules on their own ----------------------------------------------------------------

    [Fact]
    public void Dates_read_as_people_say_them()
    {
        Assert.Equal("today", TaskView.Day("2026-11-12", Today));
        Assert.Equal("tomorrow 09:30", TaskView.Day("2026-11-13T09:30", Today));
        Assert.Equal("yesterday", TaskView.Day("2026-11-11", Today));
        Assert.Equal("Fri 20 Nov", TaskView.Day("2026-11-20", Today));
        Assert.Equal("3 Jan 2027", TaskView.Day("2027-01-03", Today));
        Assert.Equal("", TaskView.Day(null, Today));
        Assert.Equal("2026-11-12 09:00", TaskView.Local("2026-11-12T15:00:00.000Z", TimeZoneInfo.CreateCustomTimeZone("UTC-6", TimeSpan.FromHours(-6), "UTC-6", "UTC-6")));
    }

    [Fact]
    public void Due_words_and_ranges_become_the_api_dates()
    {
        Assert.Equal(("2026-11-12", "2026-11-12"), TaskView.DueRange("today", Today));
        Assert.Equal(("2026-11-13", "2026-11-13"), TaskView.DueRange("Tomorrow", Today));
        Assert.Equal((null, "2026-11-11"), TaskView.DueRange("overdue", Today));
        Assert.Equal(("2026-11-12", "2026-11-18"), TaskView.DueRange("week", Today));
        Assert.Equal(("2026-12-01", "2026-12-01"), TaskView.DueRange("2026-12-01", Today));
        Assert.Equal(("2026-12-01", null), TaskView.DueRange("2026-12-01..", Today));
        Assert.Equal((null, "2026-12-01"), TaskView.DueRange("..2026-12-01", Today));
        foreach (var wrong in new[] { "", "..", "soon", "2026-13-01", "2026-12-01..later" })
        {
            Assert.Throws<UsageException>(() => TaskView.DueRange(wrong, Today));
        }
    }

    [Fact]
    public void Priorities_take_names_numbers_lists_and_and_up()
    {
        Assert.Equal("3", TaskView.Priorities("high"));
        Assert.Equal("2,3", TaskView.Priorities("medium+"));
        Assert.Equal("1,2,3", TaskView.Priorities("low+"));
        Assert.Equal("0,3", TaskView.Priorities("high, none"));
        Assert.Equal("1,2", TaskView.Priorities("1,med"));
        Assert.Throws<UsageException>(() => TaskView.Priorities("urgent"));
        Assert.Throws<UsageException>(() => TaskView.Priorities(","));
    }

    [Fact]
    public void Short_ids_grow_until_the_shown_ones_differ()
    {
        Assert.Equal(6, TaskView.ShortLength([Roses, Hose, Milk]));
        Assert.Equal(7, TaskView.ShortLength(["01JD000000000000000AABCDEF", "01JD000000000000000BABCDEF"]));
        Assert.Equal("T9", TaskView.Short("T9"));
    }

    [Fact]
    public void Subtasks_follow_their_parent_at_any_depth_and_name_a_parent_not_shown()
    {
        JsonNode Task(string id, string? parent) => JsonNode.Parse($$"""{"id":"{{id}}","title":"{{id}}","parentId":{{(parent is null ? "null" : $"\"{parent}\"")}}}""")!;
        var rows = TaskView.Arrange([Task("C", "B"), Task("A", null), Task("B", "A"), Task("D", "X"), Task("E", null)], new Dictionary<string, string> { ["X"] = "Elsewhere" });
        Assert.Equal(["A:0", "B:1", "C:2", "D:0:Elsewhere", "E:0"],
            rows.Select(row => $"{(string?)row.Task["id"]}:{row.Depth}{(row.ParentTitle is { } title ? ":" + title : "")}"));
    }

    [Fact]
    public void Reminders_checklists_and_counts_read_plainly()
    {
        Assert.Equal("at the time", TaskView.Reminder(JsonNode.Parse("""{"before":0}""")!, Today));
        Assert.Equal("1 minute before", TaskView.Reminder(JsonNode.Parse("""{"before":1}""")!, Today));
        Assert.Equal("2 hours before", TaskView.Reminder(JsonNode.Parse("""{"before":120}""")!, Today));
        Assert.Equal("90 minutes before", TaskView.Reminder(JsonNode.Parse("""{"before":90}""")!, Today));
        Assert.Equal("today 18:00", TaskView.Reminder(JsonNode.Parse("""{"at":"2026-11-12T18:00"}""")!, Today));

        var notes = "Intro\r\n* [X] One\n  - [ ] Two\n+ [ ]\nOutro";
        Assert.Equal([(true, "One"), (false, "Two"), (false, "")], TaskView.Checklist(notes));
        Assert.Equal("Intro\nOutro", TaskView.NotesWithoutChecklist(notes));

        Assert.Equal("1 task: 1 deleted", TaskView.Footer([JsonNode.Parse("""{"deletedAt":"2026-11-01T00:00:00Z","status":"done"}""")!], 1));
    }
}
