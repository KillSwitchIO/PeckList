using System.Text.RegularExpressions;
using Punchlist.Core.Accounts;

namespace Punchlist.Core.Configuration;

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
    /// Signing out of Punchlist also ends the provider session (RP-initiated logout), when the
    /// provider advertises an <c>end_session_endpoint</c>. Off by default: the provider must accept
    /// <c>&lt;PUBLIC_URL&gt;/login</c> as a post-logout redirect.
    /// </summary>
    public bool SignOut { get; init; }

    /// <summary>A first sign-in with a verified email joins the one account another provider gave that email. Off by default.</summary>
    public bool LinkByEmail { get; init; }

    /// <summary>Provider group to role; the highest match wins. Empty leaves roles to admins.</summary>
    public IReadOnlyDictionary<string, Role> RoleMap { get; init; } = new Dictionary<string, Role>();

    /// <summary>Provider group to server group name. Empty maps nothing.</summary>
    public IReadOnlyDictionary<string, string> GroupMap { get; init; } = new Dictionary<string, string>();

    /// <summary><c>GROUP_MAP=*</c>: every provider group becomes the server group of the same name.</summary>
    public bool MirrorGroups { get; init; }

    /// <summary>Whether this provider's groups matter (and so the groups scope is asked for by default).</summary>
    public bool UsesGroups => RequiredGroups.Count > 0 || RoleMap.Count > 0 || GroupMap.Count > 0 || MirrorGroups;

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

            Uri? authority = null;
            if (Value("AUTHORITY") is not { } rawAuthority)
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
                DisplayName = Value("DISPLAY_NAME") ?? char.ToUpperInvariant(name[0]) + name[1..],
                Authority = authority,
                ClientId = clientId,
                ClientSecret = Value("CLIENT_SECRET"),
                Scopes = [],
                GroupsClaim = Value("GROUPS_CLAIM") ?? "groups",
                UsernameClaim = Value("USERNAME_CLAIM") ?? "preferred_username",
                RequiredGroups = Split(Value("REQUIRED_GROUPS")),
                AutoCreate = autoCreate,
                LinkByEmail = linkByEmail,
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

    private static IReadOnlyList<string> Split(string? raw) =>
        (raw ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    /// <summary><c>a=b,c=d</c>; the left side may not be empty.</summary>
    private static IEnumerable<(string Key, string Value)> Pairs(string? raw, string name, List<string> errors)
    {
        foreach (var item in Split(raw))
        {
            var at = item.IndexOf('=');
            if (at <= 0 || at == item.Length - 1)
            {
                errors.Add($"{name}: '{item}' is not group=value");
                continue;
            }
            yield return (item[..at].Trim(), item[(at + 1)..].Trim());
        }
    }
}
