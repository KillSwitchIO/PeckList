using Punchlist.Core.Accounts;
using Punchlist.Core.Sharing;
using Punchlist.Core.Storage;

namespace Punchlist.Server;

/// <summary>
/// After migrations: load the sharing index and bring stored access in line with the rules
/// (a new version may have changed them, or a backup was restored).
/// </summary>
public sealed class SharingStartup(SharingState sharing, Groups groups, Invites invites, IEntityStore store, IAccountStore accounts, ILogger<SharingStartup> logger)
    : IHostedService
{
    public async Task StartAsync(CancellationToken cancellation)
    {
        var users = (await accounts.ListAsync(cancellation)).Select(account => account.Id);
        var changed = await sharing.LoadAsync(store, users, cancellation);
        if (changed > 0) logger.LogInformation("Brought {Count} access entries in line with the sharing rules", changed);
        var settled = await groups.SettleAsync(cancellation);
        if (settled > 0) logger.LogInformation("Handed on {Count} groups whose owner had left", settled);
        var invited = await invites.SettleAsync(cancellation);
        if (invited > 0) logger.LogInformation("Settled invite assignments on {Count} tasks", invited);
    }

    public Task StopAsync(CancellationToken cancellation) => Task.CompletedTask;
}
