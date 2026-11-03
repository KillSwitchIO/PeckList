using System.Security.Claims;
using System.Text.Json.Nodes;
using PeckList.Core.Accounts;
using PeckList.Core.Audit;
using PeckList.Core.Sharing;
using PeckList.Core.Sync;
using PeckList.Server.Auth;

namespace PeckList.Server.Audit;

/// <summary>
/// Sharing changes that come in through sync, as events (spec: Access and event log): a list shared
/// or made private, people added to or taken off a list or a group, a role changed. Who did it is
/// the person whose device pushed it (and the admin, when viewing as them).
/// </summary>
public sealed class SharingAudit(AuditLog audit, IAccountStore accounts, SharingState sharing, IHttpContextAccessor http)
    : ISharingChangeSink
{
    public async Task ChangedAsync(string userId, IReadOnlyList<SharingChange> changes, CancellationToken cancellation = default)
    {
        var names = (await accounts.ListAsync(cancellation)).ToDictionary(account => account.Id, account => account.Username);
        var user = http.HttpContext?.User;
        foreach (var change in changes)
        {
            if (Describe(change, names, sharing.Index) is not { } found) continue;
            audit.RecordEvent(http.HttpContext, found.Type, userId, names.GetValueOrDefault(userId),
                found.TargetId, found.TargetName, found.Detail,
                user?.Impersonator() is not null ? user.FindFirstValue(ImpersonationSetup.ByClaim) : null,
                user?.FindFirstValue(ImpersonationSetup.ByNameClaim));
        }
    }

    private sealed record Described(string Type, string? TargetId, string? TargetName, string? Detail);

    private static Described? Describe(SharingChange change, IReadOnlyDictionary<string, string> names, SharingIndex index)
    {
        string? Field(JsonObject? doc, string name) => doc?[name] is JsonValue value && value.TryGetValue<string>(out var text) ? text : null;
        bool Alive(JsonObject? doc) => doc is not null && doc["deletedAt"] is null;
        string? NameOf(string? id) => id is null ? null : Field(index.DocOf(id), "name");
        var wasAlive = Alive(change.Before);
        var isAlive = Alive(change.After);

        switch (change.Collection)
        {
            case "lists":
            {
                var before = Field(change.Before, "visibility") ?? "private";
                var after = Field(change.After, "visibility") ?? "private";
                if (before == after || !isAlive) return null;
                return new Described(after == "shared" ? "sharing.list-shared" : "sharing.list-unshared",
                    change.Id, Field(change.After, "name"), null);
            }
            case "listMembers":
            {
                var principal = Field(change.After, "principal") ?? "";
                var user = principal.Replace("user:", "", StringComparison.Ordinal);
                var (targetId, targetName) = principal.StartsWith("group:", StringComparison.Ordinal)
                    ? (principal[6..], NameOf(principal[6..]) ?? "a group")
                    : (user, names.GetValueOrDefault(user));
                var list = NameOf(Field(change.After, "listId")) ?? "a list";
                var role = Field(change.After, "role");
                // The owner's own row comes with sharing the list: that event says it already.
                if (role == "owner" && !wasAlive) return null;
                if (!wasAlive && isAlive) return new Described("sharing.member-added", targetId, targetName, $"{list} as {role}");
                if (wasAlive && !isAlive) return new Described("sharing.member-removed", targetId, targetName, list);
                var oldRole = Field(change.Before, "role");
                return isAlive && oldRole != role
                    ? new Described("sharing.member-role-changed", targetId, targetName, $"{list}: {oldRole} to {role}")
                    : null;
            }
            case "groupMembers":
            {
                var member = Field(change.After, "userId");
                var group = NameOf(Field(change.After, "groupId")) ?? "a group";
                if (!wasAlive && isAlive) return new Described("sharing.group-member-added", member, names.GetValueOrDefault(member ?? ""), group);
                if (wasAlive && !isAlive) return new Described("sharing.group-member-removed", member, names.GetValueOrDefault(member ?? ""), group);
                return null;
            }
            default:
                return null;
        }
    }
}
