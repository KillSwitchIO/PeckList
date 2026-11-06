using System.Globalization;
using System.Text;
using PeckList.Core.Configuration;

namespace PeckList.Core.Accounts;

/// <summary>Who an identity provider says signed in, already checked by the provider adapter.</summary>
public sealed record ExternalIdentity
{
    public required string Subject { get; init; }

    /// <summary>The configured username claim (<c>preferred_username</c> by default).</summary>
    public string? Username { get; init; }

    public string? DisplayName { get; init; }
    public string? Email { get; init; }

    /// <summary>The provider vouches for the email (<c>email_verified</c>).</summary>
    public bool EmailVerified { get; init; }

    public IReadOnlyList<string> Groups { get; init; } = [];
}

public abstract record ExternalSignInResult
{
    /// <summary>
    /// <paramref name="JoinedBy"/> when this sign-in joined an existing account: <c>mapping</c>,
    /// <c>migration</c>, <c>username</c> or <c>email</c>; <c>remap</c> when a mapping moved the link
    /// from another account. <paramref name="RoleBefore"/>: the role before this sign-in applied the
    /// role map. <paramref name="LastSuperAdminSpared"/>: the map would have lowered the only super
    /// admin, so it did not. An admin should hear about both.
    /// </summary>
    public sealed record Success(Account Account, bool Created, string? JoinedBy = null, Role? RoleBefore = null, bool LastSuperAdminSpared = false) : ExternalSignInResult;

    /// <summary>In none of the provider's required groups: no account, nothing stored.</summary>
    public sealed record NotAllowed : ExternalSignInResult;

    /// <summary>Unknown and auto-create is off: listed for an admin to approve.</summary>
    public sealed record Pending : ExternalSignInResult;

    /// <summary>The linked account is disabled.</summary>
    public sealed record Disabled : ExternalSignInResult;
}

/// <summary>
/// The rules for an OIDC sign-in (spec: Accounts &amp; Admin, OIDC): the access check, finding or
/// making the account, then the provider's role and group mappings. The web flow itself lives in
/// the server; this part runs the same for any provider and is tested without one.
/// </summary>
public enum LinkResult
{
    Linked,

    /// <summary>That provider account belongs to another user.</summary>
    Taken,

    /// <summary>In none of the provider's required groups.</summary>
    NotAllowed,
}

public enum UnlinkResult
{
    Unlinked,
    NotFound,

    /// <summary>Self-service only: it is the account's last way to sign in.</summary>
    LastWayIn,
}

