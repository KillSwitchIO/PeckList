using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json.Nodes;
using Jint;
using Jint.Runtime;
using Microsoft.Extensions.Logging.Abstractions;
using PeckList.Core.Api;

namespace PeckList.Server.Api;

/// <summary>How far one quick add reading may go, and how engines are kept.</summary>
public sealed record JsQuickAddLimits
{
    /// <summary>
    /// JavaScript statements one reading may run: the main guard against a line built to make reading
    /// crawl. It counts work, not time, so a busy machine can't trip it. About 20 times the busiest
    /// of the shared cases (1,836 statements when set; a 1,000-character line with a date, tag and
    /// repeat runs about 1,300).
    /// </summary>
    public long Statements { get; init; } = 40_000;

    /// <summary>
    /// Statements added to <see cref="Statements"/> for each list, tag and person the person has: the
    /// app's code looks through them all, about 43 statements a list and 22 a tag, so without this
    /// someone with a thousand lists (their own or shared with them) could not quick add at all.
    /// </summary>
    public long StatementsPerContextItem { get; init; } = 60;

    /// <summary>
    /// Wall time for one reading: the backstop behind <see cref="Statements"/>, wide enough that a
    /// busy machine reading an ordinary line stays inside.
    /// </summary>
    public TimeSpan Time { get; init; } = TimeSpan.FromSeconds(5);

    /// <summary>
    /// Time any one regular expression match may take. The statement count can't see inside a match,
    /// so this has its own, shorter limit; Jint fixes it when the engine is made.
    /// </summary>
    public TimeSpan RegexTime { get; init; } = TimeSpan.FromSeconds(2);

    /// <summary>
    /// Wall time for getting a new engine ready: loading the script and one fixed reading of our own,
    /// never anyone's text. A cold engine's first reading is its slowest, and on a busy or small
    /// machine it can take longer than <see cref="Time"/>; done here, it isn't charged to a request.
    /// </summary>
    public TimeSpan WarmUp { get; init; } = TimeSpan.FromSeconds(30);

    /// <summary>Memory one reading may allocate.</summary>
    public long Memory { get; init; } = 64L * 1024 * 1024;

    /// <summary>How deep JavaScript calls may nest; the app's code needs well under a hundred.</summary>
    public int Recursion { get; init; } = 256;

    /// <summary>Engines kept at once (readings side by side).</summary>
    public int Engines { get; init; } = Math.Clamp(Environment.ProcessorCount, 1, 4);

    /// <summary>Readings one engine does before it is replaced by a fresh one.</summary>
    public int CallsPerEngine { get; init; } = 500;

    /// <summary>How long a reading waits for an engine before the request hears "busy".</summary>
    public TimeSpan Wait { get; init; } = TimeSpan.FromSeconds(3);
}

/// <summary>
/// Quick add on the server (PL-137, Ben 2026-11-09): the app's own <c>web/src/core/quickAdd.ts</c>
/// and its chrono date parser, bundled into <c>Api/quickadd.js</c> by
/// <c>scripts/build-quick-add.mjs</c> and run in Jint, a JavaScript engine written in .NET. One
/// grammar, so the app and the task API read a line identically.
/// </summary>
/// <remarks>
/// The text is someone else's, so the engine is a sandbox:
/// <list type="bullet">
/// <item>no CLR access (Jint's interop is never turned on, and nothing from .NET is handed in but
/// one JSON string);</item>
/// <item>limits on statements run (the main guard), wall time (the backstop), memory, call depth and
/// regex time for every reading, and the text capped at
/// <see cref="IQuickAddReader.MaxText"/> before it reaches the engine;</item>
/// <item>nothing carries from one reading to the next: after the script loads, the global object and
/// the built-ins are frozen, an engine that threw is dropped, and each engine is replaced after
/// <see cref="JsQuickAddLimits.CallsPerEngine"/> readings.</item>
/// </list>
/// An engine serves one reading at a time, so a few are kept; the script is parsed once for all of
/// them. Each new engine does one fixed reading before it serves anyone (see
/// <see cref="JsQuickAddLimits.WarmUp"/>), and the server gets one ready at startup
/// (<see cref="QuickAddPrewarm"/>). The engine's local zone is UTC: the wall clock goes in as local
/// time, and UTC has no daylight saving gaps.
/// </remarks>
public sealed class JsQuickAdd(JsQuickAddLimits limits, ILogger? logger = null) : IQuickAddReader
{
    public JsQuickAdd()
        : this(new JsQuickAddLimits())
    {
    }

    private readonly ILogger log = logger ?? NullLogger.Instance;

    // The warm-up reading: fixed text touching dates, times, tags, priority and repeats, with nothing
    // of anyone's in it.
    private static readonly string WarmUpInput = Input(
        "Warm up tomorrow 9am #tag !high every week",
        new QuickAddContext([new QuickList("inbox", "Inbox", IsInbox: true)], [], [], new DateTime(2026, 1, 5, 9, 0, 0)));

