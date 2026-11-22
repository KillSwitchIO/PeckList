namespace PeckList.Core.Attachments;

/// <summary>
/// Who has shown they hold a file's bytes (migration 0025): they uploaded them (PUT checks the body
/// every time), they could already download them when they attached the file again (a Duplicate),
/// or they held them before this was recorded (the migration's back-fill). Only attachments whose
/// owner holds the file let anyone download it (<c>SharingIndex.SeesFile</c>), so a file's hash on
/// its own is no key to its bytes.
/// </summary>
public interface IFileHolderStore
{
    /// <summary>Every (file, holder) pair.</summary>
    Task<IReadOnlyList<(string Sha256, string AccountId)>> AllAsync(CancellationToken cancellation = default);

    /// <summary>Records one; one already recorded stays as it is.</summary>
    Task AddAsync(string sha256, string accountId, CancellationToken cancellation = default);

    /// <summary>The bytes are gone from the store: nobody holds them any more.</summary>
    Task DeleteForFileAsync(string sha256, CancellationToken cancellation = default);
}

/// <summary>
/// The holders, kept in memory for every download's check and written through to the store. Loaded
/// once at start, before the sharing index (<c>SharingStartup</c>), so nothing reads it empty.
/// </summary>
public sealed class FileHolders(IFileHolderStore store)
{
    private readonly Lock gate = new();
    private Dictionary<string, HashSet<string>> holders = new(StringComparer.Ordinal);

    public async Task LoadAsync(CancellationToken cancellation = default)
    {
        var next = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
        foreach (var (sha256, account) in await store.AllAsync(cancellation)) Put(next, sha256, account);
        lock (gate) holders = next;
    }

    /// <summary>Whether <paramref name="accountId"/> has shown they hold the bytes of <paramref name="sha256"/>.</summary>
    public bool Holds(string sha256, string accountId)
    {
        lock (gate) return holders.TryGetValue(sha256, out var who) && who.Contains(accountId);
    }

    /// <summary>The files <paramref name="accountId"/> holds, for their backup.</summary>
    public IReadOnlyList<string> HeldBy(string accountId)
    {
        lock (gate) return [.. holders.Where(each => each.Value.Contains(accountId)).Select(each => each.Key).Order(StringComparer.Ordinal)];
    }

    public async Task AddAsync(string sha256, string accountId, CancellationToken cancellation = default)
    {
        if (Holds(sha256, accountId)) return;
        await store.AddAsync(sha256, accountId, cancellation);
        lock (gate) Put(holders, sha256, accountId);
    }

    public async Task ForgetFileAsync(string sha256, CancellationToken cancellation = default)
    {
        await store.DeleteForFileAsync(sha256, cancellation);
        lock (gate) holders.Remove(sha256);
    }

    private static void Put(Dictionary<string, HashSet<string>> into, string sha256, string account)
    {
        if (!into.TryGetValue(sha256, out var who)) into[sha256] = who = new HashSet<string>(StringComparer.Ordinal);
        who.Add(account);
    }
}
