using PeckList.Core.Configuration;

namespace PeckList.Server.Push;

/// <summary>
/// At startup, one warning when <c>PUBLIC_URL</c> is http: push services take only an https: or a
/// mailto: contact, so pushes name the mail address or a placeholder instead (see
/// <see cref="PushSender.Contact"/>), and browsers take pushes only from an https site anyway.
/// </summary>
public sealed class PushContactCheck(ServerSettings settings, ILogger<PushContactCheck> logger) : IHostedService
{
    public Task StartAsync(CancellationToken cancellationToken)
    {
        if (Warning(settings) is { } warning) logger.LogWarning("{Warning}", warning);
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    /// <summary>The startup warning, or null when there is nothing to warn about.</summary>
    public static string? Warning(ServerSettings settings) =>
        settings.DemoMode || settings.PublicUrl is not { } url || url.Scheme == Uri.UriSchemeHttps
            ? null
            : $"PUBLIC_URL is not https, so push notifications give push services {PushSender.Contact(settings)} as the contact"
              + (PushSender.Contact(settings) == PushSender.PlaceholderContact ? " (set SMTP_FROM to give a real one)" : "")
              + ", and browsers take pushes only from a site served over https.";
}
