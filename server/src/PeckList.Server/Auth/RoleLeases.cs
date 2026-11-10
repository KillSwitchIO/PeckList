using System.Collections.Concurrent;
using PeckList.Core.Accounts;
using PeckList.Core.Configuration;
using PeckList.Server.Audit;

namespace PeckList.Server.Auth;

/// <summary>
/// Lowers a role from <c>ROLE_MAP</c> that no sign-in through its provider renewed within
/// <c>ROLE_MAP_RENEW_DAYS</c> (audit S10 follow-up, R1), when the account is next used (a session's
/// check, an API key) and by the daily <see cref="RoleLeaseCheck"/>. The role drops to user, as the
/// provider's map gives with no group matched, with an event and a log line. The last active super
/// admin keeps the role, as at a sign-in (R2), with a warning once a day.
/// </summary>
public sealed class RoleLeases(AccountService accounts, LiveSettings live, AuditLog audit, TimeProvider time, ILogger<RoleLeases> logger)
{
    private readonly ConcurrentDictionary<string, DateOnly> sparedWarned = new(StringComparer.Ordinal);

    /// <summary>The account as it is once its lease is checked: lowered when it lapsed.</summary>
    public async Task<Account> CheckAsync(Account account, CancellationToken cancellation = default)
    {
        var days = live.Current.RoleMapRenewDays;
        var now = time.GetUtcNow();
        if (!RoleLease.Lapsed(account, now, days)) return account;
        try
        {
            var (updated, lowered) = await accounts.LapseRoleAsync(account.Id, now, days, cancellation);
            if (lowered)
            {
                audit.RecordEvent(null, "auth.role-lease-lapsed", null, "system", account.Id, account.Username,
                    $"No sign-in through {account.RoleProvider} renewed {account.Role.Name()} within {days} days (ROLE_MAP_RENEW_DAYS), so it became user. The next sign-in through {account.RoleProvider} with the group gives it back.");
                logger.LogWarning(
                    "No sign-in through {Provider} renewed the {Role} role of {Username} within {Days} days (ROLE_MAP_RENEW_DAYS), so it became user.",
                    account.RoleProvider, account.Role.Name(), account.Username, days);
            }
            return updated;
        }
        catch (LastSuperAdminException)
        {
            var today = DateOnly.FromDateTime(now.UtcDateTime);
            if (sparedWarned.TryGetValue(account.Id, out var warned) && warned == today) return account;
            sparedWarned[account.Id] = today;
            audit.RecordEvent(null, "auth.role-lease-kept", null, "system", account.Id, account.Username,
                $"No sign-in through {account.RoleProvider} renewed the role within {days} days, but this is the only super admin, so the role stays. Make someone else a super admin.");
            logger.LogWarning(
                "No sign-in through {Provider} renewed the role of {Username} within {Days} days, but it is the only super admin, so the role stays.",
                account.RoleProvider, account.Username, days);
            return account;
        }
    }
}

/// <summary>
/// Daily: every account's role lease (<see cref="RoleLeases"/>). Its first run after the upgrade that
/// brought leases starts one, from now, for each role above user that an account's linked provider's
/// <c>ROLE_MAP</c> can give, so nobody is lowered on the first day and a role from before the upgrade
/// is not kept for good.
/// </summary>
public sealed class RoleLeaseCheck(
    RoleLeases leases, IAccountStore accounts, IIdentityStore identities, ISecretStore secrets, ServerSettings settings, AuditLog audit,
    TimeProvider time, ILogger<RoleLeaseCheck> logger)
    : PeriodicService("Checking role leases", TimeSpan.FromMinutes(1), TimeSpan.FromDays(1), time, logger)
{
    /// <summary>Where the server notes that the leases were started (once per database).</summary>
    public const string StartedKind = "role-lease";

    /// <summary>
    /// The one-time start is done before the server answers any request, so a role someone sets by
    /// hand once it is up is never leased by it. Should it fail, the daily run tries it again.
    /// </summary>
    public override async Task StartAsync(CancellationToken cancellationToken)
    {
        try
        {
            await StartLeasesAsync(cancellationToken);
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            Logger.LogError(error, "Starting role leases failed; the daily check tries again");
        }
        await base.StartAsync(cancellationToken);
    }

    protected override async Task RunAsync(CancellationToken stopping)
    {
        await StartLeasesAsync(stopping);
        foreach (var account in await accounts.ListAsync(stopping)) await leases.CheckAsync(account, stopping);
    }

    /// <summary>Lease the roles that came from a provider before there were leases: once, renewed now.</summary>
    public async Task<int> StartLeasesAsync(CancellationToken cancellation = default)
    {
        if ((await secrets.ListAsync(StartedKind, cancellation)).Count > 0) return 0;
        var now = Time.GetUtcNow();
        var links = (await identities.ListAsync(cancellation)).ToLookup(link => link.AccountId, StringComparer.Ordinal);
        var started = 0;
        foreach (var account in await accounts.ListAsync(cancellation))
        {
            if (account.Role == Role.User || account.RoleProvider is not null || account.DeletedAt is not null) continue;
            var provider = links[account.Id]
                .Select(link => settings.Provider(link.Provider))
                .FirstOrDefault(each => each is not null && each.RoleMap.Values.Contains(account.Role));
            if (provider is null) continue;
            await accounts.UpdateAsync(account with { RoleProvider = provider.Name, RoleRenewedAt = now }, cancellation);
            started++;
        }
        await secrets.PutAsync(StartedKind, "started", now.ToString("O", System.Globalization.CultureInfo.InvariantCulture), cancellation);
        if (started > 0)
        {
            audit.RecordSystem("auth.role-lease-started", detail:
                $"{started} roles from ROLE_MAP now last {settings.RoleMapRenewDays} days from today unless a sign-in through their provider renews them (ROLE_MAP_RENEW_DAYS).");
            Logger.LogInformation("{Count} roles from ROLE_MAP now need a sign-in through their provider to renew them.", started);
        }
        return started;
    }
}
