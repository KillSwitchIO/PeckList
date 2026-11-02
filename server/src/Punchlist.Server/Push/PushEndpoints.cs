using System.Globalization;
using System.Security.Claims;
using System.Text.Json.Nodes;
using Punchlist.Core;
using Punchlist.Core.Push;
using Punchlist.Core.Sharing;
using Punchlist.Core.Storage;
using Punchlist.Core.Sync;
using Punchlist.Core.Tasks;
using Punchlist.Server.Auth;

namespace Punchlist.Server.Push;

public sealed record PushKey(string PublicKey);

public sealed record PushKeys(string? P256dh, string? Auth);

/// <summary>A browser's subscription as <c>PushSubscription.toJSON()</c> gives it.</summary>
public sealed record PushSubscribe(string? Endpoint, PushKeys? Keys);

public sealed record PushUnsubscribe(string? Endpoint);

/// <summary>
/// A button on a reminder: the task and the reminder's first time (ms since the epoch). Dismiss and
/// Snooze come from a constant reminder in the browser; Complete and Snooze from the Android app's
/// notifications. <paramref name="Minutes"/>: how long Snooze puts it off (default ten).
/// </summary>
public sealed record ReminderAct(string? TaskId, long First, string? Action, int? Minutes = null);

/// <summary>Web Push (spec: PL-061): the server's key, and this browser's subscription.</summary>
public static class PushEndpoints
{
    public static RouteGroupBuilder MapPush(this RouteGroupBuilder api)
    {
        api.MapGet("/push/key", async (VapidKeys vapid, CancellationToken cancellation) =>
            new PushKey((await vapid.GetAsync(cancellation)).Public));

        api.MapPost("/push/subscriptions", async (PushSubscribe request, ClaimsPrincipal user, IPushStore store, CancellationToken cancellation) =>
        {
            if (!Uri.TryCreate(request.Endpoint, UriKind.Absolute, out var endpoint) || endpoint.Scheme != Uri.UriSchemeHttps
                || string.IsNullOrWhiteSpace(request.Keys?.P256dh) || string.IsNullOrWhiteSpace(request.Keys?.Auth))
            {
                return Results.BadRequest(new { error = "invalid_subscription" });
            }
            await store.SaveAsync(new PushSubscription(user.UserId(), request.Endpoint!, request.Keys.P256dh, request.Keys.Auth), cancellation);
            return Results.NoContent();
        });

        api.MapPost("/push/unsubscribe", async (PushUnsubscribe request, ClaimsPrincipal user, IPushStore store, CancellationToken cancellation) =>
        {
            // Only one's own: an endpoint someone else holds is left alone.
            if (request.Endpoint is { } endpoint
                && (await store.ForUserAsync(user.UserId(), cancellation)).Any(each => each.Endpoint == endpoint))
            {
                await store.RemoveAsync(endpoint, cancellation);
            }
            return Results.NoContent();
        });

        // Dismiss or Snooze pressed on a constant reminder with the app closed (spec: R-FB-70): its
        // repeats stop for this person; Snooze adds a one-time reminder in ten minutes, written to
        // the task so every device has it. The task's other reminders come as before. Complete
        // (the Android app's notifications) closes the task and its open subtasks; a repeating task
        // moves to its next date as the app moves it (RepeatingTask), so the app need not open.
        api.MapPost("/reminders/act", async (
            ReminderAct request, ClaimsPrincipal user, SharingState sharing, IPushStore store, SyncService sync,
            IEntityStore entities, ServerClock clock, TimeProvider time, CancellationToken cancellation) =>
        {
            var userId = user.UserId();
            var index = sharing.Index;
            var found = (Id: request.TaskId ?? "", Doc: request.TaskId is null ? null : index.LiveDocOf(request.TaskId, "tasks"));
            if (found.Doc is null || !ServerReminders.Recipients(found.Doc, index).Contains(userId)) return Results.NotFound();
            if (request.Action is not ("dismiss" or "snooze" or "complete")) return Results.BadRequest(new { error = "unknown_action" });
            // A reminder time, not any number (FromUnixTimeMilliseconds throws outside year 1 to 9999).
            if (request.First is < 0 or > 253_402_300_799_999) return Results.BadRequest(new { error = "invalid_time" });
            var now = time.GetUtcNow();
            if (request.Action == "complete")
            {
                if ((string?)found.Doc["status"] != "open") return Results.NoContent();
                var completedAt = clock.Now();
                var owner = (string?)found.Doc["createdBy"] ?? userId;
                if ((string?)found.Doc["recurrence"] is { Length: > 0 }
                    && await entities.GetAsync(found.Id, cancellation) is { } stored)
                {
                    // Its next date counts from the day it was done, where the person is.
                    var zone = ReminderSender.ZoneOf(ReminderSender.SettingsOf(index, userId));
                    var doneOn = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(time.GetUtcNow(), zone).DateTime);
                    var subtasks = Subtasks(index, found.Id).Select(each => each.Doc);
                    if (RepeatingTask.Complete(stored.Doc, subtasks, userId, completedAt, doneOn, Ids.NewUlid(), clock.Next) is { } moved)
                    {
                        await sync.WriteAsServerAsync(owner, [.. moved.Select(each => new IncomingEntity("tasks", each))], cancellation);
                        return Results.NoContent();
                    }
                }
                var closed = new List<IncomingEntity>();
                foreach (var (_, doc) in WithOpenSubtasks(index, found.Id, found.Doc))
                {
                    var fields = new JsonObject { ["status"] = "done", ["completedAt"] = completedAt, ["completedBy"] = userId };
                    // Done is done: a pinned task lets go of the top, as in the app.
                    if (doc["pinnedAt"] is JsonValue) fields["pinnedAt"] = null;
                    closed.Add(new IncomingEntity("tasks", ServerEntities.Changed(doc, clock.Next(), fields)));
                }
                await sync.WriteAsServerAsync(owner, closed, cancellation);
                return Results.NoContent();
            }
            var first = DateTimeOffset.FromUnixTimeMilliseconds(request.First);
            var tag = $"{found.Id}@{request.First}";
            for (var again = 1; again < ServerReminders.ConstantTimes; again++)
            {
                var at = first + again * ServerReminders.ConstantEvery;
                await store.MarkReminderSentAsync($"{userId}|{tag}#{at.ToUnixTimeMilliseconds()}", now, cancellation);
            }
            if (request.Action == "snooze")
            {
                var zone = ReminderSender.ZoneOf(ReminderSender.SettingsOf(index, userId));
                var local = TimeZoneInfo.ConvertTime(now, zone);
                var nowText = local.ToString("yyyy-MM-dd'T'HH:mm", CultureInfo.InvariantCulture);
                // Up to a week: "tomorrow morning" from late at night is more than a day.
                var minutes = Math.Clamp(request.Minutes ?? SnoozeMinutes, 1, 7 * 24 * 60);
                var later = local.AddMinutes(minutes).ToString("yyyy-MM-dd'T'HH:mm", CultureInfo.InvariantCulture);
                var reminders = new JsonArray();
                if (found.Doc["reminders"] is JsonArray existing)
                {
                    foreach (var each in existing.OfType<JsonObject>())
                    {
                        // Set times already past (earlier snoozes) go.
                        if ((string?)each["at"] is { } setAt && string.CompareOrdinal(setAt, nowText) <= 0) continue;
                        reminders.Add(each.DeepClone());
                    }
                }
                reminders.Add(new JsonObject { ["at"] = later });
                var doc = ServerEntities.Changed(found.Doc, clock.Next(), new JsonObject { ["reminders"] = reminders });
                await sync.WriteAsServerAsync((string?)found.Doc["createdBy"] ?? userId, [new IncomingEntity("tasks", doc)], cancellation);
            }
            return Results.NoContent();
        });

        return api;
    }

    /// <summary>How long Snooze puts a constant reminder off (the app's SNOOZE_MINUTES).</summary>
    public const int SnoozeMinutes = 10;

    /// <summary>A task's live subtasks at any depth, open or not (a repeating task opens them again).</summary>
    private static IEnumerable<(string Id, JsonObject Doc)> Subtasks(SharingIndex index, string id)
    {
        foreach (var child in index.LiveChildrenOf(id))
        {
            yield return child;
            foreach (var each in Subtasks(index, child.Id)) yield return each;
        }
    }

    /// <summary>A task and its subtasks at any depth that are still open, as completing closes them.</summary>
    private static IEnumerable<(string Id, JsonObject Doc)> WithOpenSubtasks(SharingIndex index, string id, JsonObject doc)
    {
        yield return (id, doc);
        var children = index.LiveChildrenOf(id);
        foreach (var child in children)
        {
            foreach (var each in WithOpenSubtasks(index, child.Id, child.Doc))
            {
                if ((string?)each.Doc["status"] == "open") yield return each;
            }
        }
    }
}
