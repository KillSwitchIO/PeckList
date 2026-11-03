using System.Text.Json.Nodes;

namespace PeckList.Core.Sync;

/// <summary>
/// One sharing change a person's device pushed: a list shared or made private, someone added to or
/// taken off a list or a group, a role changed. <paramref name="Before"/> is null for a new entity.
/// </summary>
public sealed record SharingChange(string Collection, string Id, JsonObject? Before, JsonObject After);

/// <summary>Hears about sharing changes devices push (the server records them in its event log).</summary>
public interface ISharingChangeSink
{
    Task ChangedAsync(string userId, IReadOnlyList<SharingChange> changes, CancellationToken cancellation = default);
}

public static class SharingChanges
{
    /// <summary>The collections whose changes are sharing changes.</summary>
    public static bool Watched(string collection) => collection is "lists" or "listMembers" or "groupMembers";
}
