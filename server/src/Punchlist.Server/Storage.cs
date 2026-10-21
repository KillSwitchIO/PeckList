using Microsoft.Extensions.Diagnostics.HealthChecks;
using Punchlist.Core.Configuration;
using Punchlist.Core.Storage;
using Punchlist.Storage.Postgres;
using Punchlist.Storage.Sqlite;

namespace Punchlist.Server;

/// <summary>Picks the store from <c>DB_PROVIDER</c>, migrates it on start and reports it in /healthz.</summary>
public static class Storage
{
    public static IServiceCollection AddEntityStore(this IServiceCollection services, ServerSettings settings)
    {
        services.AddSingleton<IEntityStore>(_ => settings.DbProvider switch
        {
            DbProvider.Postgres => new PostgresEntityStore(settings.DbConnectionString!),
            _ => new SqliteEntityStore(settings.DbPath),
        });
        services.AddHostedService<DatabaseStartup>();
        services.AddHealthChecks().AddCheck<DatabaseHealthCheck>("database");
        return services;
    }

    /// <summary>Runs migrations before the server takes requests (unless DB_MIGRATE_ON_START=false).</summary>
    private sealed class DatabaseStartup(IEntityStore store, ServerSettings settings, ILogger<DatabaseStartup> logger)
        : IHostedService
    {
        public async Task StartAsync(CancellationToken cancellation)
        {
            if (!settings.DbMigrateOnStart)
            {
                logger.LogInformation("DB_MIGRATE_ON_START is false: not migrating the database");
                return;
            }
            await store.MigrateAsync(cancellation);
            logger.LogInformation("Database ready ({Provider})", settings.DbProvider);
        }

        public Task StopAsync(CancellationToken cancellation) => Task.CompletedTask;
    }

    private sealed class DatabaseHealthCheck(IEntityStore store) : IHealthCheck
    {
        public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellation) =>
            await store.PingAsync(cancellation)
                ? HealthCheckResult.Healthy()
                : HealthCheckResult.Unhealthy("the database does not answer");
    }
}
