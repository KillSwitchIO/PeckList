using System.Text.RegularExpressions;
using PeckList.Core.Accounts;

namespace PeckList.Core.Configuration;

/// <summary><c>OIDC_&lt;NAME&gt;_LINK_BY_USERNAME</c>: which accounts a first sign-in may join by username.</summary>
public enum UsernameLinking
{
    Off,

    /// <summary><c>true</c>: plain users only. Admins need a mapping, since many providers let people rename themselves.</summary>
    Users,

    /// <summary><c>all</c>: admins too, for providers where only admins set usernames.</summary>
    All,
}

/// <summary>
/// One OIDC provider (spec: Accounts &amp; Admin, OIDC). Listed in <c>OIDC_PROVIDERS</c> and set by
/// an <c>OIDC_&lt;NAME&gt;_*</c> block each, e.g. <c>OIDC_POCKET_AUTHORITY</c> for <c>pocket</c>.
/// </summary>
public sealed partial record OidcProviderSettings
{
    /// <summary>Lowercase letters, digits and dashes; used in URLs and membership sources.</summary>
    public required string Name { get; init; }

    /// <summary>The sign-in button's label.</summary>
    public required string DisplayName { get; init; }

    /// <summary>
    /// A known provider whose settings come filled in (<c>OIDC_&lt;NAME&gt;_PRESET</c>, or a provider
    /// named after one): <c>google</c>. Null for any other OIDC provider. The app draws a preset's
    /// own sign-in button.
    /// </summary>
    public string? Preset { get; init; }

    public required Uri Authority { get; init; }
    public required string ClientId { get; init; }

    /// <summary>Null for a public client (PKCE only).</summary>
    public string? ClientSecret { get; init; }

    public required IReadOnlyList<string> Scopes { get; init; }
    public string GroupsClaim { get; init; } = "groups";
    public string UsernameClaim { get; init; } = "preferred_username";

    /// <summary>Signing in needs at least one of these groups; empty lets everyone in.</summary>
    public IReadOnlyList<string> RequiredGroups { get; init; } = [];

    /// <summary>
    /// How long a session from this provider lasts before the person goes through the provider
    /// again (which re-checks the required groups and mappings). Null: as long as a password session.
    /// </summary>
    public TimeSpan? SessionLength { get; init; } = TimeSpan.FromHours(12);

    /// <summary>Make an account on a first sign-in; otherwise it waits for an admin.</summary>
    public bool AutoCreate { get; init; }

    /// <summary>
    /// Signing out of PeckList also ends the provider session (RP-initiated logout), when the
    /// provider advertises an <c>end_session_endpoint</c>. Off by default: the provider must accept
    /// <c>&lt;PUBLIC_URL&gt;/login</c> as a post-logout redirect.
    /// </summary>
    public bool SignOut { get; init; }

    /// <summary>A first sign-in with a verified email joins the one account another provider gave that email. Off by default.</summary>
    public bool LinkByEmail { get; init; }

    /// <summary>A first sign-in joins the same-named account with no link to this provider yet. Off by default.</summary>
    public UsernameLinking LinkByUsername { get; init; }

    /// <summary>
    /// Provider username (lowercase) to PeckList username: a first claim, for someone with no link yet
    /// on an account with no link to this provider yet, because a username can change hands at the
    /// provider. An admin account also needs <c>LINK_BY_USERNAME=all</c>. Admins add more on the OIDC page.
    /// </summary>
    public IReadOnlyDictionary<string, string> UserMap { get; init; } = new Dictionary<string, string>();

    /// <summary>
    /// Provider subject (exact) to PeckList username, from <c>sub:</c> entries in <c>USER_MAP</c>: that
    /// provider account always signs into that account, an admin's included, and a link elsewhere moves there.
    /// </summary>
    public IReadOnlyDictionary<string, string> SubjectMap { get; init; } = new Dictionary<string, string>();

    /// <summary>
    /// The provider's icon: an http(s) address or a file. Null: the provider's own <c>/favicon.ico</c>.
    /// </summary>
    public string? Icon { get; init; }

    /// <summary>Provider group to role; the highest match wins. Empty leaves roles to admins.</summary>
    public IReadOnlyDictionary<string, Role> RoleMap { get; init; } = new Dictionary<string, Role>();

    /// <summary>Provider group to server group name. Empty maps nothing.</summary>
    public IReadOnlyDictionary<string, string> GroupMap { get; init; } = new Dictionary<string, string>();

    /// <summary><c>GROUP_MAP=*</c>: every provider group becomes the server group of the same name.</summary>
    public bool MirrorGroups { get; init; }

    /// <summary>Whether this provider's groups matter (and so the groups scope is asked for by default).</summary>
    public bool UsesGroups => RequiredGroups.Count > 0 || RoleMap.Count > 0 || GroupMap.Count > 0 || MirrorGroups;

