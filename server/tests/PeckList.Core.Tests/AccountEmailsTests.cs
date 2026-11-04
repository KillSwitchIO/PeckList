using PeckList.Core.Accounts;

namespace PeckList.Core.Tests;

/// <summary>Emails on accounts and the links sent to them (PL-122).</summary>
public sealed class AccountEmailsTests
{
    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private readonly TestClock clock = new(new DateTimeOffset(2026, 11, 4, 9, 0, 0, TimeSpan.Zero));
    private readonly MemoryAccountStore accounts = new();
    private readonly AccountEmails emails;

    public AccountEmailsTests() => emails = new AccountEmails(accounts, new MemorySecretStore(), clock);

    private async Task<Account> Person(string username, string? email = null, bool confirmed = false)
    {
        var account = new Account
        {
            Id = username.ToUpperInvariant(),
            Username = username,
            SecurityStamp = "stamp",
            CreatedAt = clock.Now,
            Email = email,
            EmailVerifiedAt = confirmed ? clock.Now : null,
        };
        await accounts.CreateAsync(account, Token);
        return account;
    }

    [Theory]
    [InlineData(" Sam@Example.COM ", "sam@example.com")]
    [InlineData("sam+tasks@mail.example", "sam+tasks@mail.example")]
    [InlineData("not an email", null)]
    [InlineData("@example.com", null)]
    [InlineData("sam@", null)]
    [InlineData("Sam <sam@example.com>", null)]
    public void Emails_are_kept_trimmed_and_lowercase(string typed, string? stored) =>
        Assert.Equal(stored, AccountEmails.Normalize(typed));

    [Fact]
    public async Task A_new_email_waits_for_its_link_and_a_changed_one_kills_the_old_link()
    {
        var sam = await emails.SetAsync((await Person("sam")).Id, "sam@example.com", Token);
        Assert.Null(sam.VerifiedEmail);
        var link = await emails.ConfirmTokenAsync(sam, Token);
        Assert.Equal("sam@example.com", (await emails.ConfirmAsync(link, Token))!.VerifiedEmail);
        // Once only.
        Assert.Null(await emails.ConfirmAsync(link, Token));

        var moved = await emails.SetAsync(sam.Id, "sam@work.example", Token);
        Assert.Null(moved.EmailVerifiedAt);
        var stale = await emails.ConfirmTokenAsync(moved, Token);
        await emails.SetAsync(sam.Id, "sam@home.example", Token);
        Assert.Null(await emails.ConfirmAsync(stale, Token));
        // The same address again changes nothing.
        var same = await emails.SetAsync(sam.Id, "SAM@home.example", Token);
        Assert.Equal("sam@home.example", same.Email);
    }

    [Fact]
    public async Task A_confirmation_link_lasts_a_day()
    {
        var sam = await emails.SetAsync((await Person("sam")).Id, "sam@example.com", Token);
        var link = await emails.ConfirmTokenAsync(sam, Token);
        clock.Now += AccountEmails.ConfirmLifetime + TimeSpan.FromSeconds(1);
        Assert.Null(await emails.ConfirmAsync(link, Token));
    }

    [Fact]
    public async Task Reset_links_reach_only_confirmed_emails_of_active_accounts()
    {
        await Person("sam", "sam@example.com", confirmed: true);
        await Person("kim", "kim@example.com");
        await Person("pat", "shared@example.com", confirmed: true);
        await Person("lee", "shared@example.com", confirmed: true);
        var gone = await Person("old", "old@example.com", confirmed: true);
        await accounts.UpdateAsync(gone with { Disabled = true }, Token);

        Assert.Equal(["sam"], (await emails.ResetRecipientsAsync("SAM", Token)).Select(each => each.Username));
        Assert.Equal(["sam"], (await emails.ResetRecipientsAsync("sam@example.com", Token)).Select(each => each.Username));
        Assert.Empty(await emails.ResetRecipientsAsync("kim", Token));
        Assert.Empty(await emails.ResetRecipientsAsync("kim@example.com", Token));
        Assert.Empty(await emails.ResetRecipientsAsync("old", Token));
        Assert.Empty(await emails.ResetRecipientsAsync("nobody", Token));
        Assert.Equal(["lee", "pat"], (await emails.ResetRecipientsAsync("shared@example.com", Token)).Select(each => each.Username).Order());
    }

    [Fact]
    public async Task A_reset_link_dies_after_thirty_minutes_or_once_the_password_changes()
    {
        var sam = await Person("sam", "sam@example.com", confirmed: true);
        var link = await emails.ResetTokenAsync(sam, Token);
        Assert.Equal("sam", (await emails.ResetAccountAsync(link, Token))!.Username);
        // Looking does not use it up.
        Assert.NotNull(await emails.ResetAccountAsync(link, Token));

        await accounts.UpdateAsync(sam with { SecurityStamp = "new stamp" }, Token);
        Assert.Null(await emails.ResetAccountAsync(link, Token));

        var fresh = await emails.ResetTokenAsync((await accounts.FindByIdAsync(sam.Id, Token))!, Token);
        clock.Now += AccountEmails.ResetLifetime + TimeSpan.FromSeconds(1);
        Assert.Null(await emails.ResetAccountAsync(fresh, Token));

        clock.Now = clock.Now.AddHours(1);
        var spent = await emails.ResetTokenAsync((await accounts.FindByIdAsync(sam.Id, Token))!, Token);
        await emails.SpendResetAsync(spent, Token);
        Assert.Null(await emails.ResetAccountAsync(spent, Token));
    }

    [Fact]
    public async Task A_provider_that_vouches_fills_an_empty_or_matching_email_but_never_replaces_one()
    {
        var sam = await emails.VouchedAsync(await Person("sam"), "Sam@Example.com", Token);
        Assert.Equal("sam@example.com", sam.VerifiedEmail);
        var kim = await emails.VouchedAsync(await Person("kim", "kim@example.com"), "kim@example.com", Token);
        Assert.Equal("kim@example.com", kim.VerifiedEmail);
        var pat = await emails.VouchedAsync(await Person("pat", "pat@example.com"), "someone@else.example", Token);
        Assert.Equal(("pat@example.com", (DateTimeOffset?)null), (pat.Email, pat.EmailVerifiedAt));
        var lee = await emails.VouchedAsync(await Person("lee", "lee@example.com", confirmed: true), "lee@new.example", Token);
        Assert.Equal("lee@example.com", lee.VerifiedEmail);
    }
}
