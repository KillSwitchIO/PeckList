using System.Globalization;
using System.Security.Claims;
using System.Text;
using PeckList.Core;
using PeckList.Core.Calendars;
using PeckList.Core.Configuration;
using PeckList.Core.Sharing;
using PeckList.Google;
using PeckList.Server.Audit;
using PeckList.Server.Auth;

namespace PeckList.Server.Calendars;

/// <summary>A connected account as Settings &gt; Calendars shows it. Never its secret.</summary>
public sealed record CalendarAccountView(
    string Id, string Provider, string Name, string ServerUrl, string? Username, string Status, string? Problem,
    bool CanCreateCalendar, IReadOnlyList<CalendarLinkView> Calendars);

/// <summary>One calendar of an account and how this person uses it.</summary>
public sealed record CalendarLinkView(
    string Id, string Name, string? Color, bool ReadOnly, string Mode, string? TagId, string? ListId, bool MadeByPeckList,
    DateTimeOffset? SyncedAt, string? Problem, DateTimeOffset? NextAttempt);

/// <summary>The person's accounts, and the kinds this server can connect now (<c>caldav</c>, and <c>google</c> when a Google client is set up).</summary>
public sealed record CalendarAccountsView(IReadOnlyList<CalendarAccountView> Accounts, IReadOnlyList<string> Providers);

/// <summary>Connect a CalDAV account: the address, the username and an app password.</summary>
public sealed record CalendarConnectRequest(string? ServerUrl, string? Username, string? Password, string? Provider = null);

/// <summary>How to use a calendar: <c>off</c>, <c>show</c>, or <c>sync</c> with a tag (and the list new tasks land in).</summary>
public sealed record CalendarLinkRequest(string? Mode, string? TagId, string? ListId);

/// <summary>"Make a PeckList calendar" in an account, synced with a tag.</summary>
public sealed record CalendarCreateRequest(string? Name, string? TagId, string? ListId);

/// <summary>A shown event's occurrence. <see cref="Editable"/> is false on repeating events and read-only calendars.</summary>
public sealed record CalendarEventView(
    string Id, string LinkId, string Occurrence, string Title, string Notes, string Start, string? End, bool AllDay, string? TimeZone,
    bool Recurring, bool Editable, string? Color);

/// <summary>Shown events; <see cref="Truncated"/> names links that had more than one request shows (Security N4).</summary>
public sealed record CalendarEventsView(IReadOnlyList<CalendarEventView> Events, IReadOnlyList<string> Truncated);

/// <summary>An edit to a shown event; times as the calendar takes them (<c>2026-11-03</c> or <c>2026-11-03T09:00</c>).</summary>
public sealed record CalendarEventEdit(string? Title, string? Notes, string? Start, string? End, string? TimeZone);

/// <summary>The task "Make it a task" made.</summary>
public sealed record CalendarTaskMade(string TaskId);

/// <summary>Which occurrence; none means the whole event.</summary>
public sealed record CalendarOccurrenceRequest(string? Occurrence);

/// <summary>
/// The person's calendars (spec: PL-134, Settings &gt; Calendars): connect and disconnect accounts, pick
/// how each calendar is used, sync now, and the shown events (read, edit single ones, hide, make a
/// task). All 404 while <c>CALENDAR_SYNC</c> is off. Each person sees and changes only their own.
/// </summary>
public static class CalendarEndpoints
{
    /// <summary>The rate limit on connecting, which makes the server dial out.</summary>
    public const string ConnectRateLimit = "calendar-connect";

    /// <summary>Connect tries a person may make per <see cref="ConnectWindow"/>.</summary>
    public const int ConnectsPerWindow = 10;

    public static readonly TimeSpan ConnectWindow = TimeSpan.FromMinutes(15);

    /// <summary>
    /// The rate limit on "Sync now": each one is a full run, and runs go one at a time on the server,
    /// so one person pressing it over and over would hold everyone else's sync up.
    /// </summary>
    public const string SyncNowRateLimit = "calendar-sync-now";

