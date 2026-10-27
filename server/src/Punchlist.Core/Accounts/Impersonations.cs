using System.Globalization;

namespace Punchlist.Core.Accounts;

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
        var key = Tokens.Hash(token);
        var value = (await secrets.ListAsync(Kind, cancellation)).FirstOrDefault(each => each.Name == key).Value;
        if (string.IsNullOrEmpty(value)) return null;
        var parts = value.Split(' ', 4);
        if (parts.Length != 4
            || !DateTimeOffset.TryParse(parts[2], CultureInfo.InvariantCulture, DateTimeStyles.None, out var expires)
            || expires <= time.GetUtcNow())
        {
            return null;
        }
        return new Impersonation(parts[0], parts[1], parts[3], expires);
    }

    public Task EndAsync(string token, CancellationToken cancellation = default) =>
        secrets.PutAsync(Kind, Tokens.Hash(token), "", cancellation);
}
