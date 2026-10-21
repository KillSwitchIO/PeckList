namespace Punchlist.Core.Storage;

/// <summary>The database behind the stores: schema migrations and a health probe.</summary>
public interface IDatabase
{
    /// <summary>Create or upgrade the schema of every store.</summary>
    Task MigrateAsync(CancellationToken cancellation = default);

    /// <summary>Whether the database answers (health check).</summary>
    Task<bool> PingAsync(CancellationToken cancellation = default);
}
