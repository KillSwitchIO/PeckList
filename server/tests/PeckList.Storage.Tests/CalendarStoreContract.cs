using PeckList.Core.Calendars;
using PeckList.Storage.Sql;

namespace PeckList.Storage.Tests;

/// <summary>What every <see cref="ICalendarStore"/> adapter must do (PL-134).</summary>
public abstract class CalendarStoreContract : IAsyncLifetime
{
    protected ICalendarStore Store { get; private set; } = null!;

    protected abstract Task<ICalendarStore> CreateAsync();

    public async ValueTask InitializeAsync() => Store = await CreateAsync();

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private static readonly DateTimeOffset Monday = new(2026, 11, 23, 8, 0, 0, TimeSpan.Zero);

    private static CalendarAccount Account(string id, string person, int minute = 0) =>
        new(id, person, "caldav", "sam", "https://calendar.example.com", "sam", "enc:secret", CalendarAccount.Ok, null, Monday.AddMinutes(minute));

    private static CalendarLink Link(string id, string account, string person, string mode = CalendarModes.Sync, string remote = "/cal/1/") =>
        new(id, account, person, remote, "Personal", "#3366FF", false, mode, "tag1", null, false, null, 0, null, null, null, null, 0, null);

    private static CalendarItem Item(string link, string eventId, string? task = "task1") =>
        new(link, eventId, task, "\"1\"", "{}", "{}", null, Monday);

    [Fact]
    public async Task An_account_reads_back_as_saved_and_a_save_replaces_it()
    {
        await Store.SaveAccountAsync(Account("a1", "ben"), Token);
        await Store.SaveAccountAsync(Account("a1", "ben") with { Secret = "enc:new", Status = CalendarAccount.AuthFailed, Problem = "calendar_auth_failed" }, Token);

        var read = await Store.AccountAsync("a1", Token);

        Assert.Equal(Account("a1", "ben") with { Secret = "enc:new", Status = CalendarAccount.AuthFailed, Problem = "calendar_auth_failed" }, read);
    }

    [Fact]
    public async Task A_persons_accounts_and_links_are_theirs_alone()
    {
        await Store.SaveAccountAsync(Account("a1", "ben", 1), Token);
        await Store.SaveAccountAsync(Account("a2", "ben", 2), Token);
        await Store.SaveAccountAsync(Account("a3", "kim"), Token);
        await Store.SaveLinkAsync(Link("l1", "a1", "ben"), Token);
        await Store.SaveLinkAsync(Link("l2", "a3", "kim"), Token);

        Assert.Equal(["a1", "a2"], (await Store.AccountsAsync("ben", Token)).Select(each => each.Id));
        Assert.Equal(["l1"], (await Store.LinksAsync("ben", Token)).Select(each => each.Id));
    }

    [Fact]
    public async Task A_link_reads_back_with_its_channel_and_times()
    {
        var link = Link("l1", "a1", "ben") with
        {
            ReadOnly = true,
            MadeByPeckList = true,
            ListId = "list1",
            SyncToken = "token-7",
            TaskCursor = 1234567890123,
            Channel = new PushChannel("ch1", "res1", Monday.AddDays(7)),
            ChannelTokenHash = "hash",
            SyncedAt = Monday,
            Problem = "calendar_unreachable",
            Failures = 3,
            NextAttempt = Monday.AddMinutes(4),
        };

        await Store.SaveLinkAsync(link, Token);

        Assert.Equal(link, await Store.LinkAsync("l1", Token));
    }

    [Fact]
    public async Task A_link_is_found_by_its_push_channel_and_only_by_it()
    {
        await Store.SaveLinkAsync(Link("l1", "a1", "ben") with { Channel = new PushChannel("ch1", "res1", Monday.AddDays(7)), ChannelTokenHash = "hash" }, Token);
        await Store.SaveLinkAsync(Link("l2", "a1", "ben", CalendarModes.Show, "/2/"), Token);

        Assert.Equal("l1", (await Store.LinkByChannelAsync("ch1", Token))?.Id);
        Assert.Null(await Store.LinkByChannelAsync("ch2", Token));
        Assert.Null(await Store.LinkByChannelAsync("", Token));
    }

