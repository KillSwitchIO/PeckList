using PeckList.Core.Accounts;

namespace PeckList.Core.Sync;

/// <summary>
/// Which life of the server's data this is. It changes whenever a backup is restored over the
/// data, so devices (whose sync positions belong to the old data) start over from what the server
/// has now. Sent with every sync response.
/// </summary>
/// <remarks>
/// A person who starts over (spec: PL-147) gets a life of their own on top: their epoch is the
/// server's followed by theirs, so only their devices start over. Someone who never started over
/// has the server's epoch alone, as before.
/// </remarks>
public sealed class ServerEpoch(ISecretStore secrets)
{
    public const string Kind = "server";
    public const string Name = "epoch";

    /// <summary>Each person's own life, by account id, once they have started over.</summary>
    public const string PersonKind = "epoch-person";

    /// <summary>The current epoch, made on first use.</summary>
    public async Task<string> GetAsync(CancellationToken cancellation = default)
    {
        var current = (await secrets.ListAsync(Kind, cancellation)).FirstOrDefault(each => each.Name == Name).Value;
        return string.IsNullOrEmpty(current) ? await RenewAsync(secrets, cancellation) : current;
    }

    /// <summary>The epoch one person's devices go by: the server's, and theirs if they started over.</summary>
    public async Task<string> ForAsync(string userId, CancellationToken cancellation = default)
    {
        var server = await GetAsync(cancellation);
        var theirs = await secrets.GetAsync(PersonKind, userId, cancellation);
        return string.IsNullOrEmpty(theirs) ? server : $"{server}.{theirs}";
    }

    /// <summary>A new epoch: every device starts over at its next sync.</summary>
    public static async Task<string> RenewAsync(ISecretStore secrets, CancellationToken cancellation = default)
    {
        var epoch = Ids.NewUlid();
        await secrets.PutAsync(Kind, Name, epoch, cancellation);
        return epoch;
    }

    /// <summary>A new life for one person: their devices, and only theirs, start over at their next sync.</summary>
    public Task RenewForAsync(string userId, CancellationToken cancellation = default) =>
        secrets.PutAsync(PersonKind, userId, Ids.NewUlid(), cancellation);
}
