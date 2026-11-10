using System.Globalization;

namespace PeckList.Core.Accounts;

/// <summary>
/// One-time sign-in links (spec: Accounts &amp; Admin): an admin hands one to someone who cannot
/// sign in any other way, e.g. after their provider was unbound. Each works once, until it expires.
/// Only a hash of the token is stored.
/// </summary>
public sealed class LoginLinks(ISecretStore secrets, IAccountStore accounts, TimeProvider time)
{
    public const string Kind = "login-link";
    public static readonly TimeSpan DefaultLifetime = TimeSpan.FromHours(24);

    /// <summary>A new token for the account; the link is <c>/auth/link/&lt;token&gt;</c>.</summary>
    public async Task<(string Token, DateTimeOffset Expires)> CreateAsync(
        string accountId, TimeSpan? lifetime = null, CancellationToken cancellation = default)
    {
        _ = await accounts.FindByIdAsync(accountId, cancellation) ?? throw new KeyNotFoundException($"no account {accountId}");
        var token = Tokens.New();
        var expires = time.GetUtcNow() + (lifetime ?? DefaultLifetime);
        await secrets.PutAsync(Kind, Tokens.Hash(token), $"{accountId} {expires.ToString("O", CultureInfo.InvariantCulture)}", cancellation);
        return (token, expires);
    }

    /// <summary>The account the token signs in, using it up; null when unknown, used, expired or the account is disabled.</summary>
    public async Task<Account?> RedeemAsync(string token, CancellationToken cancellation = default)
    {
        // Taken, not marked: a used link leaves no row, and two tries at once cannot both have it.
        var value = await secrets.TakeAsync(Kind, Tokens.Hash(token), cancellation);
        if (string.IsNullOrEmpty(value) || ExpiresOf(value) is not { } expires || expires <= time.GetUtcNow()) return null;
        return await accounts.FindByIdAsync(value.Split(' ')[0], cancellation) is { Disabled: false } account ? account : null;
    }

    /// <summary>When a stored link runs out; null when the value is not one.</summary>
    public static DateTimeOffset? ExpiresOf(string value) =>
        value.Split(' ') is [_, var at] && DateTimeOffset.TryParse(at, CultureInfo.InvariantCulture, DateTimeStyles.None, out var expires)
            ? expires
            : null;
}
