using Microsoft.Extensions.Diagnostics.HealthChecks;
using Punchlist.Core.Accounts;
using Punchlist.Core.Configuration;
using Punchlist.Core.Storage;
using Punchlist.Storage.Postgres;
using Punchlist.Storage.Sql;
using Punchlist.Storage.Sqlite;

namespace Punchlist.Server;

/// <summary>Picks the store from <c>DB_PROVIDER</c>, migrates it on start and reports it in /healthz.</summary>
public static class Storage
{
    public static IServiceCollection AddEntityStore(this IServiceCollection services, ServerSettings settings)
    {
        services.AddSingleton<SqlDatabase>(_ => settings.DbProvider switch
        {
            DbProvider.Postgres => new PostgresDatabase(settings.DbConnectionString!),
            _ => new SqliteDatabase(settings.DbPath),
        });
        services.AddSingleton<IDatabase>(provider => provider.GetRequiredService<SqlDatabase>());
        services.AddSingleton<IEntityStore, SqlEntityStore>();
        services.AddSingleton<IAccountStore, SqlAccountStore>();
        services.AddSingleton<IServerGroupStore, SqlServerGroupStore>();
        services.AddSingleton<IIdentityStore, SqlIdentityStore>();
        services.AddSingleton<Core.Audit.IAuditStore, SqlAuditStore>();
        services.AddSingleton<Core.Notifications.INotificationStore, SqlNotificationStore>();
        services.AddSingleton<Core.History.ITaskHistoryStore, SqlTaskHistoryStore>();
        services.AddSingleton<Core.Accounts.IApiKeyStore, SqlApiKeyStore>();
        services.AddSingleton<Core.Push.IPushStore, SqlPushStore>();
        services.AddSingleton<Core.Stats.IStatsSource, SqlStatsSource>();
        services.AddSingleton<ISecretStore, SqlSecretStore>();
        services.AddHostedService<DatabaseStartup>();
        services.AddHealthChecks().AddCheck<DatabaseHealthCheck>("database");
        return services;
    }

    /// <summary>Runs migrations before the server takes requests (unless DB_MIGRATE_ON_START=false).</summary>
    private sealed class DatabaseStartup(IDatabase store, ServerSettings settings, IServiceProvider services, ILogger<DatabaseStartup> logger)
        : IHostedService
    {
        public async Task StartAsync(CancellationToken cancellation)
        {
            if (settings.DbMigrateOnStart)
            {
                await store.MigrateAsync(cancellation);
                logger.LogInformation("Database ready ({Provider})", settings.DbProvider);
            }
            else
            {
                logger.LogInformation("DB_MIGRATE_ON_START is false: not migrating the database");
            }
            // A restore chosen on the admin page runs now, before anything loads the data.
            if (services.GetService<PendingRestore>() is { } restore) await restore.ApplyAsync(cancellation);
        }

        public Task StopAsync(CancellationToken cancellation) => Task.CompletedTask;
    }

    private sealed class DatabaseHealthCheck(IDatabase store) : IHealthCheck
    {
        public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellation) =>
            await store.PingAsync(cancellation)
                ? HealthCheckResult.Healthy()
                : HealthCheckResult.Unhealthy("the database does not answer");
    }
}
