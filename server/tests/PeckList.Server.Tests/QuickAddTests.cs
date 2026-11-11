using System.Globalization;
using System.Text.Json.Nodes;
using PeckList.Core.Api;
using Jint;
using PeckList.Server.Api;

namespace PeckList.Server.Tests;

/// <summary>
/// Quick add on the server reads a line exactly as the app does (PL-137): the app's own code, run in
/// Jint, through the shared cases in <c>schema/fixtures/quick-add/cases.json</c> that the web suite
/// runs too.
/// </summary>
public sealed class QuickAddTests
{
    private static readonly JsonObject Fixture = JsonNode.Parse(File.ReadAllText(Find("schema", "fixtures", "quick-add", "cases.json")))!.AsObject();
    // Tests of what a line reads as run with a wide wall-clock backstop (a loaded CI runner can take
    // seconds); only the limit tests below depend on timing.
    private static readonly JsQuickAddLimits Generous = new() { Time = TimeSpan.FromSeconds(30) };
    private static readonly JsQuickAdd Reader = new(Generous);

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private static string Find(params string[] parts)
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            if (Directory.Exists(Path.Combine(dir.FullName, "schema", "fixtures"))) return Path.Combine([dir.FullName, .. parts]);
        }
        throw new DirectoryNotFoundException("repo root (with schema/fixtures) not found above " + AppContext.BaseDirectory);
    }

    public static TheoryData<string> Cases()
    {
        var data = new TheoryData<string>();
        foreach (var each in Fixture["cases"]!.AsArray()) data.Add((string)each!["text"]!);
        return data;
    }

    private static QuickAddContext Context()
    {
        var reference = DateTime.ParseExact((string)Fixture["reference"]!, "yyyy-MM-dd'T'HH:mm", CultureInfo.InvariantCulture);
        return new QuickAddContext(
            [.. Fixture["lists"]!.AsArray().Select(list => new QuickList((string)list!["id"]!, (string)list["name"]!, (bool?)list["isInbox"] ?? false))],
            [.. Fixture["tags"]!.AsArray().Select(tag => ((string)tag!["id"]!, (string)tag["name"]!))],
            [.. Fixture["people"]!.AsArray().Select(person => new QuickPerson((string)person!["principal"]!, (string)person["name"]!, (string?)person["handle"]))],
            reference);
    }

    private static JsonNode? Moment(QuickMoment? moment) =>
        moment is null ? null : new JsonObject { ["date"] = moment.Date, ["time"] = moment.Time };

    [Fact]
    public void Has_the_shared_cases() => Assert.True(Fixture["cases"]!.AsArray().Count > 80);

    [Theory]
    [MemberData(nameof(Cases))]
    public async Task Reads_the_line_as_the_app_does(string text)
    {
        var expected = (JsonObject)Fixture["cases"]!.AsArray().First(each => (string)each!["text"]! == text)!.DeepClone();
        expected.Remove("text");
        var parsed = await Reader.ReadAsync(text, Context(), Token);
        var actual = new JsonObject
        {
            ["title"] = parsed.Title,
            ["tokens"] = new JsonArray([.. parsed.Tokens.Select(token => (JsonNode)new JsonObject
            {
                ["kind"] = token.Kind, ["start"] = token.Start, ["end"] = token.End, ["text"] = token.Text,
            })]),
            ["schedule"] = parsed.Schedule is null ? null : new JsonObject { ["start"] = Moment(parsed.Schedule.Start), ["end"] = Moment(parsed.Schedule.End) },
            ["due"] = Moment(parsed.Due),
            ["priority"] = parsed.Priority,
            ["listId"] = parsed.ListId,
            ["tags"] = new JsonArray([.. parsed.Tags.Select(tag => (JsonNode)new JsonObject { ["id"] = tag.Id, ["name"] = tag.Name })]),
            ["assignees"] = new JsonArray([.. parsed.Assignees.Select(principal => (JsonNode)JsonValue.Create(principal))]),
            ["recurrence"] = parsed.Recurrence,
        };
        Assert.True(JsonNode.DeepEquals(expected, actual), $"\nwant {expected.ToJsonString()}\ngot  {actual.ToJsonString()}");
    }

    [Fact]
    public async Task A_line_built_to_make_reading_crawl_is_stopped_by_the_statement_limit()
    {
        // About 72,000 statements against a limit of 40,000; counted work, so it stops however busy
        // the machine is, with the wall clock nowhere near.
        var text = string.Concat(Enumerable.Repeat("12 - 12/12 - 9-9 at 9 ", 50))[..IQuickAddReader.MaxText];
        var reader = new JsQuickAdd(Generous with { Engines = 1 });
        var stopped = await Assert.ThrowsAsync<QuickAddTooSlowException>(() => reader.ReadAsync(text, Context(), Token));
        Assert.IsType<TooMuchWorkException>(stopped.InnerException);
        // The engine is dropped, and the next line reads on a fresh one.
        Assert.Equal("Fine", (await reader.ReadAsync("Fine", Context(), Token)).Title);
        Assert.Equal(2, reader.EnginesMade);
    }

    [Fact]
    public void Every_shared_case_runs_well_under_the_statement_limit()
    {
        // The limit is about 20 times the busiest case (1,836 when it was set); a tenth of it is
        // still more than twice that, so a grammar change that makes readings much heavier shows here.
        var limits = new JsQuickAddLimits();
        var engine = new JsQuickAdd(Generous).NewEngine();
        long Run(string text)
        {
            engine.Constraints.Reset();
            engine.Invoke("quickAdd", JsQuickAdd.Input(text, Context()));
            return JsQuickAdd.StatementsRun(engine);
        }
        var lines = Fixture["cases"]!.AsArray().Select(each => (string)each!["text"]!)
            .Append(string.Concat(Enumerable.Repeat("Water the plants and ", 48))[..(IQuickAddReader.MaxText - 40)] + " tomorrow 9am #garden !high every week");
        foreach (var line in lines)
        {
            var used = Run(line);
            Assert.True(used > 0, line);
            Assert.True(used < limits.Statements / 10, $"{line}: {used} statements");
        }
    }

    [Fact]
    public async Task Someone_with_thousands_of_lists_and_tags_can_still_quick_add()
    {
        // The app's code looks through every list and tag, so the count a plain line runs grows with
        // them; the limit grows too (StatementsPerContextItem). Without that this line is refused.
        var big = new QuickAddContext(
            [new QuickList("inbox", "Inbox", IsInbox: true), .. Enumerable.Range(0, 2000).Select(n => new QuickList($"L{n}", $"List {n}"))],
            [.. Enumerable.Range(0, 2000).Select(n => ($"T{n}", $"tag{n}"))],
            [],
            Context().Reference);
        var reader = new JsQuickAdd(Generous);
        var read = await reader.ReadAsync("Water plants tomorrow 9am", big, Token);
        Assert.Equal("Water plants", read.Title);
        Assert.NotNull(read.Schedule);

        var flat = new JsQuickAdd(Generous with { StatementsPerContextItem = 0 });
        var refused = await Assert.ThrowsAsync<QuickAddTooSlowException>(() => flat.ReadAsync("Water plants tomorrow 9am", big, Token));
        Assert.IsType<TooMuchWorkException>(refused.InnerException);
    }

    [Fact]
    public void A_runaway_script_stops_at_the_statement_limit()
    {
        var engine = new JsQuickAdd(Generous).NewEngine();
        engine.Constraints.Reset();
        Assert.Throws<TooMuchWorkException>(() => engine.Execute("while (true) {}"));
    }

    [Fact]
    public async Task Reads_lines_side_by_side_and_each_gets_its_own_answer()
    {
        var context = Context();
        var lines = Enumerable.Range(0, 40).Select(n => $"Call person{n} tomorrow #errands").ToArray();
        var read = await Task.WhenAll(lines.Select(line => Reader.ReadAsync(line, context, Token)));
        for (var n = 0; n < lines.Length; n++) Assert.Equal($"Call person{n}", read[n].Title);
    }

    // The sandbox: the text is someone else's, so the engine reaches nothing and stops early.

    [Fact]
    public void The_engine_has_no_way_into_dotnet()
    {
        var engine = Reader.NewEngine();
        Assert.Equal("undefined undefined undefined undefined undefined",
            engine.Evaluate("[typeof importNamespace, typeof System, typeof clrHelper, typeof require, typeof process].join(' ')").AsString());
    }

    [Fact]
    public void A_runaway_script_stops_at_the_time_limit()
    {
        var limits = new JsQuickAddLimits { Time = TimeSpan.FromMilliseconds(200), Statements = long.MaxValue };
        var engine = new JsQuickAdd(limits).NewEngine();
        engine.Constraints.Reset();
        var watch = System.Diagnostics.Stopwatch.StartNew();
        Assert.Throws<TimeoutException>(() => engine.Execute("while (true) {}"));
        // A reading's limit, not the warm-up's the engine was made under.
        Assert.True(watch.Elapsed < limits.WarmUp / 2, watch.Elapsed.ToString());
    }

    [Fact]
    public async Task A_cold_engine_reads_a_normal_line()
    {
        // A new reader has no engine yet: the first reading gets one ready (the warm-up, under its
        // own limit, PL-137 landing) and reads the line as a warm engine does.
        const string line = "Water plants tomorrow 9am #garden !high";
        var reader = new JsQuickAdd(Generous);
        var cold = await reader.ReadAsync(line, Context(), Token);
        Assert.Equal(1, reader.EnginesMade);
        var warm = await Reader.ReadAsync(line, Context(), Token);
        Assert.Equal("Water plants", cold.Title);
        Assert.NotNull(cold.Schedule);
        Assert.Equal(warm.Schedule, cold.Schedule);
        Assert.NotNull(cold.Priority);
        Assert.Equal(warm.Priority, cold.Priority);
        Assert.Equal(warm.Tags, cold.Tags);
        Assert.Equal(warm.Tokens, cold.Tokens);
    }

    [Fact]
    public async Task Someone_s_line_is_held_to_the_reading_limit_even_on_the_engine_it_got_ready()
    {
        // The engine is made inside this reading (warm-up limit), and the line itself still gets
        // only the reading's: a slow but allowed line stops.
        var reader = new JsQuickAdd(new JsQuickAddLimits { Engines = 1, Time = TimeSpan.FromMilliseconds(15), Statements = long.MaxValue });
        var text = string.Concat(Enumerable.Repeat("12 - 12/12 - 9-9 at 9 ", 50))[..IQuickAddReader.MaxText];
        await Assert.ThrowsAsync<QuickAddTooSlowException>(() => reader.ReadAsync(text, Context(), Token));
        Assert.Equal(1, reader.EnginesMade);
        Assert.Equal(1, reader.Slots.CurrentCount);
    }

    [Fact]
    public async Task An_engine_that_cannot_get_ready_is_dropped_and_readings_hear_busy()
    {
        // A warm-up limit nothing meets: loading the script stops at once.
        var log = new Warnings();
        var reader = new JsQuickAdd(new JsQuickAddLimits { Engines = 1, WarmUp = TimeSpan.FromTicks(1) }, log);
        await Assert.ThrowsAsync<QuickAddBusyException>(() => reader.ReadAsync("Water plants", Context(), Token));
        await Assert.ThrowsAsync<QuickAddBusyException>(() => reader.ReadAsync("Water plants", Context(), Token));
        reader.Prewarm();
        Assert.Equal(0, reader.EnginesMade);
        // No slot is left held.
        Assert.Equal(1, reader.Slots.CurrentCount);
        Assert.Equal(3, log.Lines.Count);
        Assert.All(log.Lines, line => Assert.Contains("could not get an engine ready", line));
    }

    [Fact]
    public async Task Prewarm_gets_an_engine_ready_before_the_first_reading()
    {
        var reader = new JsQuickAdd(Generous with { Engines = 1 });
        reader.Prewarm();
        Assert.Equal(1, reader.EnginesMade);
        Assert.Equal("Water plants", (await reader.ReadAsync("Water plants", Context(), Token)).Title);
        Assert.Equal(1, reader.EnginesMade);

        // Skipped while every slot is in use.
        Assert.True(reader.Slots.Wait(0, Token));
        try
        {
            reader.Prewarm();
        }
        finally
        {
            reader.Slots.Release();
        }
        Assert.Equal(1, reader.EnginesMade);

        // The server's startup service does it in the background.
        var started = new JsQuickAdd(Generous);
        await new QuickAddPrewarm(started).StartAsync(Token);
        for (var waited = 0; started.EnginesMade == 0 && waited < 600; waited++) await Task.Delay(100, Token);
        Assert.Equal(1, started.EnginesMade);
    }

    private sealed class Warnings : Microsoft.Extensions.Logging.ILogger
    {
        public List<string> Lines { get; } = [];

        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull => null;

        public bool IsEnabled(Microsoft.Extensions.Logging.LogLevel logLevel) => true;

        public void Log<TState>(Microsoft.Extensions.Logging.LogLevel logLevel, Microsoft.Extensions.Logging.EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            if (logLevel != Microsoft.Extensions.Logging.LogLevel.Warning) return;
            lock (Lines) Lines.Add(formatter(state, exception));
        }
    }

    [Fact]
    public void A_greedy_script_stops_at_the_memory_limit()
    {
        var engine = new JsQuickAdd(new JsQuickAddLimits { Time = TimeSpan.FromSeconds(30) }).NewEngine();
        engine.Constraints.Reset();
        Assert.Throws<Jint.Runtime.MemoryLimitExceededException>(() => engine.Execute("const all = []; while (true) all.push('x'.repeat(100000) + all.length);"));
    }

    [Fact]
    public void A_deep_script_stops_at_the_recursion_limit()
    {
        var engine = Reader.NewEngine();
        engine.Constraints.Reset();
        var deep = Assert.ThrowsAny<Exception>(() => engine.Execute("(function () { function down(n) { return down(n + 1); } return down(0); })();"));
        Assert.True(JsQuickAdd.IsTooDeep(deep) || deep is Jint.Runtime.RecursionDepthOverflowException, deep.ToString());
    }

    [Fact]
    public async Task A_reading_that_cannot_get_an_engine_soon_hears_busy_without_holding_a_thread()
    {
        var reader = new JsQuickAdd(Generous with { Engines = 1, Wait = TimeSpan.FromMilliseconds(50) });
        await reader.ReadAsync("Warm up", Context(), Token);
        // The only engine's slot is taken (as by a slow reading) while a second reading waits.
        Assert.True(reader.Slots.Wait(0, Token));
        try
        {
            await Assert.ThrowsAsync<QuickAddBusyException>(() => reader.ReadAsync("Waits", Context(), Token));
        }
        finally
        {
            reader.Slots.Release();
        }
        Assert.Equal("Free again", (await reader.ReadAsync("Free again", Context(), Token)).Title);
    }

    [Fact]
    public async Task Text_past_the_cap_never_reaches_the_engine()
    {
        var reader = new JsQuickAdd(Generous);
        await Assert.ThrowsAsync<ArgumentOutOfRangeException>(() => reader.ReadAsync(new string('a', IQuickAddReader.MaxText + 1), Context(), Token));
        Assert.Equal(0, reader.EnginesMade);
        Assert.Equal("Fine", (await reader.ReadAsync("Fine", Context(), Token)).Title);
    }

    [Fact]
    public async Task Nothing_carries_from_one_reading_to_the_next()
    {
        // The built-ins and the global object are frozen once the script is loaded.
        var engine = Reader.NewEngine();
        Assert.Throws<Jint.Runtime.JavaScriptException>(() => engine.Execute("'use strict'; Object.prototype.polluted = 1;"));
        Assert.Throws<Jint.Runtime.JavaScriptException>(() => engine.Execute("'use strict'; globalThis.quickAdd = () => 'mine';"));
        Assert.Throws<Jint.Runtime.JavaScriptException>(() => engine.Execute("'use strict'; String.prototype.trim = () => '';"));

        // One engine, replaced after its share of readings; a line reads the same before and after others.
        var reader = new JsQuickAdd(Generous with { Engines = 1, CallsPerEngine = 3 });
        var first = await reader.ReadAsync("Mow the lawn friday 9am #home/yard !high every week", Context(), Token);
        foreach (var other in new[] { "Pay rent on the 1st ^Home", "@sam call back tomorrow", "x every other tue", "due fri 5pm taxes", "!low later" })
        {
            await reader.ReadAsync(other, Context(), Token);
        }
        var again = await reader.ReadAsync("Mow the lawn friday 9am #home/yard !high every week", Context(), Token);
        Assert.Equal(first with { Tokens = [], Tags = [], Assignees = [] }, again with { Tokens = [], Tags = [], Assignees = [] });
        Assert.Equal(first.Tokens, again.Tokens);
        Assert.Equal(first.Tags, again.Tags);
        Assert.Equal(3, reader.EnginesMade);
    }
}
