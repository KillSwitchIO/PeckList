using PeckList.Core.Accounts;
using PeckList.Core.Configuration;

namespace PeckList.Server.Auth;

/// <summary>
/// At startup, one warning for each provider that is no longer set up but still has accounts linked
/// (PL-046 P3): taken out of the environment or the config file, which nothing can refuse. Those links
/// sign nobody in and count as no way in; the warning says how many and how to clear them.
/// </summary>
public sealed class OrphanedLinks(IIdentityStore identities, ServerSettings settings, ILogger<OrphanedLinks> logger) : IHostedService
{
    public async Task StartAsync(CancellationToken cancellationToken)
    {
        IReadOnlyList<(string Provider, int Accounts)> orphaned;
        try
        {
            orphaned = await FindAsync(cancellationToken);
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            // A check, not a reason to keep the server from starting (DB_MIGRATE_ON_START=false, say).
            logger.LogDebug(error, "Could not look for links to providers no longer set up");
            return;
        }
        foreach (var (provider, count) in orphaned)
        {
            logger.LogWarning(
                "{Count} accounts are still linked to {Provider}, which is no longer set up: those links sign nobody in. Clear them with: pecklist oidc unbind-all {Provider}",
                count, provider, provider);
        }
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    /// <summary>Each provider not set up now that still has links, with how many accounts it has.</summary>
    public async Task<IReadOnlyList<(string Provider, int Accounts)>> FindAsync(CancellationToken cancellation = default) =>
        [.. (await identities.ListAsync(cancellation))
            .Where(link => settings.Provider(link.Provider) is null)
            .GroupBy(link => link.Provider, StringComparer.Ordinal)
            .Select(group => (group.Key, group.Select(link => link.AccountId).Distinct(StringComparer.Ordinal).Count()))
            .OrderBy(each => each.Key, StringComparer.Ordinal)];
}
