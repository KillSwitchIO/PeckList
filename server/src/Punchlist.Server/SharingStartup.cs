using System.Diagnostics;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Punchlist.Core.Accounts;
using Punchlist.Core.Sharing;
using Punchlist.Core.Storage;

namespace Punchlist.Server;

/// <summary>
/// After migrations: load the sharing index and bring stored access in line with the rules
/// (a new version may have changed them, or a backup was restored). It runs in the background
/// while the server already listens (audit P3: at 300,000 entities nothing answered for a
/// minute): health checks say it is starting, and requests that need the index wait a little,
/// then answer 503 (<see cref="UseSharingStartup"/>). If loading fails the server stops, as before.
/// </summary>
public sealed class SharingStartup(
    SharingState sharing, Groups groups, Invites invites, ServerGroupProjection serverGroups, IEntityStore store, IAccountStore accounts,
    IHostApplicationLifetime lifetime, ILogger<SharingStartup> logger)
    : IHostedService
{
    private Task? loading;

    public Task StartAsync(CancellationToken cancellation)
    {
        loading = Task.Run(() => LoadAsync(lifetime.ApplicationStopping), CancellationToken.None);
        return Task.CompletedTask;
    }

    private async Task LoadAsync(CancellationToken stopping)
    {
        try
        {
            var watch = Stopwatch.StartNew();
            var users = (await accounts.ListAsync(stopping)).Select(account => account.Id);
            var changed = await sharing.LoadAsync(store, users, stopping);
            if (sharing.LastLoad is { } times)
            {
                logger.LogInformation(
                    "Sharing index loaded in {Seconds:0.0} s: {Entities} entities (read {Read:0.0} s, build {Build:0.0} s, access check {Check:0.0} s, store {Store:0.0} s)",
                    watch.Elapsed.TotalSeconds, times.Entities, times.Read.TotalSeconds, times.Build.TotalSeconds, times.Check.TotalSeconds, times.Store.TotalSeconds);
            }
            // Reading every document leaves a large heap behind; give it back now rather than
            // holding the peak for the life of the process (audit P1).
            GC.Collect(GC.MaxGeneration, GCCollectionMode.Aggressive, blocking: true, compacting: true);
            if (changed > 0) logger.LogInformation("Brought {Count} access entries in line with the sharing rules", changed);
            var settled = await groups.SettleAsync(stopping);
            if (settled > 0) logger.LogInformation("Handed on {Count} groups whose owner had left", settled);
            var invited = await invites.SettleAsync(stopping);
            if (invited > 0) logger.LogInformation("Settled invite assignments on {Count} tasks", invited);
            var projected = await serverGroups.ProjectAsync(stopping);
            if (projected > 0) logger.LogInformation("Brought {Count} server group entries in the app up to date", projected);
        }
        catch (OperationCanceledException) when (stopping.IsCancellationRequested)
        {
        }
        catch (Exception error)
        {
            logger.LogCritical(error, "Could not load the sharing index; stopping");
            lifetime.StopApplication();
        }
    }

    public async Task StopAsync(CancellationToken cancellation)
    {
        if (loading is not null) await loading.WaitAsync(cancellation).ConfigureAwait(ConfigureAwaitOptions.SuppressThrowing);
    }

    /// <summary>
    /// While the index loads, requests that need it wait up to <see cref="StartupWait"/>, then get
    /// <c>503 starting</c> with <c>Retry-After</c> (the app takes a 503 as offline and tries again).
    /// The server's info and its public pages answer at once.
    /// </summary>
    public static IApplicationBuilder UseSharingStartup(IApplicationBuilder app) =>
        app.Use(async (context, next) =>
        {
            var sharing = context.RequestServices.GetRequiredService<SharingState>();
            var path = context.Request.Path;
            var needsIndex = (path.StartsWithSegments("/api") || path.StartsWithSegments("/auth"))
                && !path.StartsWithSegments("/api/info") && !path.StartsWithSegments("/api/public");
            if (needsIndex && !sharing.Loaded.IsCompleted)
            {
                var wait = context.RequestServices.GetRequiredService<StartupWait>().Value;
                await Task.WhenAny(sharing.Loaded, Task.Delay(wait, context.RequestAborted));
                if (!sharing.Loaded.IsCompleted)
                {
                    context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
                    context.Response.Headers.RetryAfter = "5";
                    await context.Response.WriteAsJsonAsync(new { error = "starting" });
                    return;
                }
            }
            await next(context);
        });
}

/// <summary>How long a request that needs the sharing index waits for it at startup before a 503.</summary>
public sealed record StartupWait(TimeSpan Value)
{
    public static readonly StartupWait Default = new(TimeSpan.FromSeconds(10));
}

/// <summary>Healthy once the sharing index is loaded; "degraded" (still 200) while it loads, so a container is not restarted for starting.</summary>
public sealed class SharingHealthCheck(SharingState sharing) : IHealthCheck
{
    public Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellation = default) =>
        Task.FromResult(sharing.Loaded.IsCompleted
            ? HealthCheckResult.Healthy("sharing index loaded")
            : HealthCheckResult.Degraded("starting: loading the sharing index"));
}
