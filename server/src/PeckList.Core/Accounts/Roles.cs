namespace PeckList.Core.Accounts;

/// <summary>
/// What admin endpoints check (spec: Accounts &amp; Admin, Roles and server groups). Endpoints ask
/// for a permission, never a role name, so custom roles can come later without touching them.
/// </summary>
public enum Permission
{
    ManageUsers,
    ManageAdmins,
    ManageGroups,
    ManageSettings,
    ViewLogs,
    ManageBackups,
    ViewStats,
    Impersonate,

    /// <summary>
    /// What would let someone make themselves a super admin: settings that decide who signs in and
    /// how (<see cref="Configuration.SettingsCatalog.SuperAdminOnly"/>), and whole-server backups,
    /// which hold every password hash and the keys that sign sessions (download, export, restore).
    /// Super admins only.
    /// </summary>
    ManageSecurity,
}

public static class Roles
{
    private static readonly IReadOnlySet<Permission> None = new HashSet<Permission>();

    private static readonly IReadOnlySet<Permission> Admin = new HashSet<Permission>
    {
        Permission.ManageUsers,
        Permission.ManageGroups,
        Permission.ManageSettings,
        Permission.ViewLogs,
        Permission.ManageBackups,
        Permission.ViewStats,
    };

    private static readonly IReadOnlySet<Permission> SuperAdmin = Enum.GetValues<Permission>().ToHashSet();

    public static IReadOnlySet<Permission> PermissionsOf(Role role) => role switch
    {
        Role.SuperAdmin => SuperAdmin,
        Role.Admin => Admin,
        _ => None,
    };

    public static bool Can(this Role role, Permission permission) => PermissionsOf(role).Contains(permission);

    /// <summary>How the role is stored and sent: <c>user</c>, <c>admin</c>, <c>superadmin</c>.</summary>
    public static string Name(this Role role) => role.ToString().ToLowerInvariant();

    /// <summary>A role as typed: any case, with or without a dash or underscore (<c>super-admin</c>).</summary>
    public static bool TryParse(string? text, out Role role)
    {
        var compact = (text ?? "").Replace("-", "", StringComparison.Ordinal).Replace("_", "", StringComparison.Ordinal).Trim();
        return Enum.TryParse(compact, ignoreCase: true, out role) && Enum.IsDefined(role) && !int.TryParse(compact, out _);
    }
}

/// <summary>The last active super admin cannot lose the role, be disabled or be deleted.</summary>
public sealed class LastSuperAdminException() : Exception("the server needs at least one active super admin");
