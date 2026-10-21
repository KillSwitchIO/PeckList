using Punchlist.Core.Storage;

namespace Punchlist.Core.Sharing;

/// <summary>
/// The server's one <see cref="SharingIndex"/> and the lock that keeps it in step with the store:
/// every write that can change access runs inside <see cref="Gate"/>, tries its changes on a copy,
/// and swaps the copy in only once the store has committed.
/// </summary>
public sealed class SharingState
{
    public SemaphoreSlim Gate { get; } = new(1, 1);

    public SharingIndex Index { get; set; } = new();

    /// <summary>
    /// Load every entity, then bring the stored visibility in line with the rules (they may have
    /// changed in a new version, or a backup was restored). Returns how many access rows changed.
    /// </summary>
    public async Task<int> LoadAsync(IEntityStore store, IEnumerable<string> accounts, CancellationToken cancellation = default)
    {
        await Gate.WaitAsync(cancellation);
        try
        {
            var index = new SharingIndex();
            var owners = new HashSet<string>(StringComparer.Ordinal);
            await foreach (var entity in store.AllAsync(cancellation))
            {
                index.Apply(entity);
                owners.Add(entity.OwnerId);
            }
            var current = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
            await foreach (var (userId, entityId) in store.VisibilityAsync(cancellation))
            {
                if (!current.TryGetValue(userId, out var set)) current[userId] = set = new HashSet<string>(StringComparer.Ordinal);
                set.Add(entityId);
            }
            var users = new HashSet<string>(accounts, StringComparer.Ordinal);
            users.UnionWith(owners);
            users.UnionWith(current.Keys);
            var grants = new List<(string, string)>();
            var revokes = new List<(string, string)>();
            foreach (var user in users)
            {
                var desired = index.VisibleTo(user);
                var had = current.GetValueOrDefault(user) ?? [];
                grants.AddRange(desired.Except(had).Select(id => (user, id)));
                revokes.AddRange(had.Except(desired).Select(id => (user, id)));
            }
            await store.ApplyVisibilityAsync(new VisibilityPlan(grants, revokes), cancellation);
            Index = index;
            return grants.Count + revokes.Count;
        }
        finally
        {
            Gate.Release();
        }
    }

    /// <summary>
    /// Who gains and loses sight of what when <paramref name="written"/> moves the index from
    /// <paramref name="before"/> to <paramref name="after"/>. Only people who could see a written
    /// entity before or after can be affected: every access rule hangs on an entity they see.
    /// </summary>
    public static VisibilityPlan Plan(SharingIndex before, SharingIndex after, IReadOnlyList<StoredEntity> written)
    {
        var affected = new HashSet<string>(StringComparer.Ordinal);
        foreach (var entity in written)
        {
            affected.UnionWith(before.Viewers(entity.Id));
            affected.UnionWith(after.Viewers(entity.Id));
        }
        var grants = new List<(string, string)>();
        var revokes = new List<(string, string)>();
        foreach (var user in affected)
        {
            var had = before.VisibleTo(user);
            var has = after.VisibleTo(user);
            grants.AddRange(has.Except(had).Select(id => (user, id)));
            revokes.AddRange(had.Except(has).Select(id => (user, id)));
            // Written entities the user sees both before and after: their new seq brings them along.
        }
        return new VisibilityPlan(grants, revokes);
    }
}
