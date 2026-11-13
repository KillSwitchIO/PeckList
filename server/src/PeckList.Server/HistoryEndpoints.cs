using System.Security.Claims;
using PeckList.Core;
using PeckList.Core.History;
using PeckList.Core.Notifications;
using PeckList.Core.Sharing;
using PeckList.Server.Auth;

namespace PeckList.Server;

public sealed record HistoryView(string Id, DateTimeOffset At, string? ActorId, string Field, string? Before, string? After);

/// <summary>A task's history (R-FB-105), for whoever can see the task.</summary>
public static class HistoryEndpoints
{
    public const int Size = 200;

    public static RouteGroupBuilder MapHistory(this RouteGroupBuilder api)
    {
        api.MapGet("/tasks/{id}/history", async (string id, ClaimsPrincipal user, ITaskHistoryStore store, SharingState sharing, CancellationToken cancellation) =>
        {
            if (!sharing.Index.Viewers(id).Contains(user.UserId())) return Results.NotFound();
            var entries = await store.ListAsync(id, Size, cancellation);
            return Results.Ok(entries.Select(each => new HistoryView(each.Id, each.At, each.ActorId, each.Field, each.Before, each.After)));
        }).Doc<IReadOnlyList<HistoryView>>($"A task's history, the latest {Size} entries, for anyone who can see the task").Missing();
        return api;
    }
}

/// <summary>
/// Writes each pushed task change into its history (R-FB-105). A person's quick follow-up edits
/// to the same field (within <see cref="Fold"/>) become one entry; changed back to how it was,
/// the entry goes.
/// </summary>
public sealed class TaskHistoryRecorder(ITaskHistoryStore store, TimeProvider time) : ITaskHistorySink
{
    public static readonly TimeSpan Fold = TimeSpan.FromMinutes(10);

    public async Task ChangedAsync(string userId, IReadOnlyList<NotableChange> changes, CancellationToken cancellation = default)
    {
        var now = time.GetUtcNow();
        var fresh = new List<HistoryEntry>();
        foreach (var change in changes)
        {
            foreach (var found in HistoryRules.For(change))
            {
                if (found.Field is not ("created" or "deleted" or "restored" or "notes")
                    && change.Before is not null
                    && await store.LatestAsync(change.Id, found.Field, cancellation) is { } latest
                    && latest.ActorId == userId
                    && now - latest.At < Fold)
                {
                    if (latest.Before == found.After) await store.DeleteAsync(latest.Id, cancellation);
                    else await store.UpdateAsync(latest.Id, found.After, now, cancellation);
                    continue;
                }
                if (found.Field == "notes"
                    && await store.LatestAsync(change.Id, found.Field, cancellation) is { } edited
                    && edited.ActorId == userId
                    && now - edited.At < Fold)
                {
                    await store.UpdateAsync(edited.Id, null, now, cancellation);
                    continue;
                }
                fresh.Add(new HistoryEntry
                {
                    Id = Ids.NewUlid(time),
                    TaskId = change.Id,
                    At = now,
                    ActorId = userId,
                    Field = found.Field,
                    Before = found.Before,
                    After = found.After,
                });
            }
        }
        await store.AddAsync(fresh, cancellation);
    }
}

/// <summary>Clears task history older than a year, once a day.</summary>
public sealed class HistoryRetention(ITaskHistoryStore store, TimeProvider time, ILogger<HistoryRetention> logger)
    : PeriodicService("Clearing old task history", TimeSpan.Zero, TimeSpan.FromDays(1), time, logger, LogLevel.Warning)
{
    public static readonly TimeSpan Keep = TimeSpan.FromDays(365);

    protected override async Task RunAsync(CancellationToken stopping)
    {
        var gone = await store.PruneAsync(Time.GetUtcNow() - Keep, stopping);
        if (gone > 0) Logger.LogInformation("Cleared {Count} task history entries older than {Days} days", gone, Keep.Days);
    }
}