    /// <summary>How a <c>USER_MAP</c> entry says its left side is a subject.</summary>
    public const string SubjectPrefix = "sub:";

    [GeneratedRegex("^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$")]
    private static partial Regex NamePattern();

    /// <summary>Read the providers <c>OIDC_PROVIDERS</c> names; problems go into <paramref name="errors"/>.</summary>
    public static IReadOnlyList<OidcProviderSettings> ReadAll(Func<string, string?> get, List<string> errors)
    {
        var names = Split(get("OIDC_PROVIDERS"));
        var providers = new List<OidcProviderSettings>();
        var seen = new HashSet<string>();
        foreach (var raw in names)
        {
            var name = raw.ToLowerInvariant();
            if (!NamePattern().IsMatch(name))
            {
                errors.Add($"OIDC_PROVIDERS: '{raw}' is not a provider name (letters, digits and dashes)");
                continue;
            }
            if (!seen.Add(name))
            {
                errors.Add($"OIDC_PROVIDERS: '{name}' is listed twice");
                continue;
            }
            var prefix = $"OIDC_{name.ToUpperInvariant().Replace('-', '_')}_";
            string? Value(string key) => get(prefix + key);

            // A preset fills in what every server sets the same for that provider.
            var preset = Value("PRESET")?.Trim().ToLowerInvariant() is { Length: > 0 } named
                ? named
                : Presets.ContainsKey(name) ? name : null;
            PresetDefaults? known = null;
            if (preset is not null && !Presets.TryGetValue(preset, out known))
            {
                errors.Add($"{prefix}PRESET: '{preset}' is not one of {string.Join(", ", Presets.Keys)}");
            }

            Uri? authority = null;
            if ((Value("AUTHORITY") ?? known?.Authority) is not { } rawAuthority)
            {
                errors.Add($"{prefix}AUTHORITY is required (the provider's issuer URL)");
            }
            else if (!Uri.TryCreate(rawAuthority.TrimEnd('/'), UriKind.Absolute, out authority)
                || (authority.Scheme != Uri.UriSchemeHttp && authority.Scheme != Uri.UriSchemeHttps))
            {
                errors.Add($"{prefix}AUTHORITY: '{rawAuthority}' is not an http or https address");
            }
            var clientId = Value("CLIENT_ID");
            if (clientId is null) errors.Add($"{prefix}CLIENT_ID is required");

            var roleMap = new Dictionary<string, Role>(StringComparer.OrdinalIgnoreCase);
            foreach (var (group, roleName) in Pairs(Value("ROLE_MAP"), prefix + "ROLE_MAP", errors))
            {
                if (Roles.TryParse(roleName, out var role)) roleMap[group] = role;
                else errors.Add($"{prefix}ROLE_MAP: '{roleName}' is not one of user, admin, superadmin");
            }
            var rawGroupMap = Value("GROUP_MAP");
            var mirror = rawGroupMap?.Trim() == "*";
            var groupMap = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            if (!mirror)
            {
                foreach (var (group, serverGroup) in Pairs(rawGroupMap, prefix + "GROUP_MAP", errors)) groupMap[group] = serverGroup;
            }
            bool Flag(string name)
            {
                if (Value(name) is not { } raw) return false;
                switch (raw.Trim().ToLowerInvariant())
                {
                    case "true" or "1" or "yes" or "on":
                        return true;
                    case "false" or "0" or "no" or "off":
                        return false;
                    default:
                        errors.Add($"{prefix}{name}: '{raw}' is not true or false");
                        return false;
                }
            }
            var linkByUsername = UsernameLinking.Off;
            if (Value("LINK_BY_USERNAME") is { } rawLinking)
            {
                switch (rawLinking.Trim().ToLowerInvariant())
                {
                    case "all":
                        linkByUsername = UsernameLinking.All;
                        break;
                    case "true" or "1" or "yes" or "on":
                        linkByUsername = UsernameLinking.Users;
                        break;
                    case "false" or "0" or "no" or "off":
                        break;
                    default:
                        errors.Add($"{prefix}LINK_BY_USERNAME: '{rawLinking}' is not true, false or all");
                        break;
                }
            }
            var (userMap, subjectMap) = ReadUserMap(Value("USER_MAP"), prefix + "USER_MAP", errors);
            var autoCreate = Flag("AUTO_CREATE");
            var linkByEmail = Flag("LINK_BY_EMAIL");
            var signOut = Flag("SIGN_OUT");
            TimeSpan? sessionLength = TimeSpan.FromHours(12);
            if (Value("SESSION_HOURS") is { } rawHours)
            {
                if (!double.TryParse(rawHours, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var hours)
                    || hours < 0 || hours > 24 * 30)
                {
                    errors.Add($"{prefix}SESSION_HOURS: '{rawHours}' is not a number of hours from 0 to 720");
                }
                else
                {
                    sessionLength = hours == 0 ? null : TimeSpan.FromHours(hours);
                }
            }
            if (authority is null || clientId is null) continue;

            var provider = new OidcProviderSettings
            {
                Name = name,
                DisplayName = Value("DISPLAY_NAME") ?? known?.DisplayName ?? char.ToUpperInvariant(name[0]) + name[1..],
                Preset = known is null ? null : preset,
                Authority = authority,
                ClientId = clientId,
                ClientSecret = Value("CLIENT_SECRET"),
                Scopes = [],
                GroupsClaim = Value("GROUPS_CLAIM") ?? "groups",
                UsernameClaim = Value("USERNAME_CLAIM") ?? "preferred_username",
                RequiredGroups = Split(Value("REQUIRED_GROUPS")),
                AutoCreate = autoCreate,
                LinkByEmail = linkByEmail,
                LinkByUsername = linkByUsername,
                UserMap = userMap,
                SubjectMap = subjectMap,
                Icon = Value("ICON") is { Length: > 0 } icon ? icon.Trim() : null,
                SignOut = signOut,
                SessionLength = sessionLength,
                RoleMap = roleMap,
                GroupMap = groupMap,
                MirrorGroups = mirror,
            };
            // Most providers send groups only when asked; set SCOPES to override (Keycloak has no "groups" scope).
            IReadOnlyList<string> scopes = Value("SCOPES") is { } rawScopes
                ? rawScopes.Split([' ', ','], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                : provider.UsesGroups ? ["openid", "profile", "email", "groups"] : ["openid", "profile", "email"];
            if (!scopes.Contains("openid")) scopes = ["openid", .. scopes];
            providers.Add(provider with { Scopes = scopes });
        }
        return providers;
    }

    /// <summary>What a preset fills in (PL-124). Google: plain OIDC with no groups.</summary>
    private sealed record PresetDefaults(string Authority, string DisplayName);

    private static readonly IReadOnlyDictionary<string, PresetDefaults> Presets = new Dictionary<string, PresetDefaults>
    {
        ["google"] = new("https://accounts.google.com", "Google"),
    };

    private static IReadOnlyList<string> Split(string? raw) =>
        (raw ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    /// <summary>
    /// <c>provideruser=pecklistuser</c> and <c>sub:subject=pecklistuser</c>. Split at the last <c>=</c>,
    /// since a subject may hold one and a PeckList username never does. What starts with <c>sub:</c> is
    /// always a subject and never a username. A subject with a comma cannot be written in a list. Most
    /// such values leave a piece that is plainly wrong, with no <c>=</c> or a username holding one, and
    /// stop the start. <c>sub:a=x,b=y</c> cannot be told from two good entries, so the guide says to
    /// link those by hand and check the Mappings page.
    /// </summary>
    private static (Dictionary<string, string> Users, Dictionary<string, string> Subjects) ReadUserMap(string? raw, string name, List<string> errors)
    {
        var users = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var subjects = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var item in Split(raw))
        {
            var isSubject = item.StartsWith(SubjectPrefix, StringComparison.OrdinalIgnoreCase);
            var from = isSubject ? SubjectPrefix.Length : 0;
            var at = item.LastIndexOf('=');
            var left = at >= from ? item[from..at].Trim() : "";
            var right = at >= from ? item[(at + 1)..].Trim().ToLowerInvariant() : "";
            if (left.Length == 0 || right.Length == 0)
            {
                errors.Add(isSubject
                    ? $"{name}: '{item}' is not sub:subject=pecklistuser. A subject with a comma cannot be written here: link that account by hand under Admin > Users."
                    : $"{name}: '{item}' is not provideruser=pecklistuser");
            }
            else if (!isSubject && left.Contains('='))
            {
                errors.Add($"{name}: '{item}' has a username holding =. If it is part of a subject with a comma, link that account by hand under Admin > Users.");
            }
            else if (!isSubject)
            {
                users[left.ToLowerInvariant()] = right;
            }
            else if (!subjects.TryAdd(left, right))
            {
                errors.Add($"{name}: 'sub:{left}' is listed twice");
            }
        }
        return (users, subjects);
    }

    /// <summary><c>a=b,c=d</c>; the left side may not be empty.</summary>
    private static IEnumerable<(string Key, string Value)> Pairs(string? raw, string name, List<string> errors, string shape = "group=value")
    {
        foreach (var item in Split(raw))
        {
            var at = item.IndexOf('=');
            if (at <= 0 || at == item.Length - 1)
            {
                errors.Add($"{name}: '{item}' is not {shape}");
                continue;
            }
            yield return (item[..at].Trim(), item[(at + 1)..].Trim());
        }
    }
}
