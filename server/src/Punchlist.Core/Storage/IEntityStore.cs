using System.Text.Json.Nodes;

namespace Punchlist.Core.Storage;

/// <summary>One entity as the server keeps it: its JSON plus where it sits in the change feed.</summary>
/// <param name="Collection">The workspace collection it belongs to (<c>tasks</c>, <c>lists</c>, ...).</param>
/// <param name="Seq">Server-wide change number of its last write; the sync cursor counts these.</param>
public sealed record StoredEntity(string Collection, string Id, string OwnerId, long Seq, JsonObject Doc);

/// <summary>An entity a client sends, before the server decides what to keep.</summary>
public sealed record IncomingEntity(string Collection, JsonObject Doc)
{
    public string Id => (string?)Doc["id"] ?? throw new ArgumentException("entity without an id");
}

/// <summary>A page of the change feed: what changed after a cursor, oldest first.</summary>
/// <param name="Cursor">Pass this back to get the next page (the last entity's seq, or the input cursor).</param>
/// <param name="More">Whether more changes wait after this page.</param>
public sealed record ChangePage(IReadOnlyList<StoredEntity> Entities, long Cursor, bool More);

/// <summary>
/// Server storage (ADR-0004): each row holds one entity's JSON; a visibility index says who may
/// see which entity. Writes are serialized so seq numbers commit in order and a client's cursor
/// never skips a change. Every adapter passes the same contract suite.
/// </summary>
public interface IEntityStore
{
    /// <summary>The newest seq (0 when empty).</summary>
    Task<long> CursorAsync(CancellationToken cancellation = default);

    Task<StoredEntity?> GetAsync(string id, CancellationToken cancellation = default);

    /// <summary>
    /// Write entities for <paramref name="ownerId"/> in one transaction. For each, <paramref name="resolve"/>
    /// gets what is stored (null when new) and what arrived, and returns the JSON to store, or null to
    /// leave it as it is. Each stored entity gets the next seq, in input order. A new entity is owned by
    /// and visible to <paramref name="ownerId"/>; an existing one keeps its owner.
    /// </summary>
    /// <returns>The entities written (with their new seq).</returns>
    Task<IReadOnlyList<StoredEntity>> WriteAsync(
        string ownerId,
        IReadOnlyList<IncomingEntity> incoming,
        Func<StoredEntity?, IncomingEntity, JsonObject?> resolve,
        CancellationToken cancellation = default);

    /// <summary>Entities <paramref name="userId"/> may see, changed after <paramref name="after"/>, oldest first.</summary>
    Task<ChangePage> ChangesAsync(string userId, long after, int limit, CancellationToken cancellation = default);

    /// <summary>Every entity, in seq order (export, snapshots, moving between databases).</summary>
    IAsyncEnumerable<StoredEntity> AllAsync(CancellationToken cancellation = default);

    /// <summary>Every (user, entity) pair of the visibility index.</summary>
    IAsyncEnumerable<(string UserId, string EntityId)> VisibilityAsync(CancellationToken cancellation = default);

    /// <summary>
    /// Load exported entities as they were (owners, seqs, visibility, cursor) into an empty store.
    /// </summary>
    Task RestoreAsync(
        IReadOnlyList<StoredEntity> entities,
        IReadOnlyList<(string UserId, string EntityId)> visibility,
        long cursor,
        CancellationToken cancellation = default);
}
