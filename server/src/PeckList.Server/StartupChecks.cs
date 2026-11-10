using PeckList.Core.Storage;
using PeckList.Storage.Sql;

namespace PeckList.Server;

/// <summary>What the server checks before it starts anything, so it can refuse in one clear line.</summary>
public static class StartupChecks
{
    /// <summary>
    /// The line to stop with when a newer version upgraded the database, or null. An older server
    /// must not run on a schema it has never seen; refusing here keeps the host from starting on it,
    /// so the operator gets one line and exit code 1 instead of a stack trace. A database that cannot
    /// be reached yet is left to the normal start, which says why; so is one that has not answered
    /// within <paramref name="wait"/> (10 seconds unless given), so a slow one does not hold the start twice.
    /// </summary>
    public static async Task<string?> NewerDatabaseAsync(IServiceProvider services, TimeSpan? wait = null, CancellationToken cancellation = default)
    {
        using var limit = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        limit.CancelAfter(wait ?? TimeSpan.FromSeconds(10));
        try
        {
            return await services.GetRequiredService<IDatabase>().NewerSchemaAsync(limit.Token) is var (database, known)
                ? NewerDatabaseException.Text(database, known)
                : null;
        }
        catch (Exception) when (!cancellation.IsCancellationRequested)
        {
            return null;
        }
    }
}
