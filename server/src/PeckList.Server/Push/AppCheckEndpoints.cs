using System.Security.Claims;
using PeckList.Core;
using PeckList.Core.Accounts;
using PeckList.Core.Notifications;
using PeckList.Core.Sharing;
using PeckList.Server.Auth;

namespace PeckList.Server.Push;

/// <summary>A notification for the Android app to show, with its buttons left to right (R-FB-106, R-FB-107).</summary>
public sealed record AppCheckNotification(string Id, string Kind, string Title, string Body, string Url, IReadOnlyList<PushAction> Actions);

/// <summary>
/// <paramref name="At"/>: milliseconds since the epoch. <paramref name="Constant"/>: it comes again
/// every few minutes; <paramref name="Repeats"/>: the task repeats, so completing it is the app's job.
/// </summary>
public sealed record AppCheckReminder(string Tag, string Title, string Body, long At, string Url, bool Constant = false, bool Repeats = false);

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
            var mine = ReminderSender.SettingsOf(index, me);
            // A first check starts from now (a ULID sorts by time), taken before looking so nothing slips past.
            var start = after ?? Ids.NewUlid(time);
            var latest = await store.ListAsync(me, NotificationEndpoints.FeedSize, cancellation);
            var cursor = latest.Select(each => each.Id).Append(start).Max(StringComparer.Ordinal);

            // The first check only notes where things stand: what came before is not news.
            var fresh = after is null
                ? []
                : latest
                    .Where(each => each.ReadAt is null && each.Kind != NotificationKind.Reminder
                        && string.CompareOrdinal(each.Id, after) > 0
                        && NotificationSwitches.Allows(mine, each.Kind))
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
                notifications.Add(new AppCheckNotification(each.Id, each.Kind, "PeckList", body, url, NotificationText.ActionsOf(each, url)));
            }

            var now = time.GetUtcNow();
            var reminders = ReminderSender.UpcomingFor(index, me, now, now + Ahead, zone)
                .Take(AheadMax)
                .Select(each => new AppCheckReminder(each.Key, each.Title, each.Body, each.At.ToUnixTimeMilliseconds(), each.Url, each.Constant, each.Repeats))
                .ToList();
            return new AppCheck(cursor, notifications, reminders);
        });

        return api;
    }
}
