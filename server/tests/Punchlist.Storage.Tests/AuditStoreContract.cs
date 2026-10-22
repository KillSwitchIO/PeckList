using Punchlist.Core.Audit;

namespace Punchlist.Storage.Tests;

/// <summary>What every <see cref="IAuditStore"/> adapter must do.</summary>
public abstract class AuditStoreContract : IAsyncLifetime
{
    protected IAuditStore Audit { get; private set; } = null!;

    protected abstract Task<IAuditStore> CreateAsync();

    public async ValueTask InitializeAsync() => Audit = await CreateAsync();

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private static readonly DateTimeOffset Monday = new(2026, 10, 19, 8, 0, 0, TimeSpan.Zero);

    private static int next;

    private static AuditEntry Entry(
        int minutes, string type, string outcome = AuditOutcome.Ok, string? actor = "ben", string? target = null,
        string kind = AuditKind.Event, string? ip = "10.0.0.5", string? detail = null) => new()
    {
        Id = $"E{Interlocked.Increment(ref next):D6}",
        Time = Monday.AddMinutes(minutes),
        Kind = kind,
        Type = type,
        Outcome = outcome,
        ActorId = actor is null ? null : "id-" + actor,
        ActorName = actor,
        TargetId = target is null ? null : "id-" + target,
        TargetName = target,
        Ip = ip,
        Device = "Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0",
        Detail = detail,
    };

    [Fact]
    public async Task Keeps_every_field_and_pages_newest_first()
    {
        var full = Entry(0, "admin.role-changed", target: "sam", detail: "role=admin") with
        {
            ImpersonatorId = "id-ann",
            ImpersonatorName = "ann",
            Method = "PUT",
            Route = "/api/admin/users/{id}/role",
            Status = 200,
            DurationMs = 12,
            RequestId = "0HN1",
        };
        await Audit.AppendAsync([full, Entry(1, "auth.sign-in"), Entry(2, "auth.sign-out")], Token);
        await Audit.AppendAsync([], Token);

        var first = await Audit.QueryAsync(new AuditQuery { Limit = 2 }, Token);
        Assert.Equal(["auth.sign-out", "auth.sign-in"], first.Entries.Select(entry => entry.Type));
        Assert.True(first.More);
        var rest = await Audit.QueryAsync(new AuditQuery { Limit = 2, Offset = 2 }, Token);
        Assert.Equal(full, Assert.Single(rest.Entries));
        Assert.False(rest.More);
        Assert.Equal(["admin.role-changed", "auth.sign-in", "auth.sign-out"],
            (await Audit.QueryAsync(new AuditQuery { Ascending = true }, Token)).Entries.Select(entry => entry.Type));
    }

    [Fact]
    public async Task Filters_by_kind_text_user_type_outcome_ip_and_time()
    {
        await Audit.AppendAsync([
            Entry(0, "auth.sign-in", AuditOutcome.Failed, actor: null, target: "Kim", ip: "203.0.113.9"),
            Entry(1, "auth.sign-in", actor: "kim"),
            Entry(2, "admin.role-changed", actor: "ben", target: "kim", detail: "role=admin"),
            Entry(3, "settings.saved", actor: "ben", detail: "LOG_LEVEL 50%_off"),
            Entry(4, "request", kind: AuditKind.Access, actor: "kim") with { Route = "/api/sync", Method = "POST", Status = 200 },
        ], Token);

        async Task<string[]> Types(AuditQuery query) => [.. (await Audit.QueryAsync(query, Token)).Entries.Select(entry => entry.Type + "@" + entry.Time.Minute)];

        Assert.Equal(["request@4"], await Types(new AuditQuery { Kind = AuditKind.Access }));
        Assert.Equal(["admin.role-changed@2", "auth.sign-in@1", "auth.sign-in@0"], await Types(new AuditQuery { User = "kim" }));
        // Ids match exactly; names ignore case.
        Assert.Equal(["admin.role-changed@2", "auth.sign-in@1"], await Types(new AuditQuery { User = "id-kim" }));
        Assert.Equal(["auth.sign-in@1", "auth.sign-in@0"], await Types(new AuditQuery { Type = "auth." }));
        Assert.Equal(["settings.saved@3"], await Types(new AuditQuery { Type = "settings.saved" }));
        Assert.Empty(await Types(new AuditQuery { Type = "settings" }));
        Assert.Equal(["auth.sign-in@0"], await Types(new AuditQuery { Outcome = AuditOutcome.Failed }));
        Assert.Equal(["auth.sign-in@0"], await Types(new AuditQuery { Ip = "203.0.113.9" }));
        Assert.Equal(["admin.role-changed@2", "auth.sign-in@1"], await Types(new AuditQuery { From = Monday.AddMinutes(1), To = Monday.AddMinutes(3) }));
        // Free text, case-insensitive, with LIKE's own characters taken literally.
        Assert.Equal(["admin.role-changed@2"], await Types(new AuditQuery { Text = "ROLE=ADMIN" }));
        Assert.Equal(["settings.saved@3"], await Types(new AuditQuery { Text = "50%_" }));
        Assert.Empty(await Types(new AuditQuery { Text = "5_%" }));
        Assert.Equal(["request@4"], await Types(new AuditQuery { Kind = AuditKind.Access, Text = "/api/sync" }));
    }

    [Fact]
    public async Task Hands_out_and_prunes_old_entries_of_one_kind()
    {
        await Audit.AppendAsync([
            Entry(0, "auth.sign-in"),
            Entry(10, "auth.sign-out"),
            Entry(20, "auth.sign-in"),
            Entry(0, "request", kind: AuditKind.Access),
        ], Token);
        var cutoff = Monday.AddMinutes(15);
        Assert.Equal(["auth.sign-in", "auth.sign-out"], (await Audit.OlderAsync(AuditKind.Event, cutoff, 10, Token)).Select(entry => entry.Type));
        Assert.Single(await Audit.OlderAsync(AuditKind.Event, cutoff, 1, Token));
        Assert.Equal(2, await Audit.PruneAsync(AuditKind.Event, cutoff, Token));
        Assert.Single((await Audit.QueryAsync(new AuditQuery(), Token)).Entries);
        Assert.Single((await Audit.QueryAsync(new AuditQuery { Kind = AuditKind.Access }, Token)).Entries);
    }
}
