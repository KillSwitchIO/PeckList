using System.Globalization;

namespace PeckList.Core.Accounts;

/// <summary>A super admin viewing the app as someone else, until it ends.</summary>
public sealed record Impersonation(string AdminId, string TargetId, string Reason, DateTimeOffset Expires);

/// <summary>
/// Impersonation (spec: Account management): a super admin views the app as a user, in one browser
/// tab that holds a short-lived token. The admin's own session stays theirs everywhere else. Only a
/// hash of each token is stored.
/// </summary>
public sealed class Impersonations(ISecretStore secrets, IAccountStore accounts, TimeProvider time)
{
    public const string Kind = "impersonation";
    public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(30);
    public const int MinReasonLength = 3;

    /// <summary>Start one. Null when it is not allowed: a missing, disabled or super admin target, or oneself.</summary>
    /// <exception cref="ArgumentException">No reason given.</exception>
    public async Task<(string Token, Impersonation View)?> StartAsync(
        string adminId, string targetId, string reason, CancellationToken cancellation = default)
    {
        reason = reason.Trim();
        if (reason.Length < MinReasonLength) throw new ArgumentException("say why, in a few words");
        var target = await accounts.FindByIdAsync(targetId, cancellation);
        if (target is null || target.Disabled || target.Role == Role.SuperAdmin || targetId == adminId) return null;
        var token = Tokens.New();
        var view = new Impersonation(adminId, targetId, reason, time.GetUtcNow() + Lifetime);
        await secrets.PutAsync(Kind, Tokens.Hash(token),
            $"{adminId} {targetId} {view.Expires.ToString("O", CultureInfo.InvariantCulture)} {reason}", cancellation);
        return (token, view);
    }

    /// <summary>The impersonation a token stands for, while it lasts.</summary>
    public async Task<Impersonation?> FindAsync(string token, CancellationToken cancellation = default)
    {
        var value = await secrets.GetAsync(Kind, Tokens.Hash(token), cancellation);
        if (string.IsNullOrEmpty(value) || ExpiresOf(value) is not { } expires || expires <= time.GetUtcNow()) return null;
        var parts = value.Split(' ', 4);
        return new Impersonation(parts[0], parts[1], parts[3], expires);
    }

    /// <summary>Ended: the token's row goes.</summary>
    public Task EndAsync(string token, CancellationToken cancellation = default) =>
        secrets.DeleteAsync(Kind, Tokens.Hash(token), cancellation);

    /// <summary>When a stored impersonation ends; null when the value is not one.</summary>
    public static DateTimeOffset? ExpiresOf(string value) =>
        value.Split(' ', 4) is [_, _, var at, _] && DateTimeOffset.TryParse(at, CultureInfo.InvariantCulture, DateTimeStyles.None, out var expires)
            ? expires
            : null;
}
