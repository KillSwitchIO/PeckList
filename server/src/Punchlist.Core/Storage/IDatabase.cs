namespace Punchlist.Core.Storage;

/// <summary>The database behind the stores: schema migrations and a health probe.</summary>
public interface IDatabase
{
    /// <summary>Create or upgrade the schema of every store.</summary>
    Task MigrateAsync(CancellationToken cancellation = default);

    /// <summary>Whether the database answers (health check).</summary>
    Task<bool> PingAsync(CancellationToken cancellation = default);

    /// <summary>Whether it holds no entities, accounts or secrets (import only goes into an empty one).</summary>
    Task<bool> IsEmptyAsync(CancellationToken cancellation = default);

    /// <summary>Delete every entity, account and secret (import --replace).</summary>
    Task WipeAsync(CancellationToken cancellation = default);
}
