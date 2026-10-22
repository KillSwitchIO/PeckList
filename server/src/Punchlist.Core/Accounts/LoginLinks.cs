using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Punchlist.Core.Accounts;

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
        var token = Base64Url(RandomNumberGenerator.GetBytes(32));
        var expires = time.GetUtcNow() + (lifetime ?? DefaultLifetime);
        await secrets.PutAsync(Kind, Hash(token), $"{accountId} {expires.ToString("O", CultureInfo.InvariantCulture)}", cancellation);
        return (token, expires);
    }

    /// <summary>The account the token signs in, using it up; null when unknown, used, expired or the account is disabled.</summary>
    public async Task<Account?> RedeemAsync(string token, CancellationToken cancellation = default)
    {
        var key = Hash(token);
        var value = (await secrets.ListAsync(Kind, cancellation)).FirstOrDefault(each => each.Name == key).Value;
        if (string.IsNullOrEmpty(value)) return null;
        await secrets.PutAsync(Kind, key, "", cancellation);
        var parts = value.Split(' ');
        if (parts.Length != 2
            || !DateTimeOffset.TryParse(parts[1], CultureInfo.InvariantCulture, DateTimeStyles.None, out var expires)
            || expires <= time.GetUtcNow())
        {
            return null;
        }
        return await accounts.FindByIdAsync(parts[0], cancellation) is { Disabled: false } account ? account : null;
    }

    private static string Hash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    private static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
