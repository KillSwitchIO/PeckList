using PeckList.Server.Push;
using System.Reflection;
using Microsoft.AspNetCore.HttpOverrides;
using PeckList.Core;
using PeckList.Core.Configuration;
using PeckList.Server.Auth;
using PeckList.Server.Attachments;
using PeckList.Server.Audit;
using PeckList.Server.Logging;
using PeckList.Core.Sync;

namespace PeckList.Server;

/// <summary>Composition root: services, middleware and endpoints of the one container.</summary>
public static partial class ServerApp
{
    /// <summary>The version with its build metadata: the commit it was built from in a release build.</summary>
    public static string FullVersion { get; } =
        typeof(ServerApp).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "0.0.0";

    public static string Version { get; } = FullVersion.Split('+')[0];

    /// <summary>Built by CI with its version stamped (the image, the native packages), not on a developer's machine.</summary>
    public static bool Stamped { get; } = typeof(ServerApp).Assembly.GetCustomAttributes<AssemblyMetadataAttribute>()
        .Any(each => each.Key == "PeckListStamped" && each.Value == "true");

    public static WebApplication Build(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);
        // Both do nothing unless the server runs under that service manager: a Windows service
        // (start/stop and the event log's lifetime messages), or a systemd Type=notify unit.
        builder.Host.UseWindowsService(options => options.ServiceName = "PeckList");
        builder.Host.UseSystemd();
        var config = builder.Configuration;
        // Configuration holds the environment variables (and test overrides); NAME_FILE works too.
        // Then CONFIG_FILE, then values saved on the admin settings page (spec: Server settings).
        var loaded = SettingsLoader.Load(
            new FileAwareSecretSource(key => config[key]),
            inContainer: config["DOTNET_RUNNING_IN_CONTAINER"] == "true");
        var settings = loaded.Settings;
        builder.Services.AddSingleton(loaded);
        builder.Services.AddSingleton(settings);
        builder.Services.AddSingleton(new LiveSettings(settings));

        // One provider for every log output (spec: Logging); its levels decide what is written.
        var logging = new LogPipeline(settings.Logging);
        logging.Redaction.AddSecrets([
            settings.AdminPassword, settings.DbConnectionString, config["CONFIG_KEY"],
            .. settings.OidcProviders.Select(provider => provider.ClientSecret),
        ]);
        builder.Logging.ClearProviders();
        builder.Logging.SetMinimumLevel(LogLevel.Trace);
        builder.Services.AddSingleton(logging);
        builder.Services.AddSingleton<ILoggerProvider>(_ => logging);