    private static readonly Lazy<Prepared<Acornima.Ast.Script>> Script = new(() =>
    {
        using var stream = typeof(JsQuickAdd).Assembly.GetManifestResourceStream("PeckList.Server.quickadd.js")
            ?? throw new InvalidOperationException("the quick add script is not in this build");
        using var reader = new StreamReader(stream);
        return Engine.PrepareScript(reader.ReadToEnd(), "quickadd.js");
    });

    // After loading: the global object and every built-in, with its prototype, can't be changed.
    private static readonly Lazy<Prepared<Acornima.Ast.Script>> Freeze = new(() => Engine.PrepareScript("""
        'use strict';
        (function () {
          const names = ['Object', 'Function', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt',
            'Date', 'RegExp', 'Math', 'JSON', 'Reflect', 'Proxy', 'Promise', 'Map', 'Set', 'WeakMap',
            'WeakSet', 'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'Intl'];
          for (const name of names) {
            const value = globalThis[name];
            if (value === undefined) continue;
            if (value.prototype) Object.freeze(value.prototype);
            Object.freeze(value);
          }
          Object.freeze(globalThis);
        })();
        """, "freeze.js"));

    private readonly ConcurrentBag<(Engine Engine, int Calls)> idle = [];
    private readonly SemaphoreSlim slots = new(limits.Engines);
    private int made;

    /// <summary>The engine slots (for tests).</summary>
    internal SemaphoreSlim Slots => slots;

    /// <summary>Engines made so far (for tests).</summary>
    internal int EnginesMade => made;

    /// <summary>
    /// A sandboxed engine with the script loaded and frozen and the warm-up reading done, all under
    /// <see cref="JsQuickAddLimits.WarmUp"/> and no statement count; from then on each reading gets
    /// <see cref="JsQuickAddLimits.Statements"/> and <see cref="JsQuickAddLimits.Time"/>.
    /// </summary>
    /// <exception cref="Exception">Whatever stopped it getting ready (a timeout, say): the engine is not kept.</exception>
    internal Engine NewEngine()
    {
        var budget = new ReadingBudget(limits.WarmUp, long.MaxValue);
        var engine = new Engine(options =>
        {
            options
                .LocalTimeZone(TimeZoneInfo.Utc)
                .Strict()
                .LimitMemory(limits.Memory)
                .LimitRecursion(limits.Recursion)
                .RegexTimeoutInterval(limits.RegexTime);
            options.Constraints.Constraints.Add(budget);
        });
        engine.Constraints.Reset();
        engine.Execute(Script.Value);
        engine.Execute(Freeze.Value);
        engine.Constraints.Reset();
        engine.Invoke("quickAdd", WarmUpInput);
        budget.Time = limits.Time;
        budget.Statements = limits.Statements;
        Interlocked.Increment(ref made);
        return engine;
    }

    /// <summary>The statement count a reading with this context may run.</summary>
    internal long StatementsFor(QuickAddContext context)
    {
        var extra = limits.StatementsPerContextItem * (context.Lists.Count + context.Tags.Count + context.People.Count);
        return limits.Statements > long.MaxValue - extra ? long.MaxValue : limits.Statements + extra;
    }

    /// <summary>Statements the last reading on <paramref name="engine"/> ran (for tests).</summary>
    internal static long StatementsRun(Engine engine) => engine.Constraints.Find<ReadingBudget>()!.Used;

    /// <summary>A new engine, or null when it could not get ready (logged; the caller answers "busy").</summary>
    private Engine? TryNewEngine()
    {
        try
        {
            return NewEngine();
        }
        catch (Exception error)
        {
            log.LogWarning(error, "Quick add could not get an engine ready; quick add requests hear busy until one is");
            return null;
        }
    }

    /// <summary>
    /// Gets one engine ready ahead of the first reading (the server runs this in the background at
    /// startup). Skipped when every slot is in use already.
    /// </summary>
    public void Prewarm()
    {
        if (!slots.Wait(0)) return;
        try
        {
            if (TryNewEngine() is { } engine) idle.Add((engine, 0));
        }
        finally
        {
            slots.Release();
        }
    }

    internal static string Input(string text, QuickAddContext context) => new JsonObject
    {
        ["text"] = text,
        ["reference"] = context.Reference.ToString("yyyy-MM-dd'T'HH:mm", System.Globalization.CultureInfo.InvariantCulture),
        ["lists"] = new JsonArray([.. context.Lists.Select(list => (JsonNode)new JsonObject { ["id"] = list.Id, ["name"] = list.Name, ["isInbox"] = list.IsInbox })]),
        ["tags"] = new JsonArray([.. context.Tags.Select(tag => (JsonNode)new JsonObject { ["id"] = tag.Id, ["name"] = tag.Name })]),
        ["people"] = new JsonArray([.. context.People.Select(person => (JsonNode)new JsonObject { ["principal"] = person.Principal, ["name"] = person.Name, ["handle"] = person.Handle })]),
    }.ToJsonString();

