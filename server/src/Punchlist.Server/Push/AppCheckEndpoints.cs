using System.Security.Claims;
using Punchlist.Core;
using Punchlist.Core.Accounts;
using Punchlist.Core.Notifications;
using Punchlist.Core.Sharing;
using Punchlist.Server.Auth;

namespace Punchlist.Server.Push;

public sealed record AppCheckNotification(string Id, string Title, string Body, string Url);

/// <summary><paramref name="At"/>: milliseconds since the epoch.</summary>
public sealed record AppCheckReminder(string Tag, string Title, string Body, long At, string Url);

/// <summary><paramref name="Cursor"/>: what to send as <c>after</c> next time.</summary>
public sealed record AppCheck(string? Cursor, IReadOnlyList<AppCheckNotification> Notifications, IReadOnlyList<AppCheckReminder> Reminders);

/// <summary>
/// The Android app's background check-in (ADR-0017): a WebView has no Web Push, so with the app
/// closed it asks every few minutes instead. It gets what is new since it last asked (worded as
/// the push would be) and the reminders ahead, so it can set them even when they were changed on
/// another device. Reminders are left out of the new ones: the alarms set ahead show those.
/// </summary>
public static class AppCheckEndpoints
{
    /// <summary>The same window as the app's own hand-over (web/src/app/reminders/ReminderScheduler.tsx).</summary>
    public static readonly TimeSpan Ahead = TimeSpan.FromDays(14);
    public const int AheadMax = 100;

    public static RouteGroupBuilder MapAppCheck(this RouteGroupBuilder api)
    {
        api.MapGet("/app/check", async (string? after, string? zone, ClaimsPrincipal user, INotificationStore store,
            IAccountStore accounts, SharingState sharing, TimeProvider time, CancellationToken cancellation) =>
        {
            var me = user.UserId();
            var index = sharing.Index;
            // A first check starts from now (a ULID sorts by time), taken before looking so nothing slips past.
            var start = after ?? Ids.NewUlid(time);
            var latest = await store.ListAsync(me, NotificationEndpoints.FeedSize, cancellation);
            var cursor = latest.Select(each => each.Id).Append(start).Max(StringComparer.Ordinal);

            // The first check only notes where things stand: what came before is not news.
            var fresh = after is null
                ? []
                : latest
                    .Where(each => each.ReadAt is null && each.Kind != NotificationKind.Reminder
                        && string.CompareOrdinal(each.Id, after) > 0)
                    .OrderBy(each => each.Id, StringComparer.Ordinal)
                    .ToList();
            var names = new Dictionary<string, string?>(StringComparer.Ordinal);
            var notifications = new List<AppCheckNotification>();
            foreach (var each in fresh)
            {
                string? actor = null;
                if (each.ActorId is { } actorId && !names.TryGetValue(actorId, out actor))
                {
                    actor = names[actorId] = (await accounts.FindByIdAsync(actorId, cancellation))?.Username;
                }
                var (body, url) = NotificationText.Of(each, actor, index);
                notifications.Add(new AppCheckNotification(each.Id, "Punchlist", body, url));
            }

            var now = time.GetUtcNow();
            var reminders = ReminderSender.UpcomingFor(index, me, now, now + Ahead, zone)
                .Take(AheadMax)
                .Select(each => new AppCheckReminder(each.Key, each.Title, each.Body, each.At.ToUnixTimeMilliseconds(), each.Url))
                .ToList();
            return new AppCheck(cursor, notifications, reminders);
        });

        return api;
    }
}
