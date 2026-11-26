using PeckList.Core.Accounts;

namespace PeckList.Core.Calendars;

/// <summary>How a calendar is used in PeckList (spec: PL-134, Settings &gt; Calendars).</summary>
public static class CalendarModes
{
    /// <summary>Not used.</summary>
    public const string Off = "off";

    /// <summary>Its events show beside tasks, editable, ticking hides.</summary>
    public const string Show = "show";

    /// <summary>Synced both ways with a tag.</summary>
    public const string Sync = "sync";

    /// <summary>Whether <paramref name="mode"/> is one of the three.</summary>
    public static bool IsMode(string? mode) => mode is Off or Show or Sync;
}

/// <summary>A connected calendar account of one person.</summary>
/// <param name="AccountId">The PeckList person it belongs to.</param>
/// <param name="Provider">The provider's <see cref="ICalendarProvider.Kind"/>.</param>
/// <param name="Name">What Settings shows (the username, or the Google address).</param>
/// <param name="Secret">The app password or token, encrypted by <see cref="ICalendarSecrets"/>. Never leaves the server.</param>
/// <param name="Status"><c>ok</c>, <c>auth_failed</c> (stopped until the person reconnects) or <c>error</c>.</param>
/// <param name="Problem">The last problem's snake_case code, or null.</param>
public sealed record CalendarAccount(
    string Id,
    string AccountId,
    string Provider,
    string Name,
    string ServerUrl,
    string? Username,
    string Secret,
    string Status,
    string? Problem,
    DateTimeOffset CreatedAt)
{
    /// <summary>Status of an account that works.</summary>
    public const string Ok = "ok";

    /// <summary>Status of an account whose password or token the service refused.</summary>
    public const string AuthFailed = "auth_failed";

    /// <summary>The secret stays out of logs and test output.</summary>
    public override string ToString() => $"CalendarAccount {{ Id = {Id}, AccountId = {AccountId}, Provider = {Provider}, Status = {Status} }}";
}

/// <summary>One calendar of a connected account, and how this person uses it.</summary>
/// <param name="AccountId">The PeckList person (the account's), kept here so a person's links read in one query.</param>
/// <param name="RemoteId">The provider's calendar id.</param>
/// <param name="Mode">One of <see cref="CalendarModes"/>.</param>
/// <param name="TagId">Sync mode: the tag that decides what syncs.</param>
/// <param name="ListId">Sync mode: the list new tasks from the calendar land in; null for the inbox.</param>
/// <param name="SyncToken">The provider's token after the last run; null asks for a full listing.</param>
/// <param name="TaskCursor">The entity-store seq the last run read the person's changes up to.</param>
/// <param name="Channel">An open push channel (Google), with the hash of its token.</param>
/// <param name="Failures">Runs failed in a row; the next waits longer.</param>
/// <param name="NextAttempt">No run before this after a failure.</param>
public sealed record CalendarLink(
    string Id,
    string CalendarAccountId,
    string AccountId,
    string RemoteId,
    string Name,
    string? Color,
    bool ReadOnly,
    string Mode,
    string? TagId,
    string? ListId,
    bool MadeByPeckList,
    string? SyncToken,
    long TaskCursor,
    PushChannel? Channel,
    string? ChannelTokenHash,
    DateTimeOffset? SyncedAt,
    string? Problem,
    int Failures,
    DateTimeOffset? NextAttempt);

/// <summary>
/// One event of a linked calendar as the last run left it: the event read (or written), what both
/// sides agreed on, and for a synced one its task.
/// </summary>
/// <param name="TaskId">The paired task; null in show mode, for overrides, and for events another server wrote.</param>
/// <param name="EventJson">The <see cref="RemoteEvent"/>, Raw included (<see cref="CalendarJson"/>).</param>
/// <param name="SnapshotJson">
/// The <see cref="EventData"/> both sides agreed on at the last run. A side whose mapped value differs
/// from it changed since (spec: Conflicts, latest edit wins).
/// </param>
/// <param name="HiddenJson">Show mode: what the person ticked, the whole event or some occurrences.</param>
public sealed record CalendarItem(
    string LinkId,
    string EventId,
    string? TaskId,
    string Etag,
    string EventJson,
    string SnapshotJson,
    string? HiddenJson,
    DateTimeOffset UpdatedAt);

