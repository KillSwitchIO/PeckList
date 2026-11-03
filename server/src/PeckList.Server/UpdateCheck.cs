using System.Text.Json;
using PeckList.Core.Configuration;

namespace PeckList.Server;

/// <summary>A published release: its version (no build metadata) and its page.</summary>
public sealed record ReleaseInfo(string Version, string Url, DateTimeOffset? PublishedAt);

/// <summary>Where the newest release is read from.</summary>
public interface IReleaseFeed
{
    /// <summary>The newest release, or null when the feed has none or cannot be read (a private project answers 404).</summary>
    Task<ReleaseInfo?> LatestAsync(CancellationToken cancellation);
}

/// <summary>PeckList's releases on GitLab: the API's latest-release permalink.</summary>
public sealed class GitLabReleaseFeed(IHttpClientFactory http) : IReleaseFeed
{
    public const string LatestUrl = "https://gitlab.com/api/v4/projects/87938160/releases/permalink/latest";

    public async Task<ReleaseInfo?> LatestAsync(CancellationToken cancellation)
    {
        using var response = await http.CreateClient("updates").GetAsync(LatestUrl, cancellation);
        if (!response.IsSuccessStatusCode) return null;
        await using var body = await response.Content.ReadAsStreamAsync(cancellation);
        using var json = await JsonDocument.ParseAsync(body, cancellationToken: cancellation);
        return Parse(json.RootElement);
    }

    /// <summary>A GitLab release as JSON: <c>tag_name</c> such as <c>v0.2.7+20261028</c>, its web page and date.</summary>
    public static ReleaseInfo? Parse(JsonElement release)
    {
        var tag = release.TryGetProperty("tag_name", out var name) ? name.GetString() : null;
        var version = UpdateStatus.Plain(tag);
        if (version is null) return null;
        var url = release.TryGetProperty("_links", out var links) && links.TryGetProperty("self", out var self)
            ? self.GetString()
            : null;
        DateTimeOffset? published = release.TryGetProperty("released_at", out var at) && at.TryGetDateTimeOffset(out var when)
            ? when
            : null;
        return new ReleaseInfo(version, url ?? "https://gitlab.com/killswitch10/punchlist/-/releases", published);
    }
}

/// <summary>What the last look at the releases found (spec: update notice, R-FB-148).</summary>
public sealed class UpdateStatus
{
    private ReleaseInfo? latest;
    private DateTimeOffset? checkedAt;

    public ReleaseInfo? Latest => Volatile.Read(ref latest);

    public DateTimeOffset? CheckedAt => checkedAt;

    public void Record(ReleaseInfo? release, DateTimeOffset at)
    {
        Volatile.Write(ref latest, release);
        checkedAt = at;
    }

    /// <summary><c>v0.2.7+20261028</c> or <c>0.2.7-edge.1</c> as <c>0.2.7</c>; null when it is no version.</summary>
    public static string? Plain(string? tag)
    {
        if (string.IsNullOrWhiteSpace(tag)) return null;
        var text = tag.Trim().TrimStart('v', 'V').Split('+')[0].Split('-')[0];
        return Version.TryParse(text, out _) ? text : null;
    }

    /// <summary>Whether release <paramref name="latest"/> is newer than <paramref name="current"/> (both plain or tags).</summary>
    public static bool IsNewer(string? latest, string? current)
    {
        var a = Plain(latest);
        var b = Plain(current);
        return a is not null && b is not null && Version.Parse(a) > Version.Parse(b);
    }
}

/// <summary>
/// Looks for a newer release twice a day (<c>UPDATE_CHECK</c>, on by default): one request to
/// GitLab from the server, never from people's browsers. Off, it asks nothing and forgets what it knew.
/// </summary>
public sealed class UpdateCheck(IReleaseFeed feed, UpdateStatus status, LiveSettings live, TimeProvider time, ILogger<UpdateCheck> logger)
    : PeriodicService("Update check", TimeSpan.FromMinutes(1), TimeSpan.FromHours(12), time, logger, LogLevel.Warning)
{
    protected override async Task RunAsync(CancellationToken stopping)
    {
        if (!live.Current.UpdateCheck)
        {
            status.Record(null, Time.GetUtcNow());
            return;
        }
        var release = await feed.LatestAsync(stopping);
        status.Record(release, Time.GetUtcNow());
        if (release is null)
        {
            Logger.LogDebug("Update check: no release found");
        }
        else if (UpdateStatus.IsNewer(release.Version, ServerApp.Version))
        {
            Logger.LogInformation("PeckList {Latest} is out; this server runs {Current}", release.Version, ServerApp.Version);
        }
    }
}

public static class UpdateEndpoints
{
    /// <summary>
    /// <c>GET /api/updates</c>: the newest release the server knows of, for the menu's notice. The
    /// app compares it with the server's version and its own.
    /// </summary>
    public static RouteGroupBuilder MapUpdates(this RouteGroupBuilder api)
    {
        api.MapGet("/updates", (UpdateStatus status, LiveSettings live) =>
        {
            var on = live.Current.UpdateCheck;
            var latest = on ? status.Latest : null;
            return new UpdateInfo(on, ServerApp.Version, latest?.Version, latest?.Url, latest?.PublishedAt, on ? status.CheckedAt : null);
        });
        return api;
    }
}

/// <summary>The answer of <c>GET /api/updates</c>.</summary>
public sealed record UpdateInfo(
    bool Enabled, string Current, string? Latest, string? ReleaseUrl, DateTimeOffset? PublishedAt, DateTimeOffset? CheckedAt);
