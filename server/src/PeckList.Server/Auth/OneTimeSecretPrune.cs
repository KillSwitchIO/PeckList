using Microsoft.AspNetCore.DataProtection;
using PeckList.Core.Accounts;

namespace PeckList.Server.Auth;

/// <summary>
/// Once a day, removes one-time tokens nobody used before they ran out, and the empty rows that
/// used ones left before they were deleted on use (audit S14 / B6). A row is removed only when it
/// is empty or its end can be read and has passed; anything else is left as it is.
/// </summary>
public sealed class OneTimeSecretPrune(ISecretStore secrets, IDataProtectionProvider protection, TimeProvider time, ILogger<OneTimeSecretPrune> logger)
    : PeriodicService("Pruning used and expired one-time tokens", TimeSpan.FromMinutes(2), TimeSpan.FromDays(1), time, logger)
{
    protected override Task RunAsync(CancellationToken stopping) => PruneAsync(stopping);

    /// <summary>One pass; how many rows went.</summary>
    public async Task<int> PruneAsync(CancellationToken cancellation = default)
    {
        var now = Time.GetUtcNow();
        var removed = 0;
        foreach (var (kind, expires) in Kinds())
        {
            foreach (var (name, value) in await secrets.ListAsync(kind, cancellation))
            {
                if (value.Length > 0 && !(expires(value) is { } end && end <= now)) continue;
                await secrets.DeleteAsync(kind, name, cancellation);
                removed++;
            }
        }
        if (removed > 0) Logger.LogInformation("Removed {Count} used or expired one-time tokens", removed);
        return removed;
    }

    private IEnumerable<(string Kind, Func<string, DateTimeOffset?> Expires)> Kinds() =>
    [
        (LoginLinks.Kind, LoginLinks.ExpiresOf),
        (Impersonations.Kind, Impersonations.ExpiresOf),
        (AccountEmails.ResetKind, AccountEmails.ExpiresOf),
        (AccountEmails.ConfirmKind, AccountEmails.ExpiresOf),
        (SignupInvites.Kind, SignupInvites.ExpiresOf),
        (AppSignIn.Kind, value => AppSignIn.ExpiresOf(protection, value)),
        (AppSignIn.LinkKind, value => AppSignIn.ExpiresOf(protection, value)),
        (PasskeyEndpoints.EnrollKind, value => PasskeyEndpoints.ExpiresOf(protection, value)),
        // Reports waiting to be sent have no end; only the empty rows sent ones left go.
        (CrashReporting.QueueKind, _ => null),
    ];
}