/// <summary>
/// Where calendar accounts, links and items are kept (PL-134). Server-side only: not workspace entities,
/// so never in exports or workspace snapshots, and left out of backups. Every adapter passes the store
/// contract in PeckList.Storage.Tests.
/// </summary>
public interface ICalendarStore
{
    /// <summary>A person's connected accounts, oldest first.</summary>
    Task<IReadOnlyList<CalendarAccount>> AccountsAsync(string accountId, CancellationToken cancellation = default);

    /// <summary>One account by id, or null.</summary>
    Task<CalendarAccount?> AccountAsync(string id, CancellationToken cancellation = default);

    /// <summary>Add or replace an account.</summary>
    Task SaveAccountAsync(CalendarAccount account, CancellationToken cancellation = default);

    /// <summary>Remove an account with its links and their items.</summary>
    Task DeleteAccountAsync(string id, CancellationToken cancellation = default);

    /// <summary>A person's links, every mode.</summary>
    Task<IReadOnlyList<CalendarLink>> LinksAsync(string accountId, CancellationToken cancellation = default);

    /// <summary>Every link in use (show or sync) on the server, for the background runs.</summary>
    Task<IReadOnlyList<CalendarLink>> ActiveLinksAsync(CancellationToken cancellation = default);

    /// <summary>One link by id, or null.</summary>
    Task<CalendarLink?> LinkAsync(string id, CancellationToken cancellation = default);

    /// <summary>Add or replace a link.</summary>
    Task SaveLinkAsync(CalendarLink link, CancellationToken cancellation = default);

    /// <summary>Remove a link with its items (its calendar is gone from the account).</summary>
    Task DeleteLinkAsync(string id, CancellationToken cancellation = default);

    /// <summary>A link's items.</summary>
    Task<IReadOnlyList<CalendarItem>> ItemsAsync(string linkId, CancellationToken cancellation = default);

    /// <summary>Add or replace <paramref name="put"/> and remove the items of <paramref name="removed"/> event ids, in one transaction.</summary>
    Task SaveItemsAsync(string linkId, IReadOnlyList<CalendarItem> put, IReadOnlyList<string> removed, CancellationToken cancellation = default);

    /// <summary>Remove all of a link's items (its tag or mode changed).</summary>
    Task ClearItemsAsync(string linkId, CancellationToken cancellation = default);

    /// <summary>Remove everything of a person's (their account is being deleted).</summary>
    Task RemoveUserAsync(string accountId, CancellationToken cancellation = default);
}

/// <summary>
/// Encrypts calendar secrets at rest (PL-134, Secrets): the server's settings key, wrapped by
/// <c>CONFIG_KEY</c> when set, so a copy of the database alone opens nothing.
/// </summary>
public interface ICalendarSecrets
{
    /// <summary>The secret as stored.</summary>
    Task<string> ProtectAsync(string secret, CancellationToken cancellation = default);

    /// <summary>The secret back from what was stored.</summary>
    Task<string> UnprotectAsync(string stored, CancellationToken cancellation = default);
}

/// <summary>
/// This server's id on the events it writes (<see cref="EventMarker.Instance"/>), made on first use.
/// Kept with the server's secrets, so a backup restored on the same server pairs its events again.
/// </summary>
public sealed class CalendarInstance(ISecretStore secrets)
{
    /// <summary>The kind it is kept under in the secret store.</summary>
    public const string Kind = "calendar";

    private const string Name = "instance";
    private readonly SemaphoreSlim gate = new(1, 1);
    private string? cached;

    /// <summary>The id, made and kept on first use (two first uses at once make one id).</summary>
    public async Task<string> GetAsync(CancellationToken cancellation = default)
    {
        if (cached is not null) return cached;
        await gate.WaitAsync(cancellation);
        try
        {
            if (cached is not null) return cached;
            var stored = await secrets.GetAsync(Kind, Name, cancellation);
            if (stored is null)
            {
                stored = Ids.NewUlid();
                await secrets.PutAsync(Kind, Name, stored, cancellation);
            }
            return cached = stored;
        }
        finally
        {
            gate.Release();
        }
    }
}
