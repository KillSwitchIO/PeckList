using System.Globalization;
using System.Net.Mail;

namespace PeckList.Core.Accounts;

/// <summary>
/// A person's email and the links sent to it (PL-122): a confirmation link when the email is set,
/// and password reset links, which only ever go to a confirmed email. Links work once, until they
/// expire; only a hash of each token is stored.
/// </summary>
public sealed class AccountEmails(IAccountStore accounts, ISecretStore secrets, TimeProvider time)
{
    public const string ResetKind = "password-reset";
    public const string ConfirmKind = "email-confirm";
    public static readonly TimeSpan ResetLifetime = TimeSpan.FromMinutes(30);
    public static readonly TimeSpan ConfirmLifetime = TimeSpan.FromDays(1);
    public const int MaxLength = 254;

    /// <summary>The email in its stored form (trimmed, lowercase), or null when it is not one.</summary>
    public static string? Normalize(string? email)
    {
        var value = email?.Trim().ToLowerInvariant();
        if (string.IsNullOrEmpty(value) || value.Length > MaxLength || value.Any(char.IsWhiteSpace)) return null;
        return MailAddress.TryCreate(value, out var parsed) && parsed.Address == value && value.IndexOf('@') > 0 ? value : null;
    }

    /// <summary>
    /// Set (or, with null, remove) the account's email. A new address starts unconfirmed; setting
    /// the one it already has changes nothing.
    /// </summary>
    /// <exception cref="ArgumentException">Not an email address.</exception>
    public async Task<Account> SetAsync(string accountId, string? email, CancellationToken cancellation = default)
    {
        var account = await accounts.FindByIdAsync(accountId, cancellation) ?? throw new KeyNotFoundException($"no account {accountId}");
        string? next = null;
        if (!string.IsNullOrWhiteSpace(email))
        {
            next = Normalize(email) ?? throw new ArgumentException("that is not an email address");
        }
        if (next == account.Email) return account;
        var updated = account with { Email = next, EmailVerifiedAt = null };
        await accounts.UpdateAsync(updated, cancellation);
        return updated;
    }

    /// <summary>
    /// An identity provider vouches for this email (<c>email_verified</c>): it becomes the account's
    /// confirmed email when the account has none of its own, or already has this one unconfirmed.
    /// </summary>
    public async Task<Account> VouchedAsync(Account account, string? email, CancellationToken cancellation = default)
    {
        if (Normalize(email) is not { } address) return account;
        if (account.VerifiedEmail is not null || (account.Email is not null && account.Email != address)) return account;
        var updated = account with { Email = address, EmailVerifiedAt = time.GetUtcNow() };
        await accounts.UpdateAsync(updated, cancellation);
        return updated;
    }

    /// <summary>A link token confirming the account's current email; the link is <c>/auth/confirm-email/&lt;token&gt;</c>.</summary>
    public Task<string> ConfirmTokenAsync(Account account, CancellationToken cancellation = default)
    {
        var email = account.Email ?? throw new InvalidOperationException("the account has no email");
        return IssueAsync(ConfirmKind, $"{account.Id} {email}", ConfirmLifetime, cancellation);
    }

    /// <summary>
    /// Confirm the email a token was made for, using it up; null when the token is unknown, used or
    /// expired, or the account's email has changed since.
    /// </summary>
    public async Task<Account?> ConfirmAsync(string token, CancellationToken cancellation = default)
    {
        if (await RedeemAsync(ConfirmKind, token, cancellation) is not [var id, var email]) return null;
        if (await accounts.FindByIdAsync(id, cancellation) is not { DeletedAt: null } account || account.Email != email) return null;
        if (account.EmailVerifiedAt is not null) return account;
        var updated = account with { EmailVerifiedAt = time.GetUtcNow() };
        await accounts.UpdateAsync(updated, cancellation);
        return updated;
    }

    /// <summary>
    /// Who a forgot-password request for <paramref name="login"/> (a username or an email) reaches:
    /// active accounts with a confirmed email, found by username or by that confirmed email.
    /// </summary>
    public async Task<IReadOnlyList<Account>> ResetRecipientsAsync(string login, CancellationToken cancellation = default)
    {
        var typed = login.Trim().ToLowerInvariant();
        if (typed.Length is 0 or > MaxLength) return [];
        var found = new List<Account>();
        if (typed.Contains('@'))
        {
            found.AddRange((await accounts.FindByEmailAsync(typed, cancellation)).Where(account => account.VerifiedEmail == typed));
        }
        else if (await accounts.FindByUsernameAsync(typed, cancellation) is { VerifiedEmail: not null } byName)
        {
            found.Add(byName);
        }
        return found.Where(account => !account.Disabled && account.DeletedAt is null).ToList();
    }

    /// <summary>A reset link token for an account; the link is <c>/reset/&lt;token&gt;</c>.</summary>
    public Task<string> ResetTokenAsync(Account account, CancellationToken cancellation = default) =>
        // The stamp ties the link to the password as it is: once that changes, the link is dead.
        IssueAsync(ResetKind, $"{account.Id} {account.SecurityStamp}", ResetLifetime, cancellation);

    /// <summary>The account a reset token is for, without using it up; null when it no longer works.</summary>
    public async Task<Account?> ResetAccountAsync(string token, CancellationToken cancellation = default) =>
        await ReadAsync(ResetKind, token, cancellation) is [var id, var stamp] ? await ActiveAsync(id, stamp, cancellation) : null;

    /// <summary>Use up a reset token once the new password is set.</summary>
    public Task SpendResetAsync(string token, CancellationToken cancellation = default) =>
        secrets.DeleteAsync(ResetKind, Tokens.Hash(token), cancellation);

    private async Task<Account?> ActiveAsync(string id, string stamp, CancellationToken cancellation) =>
        await accounts.FindByIdAsync(id, cancellation) is { Disabled: false, DeletedAt: null } account && account.SecurityStamp == stamp
            ? account
            : null;

    private async Task<string> IssueAsync(string kind, string what, TimeSpan lifetime, CancellationToken cancellation)
    {
        var token = Tokens.New();
        var expires = time.GetUtcNow() + lifetime;
        await secrets.PutAsync(kind, Tokens.Hash(token), $"{what} {expires.ToString("O", CultureInfo.InvariantCulture)}", cancellation);
        return token;
    }

    /// <summary>What a live token was issued for (its words, without the expiry); null when unknown, used or expired.</summary>
    private async Task<string[]?> ReadAsync(string kind, string token, CancellationToken cancellation) =>
        Live(await secrets.GetAsync(kind, Tokens.Hash(token), cancellation));

    /// <summary>Taken, not marked: a used token leaves no row, and two tries at once cannot both have it.</summary>
    private async Task<string[]?> RedeemAsync(string kind, string token, CancellationToken cancellation) =>
        Live(await secrets.TakeAsync(kind, Tokens.Hash(token), cancellation));

    private string[]? Live(string? value) =>
        !string.IsNullOrEmpty(value) && ExpiresOf(value) is { } expires && expires > time.GetUtcNow() ? value.Split(' ')[..^1] : null;

    /// <summary>When a stored token runs out (its last word); null when the value is not one.</summary>
    public static DateTimeOffset? ExpiresOf(string value) =>
        value.Split(' ') is { Length: >= 2 } parts
        && DateTimeOffset.TryParse(parts[^1], CultureInfo.InvariantCulture, DateTimeStyles.None, out var expires)
            ? expires
            : null;
}
