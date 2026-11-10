using System.Text.Json;

namespace PeckList.Core.Accounts;

/// <summary>An invite to make an account here (spec: Accounts &amp; Admin, Registration).</summary>
public sealed record SignupInvite
{
    public required string Id { get; init; }

    /// <summary>The admin who made it.</summary>
    public required string CreatedBy { get; init; }
    public required DateTimeOffset CreatedAt { get; init; }
    public required DateTimeOffset Expires { get; init; }

    /// <summary>How many accounts it may make; null means any number until it expires.</summary>
    public int? MaxUses { get; init; } = 1;
    public int Uses { get; init; }

    /// <summary>Who it is for, as the admin wrote it; only admins see it.</summary>
    public string? Note { get; init; }

    /// <summary>The accounts it made, oldest first.</summary>
    public IReadOnlyList<string> UsedBy { get; init; } = [];

    public bool Usable(DateTimeOffset now) => Expires > now && (MaxUses is null || Uses < MaxUses);
}

/// <summary>
/// Invite links (<c>/join/&lt;token&gt;</c>) that let someone make their own account while
/// <c>REGISTRATION</c> is <c>invite</c> (or <c>open</c>). Only a hash of the token is kept, so a link
/// is shown once, when it is made. Revoked and used-up invites are forgotten.
/// </summary>
public sealed class SignupInvites(ISecretStore secrets, TimeProvider time)
{
    public const string Kind = "signup-invite";
    public const int MaxNoteLength = 100;
    public static readonly TimeSpan DefaultLifetime = TimeSpan.FromDays(7);
    public static readonly TimeSpan MaxLifetime = TimeSpan.FromDays(90);

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>Two sign-ups racing for the last use of an invite: one wins.</summary>
    private readonly SemaphoreSlim gate = new(1, 1);

    /// <exception cref="ArgumentException">A lifetime or use count out of range.</exception>
    public async Task<(string Token, SignupInvite Invite)> CreateAsync(
        string createdBy, TimeSpan? lifetime = null, int? maxUses = 1, string? note = null, CancellationToken cancellation = default)
    {
        var length = lifetime ?? DefaultLifetime;
        if (length <= TimeSpan.Zero || length > MaxLifetime) throw new ArgumentException("an invite lasts between a minute and 90 days");
        if (maxUses is < 1 or > 1000) throw new ArgumentException("an invite is for 1 to 1000 people, or any number");
        note = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
        if (note is not null) note = SafeText.Cut(note, MaxNoteLength);
        var now = time.GetUtcNow();
        var token = Tokens.New(24);
        var invite = new SignupInvite
        {
            Id = Ids.NewUlid(time),
            CreatedBy = createdBy,
            CreatedAt = now,
            Expires = now + length,
            MaxUses = maxUses,
            Note = note,
        };
        await secrets.PutAsync(Kind, Tokens.Hash(token), JsonSerializer.Serialize(invite, Json), cancellation);
        return (token, invite);
    }

    /// <summary>Invites that can still be used, newest first. Expired ones are dropped as a side effect.</summary>
    public async Task<IReadOnlyList<SignupInvite>> ListAsync(CancellationToken cancellation = default)
    {
        var now = time.GetUtcNow();
        var live = new List<SignupInvite>();
        foreach (var (name, invite) in await AllAsync(cancellation))
        {
            if (invite.Usable(now)) live.Add(invite);
            else await secrets.DeleteAsync(Kind, name, cancellation);
        }
        return live.OrderByDescending(invite => invite.CreatedAt).ToList();
    }

    /// <summary>The invite behind a token when it can still be used, else null.</summary>
    public async Task<SignupInvite?> FindAsync(string token, CancellationToken cancellation = default)
    {
        var invite = await ByTokenAsync(token, cancellation);
        return invite?.Usable(time.GetUtcNow()) == true ? invite : null;
    }

    /// <summary>
    /// Use the invite for <paramref name="create"/>, which makes the account: false (and nothing
    /// made) when the token is unknown, expired or used up. Exceptions from <paramref name="create"/>
    /// leave the invite as it was.
    /// </summary>
    public async Task<T?> UseAsync<T>(string token, Func<Task<T>> create, Func<T, string> accountId, CancellationToken cancellation = default)
        where T : class
    {
        await gate.WaitAsync(cancellation);
        try
        {
            var invite = await ByTokenAsync(token, cancellation);
            if (invite?.Usable(time.GetUtcNow()) != true) return null;
            var made = await create();
            var used = invite with { Uses = invite.Uses + 1, UsedBy = [.. invite.UsedBy, accountId(made)] };
            if (used.Usable(time.GetUtcNow())) await secrets.PutAsync(Kind, Tokens.Hash(token), JsonSerializer.Serialize(used, Json), cancellation);
            else await secrets.DeleteAsync(Kind, Tokens.Hash(token), cancellation);
            return made;
        }
        finally
        {
            gate.Release();
        }
    }

    /// <summary>Stop an invite working; the invite, or null when there was none with that id.</summary>
    public async Task<SignupInvite?> RevokeAsync(string id, CancellationToken cancellation = default)
    {
        foreach (var (name, invite) in await AllAsync(cancellation))
        {
            if (invite.Id != id) continue;
            await secrets.DeleteAsync(Kind, name, cancellation);
            return invite;
        }
        return null;
    }

    private async Task<SignupInvite?> ByTokenAsync(string token, CancellationToken cancellation)
    {
        if (string.IsNullOrWhiteSpace(token)) return null;
        return Read(await secrets.GetAsync(Kind, Tokens.Hash(token.Trim()), cancellation));
    }

    /// <summary>When a stored invite runs out; null when the value is not one.</summary>
    public static DateTimeOffset? ExpiresOf(string value) => Read(value)?.Expires;

    private static SignupInvite? Read(string? value)
    {
        if (string.IsNullOrEmpty(value)) return null;
        try
        {
            return JsonSerializer.Deserialize<SignupInvite>(value, Json);
        }
        catch (JsonException)
        {
            // Not ours to read: leave it.
            return null;
        }
    }

    private async Task<List<(string Name, SignupInvite Invite)>> AllAsync(CancellationToken cancellation)
    {
        var all = new List<(string, SignupInvite)>();
        foreach (var (name, value) in await secrets.ListAsync(Kind, cancellation))
        {
            if (Read(value) is { } invite) all.Add((name, invite));
        }
        return all;
    }
}
