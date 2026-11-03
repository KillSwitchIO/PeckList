using PeckList.Core.Accounts;

namespace PeckList.Core.Sync;

/// <summary>
/// Which life of the server's data this is. It changes whenever a backup is restored over the
/// data, so devices (whose sync positions belong to the old data) start over from what the server
/// has now. Sent with every sync response.
/// </summary>
public sealed class ServerEpoch(ISecretStore secrets)
{
    public const string Kind = "server";
    public const string Name = "epoch";

    /// <summary>The current epoch, made on first use.</summary>
    public async Task<string> GetAsync(CancellationToken cancellation = default)
    {
        var current = (await secrets.ListAsync(Kind, cancellation)).FirstOrDefault(each => each.Name == Name).Value;
        return string.IsNullOrEmpty(current) ? await RenewAsync(secrets, cancellation) : current;
    }

    /// <summary>A new epoch: every device starts over at its next sync.</summary>
    public static async Task<string> RenewAsync(ISecretStore secrets, CancellationToken cancellation = default)
    {
        var epoch = Ids.NewUlid();
        await secrets.PutAsync(Kind, Name, epoch, cancellation);
        return epoch;
    }
}
