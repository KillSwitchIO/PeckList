using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using PeckList.Core;
using PeckList.Core.Calendars;
using PeckList.Core.Configuration;

namespace PeckList.Server.Calendars;

/// <summary>
/// Push channels for calendars whose provider can push (Google, spec: PL-134 Speed): after a link
/// syncs, one is opened when it has none or the one it has ends within <see cref="RenewBefore"/>,
/// and the old one stopped. Only when <c>PUBLIC_URL</c> is a public https address, the only kind
/// Google calls; otherwise nothing is opened and the checks every <c>CALENDAR_SYNC_MINUTES</c> carry
/// on, as they do anyway beside push. A channel Google refuses is not asked for again for
/// <see cref="RetryAfter"/>, so a server Google cannot reach does not try on every run.
/// </summary>
public sealed class CalendarChannels(CalendarSync engine, ICalendarStore store, ServerSettings settings, TimeProvider time, ILogger<CalendarChannels> logger)
{
    /// <summary>A channel ending sooner than this is replaced.</summary>
    public static readonly TimeSpan RenewBefore = TimeSpan.FromDays(1);

    /// <summary>How long after Google refused a channel the link's next one is asked for.</summary>
    public static readonly TimeSpan RetryAfter = TimeSpan.FromHours(6);

    /// <summary>The path Google calls.</summary>
    public const string PushPath = "/api/calendars/google/push";

    private readonly ConcurrentDictionary<string, DateTimeOffset> refused = new(StringComparer.Ordinal);

    /// <summary>Where Google calls this server, or null when it can't: no PUBLIC_URL, not https, or not a public host.</summary>
    public Uri? Callback => PushCallback(settings.PublicUrl);

    /// <summary>The push address for a public URL, or null when Google could not call it.</summary>
    public static Uri? PushCallback(Uri? publicUrl)
    {
        if (publicUrl is not { Scheme: "https" } || !IsPublicHost(publicUrl.IdnHost)) return null;
        return new Uri(publicUrl.AbsoluteUri.TrimEnd('/') + PushPath);
    }

    /// <summary>Keeps the link's channel open, best effort: a failure is logged and polling covers it.</summary>
    public async Task KeepAsync(string linkId, CancellationToken cancellation)
    {
        try
        {
            await KeepCoreAsync(linkId, cancellation);
        }
        catch (Exception error) when (!cancellation.IsCancellationRequested)
        {
            refused[linkId] = time.GetUtcNow() + RetryAfter;
            // A calendar problem's words are the status and reason only (never content); any other
            // exception's message may quote what it was sent, so only its type.
            logger.LogInformation("Calendar link {Link} has no push channel ({Error}); it is checked on its interval instead", linkId,
                error is CalendarProblem problem ? problem.At(CalendarCalls.Watch).Describe() : error.GetType().Name);
        }
    }

    /// <summary>
    /// Stops a link's channel and forgets it (the link was set to Off), best effort and bounded by
    /// <see cref="CalendarEndpoints.EndAtProviderWithin"/>: an unreadable secret or a silent provider
    /// never fails the change, and the channel is forgotten either way.
    /// </summary>
    public async Task StopAsync(CalendarLink link, CancellationToken cancellation)
    {
        if (link.Channel is not { } channel) return;
        using var bounded = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        bounded.CancelAfter(CalendarEndpoints.EndAtProviderWithin);
        try
        {
            if (await store.AccountAsync(link.CalendarAccountId, cancellation) is { } account && engine.Provider(account.Provider) is { Capabilities.Push: true } provider)
            {
                await provider.StopWatchAsync(await engine.ConnectionAsync(account, cancellation), channel, bounded.Token);
            }
        }
        catch (Exception) when (!cancellation.IsCancellationRequested)
        {
            // Google stops calling when the channel ends; until then a push for an Off link nudges nothing.
        }
        await store.UpdateLinkChannelAsync(link.Id, null, null, cancellation);
    }

    private async Task KeepCoreAsync(string linkId, CancellationToken cancellation)
    {
        var now = time.GetUtcNow();
        if (Callback is not { } callback) return;
        if (refused.TryGetValue(linkId, out var until) && until > now) return;
        if (await store.LinkAsync(linkId, cancellation) is not { } link || link.Mode == CalendarModes.Off) return;
        if (link.Channel is { } current && current.Expires - now > RenewBefore) return;
        if (await store.AccountAsync(link.CalendarAccountId, cancellation) is not { Status: CalendarAccount.Ok } account) return;
        if (engine.Provider(account.Provider) is not { Capabilities.Push: true } provider) return;
        var connection = await engine.ConnectionAsync(account, cancellation);
        var token = Tokens.New();
        if (await provider.WatchAsync(connection, link.RemoteId, callback, token, cancellation) is not { } opened) return;
        refused.TryRemove(linkId, out _);
        // Only the token's hash is kept (Security N1); the push route compares hashes. Kept only while the
        // link is: one disconnected meanwhile comes back with no channel.
        await store.UpdateLinkChannelAsync(linkId, opened, Tokens.Hash(token), cancellation);
        if (link.Channel is { } old)
        {
            try
            {
                await provider.StopWatchAsync(connection, old, cancellation);
            }
            catch (CalendarProblem)
            {
                // It ends on its own within a day, and its token no longer matches.
            }
        }
    }

    /// <summary>A host Google could reach: not loopback, private, link-local, shared (CGNAT) or a local-only name.</summary>
    internal static bool IsPublicHost(string host)
    {
        if (IPAddress.TryParse(host.Trim('[', ']'), out var address))
        {
            if (address.IsIPv4MappedToIPv6) address = address.MapToIPv4();
            if (IPAddress.IsLoopback(address) || address.IsIPv6LinkLocal || address.IsIPv6SiteLocal || address.IsIPv6UniqueLocal) return false;
            if (address.AddressFamily != AddressFamily.InterNetwork) return true;
            var b = address.GetAddressBytes();
            return !(b[0] == 10 || b[0] == 127 || b[0] == 0 || (b[0] == 172 && b[1] >= 16 && b[1] <= 31) || (b[0] == 192 && b[1] == 168)
                || (b[0] == 169 && b[1] == 254) || (b[0] == 100 && b[1] >= 64 && b[1] <= 127));
        }
        var name = host.TrimEnd('.').ToLowerInvariant();
        return name.Contains('.', StringComparison.Ordinal)
            && !(name == "localhost" || name.EndsWith(".localhost", StringComparison.Ordinal) || name.EndsWith(".local", StringComparison.Ordinal)
                || name.EndsWith(".internal", StringComparison.Ordinal) || name.EndsWith(".lan", StringComparison.Ordinal)
                || name.EndsWith(".home.arpa", StringComparison.Ordinal) || name.EndsWith(".test", StringComparison.Ordinal));
    }
}