public sealed class ExternalSignIn(
    IAccountStore accounts,
    AccountService accountService,
    IIdentityStore identities,
    IServerGroupStore groups,
    ISecretStore secrets,
    TimeProvider time,
    IPasskeyStore? passkeys = null)
{
    public const int MaxUsernameLength = 32;

    /// <summary>Where migration windows are kept: one value per provider, the time it closes.</summary>
    public const string MigrationWindowKind = "oidc-migration";

    public async Task<ExternalSignInResult> SignInAsync(
        OidcProviderSettings provider, ExternalIdentity identity, CancellationToken cancellation = default)
    {
        if (!Allowed(provider, identity)) return new ExternalSignInResult.NotAllowed();

        var now = time.GetUtcNow();
        var link = await identities.FindAsync(provider.Name, identity.Subject, cancellation);
        var account = link is null ? null : await accounts.FindByIdAsync(link.AccountId, cancellation);
        var created = false;
        string? joinedBy = null;
        if (account is null && link is not null)
        {
            await identities.UnlinkAsync(provider.Name, identity.Subject, cancellation);
            link = null;
        }
        if (await MappedAccountAsync(provider, identity, cancellation) is { } mapped && mapped.Id != account?.Id)
        {
            // An admin said where this provider user belongs. Only the link moves; whatever the
            // other account owns stays with it.
            if (link is not null)
            {
                await identities.UpdateAsync(
                    link with { AccountId = mapped.Id, Email = identity.Email, Username = identity.Username, LastUsedAt = now }, cancellation);
                joinedBy = "remap";
            }
            else
            {
                await AttachAsync(provider, identity, mapped.Id, cancellation);
                joinedBy = "mapping";
            }
            account = mapped;
        }
        else if (account is null && await MigrationMatchAsync(provider, identity, cancellation) is { } matched)
        {
            account = matched;
            joinedBy = "migration";
        }
        else if (account is null && await UsernameMatchAsync(provider, identity, cancellation) is { } byUsername)
        {
            account = byUsername;
            joinedBy = "username";
        }
        else if (account is null && await EmailMatchAsync(provider, identity, cancellation) is { } byEmail)
        {
            account = byEmail;
            joinedBy = "email";
        }
        else if (account is null)
        {
            if (!provider.AutoCreate)
            {
                var waiting = (await identities.ListPendingAsync(cancellation))
                    .FirstOrDefault(each => each.Provider == provider.Name && each.Subject == identity.Subject);
                await identities.PutPendingAsync(new PendingSignIn
                {
                    Provider = provider.Name,
                    Subject = identity.Subject,
                    Username = UsernameBase(identity),
                    DisplayName = identity.DisplayName,
                    Email = identity.Email,
                    Groups = identity.Groups,
                    FirstSeen = waiting?.FirstSeen ?? now,
                    LastSeen = now,
                }, cancellation);
                return new ExternalSignInResult.Pending();
            }
            account = await CreateAsync(provider, identity, UsernameBase(identity), cancellation);
            created = true;
        }
        else if (link is not null)
        {
            await identities.UpdateAsync(link with { Email = identity.Email, Username = identity.Username, LastUsedAt = now }, cancellation);
        }
        if (account.Disabled) return new ExternalSignInResult.Disabled();

        var before = account.Role;
        (account, var spared) = await ApplyRoleMapAsync(provider, identity, account, cancellation);
        await ApplyGroupMapAsync(provider, identity, account, cancellation);
        return new ExternalSignInResult.Success(account, created, joinedBy, before, spared);
    }

    /// <summary>
    /// Attach a provider account to someone already signed in (their profile, spec: Linking). The
    /// provider's access check still applies.
    /// </summary>
    public async Task<LinkResult> LinkAsync(
        OidcProviderSettings provider, ExternalIdentity identity, string accountId, CancellationToken cancellation = default)
    {
        if (!Allowed(provider, identity)) return LinkResult.NotAllowed;
        var existing = await identities.FindAsync(provider.Name, identity.Subject, cancellation);
        if (existing is not null) return existing.AccountId == accountId ? LinkResult.Linked : LinkResult.Taken;
        await AttachAsync(provider, identity, accountId, cancellation);
        return LinkResult.Linked;
    }

    /// <summary>The account's linked provider accounts.</summary>
    public async Task<IReadOnlyList<LinkedIdentity>> IdentitiesOfAsync(string accountId, CancellationToken cancellation = default) =>
        (await identities.ListAsync(cancellation)).Where(identity => identity.AccountId == accountId).ToList();

    /// <summary>
    /// Detach one provider account. <paramref name="selfService"/> refuses to take an account's last
    /// way to sign in; an admin may, and then hands out a one-time sign-in link.
    /// </summary>
    public async Task<UnlinkResult> UnlinkAsync(
        string accountId, string provider, string subject, bool selfService, CancellationToken cancellation = default)
    {
        var link = await identities.FindAsync(provider, subject, cancellation);
        if (link is null || link.AccountId != accountId) return UnlinkResult.NotFound;
        if (selfService && !await HasOtherWayInAsync(accountId, link, cancellation)) return UnlinkResult.LastWayIn;
        await identities.UnlinkAsync(provider, subject, cancellation);
        return UnlinkResult.Unlinked;
    }

    /// <summary>
    /// Unbind every account from a provider (moving to another one). Accounts and data stay.
    /// Returns how many links went and the usernames left with no way to sign in.
    /// </summary>
    public async Task<(int Unbound, IReadOnlyList<string> Stranded)> UnbindProviderAsync(string provider, CancellationToken cancellation = default)
    {
        var bound = (await identities.ListAsync(cancellation)).Where(identity => identity.Provider == provider).ToList();
        var count = await identities.UnlinkProviderAsync(provider, cancellation);
        var stranded = new List<string>();
        foreach (var accountId in bound.Select(identity => identity.AccountId).Distinct())
        {
            if (await accounts.FindByIdAsync(accountId, cancellation) is { } account && !await CanSignInAsync(account, cancellation))
            {
                stranded.Add(account.Username);
            }
        }
        return (count, stranded);
    }

    /// <summary>Whether the account has a password, any linked provider account, or a passkey.</summary>
    public async Task<bool> CanSignInAsync(Account account, CancellationToken cancellation = default) =>
        account.PasswordHash is not null || (await IdentitiesOfAsync(account.Id, cancellation)).Count > 0
        || await HasPasskeyAsync(account.Id, cancellation);

    private async Task<bool> HasPasskeyAsync(string accountId, CancellationToken cancellation) =>
        passkeys is not null && (await passkeys.ListAsync(accountId, cancellation)).Count > 0;

    /// <summary>Whether the account already has an account of this provider linked.</summary>
    private async Task<bool> LinkedToAsync(string accountId, string provider, CancellationToken cancellation) =>
        (await IdentitiesOfAsync(accountId, cancellation)).Any(each => each.Provider == provider);

    private async Task<bool> HasOtherWayInAsync(string accountId, LinkedIdentity leaving, CancellationToken cancellation)
    {
        var account = await accounts.FindByIdAsync(accountId, cancellation);
        if (account?.PasswordHash is not null || await HasPasskeyAsync(accountId, cancellation)) return true;
        return (await IdentitiesOfAsync(accountId, cancellation))
            .Any(identity => identity.Provider != leaving.Provider || identity.Subject != leaving.Subject);
    }

    /// <summary>
    /// Open a migration window: until it closes, a first sign-in through <paramref name="provider"/>
    /// attaches to the account with the same username that has no account of that provider yet.
    /// </summary>
    public async Task<DateTimeOffset> OpenMigrationWindowAsync(string provider, TimeSpan length, CancellationToken cancellation = default)
    {
        var until = time.GetUtcNow() + length;
        await secrets.PutAsync(MigrationWindowKind, provider, until.ToString("O", CultureInfo.InvariantCulture), cancellation);
        return until;
    }

    public Task CloseMigrationWindowAsync(string provider, CancellationToken cancellation = default) =>
        secrets.PutAsync(MigrationWindowKind, provider, "", cancellation);

    /// <summary>When the provider's migration window closes, or null when none is open.</summary>
    public async Task<DateTimeOffset?> MigrationWindowAsync(string provider, CancellationToken cancellation = default)
    {
        var value = (await secrets.ListAsync(MigrationWindowKind, cancellation)).FirstOrDefault(each => each.Name == provider).Value;
        return DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.None, out var until) && until > time.GetUtcNow()
            ? until
            : null;
    }

    /// <summary>
    /// During a migration window: the same-named account with no link to this provider yet, now
    /// linked. Never an admin's, unless <c>LINK_BY_USERNAME=all</c> says only admins set usernames
    /// there: a provider that lets people rename themselves would hand them the admin account (audit S9).
    /// </summary>
    private async Task<Account?> MigrationMatchAsync(OidcProviderSettings provider, ExternalIdentity identity, CancellationToken cancellation)
    {
        if (await MigrationWindowAsync(provider.Name, cancellation) is null) return null;
        var account = await accounts.FindByUsernameAsync(UsernameBase(identity), cancellation);
        if (account is null || await LinkedToAsync(account.Id, provider.Name, cancellation)) return null;
        if (account.Role != Role.User && provider.LinkByUsername != UsernameLinking.All) return null;
        await AttachAsync(provider, identity, account.Id, cancellation);
        return account;
    }

    /// <summary>
    /// The account a mapping sends this provider user to: <c>USER_MAP</c> from the settings first,
    /// then the mappings admins saved. Matches the username claim as sent and as a new account's
    /// username would be made from it, ignoring case. Null when unmapped or the account is gone.
    /// </summary>
    public async Task<Account?> MappedAccountAsync(OidcProviderSettings provider, ExternalIdentity identity, CancellationToken cancellation = default)
    {
        var names = new[] { identity.Username?.Trim().ToLowerInvariant(), UsernameBase(identity) }
            .Where(name => !string.IsNullOrEmpty(name))
            .Select(name => name!)
            .Distinct()
            .ToList();
        foreach (var name in names)
        {
            if (provider.UserMap.TryGetValue(name, out var target)
                && await accounts.FindByUsernameAsync(target, cancellation) is { DeletedAt: null } account)
            {
                return account;
            }
        }
        var saved = (await identities.ListMappingsAsync(cancellation))
            .Where(each => each.Provider == provider.Name && names.Contains(each.ProviderUsername))
            .ToList();
        foreach (var mapping in saved)
        {
            if (await accounts.FindByIdAsync(mapping.AccountId, cancellation) is { DeletedAt: null } account) return account;
        }
        return null;
    }

    /// <summary>
    /// With <c>LINK_BY_USERNAME</c> on: the account named like the provider's username, when it has
    /// no link to this provider yet. <c>true</c> never joins an admin: many providers let people
    /// change their own username, which would hand them an admin account.
    /// </summary>
    private async Task<Account?> UsernameMatchAsync(OidcProviderSettings provider, ExternalIdentity identity, CancellationToken cancellation)
    {
        if (provider.LinkByUsername == UsernameLinking.Off) return null;
        var account = await accounts.FindByUsernameAsync(UsernameBase(identity), cancellation);
        if (account is null || account.DeletedAt is not null) return null;
        if (provider.LinkByUsername == UsernameLinking.Users && account.Role != Role.User) return null;
        if (await LinkedToAsync(account.Id, provider.Name, cancellation)) return null;
        await AttachAsync(provider, identity, account.Id, cancellation);
        return account;
    }

    /// <summary>
    /// Move a provider account's link to another account (an admin remapping). Nothing the old
    /// account owns moves with it. False when there is no such link.
    /// </summary>
    public async Task<bool> MoveLinkAsync(string provider, string subject, string accountId, CancellationToken cancellation = default)
    {
        var link = await identities.FindAsync(provider, subject, cancellation);
        if (link is null) return false;
        if (link.AccountId != accountId) await identities.UpdateAsync(link with { AccountId = accountId }, cancellation);
        return true;
    }

    /// <summary>
    /// With <c>LINK_BY_EMAIL</c> on (off by default: a provider that does not truly check emails
    /// would let anyone take an account over): a first sign-in whose verified email matches the
    /// email another provider gave for exactly one account joins that account.
    /// </summary>
    private async Task<Account?> EmailMatchAsync(OidcProviderSettings provider, ExternalIdentity identity, CancellationToken cancellation)
    {
        if (!provider.LinkByEmail || !identity.EmailVerified || string.IsNullOrWhiteSpace(identity.Email)) return null;
        var owners = (await identities.ListAsync(cancellation))
            .Where(each => each.Provider != provider.Name && string.Equals(each.Email, identity.Email, StringComparison.OrdinalIgnoreCase))
            .Select(each => each.AccountId)
            .Distinct()
            .ToList();
        if (owners.Count != 1) return null;
        var account = await accounts.FindByIdAsync(owners[0], cancellation);
        if (account is null || await LinkedToAsync(account.Id, provider.Name, cancellation)) return null;
        await AttachAsync(provider, identity, account.Id, cancellation);
        return account;
    }

    /// <summary>
    /// An admin attaches a provider account to someone by hand (spec: Linking), by the provider's
    /// subject; a waiting sign-in with that subject is settled by it.
    /// </summary>
    public async Task<LinkResult> LinkByAdminAsync(string provider, string subject, string accountId, CancellationToken cancellation = default)
    {
        var existing = await identities.FindAsync(provider, subject, cancellation);
        if (existing is not null) return existing.AccountId == accountId ? LinkResult.Linked : LinkResult.Taken;
        var waiting = (await identities.ListPendingAsync(cancellation))
            .FirstOrDefault(each => each.Provider == provider && each.Subject == subject);
        var now = time.GetUtcNow();
        await identities.LinkAsync(new LinkedIdentity
        {
            Provider = provider,
            Subject = subject,
            AccountId = accountId,
            Email = waiting?.Email,
            Username = waiting?.Username,
            LinkedAt = now,
            LastUsedAt = now,
        }, cancellation);
        await identities.RemovePendingAsync(provider, subject, cancellation);
        return LinkResult.Linked;
    }

    private async Task AttachAsync(OidcProviderSettings provider, ExternalIdentity identity, string accountId, CancellationToken cancellation)
    {
        var now = time.GetUtcNow();
        await identities.LinkAsync(new LinkedIdentity
        {
            Provider = provider.Name,
            Subject = identity.Subject,
            AccountId = accountId,
            Email = identity.Email,
            Username = identity.Username,
            LinkedAt = now,
            LastUsedAt = now,
        }, cancellation);
        await identities.RemovePendingAsync(provider.Name, identity.Subject, cancellation);
    }

    private static bool Allowed(OidcProviderSettings provider, ExternalIdentity identity) =>
        provider.RequiredGroups.Count == 0
        || identity.Groups.Any(group => provider.RequiredGroups.Contains(group, StringComparer.OrdinalIgnoreCase));

    /// <summary>
    /// An admin lets a waiting sign-in in: the account is made and linked, so their next sign-in
    /// goes straight through. Null when nobody with that subject is waiting.
    /// </summary>
    public async Task<Account?> ApproveAsync(OidcProviderSettings provider, string subject, CancellationToken cancellation = default)
    {
        var pending = (await identities.ListPendingAsync(cancellation))
            .FirstOrDefault(each => each.Provider == provider.Name && each.Subject == subject);
        if (pending is null) return null;
        var identity = new ExternalIdentity
        {
            Subject = pending.Subject,
            Username = pending.Username,
            DisplayName = pending.DisplayName,
            Email = pending.Email,
            Groups = pending.Groups,
        };
        var account = await CreateAsync(provider, identity, pending.Username, cancellation);
        await identities.RemovePendingAsync(provider.Name, subject, cancellation);
        (account, _) = await ApplyRoleMapAsync(provider, identity, account, cancellation);
        await ApplyGroupMapAsync(provider, identity, account, cancellation);
        return account;
    }

    private async Task<Account> CreateAsync(
        OidcProviderSettings provider, ExternalIdentity identity, string wanted, CancellationToken cancellation)
    {
        var account = await accountService.CreateWithoutPasswordAsync(await FreeUsernameAsync(wanted, cancellation), cancellation);
        await AttachAsync(provider, identity, account.Id, cancellation);
        return account;
    }

    /// <summary>
    /// The highest role the provider's groups map to, or user; the last super admin is never demoted.
    /// No groups at all counts as no match, on purpose (audit S10): some providers send nothing for a
    /// person in no groups, and that must not leave a removed admin as admin. A provider that dropped
    /// the claim by mistake costs less: the next sign-in with the groups restores the role.
    /// </summary>
    private async Task<(Account Account, bool Spared)> ApplyRoleMapAsync(
        OidcProviderSettings provider, ExternalIdentity identity, Account account, CancellationToken cancellation)
    {
        if (provider.RoleMap.Count == 0) return (account, false);
        var role = identity.Groups
            .Select(group => provider.RoleMap.TryGetValue(group, out var mapped) ? mapped : Role.User)
            .DefaultIfEmpty(Role.User)
            .Max();
        if (role == account.Role) return (account, false);
        try
        {
            return (await accountService.SetRoleAsync(account.Id, role, cancellation), false);
        }
        catch (LastSuperAdminException)
        {
            return (account, true);
        }
    }

    /// <summary>This provider's memberships become exactly what its groups map to; other sources stay.</summary>
    private async Task ApplyGroupMapAsync(
        OidcProviderSettings provider, ExternalIdentity identity, Account account, CancellationToken cancellation)
    {
        if (provider.GroupMap.Count == 0 && !provider.MirrorGroups) return;
        var names = provider.MirrorGroups
            ? identity.Groups
            : identity.Groups.Where(provider.GroupMap.ContainsKey).Select(group => provider.GroupMap[group]);
        var ids = new List<string>();
        foreach (var name in names.Select(name => name.Trim()).Where(name => name.Length is > 0 and <= ServerGroupService.MaxNameLength).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            var group = await groups.FindByNameAsync(name, cancellation);
            if (group is null)
            {
                group = new ServerGroup { Id = Ids.NewUlid(time), Name = name, CreatedAt = time.GetUtcNow() };
                try
                {
                    await groups.CreateAsync(group, cancellation);
                }
                catch (DuplicateGroupNameException)
                {
                    // Made by a sign-in running at the same moment.
                    group = await groups.FindByNameAsync(name, cancellation) ?? throw new InvalidOperationException($"group {name} vanished");
                }
            }
            ids.Add(group.Id);
        }
        await groups.SetMembershipsAsync(account.Id, MembershipSource.Oidc(provider.Name), ids, cancellation);
    }

    /// <summary>
    /// A username from the provider: its username claim (the part before an @), else the email's,
    /// else "user"; lowercase letters, digits, dots, dashes and underscores only.
    /// </summary>
    public static string UsernameBase(ExternalIdentity identity)
    {
        foreach (var candidate in new[] { identity.Username, identity.Email })
        {
            if (string.IsNullOrWhiteSpace(candidate)) continue;
            var local = candidate.Split('@')[0];
            var clean = new StringBuilder();
            foreach (var letter in local.ToLowerInvariant())
            {
                if (letter is (>= 'a' and <= 'z') or (>= '0' and <= '9') or '.' or '-' or '_') clean.Append(letter);
                else if (Fold(letter) is { } folded) clean.Append(folded);
            }
            var name = clean.ToString().Trim('.', '-', '_');
            if (name.Length > MaxUsernameLength) name = name[..MaxUsernameLength];
            if (name.Length > 0) return name;
        }
        return "user";
    }

    // Accented Latin letters as plain ones. A table, not Unicode normalization: the container runs
    // with invariant globalization, where normalization does not decompose.
    private static readonly Dictionary<char, string> Folds = new[]
    {
        ("àáâãäåāăą", "a"), ("çćĉċč", "c"), ("ďđð", "d"), ("èéêëēĕėęě", "e"), ("ĝğġģ", "g"), ("ĥħ", "h"),
        ("ìíîïĩīĭįı", "i"), ("ĵ", "j"), ("ķ", "k"), ("ĺļľŀł", "l"), ("ñńņňŉ", "n"), ("òóôõöøōŏő", "o"),
        ("ŕŗř", "r"), ("śŝşšș", "s"), ("ţťŧț", "t"), ("ùúûüũūŭůűų", "u"), ("ŵ", "w"), ("ýÿŷ", "y"),
        ("źżž", "z"), ("ß", "ss"), ("æ", "ae"), ("œ", "oe"), ("þ", "th"),
    }.SelectMany(pair => pair.Item1.Select(letter => (letter, pair.Item2))).ToDictionary(pair => pair.letter, pair => pair.Item2);

    private static string? Fold(char letter) => Folds.GetValueOrDefault(letter);

    /// <summary><paramref name="wanted"/>, or with 2, 3... after it when taken. Never someone else's account.</summary>
    private async Task<string> FreeUsernameAsync(string wanted, CancellationToken cancellation)
    {
        if (await accounts.FindByUsernameAsync(wanted, cancellation) is null) return wanted;
        for (var number = 2; ; number++)
        {
            var suffix = number.ToString(CultureInfo.InvariantCulture);
            var candidate = (wanted.Length + suffix.Length > MaxUsernameLength ? wanted[..(MaxUsernameLength - suffix.Length)] : wanted) + suffix;
            if (await accounts.FindByUsernameAsync(candidate, cancellation) is null) return candidate;
        }
    }
}