    /// <summary>"Sync now" presses a person may make per <see cref="SyncNowWindow"/>, all their calendars together.</summary>
    public const int SyncsPerWindow = 6;

    public static readonly TimeSpan SyncNowWindow = TimeSpan.FromMinutes(1);

    /// <summary>The audit entries of connecting and disconnecting a calendar account, any provider; the detail is its kind.</summary>
    public const string ConnectedAudit = "account.calendar-connected";

    public const string DisconnectedAudit = "account.calendar-disconnected";

    private const int MaxUrl = 2048;
    private const int MaxName = 256;
    private const int MaxSecret = 1024;

    public static RouteGroupBuilder MapCalendars(this RouteGroupBuilder api)
    {
        var calendars = api.MapGroup("/calendars").AddEndpointFilter(async (context, next) =>
            context.HttpContext.RequestServices.GetRequiredService<LiveSettings>().Current.CalendarSync ? await next(context) : Results.NotFound());

        calendars.MapGet("", async (ClaimsPrincipal user, ICalendarStore store, CalendarSync engine, GoogleConnect google, CancellationToken cancellation) =>
            new CalendarAccountsView(await AccountViewsAsync(user.UserId(), store, engine, cancellation), Providers(engine, google)))
            .Doc<CalendarAccountsView>("Your connected calendar accounts and how each calendar is used");

        calendars.MapPost("/accounts", async (CalendarConnectRequest request, ClaimsPrincipal user, ICalendarStore store, CalendarSync engine,
            ICalendarSecrets secrets, AuditLog audit, HttpContext context, TimeProvider time, CancellationToken cancellation) =>
        {
            var kind = request.Provider ?? "caldav";
            // Google signs in through its own flow, never with a password here.
            if (kind == "google" || engine.Provider(kind) is not { } provider) return Refuse(400, "calendar_provider_unavailable", "this server cannot connect that kind of calendar");
            if (!Uri.TryCreate(request.ServerUrl, UriKind.Absolute, out var address) || address.Scheme is not ("https" or "http") || request.ServerUrl!.Length > MaxUrl)
            {
                return Refuse(400, "invalid_url", "the server address must be a full http or https address");
            }
            if (string.IsNullOrWhiteSpace(request.Username) || request.Username.Length > MaxName) return Refuse(400, "invalid_username", "a username is needed");
            if (string.IsNullOrEmpty(request.Password) || request.Password.Length > MaxSecret) return Refuse(400, "invalid_password", "an app password is needed");
            var connection = new CalendarConnection(request.ServerUrl, request.Username.Trim(), request.Password);
            IReadOnlyList<RemoteCalendar> found;
            try
            {
                found = await provider.CalendarsAsync(connection, cancellation);
            }
            catch (CalendarProblem problem)
            {
                // Nothing is stored for a connection that does not work.
                return problem.Kind switch
                {
                    CalendarProblemKind.Auth => Refuse(400, "calendar_auth_failed", "the calendar service refused the username or password"),
                    CalendarProblemKind.Unavailable or CalendarProblemKind.RateLimited => Refuse(502, "calendar_unreachable", "the calendar service could not be reached"),
                    // The adapter's own code and words (an address it will not call, not a calendar server, ...).
                    _ => Refuse(400, problem.Code, problem.Message),
                };
            }
            var account = new CalendarAccount(Ids.NewUlid(time), user.UserId(), kind, connection.Username!, request.ServerUrl, connection.Username,
                await secrets.ProtectAsync(request.Password, cancellation), CalendarAccount.Ok, null, time.GetUtcNow());
            await store.SaveAccountAsync(account, cancellation);
            foreach (var remote in found) await store.SaveLinkAsync(NewLink(Ids.NewUlid(time), account, remote, CalendarModes.Off, null, null, false), cancellation);
            audit.RecordEvent(context, ConnectedAudit, user.UserId(), user.FindFirstValue(ClaimTypes.Name), account.Id, null, kind);
            var view = (await AccountViewsAsync(user.UserId(), store, engine, cancellation)).Single(each => each.Id == account.Id);
            return Results.Created($"/api/calendars/accounts/{account.Id}", view);
        }).RequireRateLimiting(ConnectRateLimit).Doc<CalendarAccountView>("Connect a CalDAV account (the server checks it first)", StatusCodes.Status201Created)
            .Refuses(400, 429, 502);

        calendars.MapDelete("/accounts/{id}", async (string id, ClaimsPrincipal user, ICalendarStore store, CalendarSync engine, AuditLog audit,
            HttpContext context, CancellationToken cancellation) =>
        {
            if (await store.AccountAsync(id, cancellation) is not { } account || account.AccountId != user.UserId()) return Results.NotFound();
            var ending = await EndingAsync(account, store, engine, cancellation);
            await store.DeleteAccountAsync(id, cancellation);
            audit.RecordEvent(context, DisconnectedAudit, user.UserId(), user.FindFirstValue(ClaimTypes.Name), account.Id, null, account.Provider);
            await EndAtProviderAsync(ending, cancellation);
            return Results.NoContent();
        }).Doc("Disconnect a calendar account; tasks and events both stay").Refuses(404);

        calendars.MapPost("/accounts/{id}/calendars", async (string id, CalendarCreateRequest request, ClaimsPrincipal user, ICalendarStore store,
            CalendarSync engine, CalendarRuns runs, SharingState sharing, TimeProvider time, CancellationToken cancellation) =>
        {
            var userId = user.UserId();
            if (await store.AccountAsync(id, cancellation) is not { } account || account.AccountId != userId) return Results.NotFound();
            if (engine.Provider(account.Provider) is not { Capabilities.CreateCalendar: true } provider)
            {
                return Refuse(400, "calendar_cannot_create", "this account cannot make new calendars");
            }
            var name = request.Name?.Trim();
            if (string.IsNullOrEmpty(name) || name.Length > MaxName) return Refuse(400, "invalid_name", "the calendar needs a name");
            if (TagProblem(request.TagId, userId, sharing) is { } tagProblem) return tagProblem;
            if (ListProblem(request.ListId, userId, sharing) is { } listProblem) return listProblem;
            RemoteCalendar made;
            try
            {
                made = await provider.CreateCalendarAsync(await engine.ConnectionAsync(account, cancellation), name, cancellation);
            }
            catch (CalendarProblem problem)
            {
                return Refuse(502, problem.Code, "the calendar service did not make the calendar");
            }
            var link = NewLink(Ids.NewUlid(time), account, made, CalendarModes.Sync, request.TagId, request.ListId, true);
            await store.SaveLinkAsync(link, cancellation);
            await runs.RunNowAsync(link.Id, cancellation);
            return Results.Created($"/api/calendars/{link.Id}", View((await store.LinkAsync(link.Id, cancellation))!));
        }).Doc<CalendarLinkView>("Make a new calendar in the account, synced with a tag", StatusCodes.Status201Created).Refuses(400, 404, 502);

        calendars.MapPut("/{linkId}", async (string linkId, CalendarLinkRequest request, ClaimsPrincipal user, ICalendarStore store, CalendarRuns runs,
            SharingState sharing, CalendarChannels channels, TimeProvider time, CancellationToken cancellation) =>
        {
            var userId = user.UserId();
            if (await store.LinkAsync(linkId, cancellation) is not { } link || link.AccountId != userId) return Results.NotFound();
            if (!CalendarModes.IsMode(request.Mode)) return Refuse(400, "invalid_mode", "the mode is off, show or sync");
            string? tagId = null, listId = null;
            if (request.Mode == CalendarModes.Sync)
            {
                if (link.ReadOnly) return Refuse(400, "calendar_read_only", "a read-only calendar can only show its events");
                if (TagProblem(request.TagId, userId, sharing) is { } tagProblem) return tagProblem;
                if (ListProblem(request.ListId, userId, sharing) is { } listProblem) return listProblem;
                tagId = request.TagId;
                listId = request.ListId;
            }
            var restart = request.Mode != link.Mode || tagId != link.TagId;
            var changed = link with { Mode = request.Mode!, TagId = tagId, ListId = listId };
            if (restart)
            {
                // Another use starts over: a fresh listing, and the markers pair PeckList's own events again.
                // A calendar still backing off keeps its backoff: changing the mode is no way around it.
                await store.ClearItemsAsync(link.Id, cancellation);
                changed = changed with { SyncToken = null, TaskCursor = 0, SyncedAt = null };
                if (link.NextAttempt is not { } wait || wait <= time.GetUtcNow()) changed = changed with { Problem = null, Failures = 0, NextAttempt = null };
            }
            await store.SaveLinkAsync(changed, cancellation);
            // Off: its calendar's pushes are no longer wanted.
            if (changed.Mode == CalendarModes.Off) await channels.StopAsync(link, cancellation);
            if (restart && changed.Mode != CalendarModes.Off) await runs.RunNowAsync(link.Id, cancellation);
            return Results.Ok(View((await store.LinkAsync(link.Id, cancellation))!));
        }).Doc<CalendarLinkView>("Choose how a calendar is used: off, show events, or sync with a tag").Refuses(400, 404);

        calendars.MapPost("/{linkId}/sync", async (string linkId, ClaimsPrincipal user, ICalendarStore store, CalendarRuns runs, CancellationToken cancellation) =>
        {
            if (await store.LinkAsync(linkId, cancellation) is not { } link || link.AccountId != user.UserId()) return Results.NotFound();
            await runs.RunNowAsync(linkId, cancellation);
            return Results.Ok(View((await store.LinkAsync(linkId, cancellation))!));
        }).RequireRateLimiting(SyncNowRateLimit).Doc<CalendarLinkView>("Sync a calendar now").Refuses(404, 429);

        calendars.MapGet("/events", async (string? from, string? to, ClaimsPrincipal user, ICalendarStore store, CancellationToken cancellation) =>
        {
            if (!TryDay(from, out var first) || !TryDay(to, out var last) || last < first) return Refuse(400, "invalid_range", "from and to are days, from first");
            if (last.DayNumber - first.DayNumber + 1 > CalendarOccurrences.MaxDays) return Refuse(400, "invalid_range", $"at most {CalendarOccurrences.MaxDays} days at a time");
            var events = new List<CalendarEventView>();
            var truncated = new List<string>();
            foreach (var link in (await store.LinksAsync(user.UserId(), cancellation)).Where(each => each.Mode == CalendarModes.Show))
            {
                var expanded = CalendarOccurrences.Expand(link.Id, await store.ItemsAsync(link.Id, cancellation), first, last, out var cut);
                if (cut) truncated.Add(link.Id);
                foreach (var shown in expanded)
                {
                    events.Add(new CalendarEventView(EventKey(link.Id, shown.EventId), link.Id, shown.Occurrence, shown.Data.Summary, shown.Data.Description,
                        shown.Data.Start.Value, shown.Data.End?.Value, shown.Data.AllDay, shown.Data.Start.TimeZone, shown.Recurring,
                        !shown.Recurring && !link.ReadOnly, link.Color));
                }
            }
            return Results.Ok(new CalendarEventsView([.. events.OrderBy(each => each.Start, StringComparer.Ordinal)], truncated));
        }).Doc<CalendarEventsView>($"Shown calendars' events from one day to another (at most {CalendarOccurrences.MaxDays} days)").Refuses(400);

        calendars.MapPatch("/events/{id}", async (string id, CalendarEventEdit edit, ClaimsPrincipal user, ICalendarStore store, CalendarSync engine,
            TimeProvider time, CancellationToken cancellation) =>
        {
            if (await ShownAsync(id, user.UserId(), store, cancellation) is not { } found) return Results.NotFound();
            var (link, item, remote) = found;
            if (link.ReadOnly) return Refuse(400, "calendar_read_only", "this calendar is read-only");
            if (remote.Data.RRule is not null || remote.SeriesId is not null)
            {
                return Refuse(409, "calendar_recurring_read_only", "repeating events are read-only in PeckList for now");
            }
            if (Edited(remote.Data, edit) is not { } data) return Refuse(400, "invalid_time", "start and end are both days or both times, end after start");
            if (await store.AccountAsync(link.CalendarAccountId, cancellation) is not { } account || engine.Provider(account.Provider) is not { } provider)
            {
                return Results.NotFound();
            }
            RemoteEvent written;
            try
            {
                written = await provider.UpdateEventAsync(await engine.ConnectionAsync(account, cancellation), link.RemoteId, remote, data, cancellation);
            }
            catch (CalendarProblem problem) when (problem.Kind == CalendarProblemKind.Conflict)
            {
                return Refuse(409, "calendar_event_changed", "the event changed on the calendar; look again");
            }
            catch (CalendarProblem problem)
            {
                return Refuse(502, problem.Code, "the calendar service did not take the change");
            }
            await store.SaveItemsAsync(link.Id, [item with { Etag = written.Etag, EventJson = CalendarJson.Write(written), SnapshotJson = CalendarJson.Write(written.Data), UpdatedAt = time.GetUtcNow() }], [], cancellation);
            var day = written.Data.Start.Value[..10];
            return Results.Ok(new CalendarEventView(id, link.Id, day, written.Data.Summary, written.Data.Description, written.Data.Start.Value,
                written.Data.End?.Value, written.Data.AllDay, written.Data.Start.TimeZone, false, true, link.Color));
        }).Doc<CalendarEventView>("Edit a shown event; it is written back to its calendar").Refuses(400, 404, 409, 502);

        calendars.MapPost("/events/{id}/hide", async (string id, CalendarOccurrenceRequest request, ClaimsPrincipal user, ICalendarStore store, CancellationToken cancellation) =>
        {
            if (await ShownAsync(id, user.UserId(), store, cancellation) is not { } found) return Results.NotFound();
            if (request.Occurrence is { } day && !TryDay(day, out _)) return Refuse(400, "invalid_occurrence", "the occurrence is a day");
            var (link, item, _) = found;
            await store.SaveItemsAsync(link.Id, [item with { HiddenJson = HiddenMarks.Read(item.HiddenJson).Hide(request.Occurrence).Write() }], [], cancellation);
            return Results.NoContent();
        }).Doc("Tick a shown event: hide it in PeckList (one occurrence, or all); the calendar is not changed").Refuses(400, 404);

        calendars.MapPost("/events/{id}/task", async (string id, CalendarOccurrenceRequest request, ClaimsPrincipal user, ICalendarStore store,
            CalendarSync engine, CancellationToken cancellation) =>
        {
            var userId = user.UserId();
            if (await ShownAsync(id, userId, store, cancellation) is not { } found) return Results.NotFound();
            var (link, item, remote) = found;
            var data = remote.Data;
            if (request.Occurrence is { } day)
            {
                if (!TryDay(day, out var chosen)) return Refuse(400, "invalid_occurrence", "the occurrence is a day");
                var shown = CalendarOccurrences.Expand(link.Id, [item], chosen, chosen).FirstOrDefault(each => each.Occurrence == day);
                if (shown is null) return Refuse(400, "invalid_occurrence", "the event has no occurrence that day");
                data = shown.Data;
            }
            // A task of its own: no repeat, no link to the event.
            if (await engine.MakeTaskAsync(userId, data with { RRule = null, ExDates = null }, cancellation) is not { } taskId)
            {
                return Refuse(409, "no_inbox", "there is no inbox to put the task in");
            }
            // A single event is hidden whole; a repeating one only on the day made a task.
            var hidden = HiddenMarks.Read(item.HiddenJson).Hide(remote.Data.RRule is null ? null : request.Occurrence);
            await store.SaveItemsAsync(link.Id, [item with { HiddenJson = hidden.Write() }], [], cancellation);
            return Results.Ok(new CalendarTaskMade(taskId));
        }).Doc<CalendarTaskMade>("Make a shown event a task in the inbox, and hide the event").Refuses(400, 404, 409);

        return api;
    }

