using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using PeckList.Core.Accounts;

namespace PeckList.Server.Api;

/// <summary>
/// Signing the command line in (PL-133, RFC 8628 style): the CLI asks for a sign-in and gets a
/// short code and a secret poll token; the person types the code on the server's <c>/cli</c> page,
/// signed in as usual, and approves; the CLI's next poll collects an ordinary API key, once.
/// Requests live in memory for <see cref="Lifetime"/> and are lost on restart. They are found by a
/// hash of the poll token, and approve, deny and the final poll each take a request atomically.
/// </summary>
public sealed class CliSignIns(ApiKeyService keys, TimeProvider time, ILogger<CliSignIns> logger)
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(10);
    public static readonly TimeSpan Interval = TimeSpan.FromSeconds(5);
    public const int MaxPending = 1000;
    public const int MaxNameLength = 60;

    /// <summary>
    /// Wrong codes one account may type in a <see cref="Lifetime"/>. Past
    /// <see cref="WrongCodesWorthAWarning"/> across the server, the log says so once per window; that
    /// count never blocks anyone, so other accounts' typing can't stop a right code working.
    /// </summary>
    public const int WrongCodesPerAccount = 10;
    public const int WrongCodesWorthAWarning = 200;

    /// <summary>RFC 8628 6.1: twenty consonants, no vowels (no words), none that look alike.</summary>
    private const string Alphabet = "BCDFGHJKLMNPQRSTVWXZ";
    private const int CodeLength = 8;

    public enum State { Pending, Approved, Denied }

    public sealed class Request
    {
        public required string Hash { get; init; }
        public required string Code { get; init; }
        public required string Name { get; init; }
        public required bool AdminAsked { get; init; }
        public required string? Address { get; init; }
        public required DateTimeOffset RequestedAt { get; init; }
        public required DateTimeOffset Expires { get; init; }
        public State State { get; set; }
        public string? Token { get; set; }
        public ApiKey? Key { get; set; }
        public DateTimeOffset LastPoll { get; set; }
    }

    private readonly ConcurrentDictionary<string, Request> byHash = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, string> byCode = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, (int Count, DateTimeOffset Since)> wrong = new(StringComparer.Ordinal);

    public sealed record Started(string UserCode, string PollToken, DateTimeOffset Expires);

    /// <summary>A new request, or null when <see cref="MaxPending"/> are waiting already.</summary>
    public async Task<Started?> StartAsync(string? name, bool admin, string? address, CancellationToken cancellation = default)
    {
        await SweepAsync(cancellation);
        if (byHash.Count >= MaxPending) return null;
        var pollToken = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var now = time.GetUtcNow();
        string code;
        do code = new string(RandomNumberGenerator.GetItems<char>(Alphabet, CodeLength));
        while (!byCode.TryAdd(code, HashOf(pollToken)));
        var request = new Request
        {
            Hash = HashOf(pollToken),
            Code = code,
            Name = CleanName(name),
            AdminAsked = admin,
            Address = address,
            RequestedAt = now,
            Expires = now + Lifetime,
            LastPoll = DateTimeOffset.MinValue,
        };
        byHash[request.Hash] = request;
        return new Started(Display(code), pollToken, request.Expires);
    }

    /// <summary>"WDJB-MJHT", as it is shown and typed.</summary>
    public static string Display(string code) => $"{code[..4]}-{code[4..]}";

    /// <summary>What a person typed, as stored: upper case, no dashes or spaces.</summary>
    public static string Normalize(string? typed) =>
        new((typed ?? "").ToUpperInvariant().Where(c => c is not ('-' or ' ')).ToArray());

    /// <summary>A device name to show and to name the key with: printable, trimmed, capped.</summary>
    public static string CleanName(string? name)
    {
        var cleaned = new string((name ?? "").Where(c => !char.IsControl(c) && c is not ('​' or '‎' or '‏' or '‪' or '‫' or '‬' or '‭' or '‮' or '⁦' or '⁧' or '⁨' or '⁩')).ToArray()).Trim();
        if (cleaned.Length > MaxNameLength) cleaned = cleaned[..MaxNameLength].TrimEnd();
        return cleaned.Length == 0 ? "a command line" : cleaned;
    }

    private static string HashOf(string pollToken) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(pollToken)));

    public enum Lookup { Found, NotFound, TooManyTries }

    /// <summary>The pending request a code names, counting wrong codes per account and server-wide.</summary>
    public (Lookup Result, Request? Request) Find(string accountId, string? typed)
    {
        var now = time.GetUtcNow();
        if (Tries($"account:{accountId}", now) >= WrongCodesPerAccount) return (Lookup.TooManyTries, null);
        var code = Normalize(typed);
        if (byCode.TryGetValue(code, out var hash) && byHash.TryGetValue(hash, out var request) && request.State == State.Pending && request.Expires > now)
        {
            return (Lookup.Found, request);
        }
        Wrong($"account:{accountId}", now);
        if (Wrong("server", now) == WrongCodesWorthAWarning)
        {
            logger.LogWarning("{Count} wrong CLI sign-in codes in the last {Minutes} minutes, across accounts",
                WrongCodesWorthAWarning, (int)Lifetime.TotalMinutes);
        }
        return (Lookup.NotFound, null);
    }

    private int Tries(string who, DateTimeOffset now) =>
        wrong.TryGetValue(who, out var tries) && now - tries.Since < Lifetime ? tries.Count : 0;

    private int Wrong(string who, DateTimeOffset now) =>
        wrong.AddOrUpdate(who, (1, now), (_, tries) => now - tries.Since < Lifetime ? (tries.Count + 1, tries.Since) : (1, now)).Count;

    /// <summary>
    /// Approve a pending request: makes its key (tasks, and the admin API when the terminal asked,
    /// the approver ticked it and their role allows). Null when it was no longer pending.
    /// </summary>
    public async Task<ApiKey?> ApproveAsync(Request request, string userId, Role role, bool admin, CancellationToken cancellation = default)
    {
        lock (request)
        {
            if (request.State != State.Pending || request.Expires <= time.GetUtcNow()) return null;
            request.State = State.Approved;
        }
        List<string> scopes = [ApiScopes.TasksRead, ApiScopes.TasksWrite];
        if (admin && request.AdminAsked && role != Role.User) scopes.Add(ApiScopes.Admin);
        try
        {
            var (key, token) = await keys.CreateAsync(userId, role, $"CLI: {request.Name}", scopes, expiresAt: null, cancellation);
            // Both under the lock the poll reads them under: it sees both or neither. Whether the
            // request ran out while the key was being made is decided under it too, so a poll that
            // collects the key just after never has it revoked from under it. (The sweep takes a
            // request without the lock; it revokes a key it finds set, and this one a key it set
            // after the sweep took the request: one of the two always does.)
            bool ranOut;
            lock (request)
            {
                request.Key = key;
                request.Token = token;
                ranOut = !byHash.ContainsKey(request.Hash);
            }
            // Nobody can collect it now.
            if (ranOut)
            {
                await keys.RevokeAsync(userId, key.Id, cancellation);
                return null;
            }
            return key;
        }
        catch
        {
            Take(request);
            throw;
        }
    }

    /// <summary>Deny a pending request: its next poll hears so, and it is gone.</summary>
    public bool Deny(Request request)
    {
        lock (request)
        {
            if (request.State != State.Pending) return false;
            request.State = State.Denied;
            return true;
        }
    }

    public enum Poll { Pending, SlowDown, Denied, Expired, Approved }

    /// <summary>What the CLI hears: the key's token once, after which the request is gone.</summary>
    public async Task<(Poll Result, string? Token, ApiKey? Key)> PollAsync(string? pollToken, CancellationToken cancellation = default)
    {
        await SweepAsync(cancellation);
        if (string.IsNullOrEmpty(pollToken) || !byHash.TryGetValue(HashOf(pollToken), out var request)) return (Poll.Expired, null, null);
        var now = time.GetUtcNow();
        lock (request)
        {
            switch (request.State)
            {
                case State.Denied:
                    Take(request);
                    return (Poll.Denied, null, null);
                case State.Approved when request.Token is { } token:
                    // Taken atomically: a second poll with the same token finds nothing.
                    return Take(request) ? (Poll.Approved, token, request.Key) : (Poll.Expired, null, null);
                default:
                    var early = now - request.LastPoll < Interval - TimeSpan.FromMilliseconds(500);
                    request.LastPoll = now;
                    return (early ? Poll.SlowDown : Poll.Pending, null, null);
            }
        }
    }

    private bool Take(Request request)
    {
        byCode.TryRemove(request.Code, out _);
        return byHash.TryRemove(request.Hash, out _);
    }

    /// <summary>Drop requests that ran out; a key approved but never collected is revoked.</summary>
    public async Task SweepAsync(CancellationToken cancellation = default)
    {
        var now = time.GetUtcNow();
        foreach (var request in byHash.Values.Where(each => each.Expires <= now).ToList())
        {
            if (!Take(request)) continue;
            if (request.Key is { } key)
            {
                await keys.RevokeAsync(key.UserId, key.Id, cancellation);
                logger.LogInformation("Revoked CLI key {Key}: approved but never collected", key.Id);
            }
        }
        foreach (var (who, tries) in wrong.ToList())
        {
            if (now - tries.Since >= Lifetime) wrong.TryRemove(who, out _);
        }
    }

    public int Pending => byHash.Count;
}

/// <summary>Sweeps run-out CLI sign-ins every minute, so an uncollected key goes even when nobody polls.</summary>
public sealed class CliSignInSweeper(CliSignIns signIns, TimeProvider time, ILogger<CliSignInSweeper> logger)
    : PeriodicService("Sweeping CLI sign-ins", TimeSpan.FromMinutes(1), TimeSpan.FromMinutes(1), time, logger, LogLevel.Warning)
{
    protected override Task RunAsync(CancellationToken stopping) => signIns.SweepAsync(stopping);
}