    public async Task<QuickAddResult> ReadAsync(string text, QuickAddContext context, CancellationToken cancellation = default)
    {
        ArgumentNullException.ThrowIfNull(text);
        // Capped here too, whatever the caller checked: longer never reaches the engine.
        ArgumentOutOfRangeException.ThrowIfGreaterThan(text.Length, IQuickAddReader.MaxText, nameof(text));
        var input = Input(text, context);

        // Waiting holds no thread, and not for long: a request that can't get an engine hears "busy"
        // rather than queueing behind slow lines and starving the rest of the server.
        if (!await slots.WaitAsync(limits.Wait, cancellation)) throw new QuickAddBusyException();
        (Engine Engine, int Calls)? held = null;
        try
        {
            held = idle.TryTake(out var kept) ? kept : (TryNewEngine() ?? throw new QuickAddBusyException(), 0);
            var engine = held.Value.Engine;
            // The count grows with the person's lists, tags and people, which the app's code looks through.
            engine.Constraints.Find<ReadingBudget>()!.Statements = StatementsFor(context);
            engine.Constraints.Reset();
            string output;
            try
            {
                output = engine.Invoke("quickAdd", input).AsString();
            }
            catch (Exception error) when (error is TooMuchWorkException or TimeoutException or MemoryLimitExceededException or RecursionDepthOverflowException
                or System.Text.RegularExpressions.RegexMatchTimeoutException || IsTooDeep(error))
            {
                held = null;
                throw new QuickAddTooSlowException(error);
            }
            catch
            {
                // An engine that threw may be in any state: not reused.
                held = null;
                throw;
            }
            held = (engine, held.Value.Calls + 1);
            return Parse(JsonNode.Parse(output)!.AsObject());
        }
        finally
        {
            if (held is { } done && done.Calls < limits.CallsPerEngine) idle.Add(done);
            slots.Release();
        }
    }

    /// <summary>The recursion limit, as Jint reports it inside a script: a RangeError about the call stack.</summary>
    internal static bool IsTooDeep(Exception error) =>
        error is JavaScriptException script && script.Message.Contains("call stack", StringComparison.OrdinalIgnoreCase);

    private static QuickAddResult Parse(JsonObject parsed)
    {
        static QuickMoment? Moment(JsonNode? node) =>
            node is JsonObject moment ? new QuickMoment((string)moment["date"]!, (string?)moment["time"]) : null;
        return new QuickAddResult(
            (string?)parsed["title"] ?? "",
            [.. (parsed["tokens"]?.AsArray() ?? []).Select(token => new QuickToken((string)token!["kind"]!, (int)token["start"]!, (int)token["end"]!, (string)token["text"]!))],
            parsed["schedule"] is JsonObject schedule ? new QuickSchedule(Moment(schedule["start"])!, Moment(schedule["end"])) : null,
            Moment(parsed["due"]),
            parsed["priority"] is JsonValue priority ? (int)priority : null,
            (string?)parsed["listId"],
            [.. (parsed["tags"]?.AsArray() ?? []).Select(tag => new QuickTag((string?)tag!["id"], (string)tag["name"]!))],
            [.. (parsed["assignees"]?.AsArray() ?? []).Select(principal => (string)principal!)],
            (string?)parsed["recurrence"]);
    }
}

/// <summary>
/// The limits on an engine's work, checked before every statement: how many statements, and how
/// long. Jint's own (<c>MaxStatements</c>, <c>TimeoutInterval</c>) are fixed when the engine is made;
/// these start at the warm-up's (no count, its time) and are set to a reading's once the engine is
/// ready. Each <c>Constraints.Reset()</c> (Jint does one at every Execute and Invoke) starts both again.
/// </summary>
internal sealed class ReadingBudget(TimeSpan time, long statements) : Constraint
{
    private long deadline = Stopwatch.GetTimestamp() + Ticks(time);

    public TimeSpan Time { get; set; } = time;

    public long Statements { get; set; } = statements;

    private long used;
    private long last;

    /// <summary>Statements the last run took (for tests; Jint resets the count after a run as well as before).</summary>
    public long Used => used > 0 ? used : last;

    public override void Check()
    {
        if (++used > Statements) throw new TooMuchWorkException();
        if (Stopwatch.GetTimestamp() > deadline) throw new TimeoutException("quick add ran past its time limit");
    }

    public override void Reset()
    {
        if (used > 0) last = used;
        used = 0;
        deadline = Stopwatch.GetTimestamp() + Ticks(Time);
    }

    private static long Ticks(TimeSpan span) => (long)(span.TotalSeconds * Stopwatch.Frequency);
}

/// <summary>A reading ran more statements than <see cref="JsQuickAddLimits.Statements"/> allows.</summary>
internal sealed class TooMuchWorkException() : Exception("quick add ran past its statement limit");

/// <summary>Gets quick add's first engine ready in the background once the server starts.</summary>
public sealed class QuickAddPrewarm(IQuickAddReader reader) : IHostedService
{
    public Task StartAsync(CancellationToken cancellationToken)
    {
        // Not awaited: startup doesn't wait for it, and Prewarm logs rather than throws.
        if (reader is JsQuickAdd engines) _ = Task.Run(engines.Prewarm, CancellationToken.None);
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