    private static IResult Refuse(int status, string error, string message) => Results.Json(new AdminError(error, message), statusCode: status);

    /// <summary>A link to a calendar of an account, as connecting makes them.</summary>
    internal static CalendarLink NewLink(string id, CalendarAccount account, RemoteCalendar remote, string mode, string? tagId, string? listId, bool made) =>
        new(id, account.Id, account.AccountId, remote.Id, remote.Name, remote.Color, remote.ReadOnly, mode, tagId, listId, made,
            null, 0, null, null, null, null, 0, null);

    private static async Task<IReadOnlyList<CalendarAccountView>> AccountViewsAsync(string userId, ICalendarStore store, CalendarSync engine, CancellationToken cancellation)
    {
        var links = (await store.LinksAsync(userId, cancellation)).ToLookup(each => each.CalendarAccountId, StringComparer.Ordinal);
        return [.. (await store.AccountsAsync(userId, cancellation)).Select(account => new CalendarAccountView(
            account.Id, account.Provider, account.Name, account.ServerUrl, account.Username, account.Status, account.Problem,
            engine.Provider(account.Provider)?.Capabilities.CreateCalendar == true,
            [.. links[account.Id].Select(View)]))];
    }

    private static CalendarLinkView View(CalendarLink link) =>
        new(link.Id, link.Name, link.Color, link.ReadOnly, link.Mode, link.TagId, link.ListId, link.MadeByPeckList, link.SyncedAt, link.Problem, link.NextAttempt);