    [Fact]
    public async Task Only_links_in_use_are_active()
    {
        await Store.SaveLinkAsync(Link("l1", "a1", "ben", CalendarModes.Off, "/1/"), Token);
        await Store.SaveLinkAsync(Link("l2", "a1", "ben", CalendarModes.Show, "/2/"), Token);
        await Store.SaveLinkAsync(Link("l3", "a1", "ben", CalendarModes.Sync, "/3/"), Token);

        Assert.Equal(["l2", "l3"], (await Store.ActiveLinksAsync(Token)).Select(each => each.Id));
    }

    [Fact]
    public async Task Items_are_put_and_removed_together()
    {
        await Store.SaveItemsAsync("l1", [Item("l1", "e1"), Item("l1", "e2", null)], [], Token);
        await Store.SaveItemsAsync("l1", [Item("l1", "e2", "task2") with { Etag = "\"2\"", HiddenJson = "[\"2026-11-03\"]" }], ["e1"], Token);

        var items = await Store.ItemsAsync("l1", Token);

        Assert.Equal([Item("l1", "e2", "task2") with { Etag = "\"2\"", HiddenJson = "[\"2026-11-03\"]" }], items);
    }

    [Fact]
    public async Task Deleting_an_account_takes_its_links_and_items_and_nothing_else()
    {
        await Store.SaveAccountAsync(Account("a1", "ben"), Token);
        await Store.SaveAccountAsync(Account("a2", "ben"), Token);
        await Store.SaveLinkAsync(Link("l1", "a1", "ben"), Token);
        await Store.SaveLinkAsync(Link("l2", "a2", "ben"), Token);
        await Store.SaveItemsAsync("l1", [Item("l1", "e1")], [], Token);
        await Store.SaveItemsAsync("l2", [Item("l2", "e1")], [], Token);

        await Store.DeleteAccountAsync("a1", Token);

        Assert.Null(await Store.AccountAsync("a1", Token));
        Assert.Null(await Store.LinkAsync("l1", Token));
        Assert.Empty(await Store.ItemsAsync("l1", Token));
        Assert.Single(await Store.ItemsAsync("l2", Token));
    }

    [Fact]
    public async Task Removing_a_person_takes_everything_of_theirs()
    {
        await Store.SaveAccountAsync(Account("a1", "ben"), Token);
        await Store.SaveAccountAsync(Account("a2", "kim"), Token);
        await Store.SaveLinkAsync(Link("l1", "a1", "ben"), Token);
        await Store.SaveLinkAsync(Link("l2", "a2", "kim"), Token);
        await Store.SaveItemsAsync("l1", [Item("l1", "e1")], [], Token);

        await Store.RemoveUserAsync("ben", Token);

        Assert.Empty(await Store.AccountsAsync("ben", Token));
        Assert.Empty(await Store.ItemsAsync("l1", Token));
        Assert.NotNull(await Store.LinkAsync("l2", Token));
    }

    [Fact]
    public async Task Clearing_a_links_items_and_deleting_a_link()
    {
        await Store.SaveLinkAsync(Link("l1", "a1", "ben"), Token);
        await Store.SaveItemsAsync("l1", [Item("l1", "e1"), Item("l1", "e2")], [], Token);

        await Store.ClearItemsAsync("l1", Token);
        Assert.Empty(await Store.ItemsAsync("l1", Token));

        await Store.SaveItemsAsync("l1", [Item("l1", "e3")], [], Token);
        await Store.DeleteLinkAsync("l1", Token);
        Assert.Null(await Store.LinkAsync("l1", Token));
        Assert.Empty(await Store.ItemsAsync("l1", Token));
    }
}

public sealed class SqliteCalendarStoreTests(SqliteFiles files) : CalendarStoreContract, IClassFixture<SqliteFiles>
{
    protected override async Task<ICalendarStore> CreateAsync() => new SqlCalendarStore(await files.NewDatabaseAsync());
}

public sealed class PostgresCalendarStoreTests(PostgresServer server) : CalendarStoreContract, IClassFixture<PostgresServer>
{
    protected override async Task<ICalendarStore> CreateAsync() => new SqlCalendarStore(await server.NewDatabaseAsync());
}
