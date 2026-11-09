namespace PeckList.Core.Storage;

/// <summary>The database behind the stores: schema migrations and a health probe.</summary>
public interface IDatabase
{
    /// <summary>Create or upgrade the schema of every store.</summary>
    Task MigrateAsync(CancellationToken cancellation = default);

    /// <summary>
    /// When a newer version upgraded this database: the schema it holds and the newest this version
    /// knows. Null otherwise, or when it has no schema yet. Reads only.
    /// </summary>
    Task<(int Database, int Known)?> NewerSchemaAsync(CancellationToken cancellation = default);

    /// <summary>Whether the database answers (health check).</summary>
    Task<bool> PingAsync(CancellationToken cancellation = default);

    /// <summary>Whether it holds no entities, accounts or secrets (import only goes into an empty one).</summary>
    Task<bool> IsEmptyAsync(CancellationToken cancellation = default);

    /// <summary>
    /// Row counts for the debug dump and server stats: <c>accounts</c>, <c>identities</c>,
    /// <c>server_groups</c> and so on, then <c>entities.&lt;collection&gt;</c> and <c>deleted.&lt;collection&gt;</c>.
    /// </summary>
    Task<IReadOnlyDictionary<string, long>> CountRowsAsync(CancellationToken cancellation = default);

    /// <summary>Delete every entity, account and secret (import --replace).</summary>
    Task WipeAsync(CancellationToken cancellation = default);
}