    /// <summary>The kinds people can connect here: CalDAV when the server has it, Google when a client is set up and its name is free.</summary>
    private static IReadOnlyList<string> Providers(CalendarSync engine, GoogleConnect google) =>
        [.. new[] { engine.Provider("caldav") is null ? null : "caldav", google.Available ? "google" : null }.OfType<string>()];

    /// <summary>How long a disconnect waits on the provider, all calls together, before it lets go.</summary>
    internal static readonly TimeSpan EndAtProviderWithin = TimeSpan.FromSeconds(10);

    /// <summary>What a disconnect still asks of the provider once the account is gone: its channels stopped, its grant revoked.</summary>
    private sealed record Ending(ICalendarProvider Provider, CalendarConnection Connection, IReadOnlyList<PushChannel> Channels);

    /// <summary>
    /// Read before the account (and its secret) is deleted. Null when there is nothing to ask the
    /// provider, or the secret no longer opens (a changed key, a damaged row): the disconnect goes on.
    /// </summary>
    private static async Task<Ending?> EndingAsync(CalendarAccount account, ICalendarStore store, CalendarSync engine, CancellationToken cancellation)
    {
        if (engine.Provider(account.Provider) is not { } provider) return null;
        IReadOnlyList<PushChannel> channels = provider.Capabilities.Push
            ? [.. (await store.LinksAsync(account.AccountId, cancellation)).Where(each => each.CalendarAccountId == account.Id && each.Channel is not null).Select(each => each.Channel!)]
            : [];
        if (channels.Count == 0 && provider is not GoogleCalendarProvider) return null;
        try
        {
            return new Ending(provider, await engine.ConnectionAsync(account, cancellation), channels);
        }
        catch (Exception) when (!cancellation.IsCancellationRequested)
        {
            return null;
        }
    }