        builder.Services.AddHealthChecks().AddCheck<SharingHealthCheck>("sharing");
        builder.Services.AddSingleton(StartupWait.Default);
        builder.Services.AddEntityStore(settings);
        // After the store: its startup (migrations) runs before the admin is made.
        builder.Services.AddPeckListAuth(settings, loaded.Layers.Cipher);
        builder.Services.AddSingleton<IChangeNotifier, InProcessChangeNotifier>();
        builder.Services.AddSingleton<PeckList.Core.Sharing.SharingState>();
        builder.Services.AddSingleton<ServerClock>();
        builder.Services.AddSingleton(provider => new PeckList.Core.Sharing.Friends(
            provider.GetRequiredService<PeckList.Core.Accounts.AccountService>(),
            provider.GetRequiredService<PeckList.Core.Accounts.IAccountStore>(),
            provider.GetRequiredService<SyncService>(),
            provider.GetRequiredService<PeckList.Core.Sharing.SharingState>(),
            provider.GetRequiredService<ServerClock>())
        {
            Host = settings.PublicUrl?.Host,
        });
        builder.Services.AddHostedService<SharingStartup>();
        builder.Services.AddHttpContextAccessor();
        builder.Services.AddSingleton<ISharingChangeSink, Audit.SharingAudit>();
        builder.Services.AddSingleton<PeckList.Core.Notifications.INotificationSink, NotificationRecorder>();
        builder.Services.AddHostedService<NotificationRetention>();
        builder.Services.AddSingleton<PeckList.Core.History.ITaskHistorySink, TaskHistoryRecorder>();
        builder.Services.AddHostedService<HistoryRetention>();
        builder.Services.AddHttpClient("push");
        // Provider pictures: public addresses (or the providers' own hosts) only, every redirect
        // checked again by ProviderPhoto (audit S2).
        builder.Services.AddHttpClient("photos").ConfigurePrimaryHttpMessageHandler(services => new SocketsHttpHandler
        {
            AllowAutoRedirect = false,
            ConnectCallback = Auth.PhotoAddresses.Connect(() =>
                services.GetRequiredService<LiveSettings>().Current.OidcProviders.Select(provider => provider.Authority.Host)),
        });
        builder.Services.AddHttpClient("updates", client =>
        {
            client.Timeout = TimeSpan.FromSeconds(20);
            client.DefaultRequestHeaders.UserAgent.ParseAdd($"PeckList/{Version}");
        });
        builder.Services.AddSingleton<IReleaseFeed, GitLabReleaseFeed>();
        builder.Services.AddSingleton<UpdateStatus>();
        builder.Services.AddHostedService<UpdateCheck>();
        builder.Services.AddHttpClient("telemetry", client =>
        {
            client.Timeout = TimeSpan.FromSeconds(30);
            client.DefaultRequestHeaders.UserAgent.ParseAdd($"PeckList/{Version}");
        });
        builder.Services.AddSingleton<ITelemetrySender, HttpTelemetrySender>();
        builder.Services.AddSingleton<ClientTelemetry>();
        builder.Services.AddSingleton<ICrashSender, HttpCrashSender>();
        builder.Services.AddSingleton<CrashReporting>();
        builder.Services.AddSingleton<TelemetryReport>();
        builder.Services.AddHostedService<TelemetryService>();
        builder.Services.AddSingleton<Auth.ProviderPhoto>();
        builder.Services.AddSingleton<VapidKeys>();
        builder.Services.AddSingleton<IPushSender, PushSender>();
        builder.Services.AddSingleton<PeckList.Core.Mail.IMailSender, Mail.SmtpMailSender>();
        builder.Services.AddSingleton<ReminderSender>();
        builder.Services.AddHostedService(provider => provider.GetRequiredService<ReminderSender>());
        builder.Services.AddSingleton<SyncService>();
        builder.Services.AddSingleton<PeckList.Core.Attachments.IAttachmentStore>(new Attachments.FileAttachmentStore(settings.AttachmentDir));
        builder.Services.AddHostedService<Attachments.AttachmentCleanup>();
        builder.Services.AddSingleton<PeckList.Core.Sharing.Groups>();
        builder.Services.AddSingleton<PeckList.Core.Sharing.Invites>();
        builder.Services.AddSingleton<PeckList.Core.Sharing.Ownership>();
        builder.Services.AddSingleton<PeckList.Core.Accounts.ServerGroupService>();
        builder.Services.AddSingleton<PeckList.Core.Sharing.ServerGroupProjection>();
        builder.Services.AddBackups(settings);
        builder.Services.AddSingleton(provider => new Core.Stats.StatsService(
            provider.GetRequiredService<Core.Stats.IStatsSource>(), provider.GetRequiredService<Core.Accounts.IAccountStore>(),
            provider.GetRequiredService<TimeProvider>()));
        builder.Services.AddSingleton<Audit.AuditLog>();
        builder.Services.AddHostedService(provider => provider.GetRequiredService<Audit.AuditLog>());
        builder.Services.AddHostedService<Audit.AuditRetention>();
        builder.Services.AddSingleton<AccountRemoval>();
        builder.Services.AddHostedService(provider => provider.GetRequiredService<AccountRemoval>());
        builder.Services.AddResponseHardening();
        builder.Services.AddDemoMode(settings);
        builder.Services.AddApiDocs();
        builder.Services.Configure<ForwardedHeadersOptions>(options =>
        {
            options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
            // Walk back through every trusted hop, not just the last one.
            options.ForwardLimit = null;
            options.KnownIPNetworks.Clear();
            options.KnownProxies.Clear();
            foreach (var network in ProxyTrust.Parse(settings.TrustedProxies))
            {
                options.KnownIPNetworks.Add(network);
            }
        });

