using System.Text.RegularExpressions;
using PeckList.Core.Accounts;
using PeckList.Core.Configuration;

namespace PeckList.Server;

/// <summary>
/// <c>DEMO_MODE</c> (PL-117): a public trial server that resets every night. The settings it
/// forces are in <see cref="ServerSettings.Read"/>; this is what it adds to the running server:
/// no calls out, no search engines, and the pre-made accounts the banner names.
/// </summary>
public static partial class Demo
{
    public const string Robots = "noindex, nofollow";

    public static IServiceCollection AddDemoMode(this IServiceCollection services, ServerSettings settings)
    {
        if (!settings.DemoMode) return services;
        // Every client the server makes for itself (push, provider photos, the release check,
        // usage reports, and whatever comes later) refuses to leave the machine. The identity
        // provider and log servers the operator sets up have their own clients and still work.
        services.ConfigureHttpClientDefaults(http => http.AddHttpMessageHandler(() => new OutboundGuard()));
        services.AddHostedService<DemoAccountsStartup>();
        return services;
    }

    /// <summary>Search engines stay away: every answer says so (and index.html too, <see cref="WithRobotsMeta"/>).</summary>
    public static void UseDemoMode(this WebApplication app, ServerSettings settings)
    {
        if (!settings.DemoMode) return;
        app.Use((context, next) =>
        {
            context.Response.OnStarting(() =>
            {
                context.Response.Headers["X-Robots-Tag"] = Robots;
                return Task.CompletedTask;
            });
            return next(context);
        });
    }

    /// <summary>The page with a robots meta tag in its head, for crawlers that read only the HTML.</summary>
    public static string WithRobotsMeta(string html)
    {
        var tag = $"<meta name=\"robots\" content=\"{Robots}\">";
        var head = HeadTag().Match(html);
        if (head.Success) return html.Insert(head.Index + head.Length, tag);
        var doctype = Doctype().Match(html);
        return doctype.Success ? html.Insert(doctype.Index + doctype.Length, tag) : tag + html;
    }

    [GeneratedRegex("<head(\\s[^>]*)?>", RegexOptions.IgnoreCase)]
    private static partial Regex HeadTag();

    [GeneratedRegex("<!doctype[^>]*>", RegexOptions.IgnoreCase)]
    private static partial Regex Doctype();

    /// <summary>What <c>/api/info</c> tells the app for its banner.</summary>
    public static DemoInfo? Info(ServerSettings settings) => settings.DemoMode
        ? new DemoInfo(settings.DemoResetTime, [.. settings.DemoAccounts.Select(each => new DemoLogin(each.Username, each.Password))],
            settings.DemoResetEvery)
        : null;

    /// <summary>Refuses every request: a demo server sends nothing anywhere.</summary>
    public sealed class OutboundGuard : DelegatingHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            throw new HttpRequestException($"DEMO_MODE: no outbound calls (refused {request.RequestUri?.Host})");
    }

    /// <summary>
    /// After the admin: each <c>DEMO_ACCOUNTS</c> entry exists, is a plain user and signs in with
    /// the password the banner shows, whatever a visitor did to it before the last reset.
    /// </summary>
    private sealed class DemoAccountsStartup(AccountService accounts, ServerSettings settings, ILogger<DemoAccountsStartup> logger)
        : IHostedService
    {
        public async Task StartAsync(CancellationToken cancellation)
        {
            foreach (var demo in settings.DemoAccounts)
            {
                var created = await accounts.EnsureDemoAccountAsync(demo.Username, demo.Password, cancellation);
                if (created) logger.LogInformation("Demo account {Username} created", demo.Username);
            }
        }

        public Task StopAsync(CancellationToken cancellation) => Task.CompletedTask;
    }
}

/// <summary>
/// The banner's facts: when the nightly reset runs, the accounts anyone may use, and how often it
/// resets in minutes (1440: nightly at <paramref name="ResetTime"/>).
/// </summary>
public sealed record DemoInfo(string ResetTime, IReadOnlyList<DemoLogin> Accounts, int ResetEveryMinutes = 1440);

public sealed record DemoLogin(string Username, string Password);