    /// <summary>
    /// After the account is deleted: push channels stopped and a Google grant revoked, so its token
    /// stops working everywhere. Best effort and bounded by <see cref="EndAtProviderWithin"/>: a
    /// disconnect never fails or hangs on the provider (an expired channel stops on its own).
    /// </summary>
    private static async Task EndAtProviderAsync(Ending? ending, CancellationToken cancellation)
    {
        if (ending is null) return;
        using var bounded = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        bounded.CancelAfter(EndAtProviderWithin);
        try
        {
            foreach (var channel in ending.Channels) await ending.Provider.StopWatchAsync(ending.Connection, channel, bounded.Token);
        }
        catch (Exception) when (!cancellation.IsCancellationRequested)
        {
            // Google stops calling when the channel ends; the account is already gone here.
        }
        if (ending.Provider is not GoogleCalendarProvider google) return;
        try
        {
            await google.RevokeAsync(ending.Connection, bounded.Token);
        }
        catch (Exception) when (!cancellation.IsCancellationRequested)
        {
            // Google could not be asked in time; the token is deleted here either way.
        }
    }

    private static IResult? TagProblem(string? tagId, string userId, SharingState sharing) =>
        tagId is not null && sharing.Index.LiveDocOf(tagId, "tags") is not null && sharing.Index.Viewers(tagId).Contains(userId)
            ? null
            : Refuse(400, "unknown_tag", "no tag with this id that you can see");

