using System.Text;
using Punchlist.Core.Configuration;

namespace Punchlist.Core.Accounts;

/// <summary>Who an identity provider says signed in, already checked by the provider adapter.</summary>
public sealed record ExternalIdentity
{
    public required string Subject { get; init; }

    /// <summary>The configured username claim (<c>preferred_username</c> by default).</summary>
    public string? Username { get; init; }

    public string? DisplayName { get; init; }
    public string? Email { get; init; }
    public IReadOnlyList<string> Groups { get; init; } = [];
}

public abstract record ExternalSignInResult
{
    public sealed record Success(Account Account, bool Created) : ExternalSignInResult;

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
public sealed class ExternalSignIn(
    IAccountStore accounts, AccountService accountService, IIdentityStore identities, IServerGroupStore groups, TimeProvider time)
{
    public const int MaxUsernameLength = 32;

    public async Task<ExternalSignInResult> SignInAsync(
        OidcProviderSettings provider, ExternalIdentity identity, CancellationToken cancellation = default)
    {
        if (provider.RequiredGroups.Count > 0
            && !identity.Groups.Any(group => provider.RequiredGroups.Contains(group, StringComparer.OrdinalIgnoreCase)))
        {
            return new ExternalSignInResult.NotAllowed();
        }

        var now = time.GetUtcNow();
        var link = await identities.FindAsync(provider.Name, identity.Subject, cancellation);
        var account = link is null ? null : await accounts.FindByIdAsync(link.AccountId, cancellation);
        var created = false;
        if (account is null)
        {
            if (link is not null) await identities.UnlinkAsync(provider.Name, identity.Subject, cancellation);
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
        else
        {
            await identities.UpdateAsync(link! with { Email = identity.Email, LastUsedAt = now }, cancellation);
        }
        if (account.Disabled) return new ExternalSignInResult.Disabled();

        account = await ApplyRoleMapAsync(provider, identity, account, cancellation);
        await ApplyGroupMapAsync(provider, identity, account, cancellation);
        return new ExternalSignInResult.Success(account, created);
    }

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
        account = await ApplyRoleMapAsync(provider, identity, account, cancellation);
        await ApplyGroupMapAsync(provider, identity, account, cancellation);
        return account;
    }

    private async Task<Account> CreateAsync(
        OidcProviderSettings provider, ExternalIdentity identity, string wanted, CancellationToken cancellation)
    {
        var account = await accountService.CreateWithoutPasswordAsync(await FreeUsernameAsync(wanted, cancellation), cancellation);
        var now = time.GetUtcNow();
        await identities.LinkAsync(new LinkedIdentity
        {
            Provider = provider.Name,
            Subject = identity.Subject,
            AccountId = account.Id,
            Email = identity.Email,
            LinkedAt = now,
            LastUsedAt = now,
        }, cancellation);
        await identities.RemovePendingAsync(provider.Name, identity.Subject, cancellation);
        return account;
    }

    /// <summary>The highest role the provider's groups map to, or user; the last super admin is never demoted.</summary>
    private async Task<Account> ApplyRoleMapAsync(
        OidcProviderSettings provider, ExternalIdentity identity, Account account, CancellationToken cancellation)
    {
        if (provider.RoleMap.Count == 0) return account;
        var role = identity.Groups
            .Select(group => provider.RoleMap.TryGetValue(group, out var mapped) ? mapped : Role.User)
            .DefaultIfEmpty(Role.User)
            .Max();
        if (role == account.Role) return account;
        try
        {
            return await accountService.SetRoleAsync(account.Id, role, cancellation);
        }
        catch (LastSuperAdminException)
        {
            return account;
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
            var suffix = number.ToString(System.Globalization.CultureInfo.InvariantCulture);
            var candidate = (wanted.Length + suffix.Length > MaxUsernameLength ? wanted[..(MaxUsernameLength - suffix.Length)] : wanted) + suffix;
            if (await accounts.FindByUsernameAsync(candidate, cancellation) is null) return candidate;
        }
    }
}
