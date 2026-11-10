namespace PeckList.Core.Accounts;

/// <summary>
/// A role from a provider's <c>ROLE_MAP</c> lasts while sign-ins through that provider renew it
/// (audit S10 follow-up, R1): someone taken out of the admin group who never signs in there again
/// loses the role after <c>ROLE_MAP_RENEW_DAYS</c>, with their API keys, password and passkeys alike,
/// since they all act with the account's role. A role set by hand is not leased.
/// </summary>
public static class RoleLease
{
    /// <summary>When the lease runs out, or null when the role is not leased (or never lapses).</summary>
    public static DateTimeOffset? Ends(Account account, int renewDays) =>
        renewDays > 0 && account.Role > Role.User && account.RoleProvider is not null && account.RoleRenewedAt is { } renewed
            ? renewed.AddDays(renewDays)
            : null;

    /// <summary>Whether the account's role is leased and nobody renewed it in time.</summary>
    public static bool Lapsed(Account account, DateTimeOffset now, int renewDays) =>
        Ends(account, renewDays) is { } ends && now >= ends;
}
