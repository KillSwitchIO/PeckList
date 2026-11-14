using PeckList.Core.Accounts;

namespace PeckList.Core.Supporters;

/// <summary>How entering a supporter key went.</summary>
public enum SupporterEntry
{
    Saved,
    /// <summary>The text isn't a supporter key at all (a typo, part of one, something else pasted).</summary>
    NotAKey,
    /// <summary>It reads as a key, but PeckList's issuing service did not sign it.</summary>
    NotGenuine,
    /// <summary>A server key entered for one person, or a person's key entered for the server.</summary>
    WrongKind,
}

/// <summary>
/// The supporter keys a server holds (PL-112): at most one for the server, entered by an admin, and
/// one per person. They live in the secret store, so a backup carries them, and only genuine keys are
/// kept. A key is a thank-you and nothing else: no feature asks about it, only the reminder and the
/// thank-you text do.
/// </summary>
public sealed class SupporterKeys(ISecretStore secrets, ISupporterKeyCheck check)
{
    public const string Kind = "supporter-key";
    public const string ServerName = "server";

    public static string PersonName(string userId) => $"user:{userId}";

    /// <summary>The server's key, or null. Checked again on every read, so a key stops counting if its public key is ever withdrawn.</summary>
    public Task<SupporterKey?> ServerAsync(CancellationToken cancellation = default) => ReadAsync(ServerName, cancellation);

    /// <summary>One person's own key, or null.</summary>
    public Task<SupporterKey?> PersonAsync(string userId, CancellationToken cancellation = default) => ReadAsync(PersonName(userId), cancellation);

    /// <summary>Enter a key for one person (a person key) or, with no person, for the server (a server key).</summary>
    public async Task<(SupporterEntry Result, SupporterKey? Key)> EnterAsync(string? userId, string? text, CancellationToken cancellation = default)
    {
        if (SupporterKey.Parse(text) is not { } key) return (SupporterEntry.NotAKey, null);
        if (!check.IsGenuine(key)) return (SupporterEntry.NotGenuine, null);
        var wanted = userId is null ? SupporterKind.Server : SupporterKind.Person;
        if (key.Kind != wanted) return (SupporterEntry.WrongKind, null);
        await secrets.PutAsync(Kind, userId is null ? ServerName : PersonName(userId), key.Text, cancellation);
        return (SupporterEntry.Saved, key);
    }

    /// <summary>Forget a person's key or, with no person, the server's. Nothing happens when there is none.</summary>
    public Task RemoveAsync(string? userId, CancellationToken cancellation = default) =>
        secrets.DeleteAsync(Kind, userId is null ? ServerName : PersonName(userId), cancellation);

    private async Task<SupporterKey?> ReadAsync(string name, CancellationToken cancellation) =>
        SupporterKey.Parse(await secrets.GetAsync(Kind, name, cancellation)) is { } key && check.IsGenuine(key) ? key : null;
}