    private static IResult? ListProblem(string? listId, string userId, SharingState sharing) =>
        listId is null || (sharing.Index.LiveDocOf(listId, "lists") is not null && sharing.Index.ListRole(userId, listId) is "owner" or "editor")
            ? null
            : Refuse(400, "unknown_list", "no list with this id you may add to");

    /// <summary>An event's id in the API: its link and its provider id together, opaque to the client.</summary>
    private static string EventKey(string linkId, string eventId) =>
        Convert.ToBase64String(Encoding.UTF8.GetBytes($"{linkId}\n{eventId}")).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static (string LinkId, string EventId)? ReadKey(string key)
    {
        try
        {
            var padded = key.Replace('-', '+').Replace('_', '/');
            padded += new string('=', (4 - padded.Length % 4) % 4);
            var text = Encoding.UTF8.GetString(Convert.FromBase64String(padded));
            var cut = text.IndexOf('\n', StringComparison.Ordinal);
            return cut > 0 ? (text[..cut], text[(cut + 1)..]) : null;
        }
        catch (FormatException)
        {
            return null;
        }
    }

    /// <summary>A shown event of this person's, by its API id, or null.</summary>
    private static async Task<(CalendarLink Link, CalendarItem Item, RemoteEvent Event)?> ShownAsync(string key, string userId, ICalendarStore store, CancellationToken cancellation)
    {
        if (ReadKey(key) is not { } parts) return null;
        if (await store.LinkAsync(parts.LinkId, cancellation) is not { Mode: CalendarModes.Show } link || link.AccountId != userId) return null;
        var item = (await store.ItemsAsync(link.Id, cancellation)).FirstOrDefault(each => each.EventId == parts.EventId);
        return item is null ? null : (link, item, CalendarJson.ReadEvent(item.EventJson));
    }

    /// <summary>The event with the edit applied, or null when its times do not make sense.</summary>
    private static EventData? Edited(EventData current, CalendarEventEdit edit)
    {
        var data = current with { Summary = edit.Title ?? current.Summary, Description = edit.Notes ?? current.Description };
        if (edit.Start is null && edit.End is null) return data;
        var startText = edit.Start ?? current.Start.Value;
        var endText = edit.End ?? (edit.Start is null ? current.End?.Value : null);
        if (!IsMoment(startText) || (endText is not null && (!IsMoment(endText) || endText.Length != startText.Length || string.CompareOrdinal(endText, startText) <= 0)))
        {
            return null;
        }
        var zone = startText.Length == 10 ? null : edit.TimeZone ?? current.Start.TimeZone;
        return data with
        {
            Start = new CalendarTime(startText, zone),
            End = endText is null ? null : new CalendarTime(endText, zone),
        };
    }

    private static bool IsMoment(string text) =>
        DateTime.TryParseExact(text, ["yyyy-MM-dd", "yyyy-MM-dd'T'HH:mm"], CultureInfo.InvariantCulture, DateTimeStyles.None, out _);

    private static bool TryDay(string? text, out DateOnly day) =>
        DateOnly.TryParseExact(text, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out day);
}
