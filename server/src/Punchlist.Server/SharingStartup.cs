using Punchlist.Core.Accounts;
using Punchlist.Core.Sharing;
using Punchlist.Core.Storage;

namespace Punchlist.Server;

/// <summary>
/// After migrations: load the sharing index and bring stored access in line with the rules
/// (a new version may have changed them, or a backup was restored).
/// </summary>
public sealed class SharingStartup(SharingState sharing, IEntityStore store, IAccountStore accounts, ILogger<SharingStartup> logger)
    : IHostedService
{
    public async Task StartAsync(CancellationToken cancellation)
    {
        var users = (await accounts.ListAsync(cancellation)).Select(account => account.Id);
        var changed = await sharing.LoadAsync(store, users, cancellation);
        if (changed > 0) logger.LogInformation("Brought {Count} access entries in line with the sharing rules", changed);
    }

    public Task StopAsync(CancellationToken cancellation) => Task.CompletedTask;
}
