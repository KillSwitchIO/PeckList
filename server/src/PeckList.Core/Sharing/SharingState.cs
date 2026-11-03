using PeckList.Core.Storage;

namespace PeckList.Core.Sharing;

/// <summary>
/// The server's one <see cref="SharingIndex"/> and the lock that keeps it in step with the store:
/// every write that can change access runs inside <see cref="Gate"/>, tries its changes on a copy,
/// and swaps the copy in only once the store has committed.
/// </summary>
public sealed class SharingState
{
    public SemaphoreSlim Gate { get; } = new(1, 1);

    public SharingIndex Index { get; set; } = new();

    /// <summary>How the last load went: entities, and the time spent reading, building, checking access and storing changes.</summary>
    public sealed record LoadTimes(int Entities, TimeSpan Read, TimeSpan Build, TimeSpan Check, TimeSpan Store);

    public LoadTimes? LastLoad { get; private set; }

    private readonly TaskCompletionSource loaded = new(TaskCreationOptions.RunContinuationsAsynchronously);

    /// <summary>
    /// Completes once the index has been loaded the first time. The server listens while it loads
    /// (audit P3); writes and the jobs that read the index wait for this.
    /// </summary>
    public Task Loaded => loaded.Task;

    /// <summary>
    /// Load every entity, then bring the stored visibility in line with the rules (they may have
    /// changed in a new version, or a backup was restored). Returns how many access rows changed.
    /// </summary>
    public async Task<int> LoadAsync(IEntityStore store, IEnumerable<string> accounts, CancellationToken cancellation = default)
    {
        await Gate.WaitAsync(cancellation);
        try
        {
            var watch = System.Diagnostics.Stopwatch.StartNew();
            var builder = new SharingIndex.Builder();
            await foreach (var entity in store.AllAsync(cancellation)) builder.Add(entity);
            var read = watch.Elapsed;
            var index = builder.Build();
            var built = watch.Elapsed;
            var current = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
            await foreach (var (userId, entityId) in store.VisibilityAsync(cancellation))
            {
                if (!current.TryGetValue(userId, out var set)) current[userId] = set = new HashSet<string>(StringComparer.Ordinal);
                set.Add(entityId);
            }
            // Who should see what, entity by entity (one look at each entity's viewers, rather than
            // every entity for every person: a minute at 300,000 entities, audit P3).
            var desired = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
            foreach (var id in index.Ids())
            {
                foreach (var user in index.Viewers(id))
                {
                    if (!desired.TryGetValue(user, out var set)) desired[user] = set = new HashSet<string>(StringComparer.Ordinal);
                    set.Add(id);
                }
            }
            var users = new HashSet<string>(accounts, StringComparer.Ordinal);
            users.UnionWith(desired.Keys);
            users.UnionWith(current.Keys);
            var grants = new List<(string, string)>();
            var revokes = new List<(string, string)>();
            foreach (var user in users)
            {
                var want = desired.GetValueOrDefault(user) ?? [];
                var had = current.GetValueOrDefault(user) ?? [];
                grants.AddRange(want.Where(id => !had.Contains(id)).Select(id => (user, id)));
                revokes.AddRange(had.Where(id => !want.Contains(id)).Select(id => (user, id)));
            }
            var checkedAt = watch.Elapsed;
            await store.ApplyVisibilityAsync(new VisibilityPlan(grants, revokes), cancellation);
            Index = index;
            LastLoad = new LoadTimes(index.Count, read, built - read, checkedAt - built, watch.Elapsed - checkedAt);
            loaded.TrySetResult();
            return grants.Count + revokes.Count;
        }
        finally
        {
            Gate.Release();
        }
    }

    /// <summary>
    /// Who gains and loses sight of what when <paramref name="written"/> moves the index from
    /// <paramref name="before"/> to <paramref name="after"/>. Only entities that depend on a written
    /// one can change hands (<see cref="SharingIndex.Dependents"/>, on both sides of the change), so
    /// only their viewers are compared (audit P2: comparing whole views cost seconds a write).
    /// </summary>
    public static VisibilityPlan Plan(SharingIndex before, SharingIndex after, IReadOnlyList<StoredEntity> written)
    {
        var touched = new HashSet<string>(StringComparer.Ordinal);
        foreach (var entity in written)
        {
            touched.UnionWith(before.Dependents(entity.Id));
            touched.UnionWith(after.Dependents(entity.Id));
        }
        var grants = new List<(string, string)>();
        var revokes = new List<(string, string)>();
        foreach (var id in touched.Order(StringComparer.Ordinal))
        {
            var had = before.Viewers(id);
            var has = after.Viewers(id);
            // Written entities a user sees both before and after: their new seq brings them along.
            grants.AddRange(has.Where(user => !had.Contains(user)).Select(user => (user, id)));
            revokes.AddRange(had.Where(user => !has.Contains(user)).Select(user => (user, id)));
        }
        return new VisibilityPlan(grants, revokes);
    }
}