        var app = builder.Build();
        if (loaded.PageProblem is { } problem)
        {
            app.Logger.LogError("Settings saved on the admin page were not used: {Problem}", problem);
        }
        if (settings.OidcProviders.Count > 0 && settings.PublicUrl is null)
        {
            app.Logger.LogWarning(
                "OIDC is on without PUBLIC_URL: sign-in callbacks use the address each request came in on. " +
                "Set PUBLIC_URL so it always matches the redirect URI registered with the provider.");
        }
        LogPipeline.UseLogContext(app, user: false);
        // Times every request; who made it is known by the time it is recorded.
        Audit.AuditLog.UseAuditLog(app);
        // Inside the access log, so the 500 is logged as before; the crash is kept for the admin too.
        app.UseServerCrashes();
        app.UseForwardedHeaders();
        app.UseResponseHardening(Analytics.ContentSecurityPolicy(settings.Umami));
        SharingStartup.UseSharingStartup(app);
        app.UseDemoMode(settings);
        app.UseAuthentication();
        app.UseImpersonation();
        app.UseApiKeyScopes();
        LogPipeline.UseLogContext(app, user: true);
        app.UseAuthorization();
        app.UseRateLimiter();
        app.UseApiDocs();

        app.MapHealthChecks("/healthz");
        app.MapApiDocs();
        app.MapGet("/api/info", (LiveSettings live) =>
            new ServerInfo("pecklist", Version, WorkspaceSchema.CurrentVersion, TimeZoneInfo.Local.Id, live.Current.AttachmentMaxMb,
                AppSignIn: settings.AuthMode != AuthMode.None, Demo: Demo.Info(settings)));
        app.MapAuth();
        app.MapGroup("/api").RequireAuthorization().RequirePasswordChanged().EnsureProfiles().MapSync().MapFriends().MapAccount().MapAccountEmail().MapAccountPasskeys().MapAttachments().MapNotifications().MapHistory().MapPush().MapProviderPicture().MapAppCheck().MapUpdates().MapApiKeys().MapClientTelemetry().MapCrashReports();
        app.MapGroup("/api/admin").RequireAuthorization().RequirePasswordChanged().MapAdmin().MapAdminEmail().MapAdminPasskeys().MapSettings().MapBackups().MapLogging().MapAudit().MapStats().MapSetup().MapTelemetry().MapAdminCrashReports();

        var webRoot = settings.WebRoot ?? Path.Combine(AppContext.BaseDirectory, "wwwroot");
        app.UseStaticSite(webRoot, app.Logger, noindex: settings.DemoMode, umami: settings.Umami);
        return app;
    }
}

public static partial class ServerApp
{
    /// <summary>This server's address for links people open: PUBLIC_URL, else the request's own.</summary>
    public static string Origin(HttpContext context) =>
        context.RequestServices.GetRequiredService<ServerSettings>().PublicUrl?.ToString().TrimEnd('/')
        ?? $"{context.Request.Scheme}://{context.Request.Host}";

    /// <summary>
    /// Stop the server once the answer is out (a restart to apply settings, or to restore a backup).
    /// A container with a restart policy (<c>restart: unless-stopped</c>) comes back on its own.
    /// </summary>
    public static void StopSoon(IHostApplicationLifetime lifetime) =>
        _ = Task.Delay(500).ContinueWith(_ => lifetime.StopApplication(), TaskScheduler.Default);
}

/// <summary>
/// What clients check before syncing: which app and schema version this server runs.
/// <paramref name="TimeZone"/>: the server's (<c>TZ</c>), the default for people who pick none.
/// <paramref name="AppSignIn"/>: the Android app may sign in and link providers through a browser
/// tab (<c>/auth/app/*</c>); the app checks it, since an older server has no such pages.
/// <paramref name="Demo"/>: set on a demo server, for the app's banner (PL-117).
/// </summary>
public sealed record ServerInfo(string Name, string Version, int SchemaVersion, string? TimeZone = null, int? AttachmentMaxMb = null,
    bool AppSignIn = false, DemoInfo? Demo = null);
